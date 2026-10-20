-- SOLO LECTURA. Ejecutar en SQL Editor de staging durante la fase B autorizada.
-- FAIL impide desplegar la API nueva; la historia de migraciones se consulta aparte.
select check_id, case when ok then 'PASS' else 'FAIL' end as result from (
  select '025.drafts_rls' as check_id,
    coalesce((select c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'adaptation_drafts'), false) as ok
  union all select '025.draft_save_rpc', to_regprocedure('public.save_adaptation_draft(uuid,integer,integer,jsonb,boolean)') is not null
  union all select '025.authenticated_can_save', coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.save_adaptation_draft(uuid,integer,integer,jsonb,boolean)'), 'EXECUTE'), false)
  union all select '025.anon_cannot_save', not coalesce(has_function_privilege('anon',
    to_regprocedure('public.save_adaptation_draft(uuid,integer,integer,jsonb,boolean)'), 'EXECUTE'), true)
  union all select '025.no_client_draft_insert', not coalesce(has_table_privilege('authenticated',
    to_regclass('public.adaptation_drafts'), 'INSERT'), true)
  union all select '026.free_contract', exists (select 1 from public.plans where slug = 'free'
    and monthly_adaptations = 1 and max_profiles = 2
    and features ->> 'commercial_policy' = '2026-10-v2'
    and features ->> 'monthly_analyses' = '2' and features ->> 'max_pages_per_material' = '5')
  union all select '026.pro_contract', exists (select 1 from public.plans where slug = 'pro'
    and monthly_adaptations = 15 and max_profiles = 30
    and features ->> 'commercial_policy' = '2026-10-v2'
    and features ->> 'monthly_analyses' = '30' and features ->> 'max_pages_per_material' = '15')
  union all select '026.max_contract', exists (select 1 from public.plans where slug = 'max'
    and monthly_adaptations = 30 and max_profiles = 100
    and features ->> 'commercial_policy' = '2026-10-v2'
    and features ->> 'monthly_analyses' = '50' and features ->> 'max_pages_per_material' = '25')
  union all select '027.requests_rls', coalesce((select c.relrowsecurity from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'account_deletion_requests'), false)
  union all select '028.old_rpc_absent', to_regprocedure('public.request_account_deletion()') is null
  union all select '028.server_rpc_present', to_regprocedure('public.request_account_deletion(uuid)') is not null
  union all select '028.server_rpc_definer', coalesce((select p.prosecdef from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.request_account_deletion(uuid)')), false)
  union all select '028.authenticated_denied', not coalesce(has_function_privilege('authenticated',
    to_regprocedure('public.request_account_deletion(uuid)'), 'EXECUTE'), true)
  union all select '028.anon_denied', not coalesce(has_function_privilege('anon',
    to_regprocedure('public.request_account_deletion(uuid)'), 'EXECUTE'), true)
  union all select '028.service_allowed', coalesce(has_function_privilege('service_role',
    to_regprocedure('public.request_account_deletion(uuid)'), 'EXECUTE'), false)
  union all select '027.no_client_insert', not coalesce(has_table_privilege('authenticated',
    to_regclass('public.account_deletion_requests'), 'INSERT'), true)
  union all select '027.no_client_update', not coalesce(has_table_privilege('authenticated',
    to_regclass('public.account_deletion_requests'), 'UPDATE'), true)
  union all select '027.read_own_policy', exists (select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'account_deletion_requests'
    and cmd = 'SELECT' and policyname = 'account_deletion_requests: read own' and qual like '%auth.uid%')
  union all select 'storage.objects_rls', coalesce((select c.relrowsecurity from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'), false)
  union all select 'storage.private_buckets', (select count(*) from storage.buckets
    where id in ('source-materials', 'generated-assets', 'exports') and not public) = 3
) as checks order by check_id;
