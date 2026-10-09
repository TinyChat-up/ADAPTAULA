-- Adaptaula · 020 · Recursos visuales de una adaptación (docs/VISUAL_RESOURCES.md)
-- Cuando una decisión del plan pide un apoyo visual que el original NO tiene, el documento reserva su sitio (imagen
-- `requested`). Esta tabla guarda la respuesta del docente para esa decisión de ESA adaptación:
--   · 'provided': una imagen suya (PNG normalizado por el servidor, sin metadatos) en el bucket privado `generated-assets`;
--   · 'omitted' : la decisión explícita de continuar sin ella (queda registrada, con quién y cuándo).
-- Las imágenes del ORIGINAL siguen yendo por material_visual_locators/assets (016/017): nunca por aquí.
-- Una fila por respuesta, inmutable; corregir crea otra y marca la anterior como sustituida (una activa por decisión).
-- Prevista la procedencia de recursos futuros (catálogo autorizado): `source`, `license` y `attribution`.
-- No cambia cuotas, planes, jobs ni el pipeline: aportar o descartar un recurso no crea otra adaptación ni consume unidades.

create table public.adaptation_visual_resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  decision_id text not null check (decision_id ~ '^dec_[0-9]{1,4}$'),
  resolution text not null check (resolution in ('provided', 'omitted')),
  -- Procedencia de un recurso aportado. Hoy solo la imagen del propio docente; un catálogo se añadirá con otra migración.
  source text check (source is null or source in ('teacher_upload')),
  storage_path text,
  mime text check (mime is null or mime = 'image/png'),
  width int check (width is null or (width > 0 and width <= 4096)),
  height int check (height is null or (height > 0 and height <= 4096)),
  bytes int check (bytes is null or bytes > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  -- El docente declara que puede usar la imagen en su clase. Sin esa declaración no se guarda ninguna imagen.
  rights_confirmed boolean not null default false,
  license text check (license is null or char_length(license) <= 120),
  attribution text check (attribution is null or char_length(attribution) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  check (
    (resolution = 'provided' and source is not null and storage_path is not null and mime is not null and width is not null
      and height is not null and bytes is not null and sha256 is not null and rights_confirmed)
    or
    (resolution = 'omitted' and source is null and storage_path is null and mime is null and width is null and height is null
      and bytes is null and sha256 is null)
  )
);

create unique index adaptation_visual_resources_active on public.adaptation_visual_resources (adaptation_id, decision_id)
  where superseded_at is null;

create trigger adaptation_visual_resources_workspace
  before insert or update on public.adaptation_visual_resources
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

create or replace function public.adaptation_visual_resources_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception 'adaptation_visual_resources es inmutable' using errcode = 'P0001';
  end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'un recurso sustituido no se reactiva' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger adaptation_visual_resources_immutable
  before update on public.adaptation_visual_resources
  for each row execute function public.adaptation_visual_resources_immutable();

alter table public.adaptation_visual_resources enable row level security;

revoke all on public.adaptation_visual_resources from anon;
revoke insert, update, delete on public.adaptation_visual_resources from authenticated;

create policy "adaptation_visual_resources: leer si soy miembro" on public.adaptation_visual_resources
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Guarda la respuesta del docente para una decisión. Idempotente: la misma respuesta (mismo tipo y, si es una imagen, los
-- mismos bytes) devuelve la fila activa sin crear otra. Solo service_role, después de que el servidor haya autorizado al
-- usuario con su propio cliente (RLS) y validado los bytes.
create or replace function public.set_adaptation_visual_resource(
  p_workspace uuid, p_adaptation uuid, p_decision text, p_resolution text, p_storage_path text, p_sha256 text,
  p_width int, p_height int, p_bytes int, p_rights boolean, p_user uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_active public.adaptation_visual_resources;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('visual_resource:' || p_adaptation::text || ':' || p_decision, 0));
  select * into v_active from public.adaptation_visual_resources
   where adaptation_id = p_adaptation and decision_id = p_decision and superseded_at is null;
  if found and v_active.resolution = p_resolution and v_active.sha256 is not distinct from p_sha256 then
    return jsonb_build_object('id', v_active.id, 'reused', true);
  end if;
  update public.adaptation_visual_resources set superseded_at = now()
   where adaptation_id = p_adaptation and decision_id = p_decision and superseded_at is null;
  insert into public.adaptation_visual_resources
    (workspace_id, adaptation_id, decision_id, resolution, source, storage_path, mime, width, height, bytes, sha256, rights_confirmed, created_by)
  values
    (p_workspace, p_adaptation, p_decision, p_resolution,
     case when p_resolution = 'provided' then 'teacher_upload' end,
     p_storage_path, case when p_resolution = 'provided' then 'image/png' end, p_width, p_height, p_bytes, p_sha256,
     coalesce(p_rights, false), p_user)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'reused', false);
end;
$$;

revoke execute on function public.set_adaptation_visual_resource(uuid, uuid, text, text, text, text, int, int, int, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_adaptation_visual_resource(uuid, uuid, text, text, text, text, int, int, int, boolean, uuid)
  to service_role;
