-- PROPUESTA (NO APLICADA). Motor de recreación: persistir cada versión una vez, sin exponer respuestas (ADR-051, ADR-052).
-- Vive en docs/, no en supabase/migrations/: ningún entorno la aplica. tests/db/recreation-storage.test.ts la carga sobre las
-- migraciones reales en PGlite y comprueba el acceso directo a los datos (miembros, roles, otros workspaces, anon). Para aplicarla:
-- revisión, fichero numerado nuevo en supabase/migrations/, prueba contra un proyecto de staging y autorización expresa.
--
-- Corrección respecto a la versión anterior de esta propuesta: `student_document` llevaba `answer_key` y se concedía SELECT a los
-- miembros. Quitar la clave en React no protege una consulta directa. Ahora:
--   · lo que un miembro puede leer (recreation_versions) NO PUEDE contener respuestas: un CHECK exige answer_key vacío;
--   · las respuestas, el plan y la verificación viven en recreation_internals, sin políticas ni permisos para anon/authenticated
--     (solo el rol de servicio del servidor, que se salta RLS, puede leerla).

-- 1 · La línea de una recreación: su material, su versión actual y la clave de idempotencia de la petición que la creó.
create table public.recreation_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  current_version integer not null default 1 check (current_version >= 1),
  -- La petición de creación lleva una clave: repetirla (doble clic, reintento de red) devuelve la misma línea, no otra generación.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index recreation_lines_material_idx on public.recreation_lines (material_id);
create trigger recreation_lines_workspace
  before insert or update on public.recreation_lines
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

-- 2 · Cada versión: solo lo que se muestra. Nunca se actualiza ni se borra al regenerar (una versión nueva es otra fila).
create table public.recreation_versions (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.recreation_lines (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null check (version >= 1),
  -- ready: lista · review: alguna actividad necesita revisión pedagógica · incomplete: falta algo imprescindible.
  state text not null check (state in ('ready', 'review', 'incomplete')),
  state_message text check (char_length(state_message) <= 400),
  review_activities text[] not null default '{}',
  title text not null check (char_length(title) <= 200),
  student_document jsonb not null,
  materials_document jsonb,
  explanation jsonb not null,
  -- Referencias a generated_assets (id, sha256, tamaño), nunca bytes ni URLs firmadas.
  assets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (line_id, version),
  -- Ninguna respuesta en lo que se puede leer: la clave de cada documento visible está vacía.
  constraint recreation_versions_no_answers check (
    coalesce(student_document -> 'answer_key', '[]'::jsonb) = '[]'::jsonb
    and (materials_document is null or coalesce(materials_document -> 'answer_key', '[]'::jsonb) = '[]'::jsonb)
  )
);
create trigger recreation_versions_workspace
  before insert or update on public.recreation_versions
  for each row execute function public.enforce_parent_workspace('recreation_lines', 'line_id');

-- 3 · Lo que solo lee el servidor: respuestas, plan, verificación, procedencia, decisiones visuales y llamadas (sin contenido).
create table public.recreation_internals (
  version_id uuid primary key references public.recreation_versions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  answer_key jsonb not null,
  plan jsonb not null,
  verification jsonb not null,
  provenance jsonb not null,
  visuals jsonb not null,
  runs jsonb not null,
  pipeline jsonb not null,
  created_at timestamptz not null default now()
);
create trigger recreation_internals_workspace
  before insert or update on public.recreation_internals
  for each row execute function public.enforce_parent_workspace('recreation_versions', 'version_id');

-- 4 · Permisos. Leer: miembros (líneas y versiones). Escribir: solo el servidor. Internos: nadie salvo el servidor.
alter table public.recreation_lines enable row level security;
alter table public.recreation_versions enable row level security;
alter table public.recreation_internals enable row level security;
revoke all on public.recreation_lines, public.recreation_versions, public.recreation_internals from anon, authenticated;
grant select on public.recreation_lines, public.recreation_versions to authenticated;
create policy "recreation_lines: leer si soy miembro" on public.recreation_lines
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "recreation_versions: leer si soy miembro" on public.recreation_versions
  for select to authenticated using (public.is_workspace_member(workspace_id));
-- recreation_internals: RLS activado, SIN políticas y sin permisos: authenticated y anon no ven ni una fila.

-- 5 · Recuperar una versión anterior: solo quien puede escribir en el workspace, y solo una versión que existe. No llama a ninguna
-- IA ni crea nada: cambia el puntero. Las demás versiones siguen intactas.
create or replace function public.restore_recreation_version(p_line uuid, p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.recreation_lines where id = p_line;
  if ws is null or not public.can_write_workspace(ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.recreation_versions where line_id = p_line and version = p_version) then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  update public.recreation_lines set current_version = p_version where id = p_line;
end;
$$;
revoke execute on function public.restore_recreation_version(uuid, integer) from public, anon;
grant execute on function public.restore_recreation_version(uuid, integer) to authenticated;

-- 6 · Imágenes: donde ya se guardan las de «Hacer magia» (bucket privado generated-assets, misma revisión, mismo cupo `image`).
-- Ligadas a la LÍNEA: una regeneración inserta filas nuevas y nunca sobrescribe ni borra las anteriores (rutas por sha256); una
-- versión antigua sigue viendo sus imágenes. Una petición visual idéntica reutiliza la ilustración aprobada (need_key con huella).
alter table public.generated_assets alter column adaptation_id drop not null;
alter table public.generated_assets add column recreation_line_id uuid references public.recreation_lines (id) on delete cascade;
alter table public.generated_assets add constraint generated_assets_one_parent
  check ((adaptation_id is null) <> (recreation_line_id is null));
create index generated_assets_recreation_idx on public.generated_assets (recreation_line_id);
create trigger generated_assets_recreation_workspace
  before insert or update on public.generated_assets
  for each row execute function public.enforce_parent_workspace('recreation_lines', 'recreation_line_id');

-- 7 · Llamadas y cupo. Cada llamada de una recreación va a ai_runs (sin contenido) con su línea. La creación reserva una unidad
-- `adaptation` con consume_quota(…, p_key => 'recreation:<línea>:v<n>') ANTES de llamar a nada, y la devuelve con
-- refund_quota(…) si no se guarda ninguna versión (mismo patrón que las adaptaciones y las ilustraciones).
alter table public.ai_runs add column recreation_line_id uuid references public.recreation_lines (id) on delete set null;
