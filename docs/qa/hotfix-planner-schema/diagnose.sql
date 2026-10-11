-- Diagnóstico de una planificación que falló con planner_schema.
-- SOLO LECTURA: únicamente SELECT. Ejecutar en el SQL Editor de Supabase (rol con lectura de las tablas del pipeline).
-- No modifica jobs, cuotas, usage_events ni artefactos. Sin contenido del material ni datos del alumno (solo dimensiones
-- funcionales, recuentos, códigos y tokens). Validado contra las migraciones en tests/db/planner-schema-repair.test.ts.

-- 1. La adaptación: estado, modo, fallo y la versión del planificador que tiene FIJADA (prompt, contrato, tope de salida, modelo).
select id, status, creation_mode, failure_code, created_at,
       pipeline_versions -> 'planner' ->> 'prompt_version' as planner_prompt_version,
       pipeline_versions -> 'planner' ->> 'schema_version' as planner_schema_version,
       pipeline_versions -> 'planner' ->> 'max_output_tokens' as planner_max_output_tokens,
       pipeline_versions -> 'planner' -> 'selection' ->> 'model' as planner_model,
       pipeline_versions -> 'planner' -> 'selection' ->> 'effort' as planner_effort
  from public.adaptations
 where id = '5aa33558-5e46-4114-8afc-3385376e62d3';

-- 2. Jobs: el de planificación que falló (fdae7ec2-…) y cualquier otro.
select id, stage, status, attempts, max_attempts, step, error, input_fingerprint, provider_call_started_at, created_at, started_at, completed_at
  from public.adaptation_jobs
 where adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3'
 order by created_at;

-- 3. CLAVE: las llamadas al planificador. output_tokens igual al tope fijado (consulta 1) = respuesta CORTADA (max_tokens);
--    por debajo = respuesta completa que incumplió el contrato o la normalización. status 'success' con el job en planner_schema
--    = la respuesta pasó el contrato y falló al resolver referencias (necesidad inexistente). Tras este hotfix, la reparación de
--    una respuesta cortada tiene el doble de margen: para esa llamada, compárese con max_output_tokens de su diagnóstico (consulta 4).
select r.created_at, r.status, r.error_code, r.call_kind, r.attempt, r.prompt_version, r.schema_version, r.model, r.effort,
       r.input_tokens, r.output_tokens, r.cached_input_tokens, r.cache_creation_input_tokens, r.estimated_cost_usd, r.latency_ms,
       (r.output_tokens >= coalesce((a.pipeline_versions -> 'planner' ->> 'max_output_tokens')::int, 4000)) as hit_output_limit
  from public.ai_runs r
  join public.adaptations a on a.id = r.adaptation_id
 where r.adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3' and r.purpose = 'plan'
 order by r.created_at;

-- 4. Artefactos guardados (con el código anterior, una respuesta rechazada no deja ninguno). Tras este hotfix, cada respuesta
--    rechazada deja un planner_draft con «rejected» y su diagnóstico (rutas, reglas, truncado, tokens, reparación, motivo).
select kind, count(*) as artifacts
  from public.adaptation_artifacts
 where adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3'
 group by kind
 order by kind;

select created_at, payload -> 'diagnosis' as diagnosis
  from public.adaptation_artifacts
 where adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3' and kind = 'planner_draft' and payload ? 'rejected'
 order by created_at;

-- 5. Lo que el planificador recibió, en recuentos: necesidades activas (dimensiones funcionales, sin datos del alumno) y
--    actividades, textos, visuales y elementos protegidos del material.
select jsonb_array_length(a.context_snapshot -> 'needs') as active_needs,
       (select jsonb_agg(n ->> 'dimension') from jsonb_array_elements(a.context_snapshot -> 'needs') n) as need_dimensions,
       jsonb_array_length(m.analysis -> 'activities') as activities,
       jsonb_array_length(m.analysis -> 'texts') as texts,
       jsonb_array_length(m.analysis -> 'visuals') as visuals,
       jsonb_array_length(m.analysis -> 'protected_elements') as protected_elements
  from public.adaptations a
  join public.materials m on m.id = a.material_id
 where a.id = '5aa33558-5e46-4114-8afc-3385376e62d3';

-- 6. Recuperación: la unidad reservada (debe seguir reserved, sin consumed_at ni released_at) y su +1 en usage_events.
select state, reserve_key, reserved_at, consumed_at, released_at, release_reason
  from public.adaptation_entitlements
 where adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3';

select units, idempotency_key, created_at
  from public.usage_events
 where idempotency_key in (select reserve_key from public.adaptation_entitlements where adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3')
    or idempotency_key in (select 'refund:' || reserve_key from public.adaptation_entitlements where adaptation_id = '5aa33558-5e46-4114-8afc-3385376e62d3');

-- 7. Presupuesto de fallos del espacio de trabajo (las llamadas fallidas de pago de las últimas horas): si está agotado, la
--    recuperación tendrá que esperar. Solo lectura (función stable).
select public.ai_failure_budget(a.workspace_id) as failure_budget
  from public.adaptations a
 where a.id = '5aa33558-5e46-4114-8afc-3385376e62d3';

-- 8. El mismo patrón en otras adaptaciones del espacio de trabajo (el docente borró y repitió): ¿siempre cortadas o siempre
--    inválidas? Las adaptaciones borradas conservan sus ai_runs.
select r.created_at, r.adaptation_id, r.status, r.error_code, r.call_kind, r.output_tokens, r.prompt_version
  from public.ai_runs r
 where r.workspace_id = (select workspace_id from public.adaptations where id = '5aa33558-5e46-4114-8afc-3385376e62d3')
   and r.purpose = 'plan'
 order by r.created_at desc
 limit 20;
