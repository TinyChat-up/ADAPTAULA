-- Adaptaula · 033 · Ciclo de vida de un material con adaptaciones: análisis fijado, reanálisis, retirada y eliminación definitiva.
--   1. Cada adaptación fija su análisis por huella (`adaptations.analysis_fingerprint`), pero el análisis vivía solo en
--      `materials.analysis`: un reanálisis dejaba sin análisis válido a las adaptaciones anteriores (stale_analysis). Ahora el
--      servidor guarda una copia inmutable del análisis vigente antes de sustituirlo, y el pipeline lee la copia de su huella.
--   2. «Retirar de la biblioteca»: archivado lógico (`archived_at`), reversible, sin tocar adaptaciones, archivos ni cuotas.
--   3. «Eliminar definitivamente» con adaptaciones: en dos pasos recuperables (marcar y listar ficheros → borrar ficheros en
--      Storage → borrar filas). Las relaciones SQL no cambian (siguen sin ON DELETE CASCADE hacia el material). El libro de
--      uso (`usage_events`) y `ai_runs` se conservan: nada se devuelve ni se reinicia.

-- ---------------------------------------------------------------------------
-- 1. Copias inmutables del análisis por huella
-- ---------------------------------------------------------------------------

create table public.material_analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  -- Huella del análisis normalizado (la misma que guarda la adaptación), calculada en el servidor.
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  analysis jsonb not null check (jsonb_typeof(analysis) = 'object'),
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (material_id, fingerprint)
);

create trigger material_analysis_snapshots_workspace
  before insert or update on public.material_analysis_snapshots
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

create or replace function public.material_analysis_snapshots_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'analysis_snapshot_immutable';
end;
$$;
create trigger material_analysis_snapshots_no_update
  before update on public.material_analysis_snapshots
  for each row execute function public.material_analysis_snapshots_immutable();

alter table public.material_analysis_snapshots enable row level security;
revoke all on public.material_analysis_snapshots from anon, authenticated;
grant select on public.material_analysis_snapshots to authenticated;
create policy "material_analysis_snapshots: leer si soy miembro" on public.material_analysis_snapshots
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- The pipeline of an adaptation reads the analysis it was created with: its own copy when the material was analysed again.
create or replace function public.get_adaptation_pipeline(p_adaptation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'adaptation', to_jsonb(a) - 'profile_snapshot' - 'strategy' - 'plan',
    'analysis', coalesce(
      (select jsonb_build_object('analysis', s.analysis, 'prompt_version', s.prompt_version, 'status', 'analyzed')
         from public.material_analysis_snapshots s
        where s.material_id = a.material_id and s.fingerprint = a.analysis_fingerprint),
      jsonb_build_object('analysis', m.analysis, 'prompt_version', m.analysis_prompt_version, 'status', m.status)),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'stage', j.stage, 'status', j.status, 'attempts', j.attempts,
                       'max_attempts', j.max_attempts, 'step', j.step, 'progress', j.progress, 'locked_until', j.locked_until,
                       'input_fingerprint', j.input_fingerprint, 'error', j.error, 'ambiguous', j.provider_call_started_at is not null)
                       order by j.created_at) from public.adaptation_jobs j where j.adaptation_id = a.id), '[]'::jsonb)
  )
  from public.adaptations a join public.materials m on m.id = a.material_id
  where a.id = p_adaptation;
$$;

-- ---------------------------------------------------------------------------
-- 2. Retirar de la biblioteca (archivado lógico) y 3. eliminación pendiente
-- ---------------------------------------------------------------------------

alter table public.materials
  add column archived_at timestamptz,
  -- Eliminación definitiva en curso: el material ya no se usa (ni nuevas adaptaciones, ni análisis) y se terminará de borrar.
  add column deletion_requested_at timestamptz;

create index materials_library_idx on public.materials (workspace_id, created_at desc) where archived_at is null and deletion_requested_at is null;

create or replace function public.set_material_archived(p_material uuid, p_archived boolean)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.materials where id = p_material and deletion_requested_at is null for update;
  if v_ws is null or not public.has_workspace_role(v_ws, array['owner', 'admin', 'teacher']) then
    raise exception using errcode = 'P0002', message = 'material_not_found';
  end if;
  update public.materials set archived_at = case when p_archived then coalesce(archived_at, now()) else null end where id = p_material;
  return p_archived;
end;
$$;
revoke all on function public.set_material_archived(uuid, boolean) from public, anon;
grant execute on function public.set_material_archived(uuid, boolean) to authenticated;

-- Nothing new starts on a material being deleted: no adaptation and no job (analysis, stage, image).
create or replace function public.refuse_deleting_material()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.material_id is not null and exists (select 1 from public.materials m where m.id = new.material_id and m.deletion_requested_at is not null) then
    raise exception using errcode = 'P0001', message = 'material_deleting';
  end if;
  return new;
end;
$$;
create trigger adaptations_refuse_deleting_material before insert on public.adaptations
  for each row execute function public.refuse_deleting_material();
create trigger adaptation_jobs_refuse_deleting_material before insert on public.adaptation_jobs
  for each row execute function public.refuse_deleting_material();

/*
 * Step 1 of a definitive deletion (service role only, called after the server authorised the teacher):
 *   · the teacher confirmed a number of adaptations; if it changed meanwhile, nothing happens (`confirmation_stale`);
 *   · a material with work in progress is not deleted (`material_busy`);
 *   · undelivered adaptations are cancelled and their reserved unit released (a delivered one stays consumed: never refunded);
 *   · the material is marked and the list of stored files to remove is returned. Idempotent: calling it again returns the list.
 */
create or replace function public.begin_material_deletion(p_material uuid, p_workspace uuid, p_user uuid, p_adaptations int)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare m public.materials; v_count int; v_files jsonb; v_a record;
begin
  select * into m from public.materials where id = p_material and workspace_id = p_workspace for update;
  if not found or not exists (select 1 from public.workspace_members wm where wm.workspace_id = p_workspace and wm.user_id = p_user
      and wm.role in ('owner', 'admin', 'teacher')) then
    raise exception using errcode = 'P0002', message = 'material_not_found';
  end if;
  select count(*) into v_count from public.adaptations where material_id = p_material;
  if m.deletion_requested_at is null then
    if p_adaptations is distinct from v_count then raise exception using errcode = 'P0001', message = 'confirmation_stale'; end if;
    if exists (select 1 from public.adaptation_jobs j where j.material_id = p_material and j.status in ('queued', 'processing')) then
      raise exception using errcode = 'P0001', message = 'material_busy';
    end if;
    for v_a in select id from public.adaptations where material_id = p_material and delivered_at is null and status <> 'cancelled' for update loop
      update public.adaptations set status = 'cancelled' where id = v_a.id;
      if exists (select 1 from public.adaptation_entitlements e where e.adaptation_id = v_a.id and e.state = 'reserved') then
        perform public.release_adaptation_entitlement(v_a.id, 'material_deleted');
      end if;
    end loop;
    update public.materials set deletion_requested_at = now() where id = p_material;
    insert into public.audit_logs (actor_id, workspace_id, action, target_type, target_id, metadata)
      values (p_user, p_workspace, 'material.deletion_requested', 'material', p_material::text, jsonb_build_object('adaptations', v_count));
  end if;
  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_files from (
    select jsonb_build_object('bucket', bucket, 'path', storage_path) f from public.material_files where material_id = p_material
    union all select jsonb_build_object('bucket', 'generated-assets', 'path', storage_path) from public.material_visual_assets where material_id = p_material
    union all select jsonb_build_object('bucket', 'generated-assets', 'path', g.storage_path) from public.generated_assets g
      join public.adaptations a on a.id = g.adaptation_id where a.material_id = p_material
    union all select jsonb_build_object('bucket', 'generated-assets', 'path', r.storage_path) from public.adaptation_visual_resources r
      join public.adaptations a on a.id = r.adaptation_id where a.material_id = p_material and r.storage_path is not null
  ) files;
  return jsonb_build_object('adaptations', v_count, 'files', v_files);
end;
$$;

/*
 * Step 2, only after every listed file was removed from Storage: the rows go (adaptations first, their versions, jobs, artifacts,
 * images and resources cascade; then the material and its files, analyses and visuals). `usage_events` has no link to them and
 * stays; `ai_runs` keeps its cost with the link set to null. Idempotent: a material already gone returns false.
 */
create or replace function public.finish_material_deletion(p_material uuid, p_workspace uuid, p_user uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare m public.materials; v_count int;
begin
  select * into m from public.materials where id = p_material and workspace_id = p_workspace for update;
  if not found then return false; end if;
  if m.deletion_requested_at is null then raise exception using errcode = 'P0001', message = 'deletion_not_requested'; end if;
  delete from public.adaptations where material_id = p_material;
  get diagnostics v_count = row_count;
  delete from public.materials where id = p_material;
  insert into public.audit_logs (actor_id, workspace_id, action, target_type, target_id, metadata)
    values (p_user, p_workspace, 'material.deleted', 'material', p_material::text, jsonb_build_object('adaptations', v_count));
  return true;
end;
$$;

revoke all on function public.begin_material_deletion(uuid, uuid, uuid, int), public.finish_material_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_material_deletion(uuid, uuid, uuid, int), public.finish_material_deletion(uuid, uuid, uuid)
  to service_role;
