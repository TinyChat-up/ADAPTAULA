-- SOLO LECTURA. Ejecutar únicamente si to_regclass('supabase_migrations.schema_migrations')
-- devuelve un nombre. En instalaciones hechas por SQL Editor puede no existir historia CLI.
select version from supabase_migrations.schema_migrations
where version in ('20261001002500', '20261001002600', '20261001002700', '20261001002800')
order by version;
