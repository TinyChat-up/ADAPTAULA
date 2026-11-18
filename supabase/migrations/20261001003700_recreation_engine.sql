-- «Hacer magia» con el motor de recreación pedagógica (ADR-053). SOLO LOCAL hasta autorización expresa.
--
-- La recreación NO tiene entidades propias: es una adaptación (estados, cuota, trabajos, versiones, PDF) cuyo contenido lo
-- produce el motor nuevo. Esta migración solo añade lo que la adaptación no tenía:
--   · recreation_versions  lo que un miembro puede leer de cada versión recreada (materiales, explicación, estado). SIN respuestas.
--   · recreation_internals lo que solo lee el servidor: respuestas, plan, verificación, procedencia. Sin políticas ni permisos.
--   · recreation_plans     el plan verificado que pasa de la etapa de planificación a la de generación (con sus soluciones).
-- Las respuestas nunca están en una tabla que un miembro pueda consultar: el documento de la ficha (adaptation_versions.document)
-- de una versión recreada tiene la clave vacía y un disparador lo exige.

create table public.recreation_plans (
  adaptation_id uuid primary key references public.adaptations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  verification jsonb not null check (jsonb_typeof(verification) = 'object'),
  plan_fingerprint text not null check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create trigger recreation_plans_workspace
  before insert or update on public.recreation_plans
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

create table public.recreation_versions (
  adaptation_version_id uuid primary key references public.adaptation_versions (id) on delete cascade,
  adaptation_id uuid not null references public.adaptations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- ready: lista · review: alguna actividad necesita revisión pedagógica · incomplete: falta algo imprescindible.
  state text not null check (state in ('ready', 'review', 'incomplete')),
  state_message text check (char_length(state_message) <= 400),
  review_activities text[] not null default '{}',
  materials_document jsonb check (materials_document is null or jsonb_typeof(materials_document) = 'object'),
  explanation jsonb not null check (jsonb_typeof(explanation) = 'object'),
  -- Referencias a generated_assets (id, sha256, tamaño): nunca bytes ni URLs firmadas.
  assets jsonb not null default '[]'::jsonb check (jsonb_typeof(assets) = 'array'),
  created_at timestamptz not null default now(),
  constraint recreation_versions_no_answers check (materials_document is null or coalesce(materials_document -> 'answer_key', '[]'::jsonb) = '[]'::jsonb)
);
create index recreation_versions_adaptation_idx on public.recreation_versions (adaptation_id);
create trigger recreation_versions_workspace
  before insert or update on public.recreation_versions
  for each row execute function public.enforce_parent_workspace('adaptations', 'adaptation_id');

-- La versión de la ficha a la que se ata debe ser de la misma adaptación y no llevar respuestas (la clave vive en recreation_internals).
create or replace function public.enforce_recreation_version_clean()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.adaptation_versions;
begin
  select * into v_version from public.adaptation_versions v where v.id = new.adaptation_version_id;
  if not found or v_version.adaptation_id <> new.adaptation_id then
    raise exception 'recreation_version_mismatch' using errcode = '23514';
  end if;
  if coalesce(v_version.document -> 'answer_key', '[]'::jsonb) <> '[]'::jsonb then
    raise exception 'answers_in_visible_document' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger recreation_versions_clean
  before insert or update on public.recreation_versions
  for each row execute function public.enforce_recreation_version_clean();

create table public.recreation_internals (
  adaptation_version_id uuid primary key references public.adaptation_versions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'object'),
  plan jsonb not null,
  verification jsonb not null,
  provenance jsonb not null default '[]'::jsonb,
  visuals jsonb not null default '[]'::jsonb,
  -- Registro de llamadas SIN contenido (modelo, tokens, coste).
  runs jsonb not null default '[]'::jsonb,
  pipeline jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.recreation_plans enable row level security;
alter table public.recreation_versions enable row level security;
alter table public.recreation_internals enable row level security;

revoke all on public.recreation_plans, public.recreation_versions, public.recreation_internals from anon, authenticated;
grant select on public.recreation_versions to authenticated;

-- Un miembro lee lo visible de las versiones de su workspace. Nadie escribe desde el cliente: lo hace el servidor con las funciones de abajo.
create policy "recreation_versions: leer si soy miembro" on public.recreation_versions
  for select to authenticated using (public.is_workspace_member(workspace_id));
-- recreation_plans y recreation_internals: RLS activado, SIN políticas y sin permisos de tabla: solo service_role (que se salta RLS).

-- Plan verificado de una adaptación (con sus soluciones): lo escribe la etapa de planificación, lo lee la de generación.
create or replace function public.put_recreation_plan(p_adaptation uuid, p_job uuid, p_attempt int, p_plan jsonb, p_verification jsonb, p_fp text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if p_job is not null and not exists (
    select 1 from public.adaptation_jobs j where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt and j.adaptation_id = p_adaptation
  ) then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
  select a.workspace_id into v_workspace from public.adaptations a where a.id = p_adaptation;
  if v_workspace is null then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  insert into public.recreation_plans (adaptation_id, workspace_id, plan, verification, plan_fingerprint)
  values (p_adaptation, v_workspace, p_plan, p_verification, p_fp)
  on conflict (adaptation_id) do update set plan = excluded.plan, verification = excluded.verification, plan_fingerprint = excluded.plan_fingerprint, created_at = now();
  return true;
end;
$$;

create or replace function public.get_recreation_plan(p_adaptation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('plan', r.plan, 'verification', r.verification, 'plan_fingerprint', r.plan_fingerprint)
  from public.recreation_plans r where r.adaptation_id = p_adaptation;
$$;

-- La parte visible y la interna de una versión ya persistida (persist_adaptation_version): idempotente, comprobando el arrendamiento.
create or replace function public.put_recreation_version(p_adaptation uuid, p_job uuid, p_attempt int, p_version uuid, p_public jsonb, p_internal jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if p_job is not null and not exists (
    select 1 from public.adaptation_jobs j where j.id = p_job and j.status = 'processing' and j.attempts = p_attempt and j.adaptation_id = p_adaptation
  ) then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
  select a.workspace_id into v_workspace from public.adaptations a where a.id = p_adaptation;
  if v_workspace is null then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  insert into public.recreation_versions (adaptation_version_id, adaptation_id, workspace_id, state, state_message, review_activities, materials_document, explanation, assets)
  values (
    p_version, p_adaptation, v_workspace, p_public ->> 'state', p_public ->> 'state_message',
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_public -> 'review_activities', '[]'::jsonb)) x), '{}'),
    case when jsonb_typeof(p_public -> 'materials_document') = 'object' then p_public -> 'materials_document' else null end,
    p_public -> 'explanation', coalesce(p_public -> 'assets', '[]'::jsonb)
  ) on conflict (adaptation_version_id) do nothing;
  insert into public.recreation_internals (adaptation_version_id, workspace_id, answer_key, plan, verification, provenance, visuals, runs, pipeline)
  values (
    p_version, v_workspace, p_internal -> 'answer_key', p_internal -> 'plan', p_internal -> 'verification',
    coalesce(p_internal -> 'provenance', '[]'::jsonb), coalesce(p_internal -> 'visuals', '[]'::jsonb), coalesce(p_internal -> 'runs', '[]'::jsonb), coalesce(p_internal -> 'pipeline', '{}'::jsonb)
  ) on conflict (adaptation_version_id) do nothing;
  -- El plan de relevo ya no hace falta: sus soluciones pasan a la parte interna de la versión.
  delete from public.recreation_plans where adaptation_id = p_adaptation;
  return true;
end;
$$;

-- Solo el servidor ejecuta estas funciones.
do $$
declare
  f text;
begin
  foreach f in array array[
    'put_recreation_plan(uuid, uuid, int, jsonb, jsonb, text)',
    'get_recreation_plan(uuid)',
    'put_recreation_version(uuid, uuid, int, uuid, jsonb, jsonb)',
    'enforce_recreation_version_clean()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
