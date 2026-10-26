-- Keep an old deployment/client from silently erasing V2 observations by writing a V1 profile.
-- No row conversion, no elevated privileges, no change to role/workspace policies.
create or replace function public.prevent_profile_version_downgrade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.functional_profile ->> 'schema_version' = '2'
     and new.functional_profile ->> 'schema_version' is distinct from '2' then
    raise exception using errcode = '23514', message = 'profile_version_downgrade';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_profile_version_downgrade() from public, anon, authenticated;

create or replace trigger learner_profiles_version_guard
before update of functional_profile on public.learner_profiles
for each row execute function public.prevent_profile_version_downgrade();
