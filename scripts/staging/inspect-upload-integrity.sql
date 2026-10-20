-- SOLO LECTURA. Preparado, no ejecutado contra servicios remotos.
-- Un FAIL bloquea la activación del cron nuevo. No ejecutar las RPC de trabajo como inspección.
select check_id, case when ok then 'PASS' else 'FAIL' end as result from (
  select '029.deadline' as check_id, exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='materials' and column_name='upload_expires_at' and is_nullable='NO') as ok
  union all select '029.cleanup_rls', coalesce((select relrowsecurity from pg_catalog.pg_class
    where oid=to_regclass('public.material_upload_cleanups')),false)
  union all select '029.no_client_queue_access', not coalesce(has_table_privilege('authenticated',
    to_regclass('public.material_upload_cleanups'),'SELECT,INSERT,UPDATE,DELETE'),true)
  union all select '029.guards', (select count(*)=3 from pg_catalog.pg_trigger
    where tgfoid=to_regprocedure('public.guard_reclaimed_upload()') and not tgisinternal and tgenabled='O')
) checks order by check_id;

select signature,
  case when to_regprocedure(signature) is not null
    and coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),true)
    and not coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true)
    then 'PASS' else 'FAIL' end as server_only
from (values
  ('public.open_material_upload_window(uuid,uuid,uuid)'),
  ('public.complete_material_upload(uuid,uuid,uuid,uuid,bigint,integer,text)'),
  ('public.reject_material_upload(uuid,uuid,uuid)'),
  ('public.claim_material_upload_cleanups(integer)'),
  ('public.finish_material_upload_cleanup(uuid,uuid,text)')
) functions(signature);
