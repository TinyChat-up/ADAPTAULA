-- Adaptaula / lanzamiento v1: comprobación estructural de migración 019.
-- SOLO LECTURA: no invoca las RPC, no modifica el esquema ni lee datos de usuarios.
-- Ejecutar de forma separada en staging y, con autorización de consulta, en producción.
-- Una fila FAIL = NO-GO para "Hacer magia"; la ejecución de este SQL no prueba
-- que el flujo de la aplicación funcione extremo a extremo.
--
-- La firma de 13 parámetros debe sustituir a la de 12; ambas firmas
-- simultáneas podrían hacer ambigua la resolución de la RPC de PostgREST.
select check_id, case when ok then 'PASS' else 'FAIL' end as result
from (
  select '019.creation_mode_column' as check_id,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'adaptations'
        and column_name = 'creation_mode' and data_type = 'text'
        and is_nullable = 'NO'
    ) as ok

  union all select '019.creation_mode_default',
    coalesce((
      select column_default like '%review%'
      from information_schema.columns
      where table_schema = 'public' and table_name = 'adaptations'
        and column_name = 'creation_mode'
    ), false)

  union all select '019.creation_mode_check',
    exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = to_regclass('public.adaptations')
        and c.conname = 'adaptations_creation_mode_check'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%automatic%'
        and pg_get_constraintdef(c.oid) like '%review%'
    )

  union all select '019.create_rpc_current',
    to_regprocedure(
      'public.create_adaptation(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,boolean,text)'
    ) is not null

  union all select '019.create_rpc_legacy_absent',
    to_regprocedure(
      'public.create_adaptation(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,boolean)'
    ) is null

  union all select '019.create_rpc_service_only',
    coalesce(has_function_privilege(
      'service_role',
      to_regprocedure('public.create_adaptation(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,boolean,text)'),
      'EXECUTE'
    ), false)

  union all select '019.create_rpc_no_anon',
    not coalesce(has_function_privilege(
      'anon',
      to_regprocedure('public.create_adaptation(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,boolean,text)'),
      'EXECUTE'
    ), true)

  union all select '019.create_rpc_no_authenticated',
    not coalesce(has_function_privilege(
      'authenticated',
      to_regprocedure('public.create_adaptation(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,boolean,text)'),
      'EXECUTE'
    ), true)
) checks
order by check_id;
