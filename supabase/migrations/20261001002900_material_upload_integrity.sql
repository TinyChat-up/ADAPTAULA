-- La finalización y la limpieza deciden bajo el mismo lock de materials.
-- Storage se procesa fuera de la transacción. Las lápidas conservan rutas para
-- detectar escrituras tardías incluso después de borrar la fila del material.
-- El default volátil da a las filas heredadas una ventana completa desde la
-- migración, sin reescribir su contenido ni disparar el trigger updated_at.
alter table public.materials add column upload_expires_at timestamptz not null
  default (clock_timestamp() + interval '2 hours');

create table public.material_upload_cleanups (
  material_id uuid primary key,
  workspace_id uuid not null,
  files jsonb not null check (jsonb_typeof(files) = 'array'),
  reason text not null check (reason in ('expired', 'rejected')),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (last_error in ('storage_failed', 'storage_unconfirmed')),
  last_checked_at timestamptz,
  row_deleted_at timestamptz,
  check ((lease_token is null) = (lease_until is null))
);
-- Sin FK: un borrado/cascade del material o workspace no pierde el seguimiento.
alter table public.material_upload_cleanups enable row level security;
revoke all on public.material_upload_cleanups from public, anon, authenticated, service_role;
grant select on public.material_upload_cleanups to service_role;
create index material_upload_cleanups_due on public.material_upload_cleanups(next_attempt_at);
create index material_upload_cleanups_paths on public.material_upload_cleanups using gin(files jsonb_path_ops);
create index materials_pending_upload_expiry on public.materials(upload_expires_at) where status = 'uploading';

create function public.guard_reclaimed_upload() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if tg_table_name = 'material_files' then
    v_id := new.material_id;
    perform 1 from public.materials where id = v_id for update;
    if tg_op = 'UPDATE' and (new.material_id <> old.material_id or new.storage_path <> old.storage_path or new.bucket <> old.bucket) then
      raise exception 'upload_file_immutable';
    end if;
    if exists (select 1 from public.material_upload_cleanups
      where files @> jsonb_build_array(jsonb_build_object('bucket', new.bucket, 'path', new.storage_path))) then
      raise exception 'upload_unavailable';
    end if;
  else v_id := new.id;
  end if;
  if exists (select 1 from public.material_upload_cleanups where material_id = v_id) then
    raise exception 'upload_unavailable';
  end if;
  return new;
end $$;
create trigger materials_reclaimed_upload before insert or update on public.materials
  for each row execute function public.guard_reclaimed_upload();
create trigger material_files_reclaimed_upload before insert or update on public.material_files
  for each row execute function public.guard_reclaimed_upload();
-- Recomprueba después de cualquier espera por la unicidad de storage_path: no
-- se puede volver a registrar una ruta que acaba de convertirse en lápida.
create trigger material_files_reclaimed_path_after_insert after insert on public.material_files
  for each row execute function public.guard_reclaimed_upload();

-- Helper privado: el llamante ya tiene el lock de materials.
create function public.enqueue_material_upload_cleanup(p_material uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.materials%rowtype; v_files jsonb;
begin
  select * into strict m from public.materials where id = p_material;
  if m.status <> 'uploading' or m.content_hash is not null
    or exists (select 1 from public.adaptations where material_id = m.id)
    or exists (select 1 from public.adaptation_jobs where material_id = m.id) then
    raise exception 'upload_not_pending';
  end if;
  if exists (select 1 from public.material_files where material_id = m.id
    and (workspace_id <> m.workspace_id or bucket <> 'source-materials'
      or split_part(storage_path, '/', 1) <> m.workspace_id::text
      or (split_part(storage_path, '/', 2) <> m.id::text and split_part(storage_path, '/', 3) <> m.id::text))) then
    raise exception 'upload_path_mismatch';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'path', storage_path) order by id), '[]'::jsonb)
    into v_files from public.material_files where material_id = m.id;
  insert into public.material_upload_cleanups(material_id, workspace_id, files, reason, next_attempt_at)
    values(m.id, m.workspace_id, v_files, p_reason, m.upload_expires_at)
    on conflict (material_id) do nothing;
end $$;

-- El token no se entrega al navegador hasta que esta operación confirma su ventana.
-- Se llama DESPUÉS de emitir la URL: la ventana cubre los 7200 s reales del SDK.
create function public.open_material_upload_window(p_material uuid, p_user uuid, p_workspace uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.materials%rowtype;
begin
  select * into m from public.materials where id = p_material and workspace_id = p_workspace for update;
  if not found or m.status <> 'uploading' or exists (select 1 from public.material_upload_cleanups where material_id = m.id)
    or not exists (select 1 from public.workspace_members where workspace_id = p_workspace and user_id = p_user and role in ('owner','admin','teacher')) then return false; end if;
  update public.materials set upload_expires_at = clock_timestamp() + interval '2 hours' where id = m.id;
  return true;
end $$;

create function public.complete_material_upload(p_material uuid, p_user uuid, p_workspace uuid,
  p_file uuid, p_size bigint, p_pages int, p_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.materials%rowtype;
begin
  select * into m from public.materials where id = p_material and workspace_id = p_workspace for update;
  if not found then return 'not_found'; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace and user_id = p_user and role in ('owner','admin','teacher')) then return 'not_found'; end if;
  if exists (select 1 from public.material_upload_cleanups where material_id = m.id) then return 'expired'; end if;
  if m.status <> 'uploading' then
    if m.content_hash is not null then return 'already_completed'; end if;
    return 'not_found';
  end if;
  if m.upload_expires_at <= clock_timestamp() then return 'expired'; end if;
  if p_size is null or p_size not between 1 and 20971520 or p_pages is null or p_pages not between 1 and 30
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'upload_invalid'; end if;
  update public.material_files set size_bytes = p_size, page_count = p_pages
    where id = p_file and material_id = m.id and workspace_id = p_workspace and kind = 'source';
  if not found then return 'not_found'; end if;
  update public.materials set status = 'uploaded', content_hash = p_hash, page_count = p_pages where id = m.id;
  return 'completed';
end $$;

create function public.reject_material_upload(p_material uuid, p_user uuid, p_workspace uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.materials%rowtype;
begin
  select * into m from public.materials where id = p_material and workspace_id = p_workspace for update;
  if not found or m.status <> 'uploading' or not exists (select 1 from public.workspace_members
    where workspace_id = p_workspace and user_id = p_user and role in ('owner','admin','teacher')) then return false; end if;
  perform public.enqueue_material_upload_cleanup(m.id, 'rejected');
  return true;
end $$;

create function public.claim_material_upload_cleanups(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_material record; v_claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid_limit'; end if;
  for v_material in select id from public.materials m where status = 'uploading' and upload_expires_at <= clock_timestamp()
    and content_hash is null and not exists (select 1 from public.material_upload_cleanups c where c.material_id = m.id)
    and not exists (select 1 from public.adaptations a where a.material_id = m.id)
    and not exists (select 1 from public.adaptation_jobs j where j.material_id = m.id)
    order by upload_expires_at, id limit p_limit for update of m skip locked
  loop perform public.enqueue_material_upload_cleanup(v_material.id, 'expired'); end loop;
  with due as (
    select material_id from public.material_upload_cleanups
    where next_attempt_at <= clock_timestamp() and (lease_until is null or lease_until <= clock_timestamp())
    order by next_attempt_at, material_id limit p_limit for update skip locked
  ), claimed as (
    update public.material_upload_cleanups c set lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + interval '330 seconds', attempts = attempts + 1
    from due where c.material_id = due.material_id returning c.*
  ) select coalesce(jsonb_agg(jsonb_build_object('materialId', material_id, 'workspaceId', workspace_id,
      'token', lease_token, 'files', files)), '[]'::jsonb) into v_claimed from claimed;
  return v_claimed;
end $$;

create function public.finish_material_upload_cleanup(p_material uuid, p_token uuid, p_error text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.material_upload_cleanups%rowtype; v_removed int := 0;
begin
  select * into c from public.material_upload_cleanups where material_id = p_material for update;
  if not found or p_token is null or c.lease_token is null or c.lease_until is null
    or c.lease_token is distinct from p_token or c.lease_until <= clock_timestamp() then return 0; end if;
  if p_error is not null and p_error not in ('storage_failed','storage_unconfirmed') then raise exception 'invalid_error'; end if;
  if p_error is null then
    -- No eliminación basada únicamente en un resultado remoto: exige la reclamación irreversible.
    if exists (select 1 from public.materials where id = c.material_id and (workspace_id <> c.workspace_id or status <> 'uploading')) then
      raise exception 'upload_not_pending';
    end if;
    delete from public.materials where id = c.material_id and workspace_id = c.workspace_id and status = 'uploading';
    get diagnostics v_removed = row_count;
  end if;
  update public.material_upload_cleanups set lease_token = null, lease_until = null,
    last_error = p_error, last_checked_at = clock_timestamp(),
    row_deleted_at = case when p_error is null then coalesce(row_deleted_at, clock_timestamp()) else row_deleted_at end,
    next_attempt_at = clock_timestamp() + case when p_error is null then interval '1 day' else interval '1 minute' end
    where material_id = c.material_id;
  return v_removed;
end $$;

revoke all on function public.guard_reclaimed_upload(), public.enqueue_material_upload_cleanup(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.open_material_upload_window(uuid,uuid,uuid),
  public.complete_material_upload(uuid,uuid,uuid,uuid,bigint,int,text),
  public.reject_material_upload(uuid,uuid,uuid), public.claim_material_upload_cleanups(int),
  public.finish_material_upload_cleanup(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.open_material_upload_window(uuid,uuid,uuid),
  public.complete_material_upload(uuid,uuid,uuid,uuid,bigint,int,text),
  public.reject_material_upload(uuid,uuid,uuid), public.claim_material_upload_cleanups(int),
  public.finish_material_upload_cleanup(uuid,uuid,text) to service_role;
