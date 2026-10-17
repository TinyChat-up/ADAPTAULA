-- Compatibilidad para entornos que hayan aplicado 027 antes de que se cerrara la RPC.
-- En una instalación nueva 027 ya crea la firma segura; aquí se recrea con los mismos permisos.
-- En un entorno anterior se elimina atómicamente la firma sin argumentos que aceptaba authenticated.
drop function if exists public.request_account_deletion();

create or replace function public.request_account_deletion(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
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

notify pgrst, 'reload schema';
