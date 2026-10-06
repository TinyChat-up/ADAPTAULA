-- Adaptaula · 009 · Fase 3: subida de materiales, análisis y jobs persistentes
-- Ver docs/DATABASE.md y docs/AI_PIPELINE.md.

-- ---------------------------------------------------------------------------
-- materials: estados claros, contexto confirmado por el docente y metadatos del análisis
-- ---------------------------------------------------------------------------

update public.materials set status = 'uploaded' where status = 'ready';
alter table public.materials drop constraint materials_status_check;
alter table public.materials add constraint materials_status_check
  check (status in ('uploading', 'uploaded', 'queued', 'analyzing', 'analyzed', 'failed'));

alter table public.materials
  -- Campos de contexto que el docente ha confirmado o corregido. Prevalecen sobre lo detectado por el modelo.
  add column confirmed_fields text[] not null default '{}'
    check (confirmed_fields <@ array['title', 'stage', 'grade', 'subject', 'topic']::text[]),
  -- Cómo se obtuvo el análisis: prompt, modelo, coste, origen (nuevo o reutilizado). Sin contenido del material.
  add column analysis_meta jsonb check (analysis_meta is null or jsonb_typeof(analysis_meta) = 'object'),
  -- Código de error categorizado del último intento fallido (nunca texto técnico).
  add column failure_code text check (char_length(failure_code) <= 60);

grant update (confirmed_fields) on public.materials to authenticated;

-- ---------------------------------------------------------------------------
-- material_files: el nombre original es solo metadato; el identificador es la ruta generada
-- ---------------------------------------------------------------------------

alter table public.material_files
  add column original_name text check (char_length(original_name) <= 255);

-- ---------------------------------------------------------------------------
-- adaptation_jobs: tipo "analyze", estado "queued" y un único análisis activo por material
-- ---------------------------------------------------------------------------

update public.adaptation_jobs set status = 'queued' where status = 'pending';
alter table public.adaptation_jobs drop constraint adaptation_jobs_status_check;
alter table public.adaptation_jobs add constraint adaptation_jobs_status_check
  check (status in ('queued', 'processing', 'completed', 'partial', 'failed', 'canceled'));
alter table public.adaptation_jobs alter column status set default 'queued';

alter table public.adaptation_jobs drop constraint adaptation_jobs_kind_check;
alter table public.adaptation_jobs add constraint adaptation_jobs_kind_check
  check (kind in ('analyze', 'adapt', 'revise_block', 'image'));

alter table public.adaptation_jobs drop constraint adaptation_jobs_step_check;
alter table public.adaptation_jobs add constraint adaptation_jobs_step_check
  check (step in ('analyzing', 'validating', 'saving', 'planning', 'generating', 'reviewing', 'rendering'));

drop index public.adaptation_jobs_queue_idx;
create index adaptation_jobs_queue_idx on public.adaptation_jobs (priority desc, created_at)
  where status in ('queued', 'processing');

-- Dos procesadores nunca analizan el mismo material a la vez, ni siquiera por una carrera al encolar.
create unique index adaptation_jobs_one_active_analysis on public.adaptation_jobs (material_id)
  where kind = 'analyze' and status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- Borrado seguro: un material con adaptaciones no se puede borrar sin decidir antes qué pasa con ellas
-- ---------------------------------------------------------------------------

alter table public.adaptations drop constraint adaptations_material_id_fkey;
alter table public.adaptations add constraint adaptations_material_id_fkey
  foreign key (material_id) references public.materials (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- ai_runs: el coste desconocido es NULL (nunca 0 inventado) y cada llamada se asocia al material
-- ---------------------------------------------------------------------------

alter table public.ai_runs alter column estimated_cost_usd drop not null;
alter table public.ai_runs alter column estimated_cost_usd drop default;
alter table public.ai_runs
  add column attempt smallint not null default 1 check (attempt > 0),
  add column material_id uuid references public.materials (id) on delete set null;
create index ai_runs_material_idx on public.ai_runs (material_id);

-- ---------------------------------------------------------------------------
-- Máquina de estados del job de análisis (todas las funciones: solo service_role)
-- El "attempt" actúa como token de exclusión: un procesador cuyo lease caducó no puede sobrescribir
-- el resultado de otro.
-- ---------------------------------------------------------------------------

-- Encola el análisis de un material ya subido. Idempotente: si ya hay uno activo, devuelve ese.
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

  update public.materials set status = 'queued', failure_code = null where id = p_material;
  return v_job;
end;
$$;

-- Reclama el job para procesarlo. Devuelve el job (jsonb) o null si otro procesador lo tiene,
-- si todavía está en espera de reintento o si agotó sus intentos.
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
  -- Un job cuyo lease caducó y que ya no tiene intentos se cierra como fallido.
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

-- Guarda el análisis y cierra el job. Devuelve false si el procesador ya no es el titular (lease perdido).
create or replace function public.complete_analysis_job(
  p_job uuid,
  p_attempt int,
  p_analysis jsonb,
  p_prompt_version text,
  p_meta jsonb,
  p_context jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_material uuid;
begin
  update public.adaptation_jobs j
     set status = 'completed', progress = 100, step = null, locked_until = null,
         completed_at = now(), error = null
   where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt
  returning j.material_id into v_material;
  if not found then
    return false;
  end if;

  -- Lo detectado rellena solo los campos que el docente NO ha confirmado. Lo confirmado nunca se pisa.
  update public.materials m
     set analysis = p_analysis, analysis_prompt_version = p_prompt_version, analysis_meta = p_meta,
         status = 'analyzed', failure_code = null,
         title = case when 'title' = any (m.confirmed_fields) then m.title else coalesce(p_context ->> 'title', m.title) end,
         stage_slug = case when 'stage' = any (m.confirmed_fields) then m.stage_slug else coalesce(p_context ->> 'stage', m.stage_slug) end,
         grade_slug = case when 'grade' = any (m.confirmed_fields) then m.grade_slug else coalesce(p_context ->> 'grade', m.grade_slug) end,
         subject_slug = case when 'subject' = any (m.confirmed_fields) then m.subject_slug else coalesce(p_context ->> 'subject', m.subject_slug) end,
         topic = case when 'topic' = any (m.confirmed_fields) then m.topic else coalesce(p_context ->> 'topic', m.topic) end
   where m.id = v_material;
  return true;
end;
$$;

-- Registra un fallo. Reintenta (con espera) si procede y quedan intentos; si no, cierra el job.
-- Un reanálisis fallido conserva el análisis anterior.
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
  return 'failed';
end;
$$;

revoke execute on function public.enqueue_analysis_job(uuid, uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public.claim_analysis_job(uuid, int) from public, anon, authenticated;
revoke execute on function public.complete_analysis_job(uuid, int, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_analysis_job(uuid, int, text, boolean, int) from public, anon, authenticated;
grant execute on function public.enqueue_analysis_job(uuid, uuid, jsonb, int) to service_role;
grant execute on function public.claim_analysis_job(uuid, int) to service_role;
grant execute on function public.complete_analysis_job(uuid, int, jsonb, text, jsonb, jsonb) to service_role;
grant execute on function public.fail_analysis_job(uuid, int, text, boolean, int) to service_role;
