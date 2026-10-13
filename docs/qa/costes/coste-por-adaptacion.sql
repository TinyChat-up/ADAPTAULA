-- Coste real de las adaptaciones a partir de ai_runs (docs/COSTS.md).
-- SOLO LECTURA: únicamente SELECT. Ejecutar en el SQL Editor de Supabase con un rol que lea ai_runs.
-- Sin contenido: ai_runs no guarda material ni datos del alumno. Sustituir el id para estudiar otra adaptación.
-- estimated_cost_usd es null cuando el modelo no tiene precio: se cuenta aparte, nunca como 0.
-- Validado contra las migraciones reales en tests/db/illustrations.test.ts.

-- 1. Una adaptación, paso a paso: llamadas, fallos, tokens, coste conocido y llamadas sin precio.
select purpose, provider, model, count(*) as calls,
       count(*) filter (where status <> 'success') as failed,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       sum(cached_input_tokens) as cached_input_tokens,
       round(coalesce(sum(estimated_cost_usd), 0), 6) as known_cost_usd,
       count(*) filter (where estimated_cost_usd is null and status = 'success') as unpriced_calls
  from public.ai_runs
 where adaptation_id = '00000000-0000-4000-8000-00000000c057'
 group by purpose, provider, model
 order by purpose, provider, model;

-- 2. Total de la adaptación (sin el análisis del material, que se comparte entre adaptaciones).
select count(*) as calls,
       round(coalesce(sum(estimated_cost_usd), 0), 6) as known_cost_usd,
       round(coalesce(sum(estimated_cost_usd) filter (where purpose in ('image_brief', 'image', 'image_review')), 0), 6) as illustrations_usd,
       count(*) filter (where purpose = 'image' and status = 'success') as images,
       count(*) filter (where estimated_cost_usd is null and status = 'success') as unpriced_calls
  from public.ai_runs
 where adaptation_id = '00000000-0000-4000-8000-00000000c057';

-- 3. Coste compartido de su material: análisis y localización de visuales (una vez por material y versión, reutilizado).
select r.purpose, count(*) as calls, round(coalesce(sum(r.estimated_cost_usd), 0), 6) as known_cost_usd
  from public.ai_runs r
 where r.adaptation_id is null
   and r.material_id = (select material_id from public.adaptations where id = '00000000-0000-4000-8000-00000000c057')
 group by r.purpose
 order by r.purpose;

-- 4. Telemetría de los últimos 30 días, por paso, proveedor y modelo (todas las cuentas).
select purpose, provider, model, count(*) as calls,
       count(*) filter (where status <> 'success') as failed,
       round(coalesce(avg(estimated_cost_usd), 0), 6) as avg_cost_usd,
       round(coalesce(sum(estimated_cost_usd), 0), 4) as total_cost_usd,
       count(*) filter (where estimated_cost_usd is null and status = 'success') as unpriced_calls
  from public.ai_runs
 where created_at >= now() - interval '30 days'
 group by purpose, provider, model
 order by total_cost_usd desc;

-- 5. Coste por adaptación en los últimos 30 días, según cuántas imágenes llevó: media, mediana, p90 y máximo.
select images, count(*) as adaptations,
       round(avg(cost), 4) as avg_usd,
       round((percentile_cont(0.5) within group (order by cost))::numeric, 4) as p50_usd,
       round((percentile_cont(0.9) within group (order by cost))::numeric, 4) as p90_usd,
       round(max(cost), 4) as max_usd
  from (select adaptation_id,
               coalesce(sum(estimated_cost_usd), 0) as cost,
               count(*) filter (where purpose = 'image' and status = 'success') as images
          from public.ai_runs
         where adaptation_id is not null and created_at >= now() - interval '30 days'
         group by adaptation_id) per_adaptation
 group by images
 order by images;

-- 6. Gasto en ilustraciones por espacio de trabajo este mes natural (para vigilar presupuestos por cuenta).
select workspace_id,
       count(*) filter (where purpose = 'image' and status = 'success') as images,
       round(coalesce(sum(estimated_cost_usd), 0), 4) as illustrations_usd
  from public.ai_runs
 where purpose in ('image_brief', 'image', 'image_review')
   and created_at >= date_trunc('month', now())
 group by workspace_id
 order by illustrations_usd desc;
