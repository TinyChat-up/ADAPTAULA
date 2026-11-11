-- Adaptaula · 035 · Piloto V3 desde la interfaz: libro de gasto, informe de costes y huella de reglas (ADR-046)
--
-- 1. record_ai_run guarda también ai_runs.rules_sha256 (034): la huella del paquete de reglas de una llamada v3, nunca su texto.
--
-- 2. Libro de gasto (ai_spend_reservations). En un despliegue con AI_PILOT_BUDGET_USD, CADA petición de pago a un proveedor de
--    IA se cuenta antes de enviarse y reserva su cota máxima; la reserva se admite solo si lo comprometido de la campaña más la
--    nueva cota cabe en el presupuesto. Comprometido = lo liquidado con su coste real + lo pendiente o retenido con su cota entera:
--    un trabajo simultáneo, un error, una respuesta sin uso conocido o una liquidación que nunca llegó cuentan siempre por su máximo.
--    Un bloqueo transaccional por campaña serializa las admisiones (dos peticiones simultáneas no pueden pasar ambas el límite).
--    Sin políticas para usuarios: solo el servidor (service_role) lo usa, a través de las funciones.
--
-- 3. ai_cost_report: una fila por llamada registrada en ai_runs, con su fase, modelo, tokens y coste, para la vista SQL privada
--    y la exportación CSV/JSON del piloto. Solo service_role. Sin datos del alumnado: el perfil aparece solo por su id.

-- 1 · record_ai_run con rules_sha256 -----------------------------------------------------------------------------------------

create or replace function public.record_ai_run(p_row jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.ai_runs (
    workspace_id, job_id, adaptation_id, material_id, purpose, model_alias, provider, model, prompt_key, prompt_version, effort,
    input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens, estimated_cost_usd, latency_ms, status, error_code,
    attempt, schema_version, call_kind, reasoning_tokens, input_fingerprint, output_fingerprint, job_attempt, rules_sha256
  ) values (
    (p_row ->> 'workspace_id')::uuid, (p_row ->> 'job_id')::uuid, (p_row ->> 'adaptation_id')::uuid, (p_row ->> 'material_id')::uuid,
    p_row ->> 'purpose', p_row ->> 'model_alias', p_row ->> 'provider', p_row ->> 'model', p_row ->> 'prompt_key',
    (p_row ->> 'prompt_version')::int, p_row ->> 'effort',
    coalesce((p_row ->> 'input_tokens')::int, 0), coalesce((p_row ->> 'output_tokens')::int, 0),
    coalesce((p_row ->> 'cached_input_tokens')::int, 0), coalesce((p_row ->> 'cache_creation_input_tokens')::int, 0),
    (p_row ->> 'estimated_cost_usd')::numeric, (p_row ->> 'latency_ms')::int, p_row ->> 'status', p_row ->> 'error_code',
    coalesce((p_row ->> 'attempt')::smallint, 1), (p_row ->> 'schema_version')::int, p_row ->> 'call_kind',
    (p_row ->> 'reasoning_tokens')::int, p_row ->> 'input_fingerprint', p_row ->> 'output_fingerprint', (p_row ->> 'job_attempt')::smallint,
    p_row ->> 'rules_sha256'
  )
  on conflict do nothing;
  return found;
end;
$$;

-- 2 · Libro de gasto ---------------------------------------------------------------------------------------------------------

create table public.ai_spend_reservations (
  id uuid primary key default gen_random_uuid(),
  campaign text not null check (campaign ~ '^[a-z0-9][a-z0-9-]{2,40}$'),
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 120),
  counted_input_tokens int not null check (counted_input_tokens >= 0),
  max_output_tokens int not null check (max_output_tokens > 0),
  reserved_usd numeric(10, 6) not null check (reserved_usd > 0),
  settled_usd numeric(10, 6) check (settled_usd >= 0),
  -- pending: admitida, sin resultado; settled: liquidada con su coste real; kept: error o uso desconocido (cuenta su cota).
  state text not null default 'pending' check (state in ('pending', 'settled', 'kept')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((state = 'settled') = (settled_usd is not null)),
  check ((state = 'pending') = (settled_at is null))
);

create index ai_spend_reservations_campaign_idx on public.ai_spend_reservations (campaign, created_at);

alter table public.ai_spend_reservations enable row level security;
revoke all on table public.ai_spend_reservations from public, anon, authenticated;

/** Lo comprometido de una campaña: lo liquidado por su coste real (o su cota, si fuera mayor no se reduce), lo demás por su cota. */
create or replace function public.ai_spend_committed(p_campaign text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when state = 'settled' then settled_usd else reserved_usd end), 0)
  from public.ai_spend_reservations where campaign = p_campaign;
$$;

create or replace function public.ai_spend_admit(
  p_campaign text, p_budget_usd numeric, p_provider text, p_model text, p_counted_input_tokens int, p_max_output_tokens int, p_reserved_usd numeric
)
returns table (reservation_id uuid, committed_usd numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_committed numeric;
begin
  if p_budget_usd is null or p_budget_usd <= 0 or p_reserved_usd is null or p_reserved_usd <= 0 then
    raise exception 'invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_spend:' || p_campaign));
  v_committed := public.ai_spend_committed(p_campaign);
  if v_committed + p_reserved_usd > p_budget_usd then
    return query select null::uuid, v_committed;
    return;
  end if;
  return query
    insert into public.ai_spend_reservations (campaign, provider, model, counted_input_tokens, max_output_tokens, reserved_usd)
    values (p_campaign, p_provider, p_model, p_counted_input_tokens, p_max_output_tokens, p_reserved_usd)
    returning id, v_committed + p_reserved_usd;
end;
$$;

-- Liquida una reserva pendiente: con su coste real (settled) o, sin él, conservando su cota (kept). Una sola vez.
create or replace function public.ai_spend_settle(p_reservation uuid, p_settled_usd numeric)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.ai_spend_reservations
     set state = case when p_settled_usd is null then 'kept' else 'settled' end,
         settled_usd = case when p_settled_usd is null then null else greatest(p_settled_usd, 0) end,
         settled_at = now()
   where id = p_reservation and state = 'pending';
  return found;
end;
$$;

-- Resumen de una campaña para el informe: comprometido, liquidado real y lo que sigue pendiente o retenido.
create or replace function public.ai_spend_summary(p_campaign text)
returns table (committed_usd numeric, settled_usd numeric, pending_count bigint, pending_usd numeric, kept_count bigint, kept_usd numeric, requests bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select public.ai_spend_committed(p_campaign),
         coalesce(sum(r.settled_usd) filter (where r.state = 'settled'), 0),
         count(*) filter (where r.state = 'pending'),
         coalesce(sum(r.reserved_usd) filter (where r.state = 'pending'), 0),
         count(*) filter (where r.state = 'kept'),
         coalesce(sum(r.reserved_usd) filter (where r.state = 'kept'), 0),
         count(*)
  from public.ai_spend_reservations r where r.campaign = p_campaign;
$$;

-- 3 · Informe de costes ------------------------------------------------------------------------------------------------------

create or replace function public.ai_cost_report(p_since timestamptz, p_workspace uuid default null)
returns table (
  created_at timestamptz, workspace_id uuid, material_id uuid, material_title text, adaptation_id uuid, learner_profile_id uuid,
  planner_version int, rules_package text, phase text, purpose text, call_kind text, attempt smallint, job_attempt smallint,
  status text, error_code text, provider text, model text, model_alias text, prompt_key text, prompt_version int, effort text,
  input_tokens int, cached_input_tokens int, cache_creation_input_tokens int, output_tokens int, reasoning_tokens int,
  estimated_cost_usd numeric, latency_ms int, rules_sha256 text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.created_at, r.workspace_id, r.material_id, m.title, r.adaptation_id, a.learner_profile_id,
         nullif(a.pipeline_versions -> 'planner' ->> 'prompt_version', '')::int,
         a.pipeline_versions -> 'rules' ->> 'package_sha256',
         case
           when r.purpose = 'analyze' then 'analysis'
           when r.purpose = 'plan' then 'planning'
           when r.purpose in ('generate', 'revise_block') then 'generation'
           when r.purpose = 'review' then 'review'
           when r.purpose in ('image_brief', 'image', 'image_review') then 'images'
           else 'visual_supports'
         end,
         r.purpose, r.call_kind, r.attempt, r.job_attempt, r.status, r.error_code, r.provider, r.model, r.model_alias, r.prompt_key,
         r.prompt_version, r.effort, r.input_tokens, r.cached_input_tokens, r.cache_creation_input_tokens, r.output_tokens,
         r.reasoning_tokens, r.estimated_cost_usd, r.latency_ms, r.rules_sha256
  from public.ai_runs r
  left join public.adaptations a on a.id = r.adaptation_id
  left join public.materials m on m.id = coalesce(r.material_id, a.material_id)
  where r.created_at >= p_since and (p_workspace is null or r.workspace_id = p_workspace)
  order by r.created_at;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'record_ai_run(jsonb)',
    'ai_spend_committed(text)',
    'ai_spend_admit(text, numeric, text, text, int, int, numeric)',
    'ai_spend_settle(uuid, numeric)',
    'ai_spend_summary(text)',
    'ai_cost_report(timestamptz, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
