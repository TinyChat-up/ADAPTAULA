-- Borradores docentes separados de la ficha entregada y del PDF original.
create table public.adaptation_drafts (
  id uuid primary key default gen_random_uuid(),
  adaptation_id uuid not null references public.adaptations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  base_version int not null check (base_version > 0),
  revision int not null check (revision > 0),
  changes jsonb not null check (jsonb_typeof(changes) = 'object' and octet_length(changes::text) <= 250000),
  content_acknowledged boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(adaptation_id, base_version, revision),
  foreign key (adaptation_id, base_version) references public.adaptation_versions(adaptation_id, version) on delete cascade
);
create trigger adaptation_drafts_workspace before insert or update on public.adaptation_drafts
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');
alter table public.adaptation_drafts enable row level security;
revoke all on public.adaptation_drafts from public, anon, authenticated;
grant select on public.adaptation_drafts to authenticated, service_role;
create policy "adaptation_drafts: leer si soy miembro" on public.adaptation_drafts
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Locking the parent serialises saves; a stale tab cannot overwrite a newer draft.
create function public.save_adaptation_draft(p_adaptation uuid, p_base_version int, p_revision int, p_changes jsonb, p_acknowledged boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.adaptations%rowtype; latest int;
begin
  select * into a from public.adaptations where id = p_adaptation for update;
  if not found or not public.is_workspace_member(a.workspace_id) then return '{"error":"not_found"}'::jsonb; end if;
  if not public.can_write_workspace(a.workspace_id) then return '{"error":"forbidden"}'::jsonb; end if;
  if p_base_version is null or a.current_version <> p_base_version or a.delivered_at is null or a.status <> 'ready' then
    return '{"error":"conflict"}'::jsonb;
  end if;
  if p_revision is null or p_revision < 0 or jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text) > 250000 then
    return '{"error":"invalid"}'::jsonb;
  end if;
  select coalesce(max(revision), 0) into latest from public.adaptation_drafts
    where adaptation_id = a.id and base_version = p_base_version;
  if latest <> p_revision then return '{"error":"conflict"}'::jsonb; end if;
  insert into public.adaptation_drafts(adaptation_id, workspace_id, base_version, revision, changes, content_acknowledged, created_by)
    values (a.id, a.workspace_id, p_base_version, latest + 1, p_changes, coalesce(p_acknowledged, false), auth.uid());
  return jsonb_build_object('revision', latest + 1);
end;
$$;
revoke all on function public.save_adaptation_draft(uuid, int, int, jsonb, boolean) from public, anon;
grant execute on function public.save_adaptation_draft(uuid, int, int, jsonb, boolean) to authenticated;
