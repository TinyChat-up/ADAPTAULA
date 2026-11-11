-- Huella del esquema `public` (columnas, índices, políticas, restricciones, disparadores, funciones con su código y RLS), agregada por tipo.
-- Solo lectura. Dos bases con el mismo esquema devuelven las mismas siete filas. Los `NOT NULL` se excluyen de las restricciones porque
-- Postgres 17 no los registra y Postgres 18 sí. Valores esperados tras las migraciones 001–033: docs/qa/copia-seguridad/README.md.
select k, count(*) n, md5(string_agg(t||'='||h, ',' order by t)) agg from (select 'cols' k, table_name t, md5(string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by column_name)) h, count(*) n from information_schema.columns where table_schema='public' group by table_name
union all select 'idx', tablename, md5(string_agg(indexname, ',' order by indexname)), count(*) from pg_indexes where schemaname='public' group by tablename
union all select 'pol', tablename, md5(string_agg(policyname||':'||cmd, ',' order by policyname)), count(*) from pg_policies where schemaname='public' group by tablename
union all select 'con', c.relname, md5(string_agg(k.conname||':'||k.contype::text, ',' order by k.conname)), count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and k.contype <> 'n' and k.conname !~ '^[0-9]+_' group by c.relname
union all select 'trg', c.relname, md5(string_agg(t.tgname, ',' order by t.tgname)), count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal group by c.relname
union all select 'fn', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')), 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'rls', relname, relrowsecurity::text, 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'
) x(k,t,h,n) group by k order by k;
