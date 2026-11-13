-- Allow V2 -> V3 while preventing older deployments or direct clients from erasing newer fields.
create or replace function public.prevent_profile_version_downgrade()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.functional_profile ->> 'schema_version' = '2' and new.functional_profile ->> 'schema_version' not in ('2', '3'))
     or (old.functional_profile ->> 'schema_version' = '2' and new.functional_profile ->> 'schema_version' is null)
     or (old.functional_profile ->> 'schema_version' = '3' and new.functional_profile ->> 'schema_version' is distinct from '3') then
    raise exception using errcode = '23514', message = 'profile_version_downgrade';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_profile_version_downgrade() from public, anon, authenticated;
