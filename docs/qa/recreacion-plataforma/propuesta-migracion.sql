-- PROPUESTA (NO APLICADA). Motor de recreación: persistir cada recreación una vez y reutilizarla (ADR-051).
-- Va en docs/, no en supabase/migrations/: ningún entorno la aplica. Para aplicarla: revisión, fichero numerado nuevo en
-- supabase/migrations/, prueba de aislamiento entre workspaces (tests/db) y autorización expresa.

-- 1 · Una fila por versión de una recreación. La línea (`line_id`) agrupa sus versiones; regenerar inserta v+1.
create table public.recreations (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null,
  version integer not null check (version >= 1),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  state text not null check (state in ('ready', 'incomplete')),
  state_message text check (char_length(state_message) <= 300),
  title text not null check (char_length(title) <= 200),
  -- Lo que muestra la pantalla: ficha (con su answer_key, que la vista quita), materiales y explicación. Validado en servidor
  -- con RecreationRecordSchema antes de insertar.
  student_document jsonb not null,
  materials_document jsonb,
  explanation jsonb not null,
  -- Solo servidor: plan, verificación, procedencia, decisiones visuales y versiones del pipeline. La columna no se concede al
  -- rol authenticated (ver 3).
  internal jsonb not null,
  created_at timestamptz not null default now(),
  unique (line_id, version)
);
create index recreations_material_idx on public.recreations (material_id);
create index recreations_line_idx on public.recreations (line_id, version desc);

create trigger recreations_workspace
  before insert or update on public.recreations
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

-- 2 · Las ilustraciones aprobadas de una recreación se guardan donde ya se guardan las de «Hacer magia» (bucket privado
-- generated-assets, misma revisión, mismo cupo `image`): `generated_assets` admite como padre una adaptación O una recreación.
alter table public.generated_assets alter column adaptation_id drop not null;
alter table public.generated_assets add column recreation_id uuid references public.recreations (id) on delete cascade;
alter table public.generated_assets add constraint generated_assets_one_parent
  check ((adaptation_id is null) <> (recreation_id is null));
create index generated_assets_recreation_idx on public.generated_assets (recreation_id);
-- (El trigger generated_assets_workspace debe comprobar también el workspace de recreation_id: nueva función o rama.)

-- 3 · RLS: leen los miembros; escribe solo el servidor (como adaptations y generated_assets). `internal` no se concede.
alter table public.recreations enable row level security;
revoke all on public.recreations from anon, authenticated;
grant select (id, line_id, version, workspace_id, material_id, created_by, state, state_message, title, student_document, materials_document, explanation, created_at)
  on public.recreations to authenticated;
create policy "recreations: leer si soy miembro" on public.recreations
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- 4 · ai_runs y cupo: cada llamada de una recreación se registra en ai_runs (sin contenido) con recreation_id; la recreación
-- consume una unidad `adaptation` por consume_quota() al crearse (y la devuelve si no se guarda nada), como una adaptación.
alter table public.ai_runs add column recreation_id uuid references public.recreations (id) on delete set null;
