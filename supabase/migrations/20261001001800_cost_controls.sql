-- Adaptaula · 018 · Controles de coste y telemetría económica (docs/BILLING.md § Coste de IA y cuota)
-- Cuota y gasto son dos cosas distintas: una unidad de cuota se puede devolver (el docente no recibió nada); el coste de una
-- llamada ya hecha, no. Esta migración NO cambia ninguna cuota ni la semántica de reservar/consumir/devolver:
--   1. ai_spend_summary: resumen interno (solo service_role) del gasto real por workspace y periodo, a partir de ai_runs,
--      incluidas las llamadas fallidas y las de unidades devueltas. Nunca lee contenido, alias ni datos del alumnado.
--   2. Presupuesto defensivo de fallos: llamadas FALLIDAS QUE CONSUMIERON TOKENS en las últimas 24 h por workspace. Se
--      comprueba solo al crear un job nuevo (análisis o etapa de adaptación); los reintentos técnicos de un job ya admitido
--      no pasan por aquí. Una caída del proveedor (0 tokens, sin coste) no cuenta.
--   3. Límite de ciclos de generación por adaptación: una generación inicial + 2 nuevas, contadas como huellas de entrada
--      distintas de los jobs de generación (un reintento técnico reencola la MISMA huella y no cuenta).

-- ---------------------------------------------------------------------------
-- 1. Resumen económico interno
-- ---------------------------------------------------------------------------

create or replace function public.ai_spend_summary(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with runs as (
    select r.purpose, r.status, r.job_id, r.adaptation_id, r.estimated_cost_usd,
      r.input_tokens, r.output_tokens, r.cached_input_tokens, r.cache_creation_input_tokens
    from public.ai_runs r
    where r.workspace_id = p_workspace and r.created_at >= p_from and r.created_at < p_to
  ),
  by_purpose as (
    select purpose,
      coalesce(sum(estimated_cost_usd), 0) as cost,
      count(*) as runs,
      count(*) filter (where status = 'success') as successful,
      count(*) filter (where status <> 'success') as failed,
      count(*) filter (where estimated_cost_usd is null and (input_tokens + output_tokens + cached_input_tokens + cache_creation_input_tokens) > 0) as unpriced
    from runs group by purpose
  ),
  cost_of as (
    select coalesce(sum(cost) filter (where purpose = 'analyze'), 0) as analysis,
      coalesce(sum(cost) filter (where purpose = 'plan'), 0) as planner,
      coalesce(sum(cost) filter (where purpose = 'generate'), 0) as generator,
      coalesce(sum(cost) filter (where purpose = 'review'), 0) as reviewer,
      coalesce(sum(cost), 0) as total
    from by_purpose
  ),
  counts as (
    select
      (select count(distinct job_id) from runs where purpose = 'analyze' and job_id is not null) as analyses,
      (select count(distinct adaptation_id) from runs where purpose in ('plan', 'generate', 'review') and adaptation_id is not null) as adaptations
  )
  select jsonb_build_object(
    'workspace_id', p_workspace,
    'from', p_from,
    'to', p_to,
    'ai_cost_total', c.total,
    'analysis_cost', c.analysis,
    'planner_cost', c.planner,
    'generator_cost', c.generator,
    'reviewer_cost', c.reviewer,
    'successful_ai_runs', (select count(*) from runs where status = 'success'),
    'failed_ai_runs', (select count(*) from runs where status <> 'success'),
    'unpriced_ai_runs', (select coalesce(sum(unpriced), 0) from by_purpose),
    'input_tokens', (select coalesce(sum(input_tokens), 0) from runs),
    'output_tokens', (select coalesce(sum(output_tokens), 0) from runs),
    'cached_input_tokens', (select coalesce(sum(cached_input_tokens), 0) from runs),
    'cache_creation_input_tokens', (select coalesce(sum(cache_creation_input_tokens), 0) from runs),
    'analysis_count', n.analyses,
    'adaptation_count', n.adaptations,
    'avg_cost_per_analysis', case when n.analyses > 0 then round(c.analysis / n.analyses, 6) end,
    'avg_cost_per_adaptation', case when n.adaptations > 0 then round((c.planner + c.generator + c.reviewer) / n.adaptations, 6) end,
    'by_purpose', coalesce((select jsonb_object_agg(purpose, jsonb_build_object('cost', cost, 'runs', runs, 'successful', successful, 'failed', failed)) from by_purpose), '{}'::jsonb)
  )
  from cost_of c, counts n;
$$;

-- ---------------------------------------------------------------------------
-- 2. Presupuesto defensivo de fallos (llamadas fallidas que consumieron tokens, ventana móvil de 24 h)
-- ---------------------------------------------------------------------------

-- Valores provisionales, en un único sitio: se ajustan con datos reales (ai_spend_summary) sin tocar código.
insert into public.app_settings (key, value) values
  ('ai.failure_budget', '{"max_failed_paid_calls": 40, "window_hours": 24}'::jsonb)
on conflict (key) do nothing;

create or replace function public.ai_failure_budget(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting jsonb;
  v_limit int;
  v_hours int;
  v_used int;
begin
  select s.value into v_setting from public.app_settings s where s.key = 'ai.failure_budget';
  v_limit := coalesce((v_setting ->> 'max_failed_paid_calls')::int, 40);
  v_hours := coalesce((v_setting ->> 'window_hours')::int, 24);
  select count(*) into v_used from public.ai_runs r
    where r.workspace_id = p_workspace
      and r.status <> 'success'
      and (r.input_tokens + r.output_tokens + r.cached_input_tokens + r.cache_creation_input_tokens) > 0
      and r.created_at > now() - make_interval(hours => v_hours);
  return jsonb_build_object('used', v_used, 'limit', v_limit, 'window_hours', v_hours, 'allowed', v_used < v_limit);
end;
$$;

-- Admite (o no) un job NUEVO. Serializa por workspace para que dos admisiones simultáneas lean el mismo recuento.
create or replace function public.assert_ai_failure_budget(p_workspace uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_failure_budget:' || p_workspace::text, 0));
  if not coalesce((public.ai_failure_budget(p_workspace) ->> 'allowed')::boolean, true) then
    raise exception 'ai_failure_budget_exhausted' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. enqueue_analysis_job: igual que en 010, más el presupuesto de fallos al crear un job nuevo
-- ---------------------------------------------------------------------------

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

  perform public.assert_ai_failure_budget(v_material.workspace_id);

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

-- ---------------------------------------------------------------------------
-- 4. enqueue_adaptation_stage: igual que en 013, más el límite de ciclos de generación y el presupuesto de fallos
-- ---------------------------------------------------------------------------

-- Generaciones de producto por adaptación (inicial + 2). Debe coincidir con MAX_GENERATION_CYCLES (status.ts; un test lo
-- comprueba): la base de datos es la que lo hace cumplir, el valor del código solo sirve para no ofrecer lo que se negará.
create or replace function public.adaptation_generation_cycles(p_adaptation uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct j.input_fingerprint)::int from public.adaptation_jobs j
  where j.adaptation_id = p_adaptation and j.stage = 'generation' and j.input_fingerprint is not null;
$$;

create or replace function public.enqueue_adaptation_stage(p_adaptation uuid, p_stage text, p_input_fp text, p_max_attempts int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_adaptation public.adaptations;
  v_job public.adaptation_jobs;
  v_id uuid;
begin
  if p_stage not in ('planning', 'generation') then
    raise exception 'unknown_stage' using errcode = '22023';
  end if;
  select * into v_adaptation from public.adaptations a where a.id = p_adaptation for update;
  if not found then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;

  select * into v_job from public.adaptation_jobs j
    where j.adaptation_id = p_adaptation and j.stage = p_stage and j.input_fingerprint = p_input_fp and j.status = 'completed';
  if found then
    return jsonb_build_object('job_id', v_job.id, 'reused', true, 'status', 'completed');
  end if;

  select * into v_job from public.adaptation_jobs j
    where j.adaptation_id = p_adaptation and j.stage = p_stage and j.status in ('queued', 'processing');
  if found then
    return jsonb_build_object('job_id', v_job.id, 'reused', true, 'status', v_job.status);
  end if;

  -- Solo desde los estados donde esa etapa puede empezar: nadie se salta awaiting_plan_review.
  if p_stage = 'planning' then
    if v_adaptation.status not in ('queued', 'failed', 'awaiting_plan_review', 'blocked') then
      raise exception 'invalid_state' using errcode = 'P0001', detail = v_adaptation.status;
    end if;
  else
    if v_adaptation.status not in ('generation_queued', 'failed') then
      raise exception 'invalid_state' using errcode = 'P0001', detail = v_adaptation.status;
    end if;
    -- Una generación NUEVA (otra revisión, otra huella) cuenta como ciclo; reintentar la misma huella, no. La fila de la
    -- adaptación está bloqueada (for update): dos peticiones simultáneas no pueden pasar las dos con el último hueco.
    if not exists (select 1 from public.adaptation_jobs j where j.adaptation_id = p_adaptation and j.stage = 'generation' and j.input_fingerprint = p_input_fp)
       and public.adaptation_generation_cycles(p_adaptation) >= 3 then
      raise exception 'generation_cycles_exhausted' using errcode = 'P0001';
    end if;
  end if;

  perform public.assert_ai_failure_budget(v_adaptation.workspace_id);

  if p_stage = 'planning' then
    if v_adaptation.status = 'blocked' then
      perform public.transition_adaptation(p_adaptation, 'blocked', 'awaiting_plan_review');
      v_adaptation.status := 'awaiting_plan_review';
    end if;
    if v_adaptation.status in ('failed', 'awaiting_plan_review') then
      perform public.transition_adaptation(p_adaptation, v_adaptation.status, 'queued');
    end if;
  elsif v_adaptation.status = 'failed' then
    perform public.transition_adaptation(p_adaptation, 'failed', 'generation_queued');
  end if;

  insert into public.adaptation_jobs (workspace_id, material_id, requested_by, kind, input, status, adaptation_id, stage, input_fingerprint, max_attempts)
  values (v_adaptation.workspace_id, v_adaptation.material_id, v_adaptation.created_by, 'adapt', '{}'::jsonb, 'queued', p_adaptation, p_stage, p_input_fp, p_max_attempts)
  returning id into v_id;
  return jsonb_build_object('job_id', v_id, 'reused', false, 'status', 'queued');
end;
$$;

revoke execute on function public.ai_spend_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.ai_failure_budget(uuid) from public, anon, authenticated;
revoke execute on function public.assert_ai_failure_budget(uuid) from public, anon, authenticated;
revoke execute on function public.adaptation_generation_cycles(uuid) from public, anon, authenticated;
grant execute on function public.ai_spend_summary(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.ai_failure_budget(uuid) to service_role;
grant execute on function public.assert_ai_failure_budget(uuid) to service_role;
grant execute on function public.adaptation_generation_cycles(uuid) to service_role;
