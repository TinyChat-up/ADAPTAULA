-- Adaptaula · 001 · Utilidades, identidad y workspaces
-- Ver docs/DATABASE.md. Todas las funciones security definer fijan search_path = '' y usan nombres calificados.

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Convierte texto en uuid sin lanzar error (rutas de Storage manipuladas, etc.).
create or replace function public.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  teaching_stages text[] not null default '{}',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspaces y miembros
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  type text not null default 'personal'
    check (type in ('personal', 'school', 'high_school', 'academy', 'organization')),
  -- restrict: borrar una cuenta exige borrar antes sus workspaces de forma explícita (flujo de baja).
  owner_id uuid not null references public.profiles (id) on delete restrict,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_idx on public.workspaces (owner_id);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'teacher', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.system_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Funciones de autorización (usadas por las políticas RLS)
-- security definer: leen workspace_members sin depender de su propia RLS.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_role(ws uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create or replace function public.can_write_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_workspace_role(ws, array['owner', 'admin', 'teacher']);
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.system_admins a where a.user_id = (select auth.uid()));
$$;

-- Comprueba que una fila hija pertenece al mismo workspace que su padre.
-- Uso: trigger ... execute function public.enforce_parent_workspace('tabla_padre', 'columna_fk')
create or replace function public.enforce_parent_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_id uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  parent_ws uuid;
begin
  if parent_id is null then
    return new;
  end if;
  execute format('select workspace_id from public.%I where id = $1', tg_argv[0])
    into parent_ws
    using parent_id;
  if parent_ws is distinct from new.workspace_id then
    raise exception 'workspace_mismatch' using errcode = '23514',
      detail = format('%s.%s no pertenece al workspace indicado', tg_argv[0], tg_argv[1]);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alta de usuario: perfil + workspace personal + membresía owner
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  v_workspace uuid;
begin
  insert into public.profiles (id, full_name) values (new.id, left(v_name, 120));

  insert into public.workspaces (name, type, owner_id)
  values ('Mi espacio', 'personal', new.id)
  returning id into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------

revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.has_workspace_role(uuid, text[]) from public, anon;
revoke execute on function public.can_write_workspace(uuid) from public, anon;
revoke execute on function public.is_system_admin() from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.can_write_workspace(uuid) to authenticated, service_role;
grant execute on function public.is_system_admin() to authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_parent_workspace() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.system_admins enable row level security;

-- profiles: cada usuario solo ve y edita su propio perfil, y solo ciertas columnas.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, teaching_stages, onboarding_completed) on public.profiles to authenticated;

create policy "profiles: leer el propio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: editar el propio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces: los miembros leen; owner/admin editan nombre y ajustes. Altas y bajas, solo servidor.
revoke insert, update, delete on public.workspaces from anon, authenticated;
grant update (name, settings) on public.workspaces to authenticated;

create policy "workspaces: leer si soy miembro" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "workspaces: editar si soy owner o admin" on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']))
  with check (public.has_workspace_role(id, array['owner', 'admin']));

-- workspace_members: lectura para miembros; la gestión de miembros llega con Centros (servidor).
revoke insert, update, delete on public.workspace_members from anon, authenticated;

create policy "workspace_members: leer si soy miembro" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- system_admins: sin políticas = sin acceso salvo service role.
revoke all on public.system_admins from anon, authenticated;
