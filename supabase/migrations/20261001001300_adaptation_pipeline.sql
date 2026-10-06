-- Adaptaula · 013 · Orquestación del pipeline de adaptación (docs/ADAPTATION.md § Orquestación)
-- Solo cambios ADITIVOS sobre lo existente:
--   · adaptations: estados del pipeline, versiones fijadas al crear, contexto minimizado y entrega.
--   · adaptation_jobs: la misma cola con lease de la Fase 3, ahora también por etapa de una adaptación.
--   · adaptation_versions: huellas del plan, de la revisión docente y de la generación que la produjeron.
--   · ai_runs: lo imprescindible para auditar cada llamada por etapa.
--   · adaptation_artifacts (nueva): historial inmutable de lo que produce cada etapa (borradores, plan, revisión, informes).
-- Todas las funciones: solo service_role. Nada de esto toca cuotas ni planes.

-- ---------------------------------------------------------------------------
-- adaptations: estados del pipeline
-- ---------------------------------------------------------------------------

update public.adaptations set status = 'queued' where status = 'pending';
alter table public.adaptations drop constraint adaptations_status_check;
alter table public.adaptations add constraint adaptations_status_check check (status in (
  'queued', 'planning', 'awaiting_plan_review', 'generation_queued', 'generating',
  'reviewing_deterministic', 'reviewing_ai', 'ready', 'blocked', 'failed', 'cancelled'
));
alter table public.adaptations alter column status set default 'queued';

alter table public.adaptations
  -- Idempotencia de la creación: el mismo envío del mismo formulario no crea dos adaptaciones.
  add column request_key text check (char_length(request_key) between 8 and 120),
  -- Versiones resueltas UNA vez al crear (prompts, esquemas, política, alias y modelo): un reintento nunca las cambia.
  add column pipeline_versions jsonb check (pipeline_versions is null or jsonb_typeof(pipeline_versions) = 'object'),
  -- AdaptationContext minimizado (sin nombre, etiquetas ni diagnóstico) y su huella.
  add column context_snapshot jsonb check (context_snapshot is null or jsonb_typeof(context_snapshot) = 'object'),
  add column context_fingerprint text check (context_fingerprint ~ '^[a-f0-9]{64}$'),
  add column analysis_fingerprint text check (analysis_fingerprint ~ '^[a-f0-9]{64}$'),
  add column failure_code text check (char_length(failure_code) <= 60),
  -- Entrega: solo existe cuando hay una versión utilizable con su revisión (docs/ADAPTATION.md § Entrega).
  add column delivered_at timestamptz;

create unique index adaptations_request_key_idx on public.adaptations (workspace_id, request_key) where request_key is not null;

-- ---------------------------------------------------------------------------
-- adaptation_jobs: etapa de una adaptación (la misma cola y el mismo lease que el análisis)
-- ---------------------------------------------------------------------------

alter table public.adaptation_jobs
  add column adaptation_id uuid references public.adaptations (id) on delete cascade,
  add column stage text check (stage in ('planning', 'generation')),
  add column input_fingerprint text check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  -- Se marca justo antes de llamar al proveedor y se limpia cuando el resultado ya está persistido. Si el lease caduca con la
  -- marca puesta, el intento anterior es AMBIGUO (pudo responder y cobrarse sin llegar a guardarse): no se repite a ciegas.
  add column provider_call_started_at timestamptz,
  add constraint adaptation_jobs_stage_pairing_check check ((adaptation_id is null) = (stage is null));

create trigger adaptation_jobs_adaptation_workspace
  before insert or update on public.adaptation_jobs
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

-- Una sola ejecución activa por adaptación y etapa, y una sola completada por entrada: nunca dos jobs equivalentes.
create unique index adaptation_jobs_one_active_stage on public.adaptation_jobs (adaptation_id, stage)
  where adaptation_id is not null and status in ('queued', 'processing');
create unique index adaptation_jobs_one_completed_input on public.adaptation_jobs (adaptation_id, stage, input_fingerprint)
  where adaptation_id is not null and status = 'completed';

-- ---------------------------------------------------------------------------
-- adaptation_versions: de qué plan, qué revisión y qué generación sale cada versión
-- ---------------------------------------------------------------------------

alter table public.adaptation_versions
  add column plan_fingerprint text check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  add column plan_review_fingerprint text check (plan_review_fingerprint ~ '^[a-f0-9]{64}$'),
  add column generation_fingerprint text check (generation_fingerprint ~ '^[a-f0-9]{64}$');

create unique index adaptation_versions_generation_idx on public.adaptation_versions (adaptation_id, generation_fingerprint)
  where generation_fingerprint is not null;

-- ---------------------------------------------------------------------------
-- ai_runs: auditoría por etapa
-- ---------------------------------------------------------------------------

alter table public.ai_runs
  add column schema_version int check (schema_version > 0),
  add column call_kind text check (call_kind in ('initial', 'repair', 'regeneration')),
  add column reasoning_tokens int check (reasoning_tokens >= 0),
  add column input_fingerprint text check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  add column output_fingerprint text check (output_fingerprint ~ '^[a-f0-9]{64}$'),
  -- Intento del job que hizo la llamada (el "attempt" existente es el de la llamada dentro de la etapa).
  add column job_attempt smallint check (job_attempt > 0);

create index ai_runs_adaptation_idx on public.ai_runs (adaptation_id, purpose);
-- Registrar dos veces la misma llamada (un reintento tras caída) no la duplica.
create unique index ai_runs_call_once_idx on public.ai_runs (job_id, job_attempt, purpose, call_kind, attempt, input_fingerprint)
  where job_id is not null and job_attempt is not null and input_fingerprint is not null and call_kind is not null;

-- ---------------------------------------------------------------------------
-- adaptation_artifacts: historial inmutable (nunca se actualiza ni se borra salvo en cascada)
-- ---------------------------------------------------------------------------

create table public.adaptation_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  kind text not null check (kind in (
    'planner_draft', 'plan', 'plan_validation', 'plan_review', 'execution_report',
    'generation', 'deterministic_review', 'reviewer_findings', 'pedagogical_review'
  )),
  -- Huella de lo que lo produjo (entrada + versiones): "etapa + entrada + versiones" identifica una salida reutilizable.
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  -- Huella del propio contenido.
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (adaptation_id, kind, fingerprint)
);

-- Una salida por etapa y entrada. Las revisiones docentes y los informes de ejecución se acumulan (cada revisión es histórica).
create unique index adaptation_artifacts_one_per_input on public.adaptation_artifacts (adaptation_id, kind, input_fingerprint)
  where kind not in ('plan_review', 'execution_report');
create index adaptation_artifacts_lookup_idx on public.adaptation_artifacts (adaptation_id, kind, created_at desc);

create trigger adaptation_artifacts_workspace
  before insert or update on public.adaptation_artifacts
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

alter table public.adaptation_artifacts enable row level security;
revoke all on public.adaptation_artifacts from anon;
revoke insert, update, delete on public.adaptation_artifacts from authenticated;
create policy "adaptation_artifacts: leer si soy miembro" on public.adaptation_artifacts
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Máquina de estados: la fuente de verdad de las transiciones permitidas
-- (src/lib/adaptation/state-machine.ts debe coincidir; un test lo comprueba par a par)
-- ---------------------------------------------------------------------------

create or replace function public.adaptation_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('queued', 'planning'), ('queued', 'cancelled'), ('queued', 'failed'),
    ('planning', 'awaiting_plan_review'), ('planning', 'failed'), ('planning', 'cancelled'),
    ('awaiting_plan_review', 'generation_queued'), ('awaiting_plan_review', 'queued'), ('awaiting_plan_review', 'cancelled'),
    ('generation_queued', 'generating'), ('generation_queued', 'awaiting_plan_review'), ('generation_queued', 'cancelled'), ('generation_queued', 'failed'),
    ('generating', 'reviewing_deterministic'), ('generating', 'awaiting_plan_review'), ('generating', 'failed'), ('generating', 'cancelled'),
    ('reviewing_deterministic', 'reviewing_ai'), ('reviewing_deterministic', 'blocked'), ('reviewing_deterministic', 'failed'), ('reviewing_deterministic', 'cancelled'),
    ('reviewing_ai', 'ready'), ('reviewing_ai', 'blocked'), ('reviewing_ai', 'failed'), ('reviewing_ai', 'cancelled'),
    ('failed', 'queued'), ('failed', 'generation_queued'), ('failed', 'cancelled'),
    ('blocked', 'awaiting_plan_review'), ('blocked', 'cancelled')
  );
$$;

-- Compare-and-set: solo cambia si el estado actual es el esperado Y la transición está permitida.
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
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alta de una adaptación (idempotente por request_key)
-- ---------------------------------------------------------------------------

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
  p_analysis_fp text
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
begin
  if p_request_key is not null then
    select a.id into v_id from public.adaptations a where a.workspace_id = p_workspace and a.request_key = p_request_key;
    if v_id is not null then
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

  -- profile_snapshot es obligatorio en el modelo existente; el pipeline usa el contexto minimizado, así que no se copia el perfil.
  insert into public.adaptations (workspace_id, material_id, learner_profile_id, title, adaptation_type, profile_snapshot,
                                  status, created_by, request_key, pipeline_versions, context_snapshot, context_fingerprint, analysis_fingerprint)
  values (p_workspace, p_material, p_learner, p_title, p_type, jsonb_build_object('minimized', true),
          'queued', p_user, p_request_key, p_versions, p_context, p_context_fp, p_analysis_fp)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cola por etapa: encolar, reclamar (lease + ambigüedad), completar y fallar
-- ---------------------------------------------------------------------------

-- Encola una etapa. Idempotente: si ya hay una completada para la misma entrada la devuelve (reused), y si hay una activa, esa.
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
    if v_adaptation.status = 'blocked' then
      perform public.transition_adaptation(p_adaptation, 'blocked', 'awaiting_plan_review');
      v_adaptation.status := 'awaiting_plan_review';
    end if;
    if v_adaptation.status in ('failed', 'awaiting_plan_review') then
      perform public.transition_adaptation(p_adaptation, v_adaptation.status, 'queued');
    end if;
  else
    if v_adaptation.status not in ('generation_queued', 'failed') then
      raise exception 'invalid_state' using errcode = 'P0001', detail = v_adaptation.status;
    end if;
    if v_adaptation.status = 'failed' then
      perform public.transition_adaptation(p_adaptation, 'failed', 'generation_queued');
    end if;
  end if;

  insert into public.adaptation_jobs (workspace_id, material_id, requested_by, kind, input, status, adaptation_id, stage, input_fingerprint, max_attempts)
  values (v_adaptation.workspace_id, v_adaptation.material_id, v_adaptation.created_by, 'adapt', '{}'::jsonb, 'queued', p_adaptation, p_stage, p_input_fp, p_max_attempts)
  returning id into v_id;
  return jsonb_build_object('job_id', v_id, 'reused', false, 'status', 'queued');
end;
$$;

create or replace function public.claim_adaptation_stage(p_job uuid, p_lease_seconds int, p_ack_ambiguous boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.adaptation_jobs;
  v_ambiguous boolean;
  v_exhausted uuid;
begin
  update public.adaptation_jobs j
     set status = 'failed', locked_until = null, completed_at = now(), error = jsonb_build_object('code', 'attempts_exhausted')
   where j.id = p_job and j.adaptation_id is not null and j.status in ('queued', 'processing')
     and j.attempts >= j.max_attempts and (j.locked_until is null or j.locked_until <= now())
  returning j.adaptation_id into v_exhausted;
  if found then
    update public.adaptations a set status = 'failed', failure_code = 'attempts_exhausted'
     where a.id = v_exhausted and public.adaptation_transition_allowed(a.status, 'failed');
    return null;
  end if;

  select * into v_job from public.adaptation_jobs j where j.id = p_job and j.adaptation_id is not null for update;
  if not found or v_job.attempts >= v_job.max_attempts then
    return null;
  end if;
  if not ((v_job.status = 'queued' and (v_job.locked_until is null or v_job.locked_until <= now()))
          or (v_job.status = 'processing' and v_job.locked_until <= now())) then
    return null;
  end if;

  v_ambiguous := v_job.provider_call_started_at is not null and not p_ack_ambiguous;
  update public.adaptation_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()),
         step = case j.stage when 'planning' then 'planning' else 'generating' end,
         progress = greatest(j.progress, 10),
         provider_call_started_at = case when p_ack_ambiguous then null else j.provider_call_started_at end
   where j.id = p_job
  returning * into v_job;
  return to_jsonb(v_job) || jsonb_build_object('ambiguous_previous', v_ambiguous);
end;
$$;

create or replace function public.mark_provider_call(p_job uuid, p_attempt int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.adaptation_jobs j set provider_call_started_at = now()
   where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt and j.locked_until > now();
  return found;
end;
$$;

create or replace function public.clear_provider_call(p_job uuid, p_attempt int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.adaptation_jobs j set provider_call_started_at = null
   where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt;
  return found;
end;
$$;

create or replace function public.set_adaptation_job_step(p_job uuid, p_attempt int, p_step text, p_progress int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.adaptation_jobs j set step = p_step, progress = p_progress
   where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt;
  return found;
end;
$$;

create or replace function public.complete_adaptation_stage(p_job uuid, p_attempt int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.adaptation_jobs j
     set status = 'completed', progress = 100, step = null, locked_until = null, completed_at = now(), error = null, provider_call_started_at = null
   where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt;
  return found;
end;
$$;

-- Si no hay reintento, cierra el job Y mueve la adaptación (por defecto a 'failed'; una etapa que exige acción humana
-- puede devolverla a 'awaiting_plan_review'), en la misma transacción.
create or replace function public.fail_adaptation_stage(p_job uuid, p_attempt int, p_code text, p_retryable boolean, p_backoff_seconds int, p_adaptation_status text default 'failed')
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
       set status = 'queued', step = null, locked_until = now() + make_interval(secs => p_backoff_seconds), error = jsonb_build_object('code', p_code)
     where id = p_job;
    return 'retry';
  end if;
  update public.adaptation_jobs
     set status = 'failed', step = null, locked_until = null, completed_at = now(), error = jsonb_build_object('code', p_code)
   where id = p_job;
  update public.adaptations a
     set status = p_adaptation_status, failure_code = case when p_adaptation_status = 'failed' then p_code else a.failure_code end
   where a.id = v_job.adaptation_id and public.adaptation_transition_allowed(a.status, p_adaptation_status);
  return 'failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Artefactos, versiones y entrega
-- ---------------------------------------------------------------------------

-- Guarda una salida de etapa. Si ya existe (misma entrada o mismo contenido) la devuelve sin duplicar.
-- Con p_job, solo escribe el titular vigente del lease: un procesador que lo perdió no puede persistir.
create or replace function public.put_adaptation_artifact(
  p_adaptation uuid, p_job uuid, p_attempt int, p_kind text, p_input_fp text, p_fp text, p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_id uuid;
begin
  if p_job is not null and not exists (
    select 1 from public.adaptation_jobs j where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt and j.adaptation_id = p_adaptation
  ) then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
  select a.workspace_id into v_workspace from public.adaptations a where a.id = p_adaptation;
  if v_workspace is null then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;

  insert into public.adaptation_artifacts (workspace_id, adaptation_id, kind, input_fingerprint, fingerprint, payload)
  values (v_workspace, p_adaptation, p_kind, p_input_fp, p_fp, p_payload)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', true);
  end if;
  select ar.id into v_id from public.adaptation_artifacts ar
   where ar.adaptation_id = p_adaptation and ar.kind = p_kind
     and (ar.fingerprint = p_fp or (ar.input_fingerprint = p_input_fp and p_kind not in ('plan_review', 'execution_report')))
   order by ar.created_at limit 1;
  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

create or replace function public.find_adaptation_artifact(p_adaptation uuid, p_kind text, p_input_fp text, p_fp text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(ar) from public.adaptation_artifacts ar
   where ar.adaptation_id = p_adaptation and ar.kind = p_kind
     and (p_input_fp is null or ar.input_fingerprint = p_input_fp)
     and (p_fp is null or ar.fingerprint = p_fp)
   order by ar.created_at desc limit 1;
$$;

create or replace function public.list_adaptation_artifacts(p_adaptation uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(ar) order by ar.created_at), '[]'::jsonb) from public.adaptation_artifacts ar
   where ar.adaptation_id = p_adaptation and (p_kind is null or ar.kind = p_kind);
$$;

-- Nueva versión del documento (idempotente por huella de generación). Nunca pisa una versión anterior.
create or replace function public.persist_adaptation_version(
  p_adaptation uuid, p_job uuid, p_attempt int, p_document jsonb, p_plan_fp text, p_review_fp text, p_generation_fp text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_adaptation public.adaptations;
  v_existing public.adaptation_versions;
  v_version int;
  v_id uuid;
begin
  if p_job is not null and not exists (
    select 1 from public.adaptation_jobs j where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt and j.adaptation_id = p_adaptation
  ) then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
  select * into v_adaptation from public.adaptations a where a.id = p_adaptation for update;
  if not found then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  select * into v_existing from public.adaptation_versions v where v.adaptation_id = p_adaptation and v.generation_fingerprint = p_generation_fp;
  if found then
    return jsonb_build_object('id', v_existing.id, 'version', v_existing.version, 'created', false);
  end if;
  select coalesce(max(v.version), 0) + 1 into v_version from public.adaptation_versions v where v.adaptation_id = p_adaptation;
  insert into public.adaptation_versions (adaptation_id, workspace_id, version, document, review, source, created_by, plan_fingerprint, plan_review_fingerprint, generation_fingerprint)
  values (p_adaptation, v_adaptation.workspace_id, v_version, p_document, null, 'ai_generated', null, p_plan_fp, p_review_fp, p_generation_fp)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_version, 'created', true);
end;
$$;

-- Cierra la adaptación con su revisión pedagógica. La revisión de una versión se escribe UNA vez; entregar = ready + versión vigente.
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
         delivered_at = case when v_target = 'ready' then now() else a.delivered_at end,
         failure_code = null
   where a.id = p_adaptation;
  return jsonb_build_object('finalized', true, 'duplicate', false, 'status', v_target);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecturas de servidor, ai_runs y coste
-- ---------------------------------------------------------------------------

create or replace function public.get_adaptation_pipeline(p_adaptation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'adaptation', to_jsonb(a) - 'profile_snapshot' - 'strategy' - 'plan',
    'analysis', jsonb_build_object('analysis', m.analysis, 'prompt_version', m.analysis_prompt_version, 'status', m.status),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'stage', j.stage, 'status', j.status, 'attempts', j.attempts,
                       'max_attempts', j.max_attempts, 'step', j.step, 'progress', j.progress, 'locked_until', j.locked_until,
                       'input_fingerprint', j.input_fingerprint, 'error', j.error, 'ambiguous', j.provider_call_started_at is not null)
                       order by j.created_at) from public.adaptation_jobs j where j.adaptation_id = a.id), '[]'::jsonb)
  )
  from public.adaptations a join public.materials m on m.id = a.material_id
  where a.id = p_adaptation;
$$;

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
    attempt, schema_version, call_kind, reasoning_tokens, input_fingerprint, output_fingerprint, job_attempt
  ) values (
    (p_row ->> 'workspace_id')::uuid, (p_row ->> 'job_id')::uuid, (p_row ->> 'adaptation_id')::uuid, (p_row ->> 'material_id')::uuid,
    p_row ->> 'purpose', p_row ->> 'model_alias', p_row ->> 'provider', p_row ->> 'model', p_row ->> 'prompt_key',
    (p_row ->> 'prompt_version')::int, p_row ->> 'effort',
    coalesce((p_row ->> 'input_tokens')::int, 0), coalesce((p_row ->> 'output_tokens')::int, 0),
    coalesce((p_row ->> 'cached_input_tokens')::int, 0), coalesce((p_row ->> 'cache_creation_input_tokens')::int, 0),
    (p_row ->> 'estimated_cost_usd')::numeric, (p_row ->> 'latency_ms')::int, p_row ->> 'status', p_row ->> 'error_code',
    coalesce((p_row ->> 'attempt')::smallint, 1), (p_row ->> 'schema_version')::int, p_row ->> 'call_kind',
    (p_row ->> 'reasoning_tokens')::int, p_row ->> 'input_fingerprint', p_row ->> 'output_fingerprint', (p_row ->> 'job_attempt')::smallint
  )
  on conflict do nothing;
  return found;
end;
$$;

-- Llamadas de una adaptación (sin contenido) y, aparte, las del análisis compartido del material.
create or replace function public.list_ai_runs(p_adaptation uuid, p_material uuid, p_purpose text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb) from public.ai_runs r
   where (p_adaptation is not null and r.adaptation_id = p_adaptation)
      or (p_material is not null and r.material_id = p_material and r.adaptation_id is null and r.purpose = coalesce(p_purpose, r.purpose));
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'adaptation_transition_allowed(text, text)',
    'transition_adaptation(uuid, text, text, text)',
    'create_adaptation(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text)',
    'enqueue_adaptation_stage(uuid, text, text, int)',
    'claim_adaptation_stage(uuid, int, boolean)',
    'mark_provider_call(uuid, int)',
    'clear_provider_call(uuid, int)',
    'set_adaptation_job_step(uuid, int, text, int)',
    'complete_adaptation_stage(uuid, int)',
    'fail_adaptation_stage(uuid, int, text, boolean, int, text)',
    'put_adaptation_artifact(uuid, uuid, int, text, text, text, jsonb)',
    'find_adaptation_artifact(uuid, text, text, text)',
    'list_adaptation_artifacts(uuid, text)',
    'persist_adaptation_version(uuid, uuid, int, jsonb, text, text, text)',
    'finalize_adaptation(uuid, uuid, int, uuid, jsonb, text)',
    'get_adaptation_pipeline(uuid)',
    'record_ai_run(jsonb)',
    'list_ai_runs(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
