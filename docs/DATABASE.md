# Base de datos

Postgres en Supabase (región UE). Todo cambio de esquema se hace con migraciones en `supabase/migrations/`. Convenciones:

- PK `id uuid default gen_random_uuid()`; `created_at timestamptz default now()`; `updated_at` mantenido con trigger.
- Toda tabla de negocio lleva `workspace_id` (desnormalizado cuando hace falta) para políticas RLS simples e indexables.
- Enums como `text` + `check` (más fáciles de migrar que los tipos `enum` de Postgres).
- JSONB versionado: cada JSONB con contrato lleva su versión (`schema_version` dentro del documento o columna `*_version`).
- Borrado: físico, con limpieza de Storage (privacidad). Archivado lógico (`archived_at`) solo donde el usuario lo pida (perfiles, clases).

## Identidad y workspaces

**profiles** — 1:1 con `auth.users`
| columna | tipo | notas |
|---|---|---|
| id | uuid PK → auth.users(id) on delete cascade | |
| full_name | text | |
| teaching_stages | text[] | respuesta del onboarding |
| onboarding_completed | boolean default false | |
| created_at, updated_at | timestamptz | |

**workspaces**
| id | uuid PK | |
|---|---|---|
| name | text not null | |
| type | text check in (`personal`,`school`,`high_school`,`academy`,`organization`) | |
| owner_id | uuid → profiles | |
| settings | jsonb default `{}` | p. ej. `{ "auto_delete_originals_days": null }` |
| created_at, updated_at | | |

**workspace_members** — PK (`workspace_id`, `user_id`)
| role | text check in (`owner`,`admin`,`teacher`,`viewer`) |
|---|---|

**system_admins** — `user_id` PK. RLS activado **sin políticas**: solo accesible con service role o vía `is_system_admin()`.

Trigger `on_auth_user_created` (security definer): crea `profiles`, un workspace `personal` y la membresía `owner`.

## Catálogo educativo (datos, no código)

- **stages**: `slug` PK (`primaria`, `eso`, `bachillerato`), `name`, `sort_order`, `active`.
- **grades**: `slug` PK (`1-primaria`…), `stage_slug` → stages, `name`, `sort_order`, `typical_age_min/max`.
- **subjects**: `slug` PK, `name`, `stage_slugs text[]`, `active`.

Lectura pública (`select` para `anon` y `authenticated`), escritura solo con service role. Se cargan con `seed.sql`.

## Planes, suscripciones y uso

**plans**
| columna | tipo | notas |
|---|---|---|
| id | uuid PK | |
| slug | text unique | `free`, `pro`, `max` |
| name | text | |
| monthly_price_cents, annual_price_cents | int | precios con IVA, solo para mostrar |
| stripe_price_monthly_id, stripe_price_annual_id | text null | |
| monthly_adaptations | int | |
| monthly_images | int | |
| max_profiles, max_classes | int | |
| features | jsonb | ver abajo |
| sort_order | int | |
| active | boolean | |

`features` (validado con Zod en `src/lib/schemas/plan.ts`):
```json
{
  "multi_profile": true, "max_profiles_per_job": 6,
  "monthly_analyses": 100,
  "monthly_block_revisions": 400,
  "premium_escalations_per_month": 5,
  "max_pages_per_material": 15, "max_file_mb": 20,
  "history_days": null, "templates": "all",
  "advanced_editor": true, "comparison": "full",
  "ai_base_tier": "STANDARD", "image_generation": false, "priority_processing": false
}
```

**billing_customers** — `workspace_id` PK, `stripe_customer_id` unique. Escritura solo con service role.

**subscriptions**
| id | uuid PK | |
|---|---|---|
| workspace_id | uuid unique → workspaces | una suscripción vigente por workspace |
| stripe_subscription_id | text unique | |
| stripe_price_id | text | |
| plan_id | uuid → plans | |
| billing_interval | text (`month`,`year`) | |
| status | text | estados de Stripe: `active`, `trialing`, `past_due`, `canceled`, `unpaid`, `incomplete`… |
| period_start, period_end | timestamptz | ciclo actual (base de las cuotas de pago) |
| cancel_at_period_end | boolean | |
| updated_at | timestamptz | |

Free no tiene fila: **sin suscripción vigente = plan `free`**.

**usage_events** — libro de movimientos (solo inserciones)
| id | uuid PK | |
|---|---|---|
| workspace_id | uuid | |
| user_id | uuid null | |
| kind | text | `adaptation`, `image`, `block_revision`, `analysis` |
| units | int | positivo = consumo, negativo = devolución |
| job_id | uuid null | |
| idempotency_key | text unique | `reserve:<job>:<profile>`, `refund:<job>:<profile>`; análisis: `analysis:<job>` y su devolución `refund:analysis:<job>` |
| metadata | jsonb | sin datos de alumnos |
| created_at | timestamptz | |

Índice: (`workspace_id`, `kind`, `created_at`).

## Alumnado y clases

**learner_profiles** (UI: "Perfiles de alumnado"; nunca "students")
| id | uuid PK | |
|---|---|---|
| workspace_id | uuid | |
| display_name | text not null, max 60 | alias o iniciales |
| stage_slug, grade_slug | text | → stages, grades |
| functional_profile | jsonb not null | `FunctionalProfile` (Zod), con `schema_version` |
| created_by | uuid | |
| archived_at | timestamptz null | |
| created_at, updated_at | | |

**classes**: `id`, `workspace_id`, `name` ("5ºA"), `stage_slug`, `grade_slug`, `academic_year` ("2026-2027"), `archived_at`, timestamps.

**class_learners**: PK (`class_id`, `learner_profile_id`), `workspace_id`.

## Materiales y adaptaciones

**materials**
| id | uuid PK | |
|---|---|---|
| workspace_id, created_by | uuid | |
| title | text | |
| stage_slug, grade_slug, subject_slug, topic | text | contexto confirmado por el docente |
| source_type | text (`pdf`,`image`) | |
| status | text (`uploading`,`uploaded`,`queued`,`analyzing`,`analyzed`,`failed`) | `uploading`: la fila existe y el fichero aún no llegó; `uploaded`: bytes validados; `queued`/`analyzing`: job en curso; `analyzed`/`failed`: terminal (se puede reintentar) |
| content_hash | text | sha256 de los bytes recibidos; reutiliza el análisis **dentro del workspace** |
| analysis | jsonb null | `MaterialAnalysis` v2 (Zod), representación canónica del material |
| analysis_prompt_version | text null | `material_analyzer@v1`; invalida la caché si cambia el prompt |
| analysis_meta | jsonb null | procedencia: prompt, esquema, modelo, esfuerzo, coste, intentos, avisos, `source` (`model`/`reused`). Sin contenido |
| confirmed_fields | text[] | campos que el docente confirmó o corrigió (`title`,`stage`,`grade`,`subject`,`topic`): prevalecen sobre lo detectado |
| failure_code | text null | código categorizado del último fallo (nunca texto técnico) |
| page_count | int | |
| created_at, updated_at | | |

**Forma de `materials.analysis` (JSONB):** `schema_version` 2 (escrito por `material_analyzer@v1`) o 3 (`material_analyzer@v2`). No hace falta migración entre versiones: la aplicación lee ambas con `parseStoredAnalysis` (un análisis v2 se eleva a v3 en memoria y no se reescribe) y la caché exige que coincidan prompt y `schema_version` de la fila (`analysis_meta.schema_version`). El contrato v3 está en `src/lib/schemas/material-analysis.ts` y su descripción en `docs/AI_PIPELINE.md`.

**material_files**: `id`, `material_id`, `workspace_id`, `bucket`, `storage_path` (`<workspace>/<usuario>/<material>/<uuid>.<ext>`: el nombre original nunca es identificador), `original_name` (solo metadato, saneado), `mime_type`, `size_bytes`, `page_count`, `kind` (`source`,`thumbnail`), `created_at`.

**adaptation_jobs**
| id | uuid PK | |
|---|---|---|
| workspace_id, material_id, requested_by | uuid | |
| kind | text (`analyze`,`adapt`,`revise_block`,`image`) | |
| input | jsonb | `AdaptationRequest` validada (perfiles, tipo, opciones, petición) |
| status | text (`queued`,`processing`,`completed`,`partial`,`failed`,`canceled`) | un único job `analyze` activo (`queued`/`processing`) por material: índice único parcial |
| progress | smallint 0-100 | |
| step | text | `analyzing`, `validating`, `saving` (análisis); `planning`, `generating`, `reviewing`, `rendering` (adaptación) |
| attempts, max_attempts | smallint | |
| locked_until | timestamptz null | lease del procesador |
| priority | smallint | Max > Pro > Free |
| error | jsonb null | código + mensaje interno (sin contenido) |
| created_at, started_at, completed_at | | |

**adaptations** — una por (job × perfil)
| id | uuid PK | |
|---|---|---|
| workspace_id, job_id, material_id | uuid | |
| learner_profile_id | uuid null | null = adaptación rápida |
| title | text | |
| adaptation_type | text (`accessibility`,`methodological`,`linguistic`,`reinforcement`,`enrichment`,`curricular`) | |
| profile_snapshot | jsonb | perfil funcional usado (el perfil puede cambiar después) |
| strategy | jsonb | `{ context, context_fingerprint }`: el `AdaptationContext` v1 usado (incluye la petición saneada del docente) |
| plan | jsonb null | `{ plan, validation, provenance }`: `AdaptationPlan` v1, su validación determinista y alias/modelo/prompt/esquema por etapa |
| change_summary | jsonb | 3-6 puntos de "¿Qué hemos adaptado?" |
| visual_template | text | slug de plantilla (presentación, independiente de la estrategia) |
| status | text (`pending`,`ready`,`failed`) | |
| current_version | int | |
| created_at, updated_at | | |

**adaptation_versions**: `id`, `adaptation_id`, `workspace_id`, `version` (unique con adaptation_id), `document jsonb` (`MaterialDocument` v1, con trazabilidad por bloque y clave de respuestas aparte), `review jsonb` (`PedagogicalReview` v1), `source` (`ai_generated`,`ai_revised`,`teacher_edit`), `created_by`, `created_at`. Las ediciones del docente con autoguardado se agrupan (una versión cada pocos minutos de actividad o al salir), no una por tecla.

**generated_assets**: `id`, `workspace_id`, `adaptation_id`, `block_id`, `type` (`illustration`,`card`,`sequence`…), `storage_path`, `image_brief jsonb`, `prompt`, `alt_text`, `metadata`, `created_at`.

**exports**: `id`, `workspace_id`, `adaptation_id`, `version`, `format` (`pdf`), `status`, `storage_path`, `created_at`. Caché: si existe un export `ready` para la misma versión y plantilla, se reutiliza.

**adaptation_feedback**: `id`, `workspace_id`, `adaptation_id`, `user_id`, `helpful` bool, `reasons text[]`, `comment` (max 500), `created_at`.

## Pipeline de adaptación (migración 013)

Reutiliza lo existente y añade solo lo imprescindible (ver `docs/ADAPTATION.md § Orquestación`):

- **`adaptations`** (existente): nuevos estados (`queued, planning, awaiting_plan_review, generation_queued, generating, reviewing_deterministic, reviewing_ai, ready, blocked, failed, cancelled`; `pending` pasa a `queued`) y columnas `request_key` (idempotencia de la creación), `pipeline_versions` (versiones, alias y modelo fijados al crear), `context_snapshot` + `context_fingerprint` (contexto minimizado: sin nombre, etiquetas ni diagnóstico), `analysis_fingerprint`, `failure_code`, `delivered_at`. `profile_snapshot` (obligatorio) guarda solo `{"minimized": true}`.
- **`adaptation_jobs`** (existente, la cola con lease de la Fase 3): ahora también por etapa (`adaptation_id`, `stage` planning|generation, `input_fingerprint`, `provider_call_started_at`). Un único job activo por adaptación y etapa, y uno completado por entrada.
- **`adaptation_versions`** (existente): `plan_fingerprint`, `plan_review_fingerprint`, `generation_fingerprint` (único por adaptación): de qué plan, qué revisión y qué generación sale cada versión. La revisión de una versión se escribe una vez.
- **`ai_runs`** (existente): `schema_version`, `call_kind`, `reasoning_tokens`, `input_fingerprint`, `output_fingerprint`, `job_attempt`; una llamada no se registra dos veces.
- **`adaptation_artifacts`** (nueva): historial inmutable de lo que produce cada etapa (`planner_draft, plan, plan_validation, plan_review, execution_report, generation, deterministic_review, reviewer_findings, pedagogical_review`), único por «etapa + huella de entrada»; las revisiones docentes y los informes de ejecución se acumulan. Lectura para miembros; escritura solo servidor.

Funciones (solo `service_role`): `adaptation_transition_allowed`, `transition_adaptation` (compare-and-set), `create_adaptation`, `enqueue_adaptation_stage`, `claim_adaptation_stage` (lease + detección de intento ambiguo), `mark_provider_call`, `clear_provider_call`, `set_adaptation_job_step`, `complete_adaptation_stage`, `fail_adaptation_stage`, `put_adaptation_artifact` y `persist_adaptation_version`/`finalize_adaptation` (con *fencing* por intento), `find_adaptation_artifact`, `list_adaptation_artifacts`, `get_adaptation_pipeline`, `record_ai_run`, `list_ai_runs`.

## Entitlements de adaptaciones (migración 014)

`adaptation_entitlements` (una fila por adaptación: estado de su unidad, claves de reserva/devolución, límite al reservar; lectura para miembros, escritura solo servidor) sobre el libro `usage_events` existente. Funciones (solo `service_role`): `adaptation_entitlement_limit`, `reserve_/consume_/release_adaptation_entitlement`, `adaptation_entitlement_usage`, `get_adaptation_entitlement`; `create_adaptation` (con `p_reserve`), `transition_adaptation` (libera al cancelar) y `finalize_adaptation` (consume al entregar) se redefinen para acoplar reserva, liberación y consumo a su transacción. Ver `docs/BILLING.md`.

## Ejecución durable de etapas (migración 015)

Sin tablas nuevas. `list_claimable_adaptation_jobs` (qué puede reclamar un worker: en cola fuera de su espera, o con el lease caducado, de adaptaciones no terminadas) y `list_adaptations_needing_job` (el reconciliador: `queued` sin job de planificación y `generation_queued` sin job de generación; nunca `awaiting_plan_review`, `blocked`, `failed`, `cancelled` ni `ready`). `transition_adaptation(cancelled)` ahora, en la misma transacción, libera la reserva (014) **y** pasa a `canceled` los jobs activos: un job en cola no puede arrancar y un worker que ya llamaba al proveedor pierde el lease, así que su resultado tardío no puede persistir, entregar ni consumir (queda registrado en `ai_runs`).

## Operación interna (solo service role)

- **ai_runs**: `id`, `workspace_id`, `job_id`, `material_id`, `adaptation_id`, `purpose` (`analyze`,`plan`,`generate`,`review`,`revise_block`,`image_brief`,`image`), `model_alias`, `provider`, `model`, `prompt_key`, `prompt_version`, `effort`, `attempt` (reintento de reparación dentro del paso), `input_tokens` (solo la entrada **no** cacheada), `output_tokens`, `cached_input_tokens` (lecturas de caché), `cache_creation_input_tokens` (escrituras de caché, facturadas a 1,25×; migración 012), `estimated_cost_usd numeric(10,6)` (**null** si el modelo no tiene precio: nunca un 0 inventado), `latency_ms`, `status` (`success`,`error`,`refused`,`invalid_output`), `error_code` (categoría), `review_score`, `created_at`. **Sin contenido.** `material_id` conserva el coste aunque el material se borre (`on delete set null`).
- **prompt_versions**: `id`, `key`, `version`, `content`, `content_hash`, `schema_version`, `active`, `notes`, `created_at`. Unique (`key`,`version`); índice único parcial: una sola versión activa por `key`.
- **app_settings**: `key` PK, `value jsonb`, `updated_at`, `updated_by`.
- **stripe_events**: `stripe_event_id` PK, `type`, `processed_at`, `payload_summary jsonb`.
- **audit_logs**: `id`, `actor_id`, `workspace_id`, `action`, `target_type`, `target_id`, `metadata`, `created_at`. Registra: cambios de plan, borrado de cuenta o datos, exportación de datos, cambios de rol y acciones de admin.
- **product_events**: `id`, `workspace_id`, `user_id`, `name`, `properties jsonb` (lista blanca de claves por evento), `created_at`.
- **rate_limits**: `key`, `window_start`, `count` (ADR-012).

## RLS

RLS activado en **todas** las tablas. Funciones auxiliares (`security definer`, `stable`, `search_path = ''`):

```sql
is_workspace_member(ws uuid) returns boolean
has_workspace_role(ws uuid, roles text[]) returns boolean
is_system_admin() returns boolean
```

| Tabla | select | insert/update/delete |
|---|---|---|
| profiles | uno mismo | update uno mismo (columnas permitidas) |
| workspaces | miembros | update: owner/admin; insert/delete: servidor |
| workspace_members | miembros del workspace | owner/admin (Fase 3); servidor |
| stages, grades, subjects, plans | público | service role |
| subscriptions, billing_customers | miembros | service role |
| usage_events | miembros | service role (vía `consume_quota`) |
| learner_profiles, classes, class_learners | miembros | owner/admin/teacher |
| materials | miembros | insert (solo `uploading`, sin análisis) y borrar: owner/admin/teacher; update solo de `title`, `stage_slug`, `grade_slug`, `subject_slug`, `topic`, `confirmed_fields` |
| material_files | miembros | servidor (service role) |
| adaptation_jobs | miembros | servidor (service role) |
| adaptations, adaptation_versions | miembros | update/insert de versiones `teacher_edit`: owner/admin/teacher |
| generated_assets, exports | miembros | service role |
| adaptation_feedback | miembros | insert: el propio usuario |
| ai_runs, prompt_versions, app_settings, stripe_events, audit_logs, product_events, rate_limits, system_admins | — | service role |

`viewer` solo lee. Los límites de plan (número de perfiles, clases) **no** se aplican en RLS sino en servidor con `checkEntitlement`, y además con funciones/triggers que rechazan inserciones por encima del límite (defensa en profundidad).

### Storage

Buckets privados: `source-materials`, `generated-assets`, `exports`. Ruta de los originales: `<workspace_id>/<user_id>/<material_id>/<uuid>.<ext>` (la política comprueba la primera carpeta; el nombre original del fichero es solo metadato en `material_files.original_name`). Política de `storage.objects`: `select` si `is_workspace_member((storage.foldername(name))[1]::uuid)`; las escrituras se hacen con URL firmada emitida por el servidor o con service role. Las descargas usan URLs firmadas de corta duración (60-300 s).

## Funciones SQL de negocio

- `workspace_plan(ws) returns plans` — plan efectivo (sin suscripción vigente = `free`). Solo `service_role`.
- `current_period(ws, at_time) returns (period_start, period_end)` — Free: mes natural en `Europe/Madrid`; pago: tramos mensuales anclados al inicio del ciclo de Stripe. Solo `service_role`.
- `consume_quota(ws, kind, units, user, job, key) returns jsonb` — lock por workspace+tipo, resuelve plan y periodo, suma `usage_events` y, si cabe, inserta la reserva. Devuelve `{ allowed, used, limit, period_end[, duplicate] }`. Solo `service_role`.
- `refund_quota(reserve_key) returns boolean` — devolución idempotente, fechada como la reserva. Solo `service_role`.
- `workspace_usage(ws) returns jsonb` — plan + uso del periodo para la UI. Solo miembros (`authenticated`).
- `rate_limit_allowed(key, window_seconds, max) returns boolean` (true = permitido). Solo `service_role`.
- **Cola de análisis** (solo `service_role`; el `attempt` actúa como token de exclusión): `enqueue_analysis_job(material, usuario, input, max_activos)` (idempotente; límite de análisis simultáneos por workspace), `claim_analysis_job(job, lease_s)` (un solo procesador a la vez; recupera leases caducados; cierra como fallido al agotar intentos), `complete_analysis_job(job, attempt, analysis, prompt_version, meta, contexto)` (guarda el análisis y rellena solo el contexto **no** confirmado; devuelve `false` si el lease se perdió), `fail_analysis_job(job, attempt, código, reintentable, espera_s)` (reintenta con espera o cierra; un reanálisis fallido conserva el análisis anterior).
- `provision_user(user, name)` (interna) y `ensure_personal_workspace()` (autenticado, solo sobre `auth.uid()`): crean perfil, workspace personal y membresía `owner` de forma idempotente y con lock; el alta (`handle_new_user`) y la reparación bajo demanda usan la misma ruta. Índice único: un workspace `personal` por propietario.
- Borrado seguro: `adaptations.material_id` es `ON DELETE RESTRICT`: un material con adaptaciones no se borra sin decidir antes qué pasa con ellas. `material_files` y `adaptation_jobs` sí caen en cascada.
- Triggers: `handle_new_user` (alta), `enforce_plan_limit` (perfiles y clases), `enforce_parent_workspace` (coherencia de workspace entre filas relacionadas), `set_updated_at`.

## Aplicación del esquema

- **Fuente de verdad:** `supabase/migrations/*.sql` (en orden) + `supabase/seed.sql`.
- **Proyecto nuevo, sin CLI:** `pnpm db:setup-sql` genera `supabase/setup.sql` (todo en una transacción) para pegarlo en Supabase → SQL Editor.
- **Más adelante, con la CLI de Supabase:** enlazar el proyecto y marcar como aplicadas las migraciones ya ejecutadas (`supabase migration repair --status applied <versión>`); a partir de ahí, `supabase db push` desde CI.
- Nunca se edita una migración ya aplicada: los cambios van en una migración nueva.

## Tests de base de datos (`tests/db`, dentro de `pnpm test`)

Se ejecutan sobre PGlite (Postgres embebido) con un stub mínimo de Supabase (roles con sus permisos por defecto, `auth.users`, `auth.uid()` y `storage`). Cubren: RLS activado en todas las tablas; el usuario A no lee ni escribe nada del workspace de B (tablas, funciones y Storage); `anon` solo lee el catálogo y los planes; las tablas internas no son accesibles; permisos por columna; `viewer` no escribe; coherencia de workspace entre filas; límites de perfiles y clases; cuotas (límite, idempotencia, devolución, cambio de plan); periodos (Free en Madrid, anual anclado). El stub aproxima Supabase: antes de producción, un E2E contra un proyecto real.
