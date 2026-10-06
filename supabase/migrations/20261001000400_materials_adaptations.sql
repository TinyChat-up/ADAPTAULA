-- Adaptaula · 004 · Materiales, jobs de IA, adaptaciones, versiones, assets, exports y feedback
-- Ver docs/DATABASE.md y docs/AI_PIPELINE.md.

-- ---------------------------------------------------------------------------
-- Materiales
-- ---------------------------------------------------------------------------

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  stage_slug text references public.stages (slug),
  grade_slug text references public.grades (slug),
  subject_slug text references public.subjects (slug),
  topic text check (char_length(topic) <= 200),
  source_type text not null check (source_type in ('pdf', 'image')),
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'analyzing', 'analyzed', 'failed')),
  content_hash text check (content_hash ~ '^[a-f0-9]{64}$'),
  analysis jsonb,
  analysis_prompt_version text,
  page_count int check (page_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index materials_workspace_idx on public.materials (workspace_id, created_at desc);
create index materials_hash_idx on public.materials (workspace_id, content_hash);

create trigger materials_set_updated_at
  before update on public.materials
  for each row execute function public.set_updated_at();

create table public.material_files (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bucket text not null check (bucket in ('source-materials')),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0),
  page_count int check (page_count > 0),
  kind text not null default 'source' check (kind in ('source', 'thumbnail')),
  created_at timestamptz not null default now()
);

create index material_files_material_idx on public.material_files (material_id);

create trigger material_files_workspace
  before insert or update on public.material_files
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

-- ---------------------------------------------------------------------------
-- Jobs de IA (cola respaldada por la base de datos, ADR-004)
-- ---------------------------------------------------------------------------

create table public.adaptation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('adapt', 'revise_block', 'image')),
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'partial', 'failed', 'canceled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  step text check (step in ('analyzing', 'planning', 'generating', 'reviewing', 'rendering')),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts > 0),
  locked_until timestamptz,
  priority smallint not null default 0,
  error jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index adaptation_jobs_workspace_idx on public.adaptation_jobs (workspace_id, created_at desc);
create index adaptation_jobs_queue_idx on public.adaptation_jobs (priority desc, created_at)
  where status in ('pending', 'processing');

create trigger adaptation_jobs_workspace
  before insert or update on public.adaptation_jobs
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

alter table public.usage_events
  add constraint usage_events_job_fk foreign key (job_id) references public.adaptation_jobs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Adaptaciones (una por job × perfil) y versiones inmutables
-- ---------------------------------------------------------------------------

create table public.adaptations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  job_id uuid references public.adaptation_jobs (id) on delete set null,
  material_id uuid not null references public.materials (id) on delete cascade,
  -- null = adaptación rápida; si se borra el perfil, la adaptación se conserva con su snapshot.
  learner_profile_id uuid references public.learner_profiles (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  adaptation_type text not null check (adaptation_type in (
    'accessibility', 'methodological', 'linguistic', 'reinforcement', 'enrichment', 'curricular'
  )),
  profile_snapshot jsonb not null check (jsonb_typeof(profile_snapshot) = 'object'),
  strategy jsonb not null default '{}'::jsonb,
  plan jsonb,
  change_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(change_summary) = 'array'),
  visual_template text not null default 'estandar' check (visual_template ~ '^[a-z0-9-]+$'),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  current_version int not null default 0 check (current_version >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index adaptations_workspace_idx on public.adaptations (workspace_id, created_at desc);
create index adaptations_material_idx on public.adaptations (material_id);
create index adaptations_profile_idx on public.adaptations (learner_profile_id);
create index adaptations_job_idx on public.adaptations (job_id);

create trigger adaptations_set_updated_at
  before update on public.adaptations
  for each row execute function public.set_updated_at();
create trigger adaptations_material_workspace
  before insert or update on public.adaptations
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');
create trigger adaptations_profile_workspace
  before insert or update on public.adaptations
  for each row execute function public.enforce_parent_workspace('learner_profiles', 'learner_profile_id');

create table public.adaptation_versions (
  id uuid primary key default gen_random_uuid(),
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version int not null check (version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  review jsonb,
  source text not null check (source in ('ai_generated', 'ai_revised', 'teacher_edit')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (adaptation_id, version)
);

create trigger adaptation_versions_workspace
  before insert or update on public.adaptation_versions
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

-- ---------------------------------------------------------------------------
-- Recursos generados, exports y feedback
-- ---------------------------------------------------------------------------

create table public.generated_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  block_id text,
  type text not null check (type in ('illustration', 'card', 'sequence', 'visual_vocabulary', 'manipulative', 'other')),
  storage_path text not null unique,
  image_brief jsonb,
  prompt text,
  alt_text text check (char_length(alt_text) <= 300),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index generated_assets_adaptation_idx on public.generated_assets (adaptation_id);

create trigger generated_assets_workspace
  before insert or update on public.generated_assets
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  version int not null check (version > 0),
  visual_template text not null,
  format text not null default 'pdf' check (format in ('pdf')),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  storage_path text unique,
  created_at timestamptz not null default now()
);

create index exports_adaptation_idx on public.exports (adaptation_id, version, visual_template);

create trigger exports_workspace
  before insert or update on public.exports
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

create table public.adaptation_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  helpful boolean not null,
  reasons text[] not null default '{}' check (reasons <@ array[
    'too_easy', 'too_hard', 'too_much_text', 'not_useful', 'errors', 'design', 'other'
  ]::text[]),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (adaptation_id, user_id)
);

create trigger adaptation_feedback_workspace
  before insert or update on public.adaptation_feedback
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.materials enable row level security;
alter table public.material_files enable row level security;
alter table public.adaptation_jobs enable row level security;
alter table public.adaptations enable row level security;
alter table public.adaptation_versions enable row level security;
alter table public.generated_assets enable row level security;
alter table public.exports enable row level security;
alter table public.adaptation_feedback enable row level security;

revoke all on public.materials, public.material_files, public.adaptation_jobs, public.adaptations,
  public.adaptation_versions, public.generated_assets, public.exports, public.adaptation_feedback from anon;

-- Materiales: el docente crea (estado inicial) y edita metadatos; estado, hash y análisis los gestiona el servidor.
revoke update on public.materials from authenticated;
grant update (title, stage_slug, grade_slug, subject_slug, topic) on public.materials to authenticated;

create policy "materials: leer si soy miembro" on public.materials
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "materials: crear si puedo escribir" on public.materials
  for insert to authenticated
  with check (
    public.can_write_workspace(workspace_id)
    and created_by = (select auth.uid())
    and status = 'uploading'
    and analysis is null
  );
create policy "materials: editar si puedo escribir" on public.materials
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));
create policy "materials: borrar si puedo escribir" on public.materials
  for delete to authenticated using (public.can_write_workspace(workspace_id));

-- Ficheros, jobs, assets y exports: lectura para miembros; escritura solo servidor.
revoke insert, update, delete on public.material_files, public.adaptation_jobs, public.generated_assets, public.exports
  from authenticated;

create policy "material_files: leer si soy miembro" on public.material_files
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "adaptation_jobs: leer si soy miembro" on public.adaptation_jobs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "generated_assets: leer si soy miembro" on public.generated_assets
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "exports: leer si soy miembro" on public.exports
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Adaptaciones: las crea el servidor; el docente cambia título, plantilla y versión actual, o la borra.
revoke insert, update on public.adaptations from authenticated;
grant update (title, visual_template, current_version) on public.adaptations to authenticated;

create policy "adaptations: leer si soy miembro" on public.adaptations
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "adaptations: editar si puedo escribir" on public.adaptations
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));
create policy "adaptations: borrar si puedo escribir" on public.adaptations
  for delete to authenticated using (public.can_write_workspace(workspace_id));

-- Versiones: inmutables. El docente solo añade versiones de edición propia.
revoke update, delete on public.adaptation_versions from authenticated;

create policy "adaptation_versions: leer si soy miembro" on public.adaptation_versions
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "adaptation_versions: añadir edición propia" on public.adaptation_versions
  for insert to authenticated
  with check (
    public.can_write_workspace(workspace_id)
    and source = 'teacher_edit'
    and created_by = (select auth.uid())
  );

-- Feedback: cualquier miembro valora; cada uno edita el suyo.
revoke delete on public.adaptation_feedback from authenticated;
revoke update on public.adaptation_feedback from authenticated;
grant update (helpful, reasons, comment) on public.adaptation_feedback to authenticated;

create policy "adaptation_feedback: leer si soy miembro" on public.adaptation_feedback
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "adaptation_feedback: valorar" on public.adaptation_feedback
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and user_id = (select auth.uid()));
create policy "adaptation_feedback: editar la propia" on public.adaptation_feedback
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));
