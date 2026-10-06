-- Adaptaula · 016 · Visuales originales: localización versionada y recortes derivados
-- Dos tablas porque son dos cosas distintas que se auditan por separado:
--   · material_visual_locators: DÓNDE está un visual del original (una decisión: hoy humana; mañana, otro método validado).
--     Cada corrección es una revisión nueva; la anterior se conserva marcada como sustituida. Solo una activa por visual.
--   · material_visual_assets: el recorte que el SERVIDOR produjo a partir del original, una geometría y una receta. Derivado,
--     binario e inmutable: nunca se actualiza; otra geometría o receta es otra identidad y otro objeto.
-- Identidad lógica: material + huella del original + huella del análisis + visual_id (+ revisión del localizador y receta para el
-- recorte). Ningún adaptation_id: un recorte sirve a todas las adaptaciones de ese material y análisis. El MaterialAnalysis y el
-- MaterialDocument no se tocan.
-- Lectura: miembros del workspace (RLS). Escritura: solo el servidor (service role) tras autorizar.

create table public.material_visual_locators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  analysis_fingerprint text not null check (analysis_fingerprint ~ '^[a-f0-9]{64}$'),
  visual_id text not null check (visual_id ~ '^vis_[0-9]{1,4}$'),
  -- sha-256 del archivo original (materials.content_hash): otro archivo es otra identidad.
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  -- Versión del contrato del localizador (no del método).
  locator_version smallint not null check (locator_version = 1),
  revision int not null check (revision > 0),
  -- Quién dijo dónde está. Otros métodos (automáticos) se añadirán con otra migración, nunca sin revisar este check.
  method text not null check (method in ('human')),
  page int not null check (page between 1 and 500),
  -- Coordenadas normalizadas sobre la página VISIBLE ya girada (CropBox con /Rotate aplicado), origen arriba a la izquierda.
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  w double precision not null check (w > 0 and w <= 1),
  h double precision not null check (h > 0 and h <= 1),
  -- La caja de página que vio quien localizó: el productor la compara antes de recortar (si no coincide, no recorta).
  page_box jsonb not null check (jsonb_typeof(page_box) = 'object'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  -- Último fallo de producción del recorte (operativo): permite reintentar sin volver a seleccionar.
  last_failure text check (last_failure is null or last_failure in (
    'source_missing', 'page_missing', 'geometry_missing', 'invalid_bounds', 'extraction_failed', 'unsupported_source', 'asset_missing', 'asset_corrupt'
  )),
  check (x + w <= 1.000001 and y + h <= 1.000001),
  unique (material_id, analysis_fingerprint, visual_id, revision)
);

create unique index material_visual_locators_active on public.material_visual_locators (material_id, analysis_fingerprint, visual_id)
  where superseded_at is null;

create trigger material_visual_locators_workspace
  before insert or update on public.material_visual_locators
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

-- Una localización no se reescribe: solo se puede marcar como sustituida o anotar su último fallo de producción.
create or replace function public.material_visual_locators_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'superseded_at' - 'last_failure') is distinct from (to_jsonb(old) - 'superseded_at' - 'last_failure') then
    raise exception 'material_visual_locators es inmutable' using errcode = 'P0001';
  end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'una localización sustituida no se reactiva' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger material_visual_locators_immutable
  before update on public.material_visual_locators
  for each row execute function public.material_visual_locators_immutable();

create table public.material_visual_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  locator_id uuid not null references public.material_visual_locators (id) on delete cascade,
  -- Huella de (localizador: material, original, análisis, visual, revisión, página, coordenadas) + receta.
  identity text not null unique check (identity ~ '^[a-f0-9]{64}$'),
  recipe_version text not null check (recipe_version ~ '^visual_crop@v[0-9]+$'),
  recipe_fingerprint text not null check (recipe_fingerprint ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  mime text not null check (mime = 'image/png'),
  width int not null check (width > 0 and width <= 4096),
  height int not null check (height > 0 and height <= 4096),
  bytes int not null check (bytes > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  -- Versiones del rasterizador y región exacta en píxeles: solo para reproducir/auditar.
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now()
);

create index material_visual_assets_locator_idx on public.material_visual_assets (locator_id);

create trigger material_visual_assets_workspace
  before insert or update on public.material_visual_assets
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

create or replace function public.material_visual_assets_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'material_visual_assets es inmutable' using errcode = 'P0001';
end;
$$;

create trigger material_visual_assets_immutable
  before update on public.material_visual_assets
  for each row execute function public.material_visual_assets_immutable();

alter table public.material_visual_locators enable row level security;
alter table public.material_visual_assets enable row level security;

revoke all on public.material_visual_locators, public.material_visual_assets from anon;
revoke insert, update, delete on public.material_visual_locators, public.material_visual_assets from authenticated;

create policy "material_visual_locators: leer si soy miembro" on public.material_visual_locators
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "material_visual_assets: leer si soy miembro" on public.material_visual_assets
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Nueva localización: sustituye la activa (si la hay) e inserta la revisión siguiente, en una transacción y con un candado por
-- visual, así dos guardados simultáneos no dejan dos activas. Nunca borra la anterior.
create or replace function public.create_visual_locator(
  p_workspace uuid, p_material uuid, p_analysis text, p_visual text, p_source text, p_method text,
  p_page int, p_x double precision, p_y double precision, p_w double precision, p_h double precision, p_page_box jsonb, p_user uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revision int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('visual:' || p_material::text || ':' || p_analysis || ':' || p_visual, 0));
  update public.material_visual_locators
     set superseded_at = now()
   where material_id = p_material and analysis_fingerprint = p_analysis and visual_id = p_visual and superseded_at is null;
  select coalesce(max(revision), 0) + 1 into v_revision
    from public.material_visual_locators
   where material_id = p_material and analysis_fingerprint = p_analysis and visual_id = p_visual;
  insert into public.material_visual_locators
    (workspace_id, material_id, analysis_fingerprint, visual_id, source_sha256, locator_version, revision, method, page, x, y, w, h, page_box, created_by)
  values
    (p_workspace, p_material, p_analysis, p_visual, p_source, 1, v_revision, p_method, p_page, p_x, p_y, p_w, p_h, p_page_box, p_user)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', v_revision);
end;
$$;

revoke execute on function public.create_visual_locator(uuid, uuid, text, text, text, text, int, double precision, double precision, double precision, double precision, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_visual_locator(uuid, uuid, text, text, text, text, int, double precision, double precision, double precision, double precision, jsonb, uuid)
  to service_role;
