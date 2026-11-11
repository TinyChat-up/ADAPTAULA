-- PASO 1 · Historial de migraciones (equivale a `supabase migration repair --status applied` de 001–033).
-- Solo crea la tabla de historial e inserta 33 filas. No ejecuta SQL de las migraciones ni toca ninguna tabla de la aplicación.
begin;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261001000100', 'base_identity_workspaces'),
  ('20261001000200', 'catalog_billing_usage'),
  ('20261001000300', 'learners_classes'),
  ('20261001000400', 'materials_adaptations'),
  ('20261001000500', 'operations'),
  ('20261001000600', 'storage'),
  ('20261001000700', 'provisioning'),
  ('20261001000800', 'drop_learner_notes'),
  ('20261001000900', 'materials_analysis'),
  ('20261001001000', 'analysis_quota'),
  ('20261001001100', 'drop_contextual_tags'),
  ('20261001001200', 'ai_runs_cache_creation'),
  ('20261001001300', 'adaptation_pipeline'),
  ('20261001001400', 'adaptation_entitlements'),
  ('20261001001500', 'adaptation_jobs_runtime'),
  ('20261001001600', 'material_visuals'),
  ('20261001001700', 'visual_asset_instances'),
  ('20261001001800', 'cost_controls'),
  ('20261001001900', 'creation_mode'),
  ('20261001002000', 'adaptation_visual_resources'),
  ('20261001002100', 'visual_resource_original_keys'),
  ('20261001002200', 'automatic_visuals'),
  ('20261001002300', 'magic_visual_policy'),
  ('20261001002400', 'generated_illustrations'),
  ('20261001002500', 'teacher_drafts'),
  ('20261001002600', 'commercial_policy'),
  ('20261001002700', 'account_deletion_requests'),
  ('20261001002800', 'account_deletion_rpc_server_only'),
  ('20261001002900', 'material_upload_integrity'),
  ('20261001003000', 'private_max_pilot'),
  ('20261001003100', 'max_checkout'),
  ('20261001003200', 'profile_version_guard'),
  ('20261001003300', 'material_library_lifecycle')
on conflict (version) do nothing;
commit;
select count(*) as filas, min(version) as primera, max(version) as ultima from supabase_migrations.schema_migrations;  -- 33, 20261001000100, 20261001003300
