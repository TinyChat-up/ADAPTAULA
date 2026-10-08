-- Adaptaula · 019 · Modo de creación de una adaptación (docs/ADAPTATION.md § Dos formas de crear una ficha)
-- Un solo pipeline con dos formas de recorrerlo, elegidas por el docente al crear la adaptación:
--   · 'automatic' («Hacer magia»): tras un plan válido, el servidor aplica la recomendación (la misma revisión automática del
--     pipeline offline: aplica lo no bloqueado, descarta lo bloqueado) y continúa a generación y revisión pedagógica. El revisor
--     sigue siendo obligatorio: una ficha bloqueada nunca se entrega.
--   · 'review' («Revisar antes de crear»): la puerta humana de siempre. Es el valor por defecto, así que las adaptaciones
--     existentes conservan su comportamiento.
-- Lo escribe solo el servidor (create_adaptation, service_role): el navegador no tiene INSERT ni UPDATE de esta columna.
-- No cambia cuotas, límites, modelos ni prompts: la unidad se reserva y consume exactamente igual en los dos modos.

alter table public.adaptations
  add column creation_mode text not null default 'review'
  constraint adaptations_creation_mode_check check (creation_mode in ('automatic', 'review'));

comment on column public.adaptations.creation_mode is
  'automatic = «Hacer magia» (sin aprobación humana del plan; revisor obligatorio); review = revisión humana antes de crear.';

-- create_adaptation con el modo. Se sustituye la firma anterior (dos sobrecargas harían ambigua la llamada por nombre).
-- Idempotente como antes: la misma request_key devuelve la misma adaptación, con el modo con el que se creó.
drop function public.create_adaptation(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, boolean);

create function public.create_adaptation(
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
  p_reserve boolean default false,
  p_creation_mode text default 'review'
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
  if p_creation_mode is null or p_creation_mode not in ('automatic', 'review') then
    raise exception 'invalid_creation_mode' using errcode = '22023';
  end if;

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
                                  status, created_by, request_key, pipeline_versions, context_snapshot, context_fingerprint, analysis_fingerprint,
                                  creation_mode)
  values (p_workspace, p_material, p_learner, p_title, p_type, jsonb_build_object('minimized', true),
          'queued', p_user, p_request_key, p_versions, p_context, p_context_fp, p_analysis_fp, p_creation_mode)
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

revoke execute on function public.create_adaptation(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.create_adaptation(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, boolean, text) to service_role;

-- Telemetría interna (solo service_role): el mismo resumen de 018 más el desglose por modo de creación. Solo recuentos y
-- costes agregados: ningún contenido, título, alias de modelo ni dato del alumnado.
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
  ),
  by_mode as (
    select a.creation_mode as mode,
      count(*) as adaptations,
      count(*) filter (where a.status = 'ready') as ready,
      count(*) filter (where a.status = 'blocked') as blocked
    from public.adaptations a
    where a.workspace_id = p_workspace and a.created_at >= p_from and a.created_at < p_to
    group by a.creation_mode
  ),
  cost_by_mode as (
    select a.creation_mode as mode, coalesce(sum(r.estimated_cost_usd), 0) as cost, count(distinct r.adaptation_id) as adaptations
    from runs r join public.adaptations a on a.id = r.adaptation_id
    where r.purpose in ('plan', 'generate', 'review')
    group by a.creation_mode
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
    'by_purpose', coalesce((select jsonb_object_agg(purpose, jsonb_build_object('cost', cost, 'runs', runs, 'successful', successful, 'failed', failed)) from by_purpose), '{}'::jsonb),
    -- Adaptaciones CREADAS en el periodo por modo (y cuántas están listas o bloqueadas ahora), y el gasto del periodo por modo.
    'by_creation_mode', coalesce((select jsonb_object_agg(mode, jsonb_build_object('adaptations', adaptations, 'ready', ready, 'blocked', blocked)) from by_mode), '{}'::jsonb),
    'cost_by_creation_mode', coalesce((select jsonb_object_agg(mode, jsonb_build_object('cost', cost, 'adaptations', adaptations)) from cost_by_mode), '{}'::jsonb)
  )
  from cost_of c, counts n;
$$;
