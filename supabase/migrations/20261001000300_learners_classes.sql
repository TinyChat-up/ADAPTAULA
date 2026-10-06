-- Adaptaula · 003 · Perfiles de alumnado y clases
-- Privacidad: display_name admite alias; notes y contextual_tags nunca se envían a la IA (docs/PRIVACY.md).

create table public.learner_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  stage_slug text references public.stages (slug),
  grade_slug text references public.grades (slug),
  notes text check (char_length(notes) <= 1000),
  functional_profile jsonb not null
    default '{"schema_version": 1, "supports": {}, "limits": {}, "allowances": {}}'::jsonb
    check (jsonb_typeof(functional_profile) = 'object'),
  contextual_tags text[] not null default '{}' check (cardinality(contextual_tags) <= 10),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index learner_profiles_workspace_idx on public.learner_profiles (workspace_id, archived_at, display_name);

create trigger learner_profiles_set_updated_at
  before update on public.learner_profiles
  for each row execute function public.set_updated_at();

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  stage_slug text references public.stages (slug),
  grade_slug text references public.grades (slug),
  academic_year text check (academic_year ~ '^\d{4}-\d{4}$'),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index classes_workspace_idx on public.classes (workspace_id, archived_at);

create trigger classes_set_updated_at
  before update on public.classes
  for each row execute function public.set_updated_at();

create table public.class_learners (
  class_id uuid not null references public.classes (id) on delete cascade,
  learner_profile_id uuid not null references public.learner_profiles (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, learner_profile_id)
);

create index class_learners_profile_idx on public.class_learners (learner_profile_id);

create trigger class_learners_class_workspace
  before insert or update on public.class_learners
  for each row execute function public.enforce_parent_workspace('classes', 'class_id');
create trigger class_learners_profile_workspace
  before insert or update on public.class_learners
  for each row execute function public.enforce_parent_workspace('learner_profiles', 'learner_profile_id');

-- ---------------------------------------------------------------------------
-- Límites del plan (defensa en profundidad; el servidor ya los comprueba con checkEntitlement)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource text := tg_argv[0];  -- 'profiles' | 'classes'
  v_limit int;
  v_count int;
begin
  -- Solo cuentan las altas y las desarchivaciones de elementos activos.
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return new;
  end if;
  if new.archived_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || v_resource, 0));

  if v_resource = 'profiles' then
    select p.max_profiles into v_limit from public.workspace_plan(new.workspace_id) p;
    select count(*) into v_count from public.learner_profiles
      where workspace_id = new.workspace_id and archived_at is null and id <> new.id;
  else
    select p.max_classes into v_limit from public.workspace_plan(new.workspace_id) p;
    select count(*) into v_count from public.classes
      where workspace_id = new.workspace_id and archived_at is null and id <> new.id;
  end if;

  if v_count >= coalesce(v_limit, 0) then
    raise exception 'limit_reached:%', v_resource using errcode = 'P0001',
      detail = format('limit=%s', coalesce(v_limit, 0));
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

create trigger learner_profiles_plan_limit
  before insert or update of archived_at on public.learner_profiles
  for each row execute function public.enforce_plan_limit('profiles');

create trigger classes_plan_limit
  before insert or update of archived_at on public.classes
  for each row execute function public.enforce_plan_limit('classes');

-- ---------------------------------------------------------------------------
-- RLS: miembros leen; owner/admin/teacher escriben; viewer solo lee.
-- ---------------------------------------------------------------------------

alter table public.learner_profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_learners enable row level security;

-- workspace_id y created_by no se pueden cambiar después del alta.
revoke update on public.learner_profiles from anon, authenticated;
grant update (display_name, stage_slug, grade_slug, notes, functional_profile, contextual_tags, archived_at)
  on public.learner_profiles to authenticated;
revoke update on public.classes from anon, authenticated;
grant update (name, stage_slug, grade_slug, academic_year, archived_at) on public.classes to authenticated;
revoke update on public.class_learners from anon, authenticated;
revoke all on public.learner_profiles, public.classes, public.class_learners from anon;

create policy "learner_profiles: leer si soy miembro" on public.learner_profiles
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "learner_profiles: crear si puedo escribir" on public.learner_profiles
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id) and created_by = (select auth.uid()));
create policy "learner_profiles: editar si puedo escribir" on public.learner_profiles
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));
create policy "learner_profiles: borrar si puedo escribir" on public.learner_profiles
  for delete to authenticated using (public.can_write_workspace(workspace_id));

create policy "classes: leer si soy miembro" on public.classes
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "classes: crear si puedo escribir" on public.classes
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id) and created_by = (select auth.uid()));
create policy "classes: editar si puedo escribir" on public.classes
  for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));
create policy "classes: borrar si puedo escribir" on public.classes
  for delete to authenticated using (public.can_write_workspace(workspace_id));

create policy "class_learners: leer si soy miembro" on public.class_learners
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "class_learners: añadir si puedo escribir" on public.class_learners
  for insert to authenticated with check (public.can_write_workspace(workspace_id));
create policy "class_learners: quitar si puedo escribir" on public.class_learners
  for delete to authenticated using (public.can_write_workspace(workspace_id));
