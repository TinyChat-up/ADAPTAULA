-- Adaptaula · 010 · Cuota mensual de análisis (plans.features.monthly_analyses)
-- Analizar un material NO consume la cuota de adaptaciones: tiene su propio contador y su propio límite.
--   · La reserva es atómica con el encolado (misma transacción, lock por workspace+tipo).
--   · Una reutilización de caché nunca llega aquí: no encola, no reserva.
--   · Si el job termina fallido sin entregar análisis, la reserva se devuelve (idempotente).

-- ---------------------------------------------------------------------------
-- Libro de movimientos: nuevo tipo 'analysis'
-- ---------------------------------------------------------------------------

alter table public.usage_events drop constraint usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('adaptation', 'image', 'block_revision', 'analysis'));

-- ---------------------------------------------------------------------------
-- Límites iniciales por plan. Viven en plans.features: se ajustan sin desplegar.
-- No se pisa un valor ya configurado.
-- ---------------------------------------------------------------------------

update public.plans p
   set features = p.features || jsonb_build_object('monthly_analyses', v.units)
  from (values ('free', 10), ('pro', 100), ('max', 250)) as v (slug, units)
 where p.slug = v.slug
   and not (p.features ? 'monthly_analyses');

-- ---------------------------------------------------------------------------
-- consume_quota: el tipo 'analysis' lee su límite de features.monthly_analyses
-- (un plan sin esa clave no permite analizar: falla cerrado, igual que block_revision).
-- ---------------------------------------------------------------------------

create or replace function public.consume_quota(
  p_workspace uuid,
  p_kind text,
  p_units int,
  p_user uuid,
  p_job uuid,
  p_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_limit int;
  v_used int;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_units is null or p_units <= 0 then
    raise exception 'units must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_kind, 0));

  select * into v_plan from public.workspace_plan(p_workspace);
  if v_plan.id is null then
    raise exception 'no plan resolved for workspace' using errcode = 'P0002';
  end if;

  v_limit := case p_kind
    when 'adaptation' then v_plan.monthly_adaptations
    when 'image' then v_plan.monthly_images
    when 'block_revision' then coalesce((v_plan.features ->> 'monthly_block_revisions')::int, 0)
    when 'analysis' then coalesce((v_plan.features ->> 'monthly_analyses')::int, 0)
  end;
  if v_limit is null then
    raise exception 'unknown quota kind: %', p_kind using errcode = '22023';
  end if;

  select cp.period_start, cp.period_end into v_start, v_end from public.current_period(p_workspace) cp;

  select coalesce(sum(e.units), 0)::int into v_used
  from public.usage_events e
  where e.workspace_id = p_workspace and e.kind = p_kind and e.created_at >= v_start and e.created_at < v_end;

  if exists (select 1 from public.usage_events e where e.idempotency_key = p_key) then
    return jsonb_build_object('allowed', true, 'duplicate', true, 'used', v_used, 'limit', v_limit, 'period_end', v_end);
  end if;

  if v_used + p_units > v_limit then
    return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit, 'period_end', v_end);
  end if;

  insert into public.usage_events (workspace_id, user_id, kind, units, job_id, idempotency_key)
  values (p_workspace, p_user, p_kind, p_units, p_job, p_key);

  return jsonb_build_object('allowed', true, 'used', v_used + p_units, 'limit', v_limit, 'period_end', v_end);
end;
$$;

-- ---------------------------------------------------------------------------
-- workspace_usage: añade el contador de análisis para la UI (/app/uso)
-- ---------------------------------------------------------------------------

create or replace function public.workspace_usage(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_start timestamptz;
  v_end timestamptz;
  v_used jsonb;
begin
  if not public.is_workspace_member(ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.workspace_plan(ws);
  select cp.period_start, cp.period_end into v_start, v_end from public.current_period(ws) cp;

  select coalesce(jsonb_object_agg(t.kind, t.used), '{}'::jsonb) into v_used
  from (
    select e.kind, sum(e.units)::int as used
    from public.usage_events e
    where e.workspace_id = ws and e.created_at >= v_start and e.created_at < v_end
    group by e.kind
  ) t;

  return jsonb_build_object(
    'plan', jsonb_build_object('slug', v_plan.slug, 'name', v_plan.name),
    'period_start', v_start,
    'period_end', v_end,
    'adaptations', jsonb_build_object('used', coalesce((v_used ->> 'adaptation')::int, 0), 'limit', v_plan.monthly_adaptations),
    'images', jsonb_build_object('used', coalesce((v_used ->> 'image')::int, 0), 'limit', v_plan.monthly_images),
    'block_revisions', jsonb_build_object(
      'used', coalesce((v_used ->> 'block_revision')::int, 0),
      'limit', coalesce((v_plan.features ->> 'monthly_block_revisions')::int, 0)
    ),
    'analyses', jsonb_build_object(
      'used', coalesce((v_used ->> 'analysis')::int, 0),
      'limit', coalesce((v_plan.features ->> 'monthly_analyses')::int, 0)
    ),
    'max_profiles', v_plan.max_profiles,
    'max_classes', v_plan.max_classes,
    'features', v_plan.features
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cola de análisis: reserva al encolar y devolución al fallar sin resultado
-- ---------------------------------------------------------------------------

-- Encola el análisis de un material ya subido. Idempotente: si ya hay uno activo, devuelve ese (sin reservar de nuevo).
-- Un job nuevo reserva 1 análisis; si el plan no tiene cuota, no se crea nada ('analysis_quota_exceeded').
create or replace function public.enqueue_analysis_job(
  p_material uuid,
  p_requested_by uuid,
  p_input jsonb,
  p_max_active int
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_material public.materials;
  v_job uuid;
  v_active int;
  v_quota jsonb;
begin
  select * into v_material from public.materials m where m.id = p_material for update;
  if not found then
    raise exception 'material_not_found' using errcode = 'P0002';
  end if;

  if v_material.status not in ('uploaded', 'failed', 'analyzed') then
    select j.id into v_job from public.adaptation_jobs j
      where j.material_id = p_material and j.kind = 'analyze' and j.status in ('queued', 'processing');
    if v_job is not null then
      return v_job;
    end if;
    raise exception 'material_not_ready' using errcode = 'P0001';
  end if;

  select count(*) into v_active from public.adaptation_jobs j
    where j.workspace_id = v_material.workspace_id and j.kind = 'analyze' and j.status in ('queued', 'processing');
  if v_active >= p_max_active then
    raise exception 'analysis_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.adaptation_jobs (workspace_id, material_id, requested_by, kind, input, status)
  values (v_material.workspace_id, p_material, p_requested_by, 'analyze', coalesce(p_input, '{}'::jsonb), 'queued')
  returning id into v_job;

  v_quota := public.consume_quota(v_material.workspace_id, 'analysis', 1, p_requested_by, v_job, 'analysis:' || v_job::text);
  if not coalesce((v_quota ->> 'allowed')::boolean, false) then
    -- Deshace también la inserción del job: esta función es una sola transacción.
    raise exception 'analysis_quota_exceeded' using errcode = 'P0001',
      detail = format('used=%s limit=%s period_end=%s', v_quota ->> 'used', v_quota ->> 'limit', v_quota ->> 'period_end');
  end if;

  update public.materials set status = 'queued', failure_code = null where id = p_material;
  return v_job;
end;
$$;

-- Reclama el job para procesarlo. Devuelve el job (jsonb) o null si otro procesador lo tiene,
-- si todavía está en espera de reintento o si agotó sus intentos (en ese caso se devuelve la reserva).
create or replace function public.claim_analysis_job(p_job uuid, p_lease_seconds int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.adaptation_jobs;
  v_material uuid;
begin
  update public.adaptation_jobs j
     set status = 'failed', locked_until = null, completed_at = now(),
         error = jsonb_build_object('code', 'attempts_exhausted')
   where j.id = p_job and j.kind = 'analyze' and j.status in ('queued', 'processing')
     and j.attempts >= j.max_attempts and (j.locked_until is null or j.locked_until <= now())
  returning j.material_id into v_material;
  if found then
    update public.materials
       set status = case when analysis is not null then 'analyzed' else 'failed' end,
           failure_code = 'attempts_exhausted'
     where id = v_material;
    perform public.refund_quota('analysis:' || p_job::text);
    return null;
  end if;

  update public.adaptation_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()),
         step = 'analyzing',
         progress = greatest(j.progress, 10)
   where j.id = p_job and j.kind = 'analyze' and j.attempts < j.max_attempts
     and (
       (j.status = 'queued' and (j.locked_until is null or j.locked_until <= now()))
       or (j.status = 'processing' and j.locked_until <= now())
     )
  returning * into v_job;
  if not found then
    return null;
  end if;

  update public.materials set status = 'analyzing' where id = v_job.material_id;
  return to_jsonb(v_job);
end;
$$;

-- Registra un fallo. Reintenta (con espera) si procede y quedan intentos; si no, cierra el job y
-- devuelve la reserva: no se entregó ningún análisis. Un reanálisis fallido conserva el análisis anterior.
create or replace function public.fail_analysis_job(
  p_job uuid,
  p_attempt int,
  p_code text,
  p_retryable boolean,
  p_backoff_seconds int
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.adaptation_jobs;
begin
  select * into v_job from public.adaptation_jobs j where j.id = p_job for update;
  if not found or v_job.status <> 'processing' or v_job.attempts <> p_attempt then
    return 'ignored';
  end if;

  if p_retryable and v_job.attempts < v_job.max_attempts then
    update public.adaptation_jobs
       set status = 'queued', step = null, locked_until = now() + make_interval(secs => p_backoff_seconds),
           error = jsonb_build_object('code', p_code)
     where id = p_job;
    update public.materials set status = 'queued' where id = v_job.material_id;
    return 'retry';
  end if;

  update public.adaptation_jobs
     set status = 'failed', step = null, locked_until = null, completed_at = now(),
         error = jsonb_build_object('code', p_code)
   where id = p_job;
  update public.materials
     set status = case when analysis is not null then 'analyzed' else 'failed' end,
         failure_code = p_code
   where id = v_job.material_id;
  perform public.refund_quota('analysis:' || p_job::text);
  return 'failed';
end;
$$;

revoke execute on function public.consume_quota(uuid, text, int, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, text, int, uuid, uuid, text) to service_role;
revoke execute on function public.workspace_usage(uuid) from public, anon;
grant execute on function public.workspace_usage(uuid) to authenticated, service_role;
revoke execute on function public.enqueue_analysis_job(uuid, uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public.claim_analysis_job(uuid, int) from public, anon, authenticated;
revoke execute on function public.fail_analysis_job(uuid, int, text, boolean, int) from public, anon, authenticated;
grant execute on function public.enqueue_analysis_job(uuid, uuid, jsonb, int) to service_role;
grant execute on function public.claim_analysis_job(uuid, int) to service_role;
grant execute on function public.fail_analysis_job(uuid, int, text, boolean, int) to service_role;
