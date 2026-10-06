-- Adaptaula · 007 · Aprovisionamiento idempotente de usuario y workspace personal
-- Garantiza "ningún usuario sin workspace": el alta lo hace en la misma transacción (trigger) y
-- el servidor puede repararlo con ensure_personal_workspace() si alguna vez faltara.

-- Una persona tiene como mucho un workspace personal (los de centro no tienen esta restricción).
create unique index if not exists workspaces_one_personal_per_owner
  on public.workspaces (owner_id) where type = 'personal';

-- Compatibilidad: si la 005 antigua ya estaba aplicada, esta función se llamaba rate_limit_hit.
do $$
begin
  if to_regprocedure('public.rate_limit_hit(text,integer,integer)') is not null then
    alter function public.rate_limit_hit(text, int, int) rename to rate_limit_allowed;
  end if;
end
$$;

-- Crea perfil, workspace personal y membresía owner. Idempotente y segura frente a concurrencia.
create or replace function public.provision_user(p_user uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('provision:' || p_user::text, 0));

  insert into public.profiles (id, full_name)
  values (p_user, nullif(left(trim(coalesce(p_name, '')), 120), ''))
  on conflict (id) do nothing;

  select w.id into v_workspace
  from public.workspaces w
  where w.owner_id = p_user and w.type = 'personal';

  if v_workspace is null then
    insert into public.workspaces (name, type, owner_id)
    values ('Mi espacio', 'personal', p_user)
    returning id into v_workspace;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, p_user, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return v_workspace;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.provision_user(
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

-- Reparación bajo demanda para el usuario autenticado (nunca para otro usuario).
create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    into v_name
  from auth.users u
  where u.id = v_user;
  return public.provision_user(v_user, v_name);
end;
$$;

revoke execute on function public.provision_user(uuid, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.ensure_personal_workspace() from public, anon;
grant execute on function public.ensure_personal_workspace() to authenticated, service_role;
