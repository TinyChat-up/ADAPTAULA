-- Diagnóstico de una adaptación de «Hacer magia» que acabó pidiendo «Revisar adaptación».
-- SOLO LECTURA: únicamente SELECT. Ejecutar en el SQL Editor de Supabase (rol con lectura de las tablas del pipeline).
-- No modifica cuotas, usage_events, jobs ni artefactos. Sustituir el id si se diagnostica otra adaptación.
-- Validado contra las migraciones reales en tests/db/magic-never-review.test.ts.

-- 1. La adaptación: estado, modo de creación real, código de fallo, versión vigente y entrega.
select id, status, creation_mode, failure_code, current_version, delivered_at, created_at, updated_at
  from public.adaptations
 where id = '757c2370-936e-4d03-8b9a-54defb91afae';

-- 2. La unidad de cuota: reservada / consumida / liberada (no se toca nada).
select state, reserve_key, reserved_at, consumed_at, released_at, release_reason
  from public.adaptation_entitlements
 where adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae';

select units, idempotency_key, created_at
  from public.usage_events
 where idempotency_key in (select reserve_key from public.adaptation_entitlements where adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae')
    or idempotency_key in (select 'refund:' || reserve_key from public.adaptation_entitlements where adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae');

-- 3. Jobs, en orden, y generaciones usadas (entradas de generación distintas; máximo 3).
select stage, status, attempts, step, input_fingerprint, error ->> 'code' as error_code, created_at, started_at, completed_at
  from public.adaptation_jobs
 where adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae'
 order by created_at;

select count(distinct input_fingerprint) as generations_used
  from public.adaptation_jobs
 where adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae' and stage = 'generation' and input_fingerprint is not null;

-- 4. Revisiones del plan, en orden: quién la hizo («auto» = el servidor en «Hacer magia»; «teacher» = el docente tomó el
--    control), qué decisiones llevaban restricciones de corrección y cuáles se dejaron fuera.
select a.created_at, a.fingerprint,
       a.payload -> 'reviewer' ->> 'kind' as reviewer_kind,
       (select jsonb_agg(e ->> 'decision_id') from jsonb_array_elements(a.payload -> 'entries') e where jsonb_array_length(coalesce(e -> 'restrictions', '[]'::jsonb)) > 0) as restricted,
       (select jsonb_agg(e ->> 'decision_id') from jsonb_array_elements(a.payload -> 'entries') e where e ->> 'action' = 'rejected') as rejected
  from public.adaptation_artifacts a
 where a.adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae' and a.kind = 'plan_review'
 order by a.created_at;

-- 5. Informes de ejecución: ¿corrió la corrección automática? (correction_of / repair_of), qué checks la motivaron,
--    necesidades sin resolver y paradas registradas («generation_refused», «quality»).
select a.created_at,
       a.payload ->> 'review_fingerprint' as review_fingerprint,
       a.payload -> 'automatic' -> 'correction_of' as correction_of,
       a.payload -> 'automatic' -> 'repair_of' as repair_of,
       a.payload -> 'automatic' -> 'failing' as failing_checks,
       a.payload -> 'automatic' -> 'restricted' as restricted,
       a.payload -> 'automatic' -> 'dropped' as dropped,
       a.payload -> 'automatic' -> 'unresolved' as unresolved,
       a.payload ->> 'automatic_stop' as automatic_stop,
       a.payload -> 'execution' -> 'blockers' as blockers
  from public.adaptation_artifacts a
 where a.adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae' and a.kind = 'execution_report'
 order by a.created_at;

-- 6. Los checks que no pasaron, exactos, en cada versión (la última es la que se mostró).
select v.version, v.created_at, v.review ->> 'verdict' as verdict,
       c ->> 'check' as check_name, c ->> 'status' as check_status, c ->> 'method' as method, c -> 'targets' as targets, c ->> 'detail' as detail
  from public.adaptation_versions v
 cross join lateral jsonb_array_elements(v.review -> 'checks') c
 where v.adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae' and c ->> 'status' in ('FAIL', 'WARN')
 order by v.version, c ->> 'status', c ->> 'check';

-- 7. Bloques señalados por un FAIL: tipo, a qué unidad del original pertenecen y qué decisiones los produjeron.
select v.version, b ->> 'id' as block_id, b ->> 'type' as block_type, b -> 'trace' ->> 'origin' as origin,
       b -> 'trace' -> 'source_refs' as source_refs, b -> 'trace' -> 'decision_ids' as decision_ids
  from public.adaptation_versions v
 cross join lateral jsonb_array_elements(v.document -> 'pages') p
 cross join lateral jsonb_array_elements(p -> 'blocks') b
 where v.adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae'
   and b ->> 'id' in (select jsonb_array_elements_text(c -> 'targets') from jsonb_array_elements(v.review -> 'checks') c where c ->> 'status' = 'FAIL')
 order by v.version, b ->> 'id';

-- 8. Elementos protegidos señalados por un FAIL, tal como los fijó el análisis del material.
select pe ->> 'id' as protected_id, pe ->> 'type' as protected_type, pe ->> 'importance' as importance, pe ->> 'value' as value,
       pe -> 'activity_ids' as activity_ids, pe -> 'resource_ids' as resource_ids
  from public.adaptations a
  join public.materials m on m.id = a.material_id
 cross join lateral jsonb_array_elements(m.analysis -> 'protected_elements') pe
 where a.id = '757c2370-936e-4d03-8b9a-54defb91afae'
   and pe ->> 'id' in (select jsonb_array_elements_text(c -> 'targets')
                         from public.adaptation_versions v cross join lateral jsonb_array_elements(v.review -> 'checks') c
                        where v.adaptation_id = a.id and c ->> 'status' = 'FAIL');

-- 9. Las decisiones del plan (destino, acción, necesidades, apoyos) para cruzarlas con los bloques y los FAIL.
select a.created_at, d ->> 'id' as decision_id, d ->> 'target' as target, d ->> 'action' as action, d -> 'dimensions' as dimensions, d -> 'supports' as supports
  from public.adaptation_artifacts a
 cross join lateral jsonb_array_elements(a.payload -> 'decisions') d
 where a.adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae' and a.kind = 'plan'
 order by a.created_at, d ->> 'id';

-- 10. Revisión determinista y auditoría de cada generación (y si se repuso el original de alguna unidad).
select a.created_at, a.payload -> 'review' ->> 'verdict' as verdict, a.payload -> 'restored_originals' as restored_originals,
       (select jsonb_agg(c ->> 'name') from jsonb_array_elements(a.payload -> 'audit' -> 'checks') c where (c ->> 'ok')::boolean = false) as audit_failing
  from public.adaptation_artifacts a
 where a.adaptation_id = '757c2370-936e-4d03-8b9a-54defb91afae' and a.kind = 'deterministic_review'
 order by a.created_at;
