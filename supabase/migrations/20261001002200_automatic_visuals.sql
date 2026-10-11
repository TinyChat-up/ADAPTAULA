-- Adaptaula · 022 · Visuales automáticos: localización automática verificada y reconstrucción determinista (Fase 8.2B.1)
--
-- «Hacer magia» localiza por sí mismo los visuales que el análisis identificó y reconstruye las figuras matemáticas simples.
-- Nada de esto sustituye a la decisión de una persona:
--   · un localizador automático ('auto') solo se guarda si superó la validación determinista con confianza >= 0,75, guarda las
--     señales que lo decidieron (`evidence`: firmas, zona, unicidad, acuerdo con un modelo de visión; nunca contenido) y NUNCA
--     sustituye a un localizador activo: el del docente siempre manda y una corrección del docente sí sustituye al automático;
--   · una reconstrucción (`material_visual_specs`) es DATO verificado (VisualSpec v1), no una imagen: se extrae del recorte
--     localizado y se dibuja con nuestro propio renderizador. Inmutable, con su sha-256 y la versión del extractor;
--   · `material_visual_autolocations` es la ejecución por (material, análisis, original, versión del motor): una sola por clave
--     (idempotencia, doble ejecución y coste de visión acotado) y su resultado auditable por visual (sin contenido).
-- Lectura: miembros del workspace (RLS). Escritura: solo el servidor (service role).

-- 1 · Localizadores automáticos ------------------------------------------------------------------------------------------------
alter table public.material_visual_locators drop constraint material_visual_locators_method_check;
alter table public.material_visual_locators add constraint material_visual_locators_method_check check (method in ('human', 'auto'));
alter table public.material_visual_locators
  add column confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column evidence jsonb check (evidence is null or jsonb_typeof(evidence) = 'object');
-- Un automático lleva siempre su confianza y su evidencia, y nunca se guarda por debajo del umbral; uno humano, ninguna de las dos.
alter table public.material_visual_locators add constraint material_visual_locators_auto_evidence check (
  (method = 'human' and confidence is null and evidence is null)
  or (method = 'auto' and confidence is not null and confidence >= 0.75 and evidence is not null)
);

drop function public.create_visual_locator(uuid, uuid, text, text, text, text, int, double precision, double precision, double precision, double precision, jsonb, uuid);

-- Nueva localización con un candado por visual. Humana: sustituye la activa (sea humana o automática) e inserta la revisión
-- siguiente. Automática: si ya hay una activa (de quien sea) no cambia nada y la devuelve (`created: false`).
create function public.create_visual_locator(
  p_workspace uuid, p_material uuid, p_analysis text, p_visual text, p_source text, p_method text,
  p_page int, p_x double precision, p_y double precision, p_w double precision, p_h double precision, p_page_box jsonb, p_user uuid,
  p_confidence double precision default null, p_evidence jsonb default null
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
  if p_method = 'auto' then
    select id, revision into v_id, v_revision
      from public.material_visual_locators
     where material_id = p_material and analysis_fingerprint = p_analysis and visual_id = p_visual and superseded_at is null;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'revision', v_revision, 'created', false);
    end if;
  end if;
  update public.material_visual_locators
     set superseded_at = now()
   where material_id = p_material and analysis_fingerprint = p_analysis and visual_id = p_visual and superseded_at is null;
  select coalesce(max(revision), 0) + 1 into v_revision
    from public.material_visual_locators
   where material_id = p_material and analysis_fingerprint = p_analysis and visual_id = p_visual;
  insert into public.material_visual_locators
    (workspace_id, material_id, analysis_fingerprint, visual_id, source_sha256, locator_version, revision, method, page, x, y, w, h, page_box, created_by, confidence, evidence)
  values
    (p_workspace, p_material, p_analysis, p_visual, p_source, 1, v_revision, p_method, p_page, p_x, p_y, p_w, p_h, p_page_box, p_user, p_confidence, p_evidence)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', v_revision, 'created', true);
end;
$$;

revoke execute on function public.create_visual_locator(uuid, uuid, text, text, text, text, int, double precision, double precision, double precision, double precision, jsonb, uuid, double precision, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_visual_locator(uuid, uuid, text, text, text, text, int, double precision, double precision, double precision, double precision, jsonb, uuid, double precision, jsonb)
  to service_role;

-- 2 · Reconstrucciones verificadas ---------------------------------------------------------------------------------------------
create table public.material_visual_specs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  locator_id uuid not null references public.material_visual_locators (id) on delete cascade,
  visual_id text not null check (visual_id ~ '^vis_[0-9]{1,4}$'),
  spec_version smallint not null check (spec_version = 1),
  extractor_version text not null check (extractor_version ~ '^visual_spec_extractor@v[0-9]+$'),
  kind text not null check (kind in ('fraction_bar', 'number_line', 'part_whole', 'comparison')),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and spec ->> 'kind' = kind),
  spec_sha256 text not null check (spec_sha256 ~ '^[a-f0-9]{64}$'),
  -- Medidas de la verificación (número de partes, regularidad, etiquetas…): solo números y booleanos.
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  created_at timestamptz not null default now(),
  unique (locator_id, extractor_version)
);

create index material_visual_specs_material_idx on public.material_visual_specs (material_id);

create trigger material_visual_specs_workspace
  before insert or update on public.material_visual_specs
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

-- Solo se reconstruye lo que localizó el sistema: un recorte del docente se usa tal cual (lo decidió una persona).
create or replace function public.material_visual_specs_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'material_visual_specs es inmutable' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.material_visual_locators l
     where l.id = new.locator_id and l.material_id = new.material_id and l.visual_id = new.visual_id and l.method = 'auto'
  ) then
    raise exception 'la reconstrucción no corresponde a un localizador automático de ese visual' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger material_visual_specs_check
  before insert or update on public.material_visual_specs
  for each row execute function public.material_visual_specs_check();

-- 3 · Ejecuciones del localizador automático (caché e idempotencia) ------------------------------------------------------------
create table public.material_visual_autolocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  analysis_fingerprint text not null check (analysis_fingerprint ~ '^[a-f0-9]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  engine_version text not null check (engine_version ~ '^auto_visuals@v[0-9]+$'),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  -- Por visual: decisión (A/B/C/D), confianza, motivo y señales. Nunca contenido del material.
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  vision_calls smallint not null default 0 check (vision_calls between 0 and 10),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (material_id, analysis_fingerprint, source_sha256, engine_version)
);

create trigger material_visual_autolocations_workspace
  before insert or update on public.material_visual_autolocations
  for each row execute function public.enforce_parent_workspace('materials', 'material_id');

-- Reserva atómica de la ejecución de una clave: la primera la obtiene; otra simultánea no hace nada. Una ejecución que se quedó
-- a medias (o falló) se puede retomar pasado `p_stale_seconds`, nunca antes: el coste de visión no se repite por reintentos.
create or replace function public.claim_visual_autolocation(
  p_workspace uuid, p_material uuid, p_analysis text, p_source text, p_engine text, p_stale_seconds int default 600
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.material_visual_autolocations;
begin
  insert into public.material_visual_autolocations (workspace_id, material_id, analysis_fingerprint, source_sha256, engine_version)
  values (p_workspace, p_material, p_analysis, p_source, p_engine)
  on conflict (material_id, analysis_fingerprint, source_sha256, engine_version) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id, 'claimed', true, 'status', v_row.status, 'result', v_row.result);
  end if;
  update public.material_visual_autolocations
     set status = 'running', started_at = now(), completed_at = null
   where material_id = p_material and analysis_fingerprint = p_analysis and source_sha256 = p_source and engine_version = p_engine
     and status in ('running', 'failed') and started_at < now() - make_interval(secs => p_stale_seconds)
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id, 'claimed', true, 'status', v_row.status, 'result', v_row.result);
  end if;
  select * into v_row from public.material_visual_autolocations
   where material_id = p_material and analysis_fingerprint = p_analysis and source_sha256 = p_source and engine_version = p_engine;
  return jsonb_build_object('id', v_row.id, 'claimed', false, 'status', v_row.status, 'result', v_row.result);
end;
$$;

revoke execute on function public.claim_visual_autolocation(uuid, uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.claim_visual_autolocation(uuid, uuid, text, text, text, int) to service_role;

alter table public.material_visual_specs enable row level security;
alter table public.material_visual_autolocations enable row level security;

revoke all on public.material_visual_specs, public.material_visual_autolocations from anon;
revoke insert, update, delete on public.material_visual_specs, public.material_visual_autolocations from authenticated;

create policy "material_visual_specs: leer si soy miembro" on public.material_visual_specs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "material_visual_autolocations: leer si soy miembro" on public.material_visual_autolocations
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- 4 · Coste: la hipótesis de un modelo de visión es una llamada más, registrada sin contenido -----------------------------------
alter table public.ai_runs drop constraint ai_runs_purpose_check;
alter table public.ai_runs add constraint ai_runs_purpose_check check (purpose in (
  'analyze', 'plan', 'generate', 'review', 'revise_block', 'image_brief', 'image', 'locate_visual'
));
