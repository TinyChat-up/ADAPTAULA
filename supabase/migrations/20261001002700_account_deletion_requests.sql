-- Etapa 5A: solicitud duradera de baja. No borra datos ni identidades automáticamente.
-- El procesamiento final requiere una política de conservación y un borrado de Storage
-- con reintentos; hasta entonces la solicitud permanece visible y pendiente.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- Intentionally no FK: keep a pseudonymous request id after Auth is removed,
  -- so an interrupted deletion can be reconciled without retaining the email.
  user_id uuid not null unique,
  status text not null default 'requested' check (status in ('requested', 'reviewing', 'blocked', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests (status, created_at);

drop trigger if exists account_deletion_requests_updated_at on public.account_deletion_requests;
create trigger account_deletion_requests_updated_at before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

drop policy if exists "account_deletion_requests: read own" on public.account_deletion_requests;
create policy "account_deletion_requests: read own" on public.account_deletion_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- Solo el servidor con service_role puede invocarla, después de verificar la contraseña.
-- p_user procede de auth.getUser() en el servidor; nunca de parámetros del navegador.
create or replace function public.request_account_deletion(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  insert into public.account_deletion_requests (user_id)
  values (p_user)
  on conflict (user_id) do update set user_id = excluded.user_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.request_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid) to service_role;
