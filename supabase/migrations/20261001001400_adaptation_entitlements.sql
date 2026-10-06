-- Adaptaula · 014 · Entitlements de adaptaciones: reservar / consumir / liberar (docs/BILLING.md § Adaptaciones)
-- Reutiliza lo existente: el libro `usage_events` (movimientos +1 / −1 con clave idempotente), `workspace_plan`, `current_period`,
-- el mismo lock por workspace+tipo que `consume_quota` y `refund_quota`. Lo único que el modelo actual no puede representar:
--   · el ESTADO de una unidad por adaptación (reservada → consumida | liberada), con identidad propia: una adaptación, una unidad;
--   · «sin límite» (plans.monthly_adaptations es un entero obligatorio): se expresa con features.unlimited_adaptations = true;
--   · acoplar la entrega con el consumo y la cancelación con la liberación en la misma transacción.
-- No fija ningún límite comercial ni toca el sistema de cuotas de análisis.

create table public.adaptation_entitlements (
  adaptation_id uuid primary key references public.adaptations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  state text not null check (state in ('reserved', 'consumed', 'released')),
  -- Clave del movimiento +1 en usage_events; la devolución usa 'refund:' || reserve_key (refund_quota).
  reserve_key text not null unique,
  -- Cómo estaba configurado el límite al reservar. Una reserva mantiene su identidad aunque el plan cambie después.
  availability_at_reserve text not null check (availability_at_reserve in ('finite', 'unlimited')),
  limit_at_reserve int check (limit_at_reserve >= 0),
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text check (char_length(release_reason) <= 60),
  check ((state = 'consumed') = (consumed_at is not null)),
  check ((state = 'released') = (released_at is not null)),
  check ((availability_at_reserve = 'finite') = (limit_at_reserve is not null))
);

create index adaptation_entitlements_ws_idx on public.adaptation_entitlements (workspace_id, reserved_at);

create trigger adaptation_entitlements_workspace
  before insert or update on public.adaptation_entitlements
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

alter table public.adaptation_entitlements enable row level security;
revoke all on public.adaptation_entitlements from anon;
revoke insert, update, delete on public.adaptation_entitlements from authenticated;
create policy "adaptation_entitlements: leer si soy miembro" on public.adaptation_entitlements
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Límite: finite | unlimited | unavailable (nunca un null convertido en cero ni en infinito)
-- ---------------------------------------------------------------------------

create or replace function public.adaptation_entitlement_limit(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_flag jsonb;
begin
  select * into v_plan from public.workspace_plan(p_workspace);
  if v_plan.id is null then
    return jsonb_build_object('availability', 'unavailable', 'reason', 'no_plan');
  end if;
  v_flag := v_plan.features -> 'unlimited_adaptations';
  if v_flag is not null then
    if v_flag = 'true'::jsonb then
      return jsonb_build_object('availability', 'unlimited', 'limit', null);
    elsif v_flag <> 'false'::jsonb then
      return jsonb_build_object('availability', 'unavailable', 'reason', 'misconfigured');
    end if;
  end if;
  return jsonb_build_object('availability', 'finite', 'limit', v_plan.monthly_adaptations);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reserva: atómica, idempotente por adaptación, con el mismo lock que consume_quota('adaptation')
-- ---------------------------------------------------------------------------

create or replace function public.reserve_adaptation_entitlement(p_adaptation uuid, p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_a public.adaptations;
  v_e public.adaptation_entitlements;
  v_limit jsonb;
  v_used int;
  v_start timestamptz;
  v_end timestamptz;
  v_key text := 'adaptation:' || p_adaptation::text || ':reserve';
begin
  select * into v_a from public.adaptations a where a.id = p_adaptation;
  if not found then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  -- El saldo es el del workspace DE LA ADAPTACIÓN, nunca el de quien llama.
  perform pg_advisory_xact_lock(hashtextextended(v_a.workspace_id::text || ':adaptation', 0));

  select * into v_e from public.adaptation_entitlements e where e.adaptation_id = p_adaptation;
  if found then
    return jsonb_build_object('allowed', v_e.state <> 'released', 'duplicate', true, 'state', v_e.state);
  end if;

  v_limit := public.adaptation_entitlement_limit(v_a.workspace_id);
  if v_limit ->> 'availability' = 'unavailable' then
    return jsonb_build_object('allowed', false, 'reason', 'unavailable', 'detail', v_limit ->> 'reason');
  end if;

  select cp.period_start, cp.period_end into v_start, v_end from public.current_period(v_a.workspace_id) cp;
  select coalesce(sum(u.units), 0)::int into v_used from public.usage_events u
    where u.workspace_id = v_a.workspace_id and u.kind = 'adaptation' and u.created_at >= v_start and u.created_at < v_end;

  if v_limit ->> 'availability' = 'finite' and v_used + 1 > (v_limit ->> 'limit')::int then
    return jsonb_build_object('allowed', false, 'reason', 'exhausted', 'used', v_used, 'limit', (v_limit ->> 'limit')::int, 'period_end', v_end);
  end if;

  insert into public.usage_events (workspace_id, user_id, kind, units, job_id, idempotency_key, metadata)
  values (v_a.workspace_id, p_user, 'adaptation', 1, null, v_key, jsonb_build_object('adaptation_id', p_adaptation));
  insert into public.adaptation_entitlements (adaptation_id, workspace_id, state, reserve_key, availability_at_reserve, limit_at_reserve)
  values (p_adaptation, v_a.workspace_id, 'reserved', v_key, v_limit ->> 'availability', nullif(v_limit ->> 'limit', '')::int);
  return jsonb_build_object('allowed', true, 'duplicate', false, 'state', 'reserved', 'used', v_used + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Consumo: solo con una ENTREGA válida verificada aquí (estado, versión actual, revisión, delivered_at)
-- ---------------------------------------------------------------------------

create or replace function public.consume_adaptation_entitlement(p_adaptation uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_a public.adaptations;
  v_e public.adaptation_entitlements;
begin
  select * into v_a from public.adaptations a where a.id = p_adaptation for update;
  if not found then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_a.workspace_id::text || ':adaptation', 0));
  select * into v_e from public.adaptation_entitlements e where e.adaptation_id = p_adaptation for update;
  if not found then
    return jsonb_build_object('consumed', false, 'reason', 'not_reserved');
  end if;
  if v_e.state = 'consumed' then
    return jsonb_build_object('consumed', true, 'duplicate', true);
  end if;
  if v_e.state = 'released' then
    return jsonb_build_object('consumed', false, 'reason', 'released');
  end if;
  if not (v_a.status = 'ready' and v_a.current_version > 0 and v_a.delivered_at is not null
          and exists (select 1 from public.adaptation_versions v
                       where v.adaptation_id = p_adaptation and v.version = v_a.current_version
                         and v.review ->> 'verdict' in ('approved', 'approved_with_warnings'))) then
    return jsonb_build_object('consumed', false, 'reason', 'not_delivered');
  end if;
  update public.adaptation_entitlements e set state = 'consumed', consumed_at = now() where e.adaptation_id = p_adaptation;
  return jsonb_build_object('consumed', true, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Liberación: solo una reserva que nunca produjo entrega, de una adaptación cerrada (cancelada)
-- ---------------------------------------------------------------------------

create or replace function public.release_adaptation_entitlement(p_adaptation uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_a public.adaptations;
  v_e public.adaptation_entitlements;
begin
  select * into v_a from public.adaptations a where a.id = p_adaptation for update;
  if not found then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_a.workspace_id::text || ':adaptation', 0));
  select * into v_e from public.adaptation_entitlements e where e.adaptation_id = p_adaptation for update;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'not_reserved');
  end if;
  if v_e.state = 'released' then
    return jsonb_build_object('released', true, 'duplicate', true);
  end if;
  if v_e.state = 'consumed' or v_a.delivered_at is not null then
    return jsonb_build_object('released', false, 'reason', 'delivered');
  end if;
  if v_a.status <> 'cancelled' then
    return jsonb_build_object('released', false, 'reason', 'not_closed');
  end if;
  perform public.refund_quota(v_e.reserve_key);
  update public.adaptation_entitlements e set state = 'released', released_at = now(), release_reason = left(coalesce(p_reason, 'cancelled'), 60) where e.adaptation_id = p_adaptation;
  return jsonb_build_object('released', true, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Observabilidad: workspace + periodo, y una adaptación
-- ---------------------------------------------------------------------------

create or replace function public.adaptation_entitlement_usage(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit jsonb := public.adaptation_entitlement_limit(p_workspace);
  v_start timestamptz;
  v_end timestamptz;
  v_reserved int;
  v_consumed int;
  v_ledger int;
begin
  select cp.period_start, cp.period_end into v_start, v_end from public.current_period(p_workspace) cp;
  select count(*) filter (where e.state = 'reserved')::int, count(*) filter (where e.state = 'consumed')::int into v_reserved, v_consumed
    from public.adaptation_entitlements e where e.workspace_id = p_workspace and e.reserved_at >= v_start and e.reserved_at < v_end;
  select coalesce(sum(u.units), 0)::int into v_ledger from public.usage_events u
    where u.workspace_id = p_workspace and u.kind = 'adaptation' and u.created_at >= v_start and u.created_at < v_end;
  return jsonb_build_object(
    'availability', v_limit ->> 'availability',
    'limit', nullif(v_limit ->> 'limit', '')::int,
    'reserved', v_reserved,
    'consumed', v_consumed,
    -- Nunca un número inventado: sin límite o sin configuración no hay «disponible».
    'available', case when v_limit ->> 'availability' = 'finite' then greatest((v_limit ->> 'limit')::int - v_ledger, 0) else null end,
    'ledger_used', v_ledger,
    'period_start', v_start,
    'period_end', v_end
  );
end;
$$;

create or replace function public.get_adaptation_entitlement(p_adaptation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'adaptation_id', e.adaptation_id, 'workspace_id', e.workspace_id, 'state', e.state,
    'reserve_key', e.reserve_key, 'release_key', case when e.state = 'released' then 'refund:' || e.reserve_key else null end,
    'availability_at_reserve', e.availability_at_reserve, 'limit_at_reserve', e.limit_at_reserve,
    'reserved_at', e.reserved_at, 'consumed_at', e.consumed_at, 'released_at', e.released_at, 'release_reason', e.release_reason
  ) from public.adaptation_entitlements e where e.adaptation_id = p_adaptation;
$$;

-- ---------------------------------------------------------------------------
-- Acoplamientos transaccionales (se redefinen las funciones de la 013; mismas firmas salvo create_adaptation)
-- ---------------------------------------------------------------------------

-- Cancelar libera la reserva de una adaptación nunca entregada en la MISMA transacción: ni «cancelada con cuota viva» ni al revés.
create or replace function public.transition_adaptation(p_adaptation uuid, p_from text, p_to text, p_failure_code text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.adaptation_transition_allowed(p_from, p_to) then
    raise exception 'invalid_transition' using errcode = 'P0001', detail = format('%s -> %s', p_from, p_to);
  end if;
  update public.adaptations a
     set status = p_to,
         failure_code = case when p_to = 'failed' then p_failure_code when p_to in ('queued', 'generation_queued', 'planning', 'generating') then null else a.failure_code end
   where a.id = p_adaptation and a.status = p_from;
  if found and p_to = 'cancelled' then
    perform public.release_adaptation_entitlement(p_adaptation, 'cancelled');
  end if;
  return found;
end;
$$;

-- Entregar y consumir son lo mismo: si hay reserva, `ready` y el consumo ocurren juntos o ninguno (se revierte todo).
create or replace function public.finalize_adaptation(p_adaptation uuid, p_job uuid, p_attempt int, p_version uuid, p_review jsonb, p_outcome text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_adaptation public.adaptations;
  v_version public.adaptation_versions;
  v_target text := case p_outcome when 'ready' then 'ready' else 'blocked' end;
  v_consume jsonb;
begin
  if p_outcome not in ('ready', 'blocked') then
    raise exception 'unknown_outcome' using errcode = '22023';
  end if;
  if p_job is not null and not exists (
    select 1 from public.adaptation_jobs j where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt and j.adaptation_id = p_adaptation
  ) then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
  select * into v_adaptation from public.adaptations a where a.id = p_adaptation for update;
  select * into v_version from public.adaptation_versions v where v.id = p_version and v.adaptation_id = p_adaptation;
  if v_adaptation.id is null or v_version.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_adaptation.status = v_target then
    return jsonb_build_object('finalized', true, 'duplicate', true, 'status', v_adaptation.status);
  end if;
  if not public.adaptation_transition_allowed(v_adaptation.status, v_target) then
    raise exception 'invalid_transition' using errcode = 'P0001', detail = format('%s -> %s', v_adaptation.status, v_target);
  end if;
  update public.adaptation_versions v set review = p_review where v.id = p_version and v.review is null;
  update public.adaptations a
     set status = v_target,
         current_version = case when v_target = 'ready' then v_version.version else a.current_version end,
         delivered_at = case when v_target = 'ready' then coalesce(a.delivered_at, now()) else a.delivered_at end,
         failure_code = null
   where a.id = p_adaptation;
  if v_target = 'ready' then
    v_consume := public.consume_adaptation_entitlement(p_adaptation);
    -- Sin reserva (entitlements no activados para esta adaptación) no hay nada que consumir; cualquier otra negativa revierte la entrega.
    if not coalesce((v_consume ->> 'consumed')::boolean, false) and v_consume ->> 'reason' <> 'not_reserved' then
      raise exception 'entitlement_not_consumable' using errcode = 'P0001', detail = v_consume ->> 'reason';
    end if;
  end if;
  return jsonb_build_object('finalized', true, 'duplicate', false, 'status', v_target);
end;
$$;

-- La reserva se hace en la misma transacción que la fila: nunca existe una adaptación huérfana que ya haya podido ejecutar IA sin cuota.
drop function public.create_adaptation(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text);
create or replace function public.create_adaptation(
  p_workspace uuid,
  p_material uuid,
  p_user uuid,
  p_learner uuid,
  p_type text,
  p_title text,
  p_request_key text,
  p_versions jsonb,
  p_context jsonb,
  p_context_fp text,
  p_analysis_fp text,
  p_reserve boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_material public.materials;
  v_reserve jsonb;
begin
  if p_request_key is not null then
    select a.id into v_id from public.adaptations a where a.workspace_id = p_workspace and a.request_key = p_request_key;
    if v_id is not null then
      if p_reserve then
        perform public.reserve_adaptation_entitlement(v_id, p_user);
      end if;
      return v_id;
    end if;
  end if;

  select * into v_material from public.materials m where m.id = p_material and m.workspace_id = p_workspace;
  if not found then
    raise exception 'material_not_found' using errcode = 'P0002';
  end if;
  if v_material.status <> 'analyzed' or v_material.analysis is null then
    raise exception 'material_not_analyzed' using errcode = 'P0001';
  end if;

  insert into public.adaptations (workspace_id, material_id, learner_profile_id, title, adaptation_type, profile_snapshot,
                                  status, created_by, request_key, pipeline_versions, context_snapshot, context_fingerprint, analysis_fingerprint)
  values (p_workspace, p_material, p_learner, p_title, p_type, jsonb_build_object('minimized', true),
          'queued', p_user, p_request_key, p_versions, p_context, p_context_fp, p_analysis_fp)
  returning id into v_id;

  if p_reserve then
    v_reserve := public.reserve_adaptation_entitlement(v_id, p_user);
    if not coalesce((v_reserve ->> 'allowed')::boolean, false) then
      -- Una sola transacción: esto deshace también la inserción de la adaptación.
      raise exception 'entitlement_%', case when v_reserve ->> 'reason' = 'exhausted' then 'exhausted' else 'unavailable' end using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'adaptation_entitlement_limit(uuid)',
    'reserve_adaptation_entitlement(uuid, uuid)',
    'consume_adaptation_entitlement(uuid)',
    'release_adaptation_entitlement(uuid, text)',
    'adaptation_entitlement_usage(uuid)',
    'get_adaptation_entitlement(uuid)',
    'create_adaptation(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
