# Arquitectura técnica

Prioridades al decidir: seguridad → simplicidad → mantenibilidad → UX → coste → escalabilidad realista.

## ADR-043 — Observaciones declaradas y apoyos explícitos en perfiles (2026-10-26)

El lector acepta `FunctionalProfile` V1 y V2 en el JSONB existente. V2 conserva fortalezas y barreras por IDs de un catálogo cerrado, y distingue ausencia de valoración de un `none` explícito. `supports`, límites y permisos siguen decidiendo la adaptación: ni una fortaleza ni una barrera activan dimensiones por sí solas. Tarjetas, presets y sugerencias actualizan ese mismo estado tras una acción docente. La observación se incorpora opcionalmente al contexto y al planificador, sin alias ni texto personal; un contexto sin observaciones conserva su fingerprint histórico. No cambia el currículo ni autoriza imágenes.

Sin conversión masiva de filas. Edición y duplicación conservan el contrato leído; las nuevas observaciones/selecciones escriben V2. El servidor impide degradar V2 desde un cliente V1 y compara la revisión temporal del formulario en las ediciones nuevas. La escritura usa además un filtro atómico por `updated_at`, workspace e ID. La migración 032 añade una protección de versión en BD, necesaria antes de escribir V2 en entornos compartidos: también protege frente a despliegues antiguos que no ejecutan la API nueva. No transforma datos ni cambia RLS. Un rollback a un lector exclusivamente V1 deja de ser seguro en cuanto existan filas V2: mantener un lector compatible y conservar las observaciones. [Despliegue, reversibilidad y límites](qa/perfiles-dua/README.md).

## ADR-042 — Consentimiento de apoyos visuales por adaptación (2026-10-26)

La disponibilidad comercial no autoriza por sí sola a consumir imágenes. La acción «Hacer magia» acepta una elección explícita, validada en servidor y persistida como `visual_supports.requested=true` en el contexto y su fingerprint. La ausencia histórica significa sin consentimiento; no se migran ni reescriben documentos entregados. La fábrica de ilustraciones comprueba el contexto persistido y el workspace, además del plan, flag, presupuesto y cuota existentes. La oferta de interfaz consulta `workspace_usage` con identidad de miembro, no con la identidad vacía del rol de servicio.

Se reutiliza la política visual y CLARO: un ejemplo exacto acotado se calcula sin API de imagen; una escena adicional opcional solo se intenta para un problema verbal con barrera pertinente. La elección nunca garantiza una imagen ni una equivalencia pedagógica automática. Los ejemplos añadidos entran en la revisión de la ficha. [Alcance, evidencias y límites](qa/max-apoyos-opt-in/README.md).

## Visión general

Un **monolito Next.js** desplegado en Vercel, con Supabase como backend gestionado (Postgres + Auth + Storage). La facturación pública Stripe permanece desactivada. Hay Checkout/webhook exclusivamente TEST para un piloto privado, cerrado por configuración, backend y workspace; no es una integración LIVE. Sin microservicios, sin Redis, sin colas externas en el MVP.

```
Navegador ──► Next.js (Vercel, región fra1)
               ├─ Server Components / Server Actions (UI de la app)
               ├─ Route Handlers /api/* (uploads, jobs, Stripe, cron)
               ├─ proxy.ts (refresco de sesión + redirecciones de auth)
               └─ src/lib/ai ──► Anthropic / OpenAI (solo servidor)
                     │
               Supabase ── Postgres + RLS · Auth · Storage privado

               Stripe: integración futura, sin contratación activa
```

## Stack y versiones

| Capa | Elección |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack, `proxy.ts`) |
| UI | React 19, Tailwind CSS 4, primitivas propias (`components/ui`), Lucide |
| Formularios | Server Actions + Zod 4 (validación siempre en servidor); estado local en el cliente para el editor de perfiles |
| Datos | Supabase: Postgres, Auth, Storage, RLS (`@supabase/ssr`) |
| Pagos | Catálogo y suscripciones en SQL; integración Stripe pendiente |
| IA | SDKs oficiales `@anthropic-ai/sdk` y `openai` detrás de `src/lib/ai` |
| PDF | HTML print con Chromium headless, usando el mismo renderer React (ver ADR-007) |
| Matemáticas | Texto y figuras deterministas del renderer; KaTeX no está instalado |
| Tests | Vitest (unit/integración), Playwright (E2E), PGlite + stub de Supabase (esquema, RLS y funciones SQL) |
| Hosting | Vercel (Fluid Compute, Node.js 24) + Supabase en región UE |

## Estructura del repositorio

El árbol siguiente es la propuesta inicial; contiene módulos y rutas todavía no construidos (`admin`, `billing`, `analytics`, `material-renderer`). El renderer actual está en `src/components/material` y `src/lib/render`; el editor en `src/lib/editor`. No deducir disponibilidad de una función por aparecer en este árbol.

```
src/
  app/
    (marketing)/         landing, /como-funciona, /ejemplos, /precios, /centros, legales
    (auth)/              /login, /registro, /forgot-password, /reset-password
    auth/callback/       intercambio de código OAuth / magic link
    app/                 aplicación autenticada (/app/...)
      bienvenida/        onboarding (sin sidebar)
      (shell)/           todo lo que lleva sidebar
    admin/               panel interno (solo system_admin)
    api/                 stripe/*, uploads/*, jobs/*, cron/*
  components/
    ui/                  primitivas propias (Button, campos, Alert, Card…); diálogos con `<dialog>` nativo
    marketing/ app/ materials/ editor/ adaptations/ profiles/ billing/
    material-renderer/   renderer de MaterialDocument (pantalla y print)
  lib/
    ai/                  providers/, pipeline/, registry.ts, router.ts, costs.ts, prompts.ts, errors.ts
    analysis/            normalización del análisis, contexto confirmado vs detectado, etiquetas
    adaptation/          fase 4: contexto, estrategias, invariantes, ensamblado del documento, revisión determinista, mocks (docs/ADAPTATION.md)
    materials/           config (formatos y límites), validación de ficheros, hash, PDF, storage, servicio, job de análisis, caché
    auth/                sesión, workspace activo, guards
    billing/             Stripe, sincronización de suscripciones
    permissions/         roles y entitlements (checkEntitlement)
    usage/               cuotas y periodos
    materials/           ingesta, validación de ficheros
    schemas/             contratos Zod (fuente de verdad)
    security/            rate limit, validación de ficheros, cabeceras
    supabase/            server.ts, client.ts, admin.ts (server-only)
    analytics/           eventos de producto sin datos sensibles
    config/              env validado, feature flags
prompts/                 <key>/v<N>.ts — prompts versionados (alias `@prompts/*`)
supabase/
  migrations/            SQL versionado (única vía de cambio de esquema)
  seed.sql               planes, etapas, cursos, asignaturas
  (tests de BD en tests/db con PGlite)
evals/                   casos de evaluación de IA + runner (`evals/material-analysis/`, `evals/adaptation/`)
tests/
  integration/ e2e/
docs/
```

**Desviaciones respecto a la propuesta original, justificadas:**
- `src/` separa el código de la app de `supabase/`, `prompts/`, `evals/` y `docs/` en la raíz.
- `app/app/(shell)` permite que el onboarding comparta autenticación sin heredar la sidebar.
- `components/material-renderer/` es un módulo propio porque lo usan el editor, el comparador, la vista de impresión y los evals.
- No se crea `supabase/functions/` hasta que una Edge Function aporte valor real (ver ADR-004).

## Registro de decisiones (ADR)

### ADR-001 · Monolito Next.js + Supabase gestionado
Un solo despliegue, un solo lenguaje y RLS en la base de datos como segunda barrera de seguridad. Supabase cubre Auth, Storage y Postgres sin operar infraestructura. Microservicios, Kubernetes, Redis y colas externas quedan fuera hasta que una métrica real lo pida.

### ADR-002 · Modelo multi-tenant basado en workspaces desde el día 1
Todos los recursos de negocio pertenecen a un `workspace`. Al registrarse se crea un workspace `personal` con el usuario como `owner`. La suscripción se asocia al workspace, no al usuario. Así, *Adaptaula Centros* es añadir miembros y facturación institucional, no migrar datos.

El workspace activo se guarda en una cookie (`aw`) y **siempre se valida en servidor** contra `workspace_members`. Si no es válido, se usa el workspace personal.

### ADR-003 · Acceso a datos: cliente de usuario con RLS por defecto
- `createServerClient` (sesión del usuario, RLS aplicado) para todo lo que hace el usuario.
- `createAdminClient` (service role, `server-only`) **solo** en: webhooks de Stripe, procesador de jobs, contabilidad de uso, panel admin y tareas cron.
- El cliente navegador (`anon key`) se usa para Auth y subidas directas con URL firmada. No consulta tablas de negocio directamente; la UI lee desde Server Components.

### ADR-004 · Jobs de IA: ejecución inmediata en la petición del usuario; el cron solo recupera
> **User-triggered jobs run immediately. Vercel Cron is recovery-only.**

Un paso de IA (análisis, planificación, generación + revisión) tarda de segundos a unos minutos. Los jobs siguen existiendo y son persistentes (`adaptation_jobs`): dan estado, idempotencia, exclusión entre procesadores, reintentos, recuperación, trazabilidad, cuotas y `ai_runs`.

**Camino normal:** `acción del docente → crear job (cuota/entitlement ya reservados) → claim atómico → procesar en ese momento → completed / failed`.
- El comando (Server Action o `POST /api/uploads/[id]/complete`) solo valida, reserva y **persiste el job**: es rápido.
- La pantalla pide al instante su ejecución en una petición propia y **esperada** (`await`): `POST /api/materials/[id]/analysis/run` o `POST /api/adaptations/[id]/run` (`maxDuration = 300`). Son Route Handlers y no Server Actions porque Next.js despacha las Server Actions de un cliente **de una en una**: una etapa de minutos dentro de una acción dejaría en cola «Cancelar» y cualquier otra acción.
- Los dos endpoints llaman al **mismo processor** que la recuperación: `runAnalysisJob` / `processAdaptationStage` → `runPlanningStage` / `runGenerationStage`. El claim es un `UPDATE` condicional en la base de datos (estado, lease, intentos), y cada escritura posterior está protegida por el número de intento (*fencing*). Por eso un doble clic, dos pestañas, un reintento HTTP o el cron a la vez producen **una sola ejecución**: una llamada al modelo y un conjunto de `ai_runs`.
- No hay `after()`, `waitUntil`, promesas sin esperar ni estado en memoria. Nada depende de que una Function siga viva después de responder.
- El sondeo de estado (`GET …/status`) solo lee. Si el job sigue pendiente (porque terminó una espera de reintento o murió la Function que lo ejecutaba), la pantalla vuelve a pedir la ejecución con calma, cada 15 s como mínimo y con una sola petición en vuelo por pestaña (`src/lib/jobs/run-dispatcher.ts`).

**Recuperación:** `cron diario → jobs abandonados o con reintento pendiente → el mismo processor`. `/api/cron/materials` (03:00) y `/api/cron/adaptations` (03:30) no forman parte de la latencia del docente. Solo toman **jobs ya iniciados** que nadie terminó: un lease caducado o una espera de reintento pasada (los análisis, además, con una edad mínima para no competir con la petición del docente). Nunca arrancan trabajo que el docente no ha decidido empezar (una adaptación creada sin pulsar «Empezar», o con la revisión guardada sin pulsar «Generar», espera al docente aunque pase el cron) y nunca reprocesan un job completado, retenido por otra ejecución, ambiguo o no reintentable. **Quién puede ejecutar:** los endpoints `run` exigen el mismo rol de escritura que iniciar o reintentar; un miembro de solo lectura puede leer el estado, no reanudar el procesamiento. Así encajan en el plan Hobby de Vercel (solo crons diarios).

**Deuda conocida (registrada, no abordada):**
- La función SQL `list_adaptations_needing_job` sigue en la base de datos sin ningún uso desde que se eliminó el reconciliador; retirarla es una migración aparte.
- Un miembro de solo lectura que abre la pantalla de progreso **del análisis de un material** sigue lanzando un `POST …/analysis/run` cada ≥15 s mientras el job está pendiente y recibe 403 sin efecto. *(Fase 6: la pantalla de la adaptación ya recibe el rol y no lanza `/run` para un miembro de solo lectura; queda solo el caso del análisis.)*
- Las etapas de adaptación no tienen un plazo global propio (el análisis sí: 270 s). Con los reintentos del SDK de Anthropic, el peor caso de una generación podría rebasar los 300 s de la Function; si muere, el lease caduca y el job se recupera (si ya había empezado la llamada, queda como intento ambiguo y pide confirmación).
- Si el docente cierra la pestaña entre crear el job y pedir su ejecución, ese job espera a que vuelva a abrir la página o al cron diario.

Si la duración real llega a exigir un worker o una cola, se sustituye el *dispatcher* inmediato (los endpoints `run`) sin cambiar los processors. Alternativas descartadas por ahora: Supabase Edge Functions (otro runtime y otros límites) y colas externas (más infraestructura).

### ADR-005 · Subidas directas a Storage con URL firmada
Las funciones de Vercel limitan el cuerpo de la petición a 4,5 MB. Por eso:
1. `POST /api/uploads` valida el nombre, el MIME declarado, el tamaño y la cuota de páginas, crea `materials` + `material_files` con estado `uploading` y devuelve una **signed upload URL** del bucket privado `source-materials`.
2. El navegador sube el fichero directamente a Supabase Storage.
3. `POST /api/uploads/:id/complete` descarga el objeto en servidor, verifica los *magic bytes*, el tamaño real y el número de páginas (PDF) y lo finaliza mediante RPC, o registra su rechazo para limpieza recuperable si no pasa (029, ADR-035).

### ADR-006 · Capa de IA propia sobre los SDKs oficiales
`AIProvider` es **solo transporte** (`generateStructured`): los prompts, el parseo y la validación viven en los pipelines (decisión de la fase 3; antes la interfaz tenía un método por paso, lo que obligaba a duplicar prompts en cada proveedor). Hoy hay `AnthropicProvider` y `MockProvider` para texto; OpenAI como proveedor de texto sigue reservado. Las imágenes tienen su propio transporte, `ImageProvider`, con dos implementaciones: `OpenAIImageProvider` (SDK oficial `openai`, fijado a 7.24.0) y `MockImageProvider`. Las elige `createImageProvider` solo para los alias `IMAGE_*` (migración 024: ilustraciones de «Hacer magia», `docs/VISUAL_RESOURCES.md`). Usamos los SDKs oficiales y no un SDK unificado de terceros, porque necesitamos control directo de la caché de prompts, el esfuerzo de razonamiento, la entrada PDF nativa, las salidas estructuradas y el desglose de uso de tokens para calcular costes. La lógica de negocio solo conoce alias (`ECONOMY`, `STANDARD`…); el mapeo alias → `proveedor:modelo` está en env. Detalle: `docs/AI_PIPELINE.md`.

### ADR-007 · PDF: HTML print con Chromium headless usando el mismo renderer
Un único `MaterialRenderer` React en modo `screen` o `print`, con los mismos tokens de diseño. Una ruta interna de impresión renderiza la versión aprobada y Chromium headless (Playwright + Chromium serverless en Vercel) genera un PDF vectorial A4 con CSS paged media (`@page`, `break-inside: avoid` por bloque, cabeceras y números de página).

Motivos: un solo renderer (sin divergencias pantalla/PDF), KaTeX y tablas funcionan tal cual, y control fino de los saltos de página. Hay que **validarlo con un spike en la Fase 5** (fichas de 1, 3 y 10 páginas; arranque en frío; tamaño de función). Alternativa si falla el despliegue: `@react-pdf/renderer` con un segundo renderer que comparta tokens. Nunca capturas de pantalla.

**Resultado (Fase 5.2A, local).** Se confirma el enfoque sin segundo renderer: `renderPrintHtml` (`react-dom/static`, porque Next 16 rechaza `react-dom/server` en el servidor) produce un HTML autocontenido con el mismo `MaterialSheet` y `material.css`, y `playwright-core` 1.63 con `@sparticuz/chromium` 153 lo imprime sin red, con la CSS de paginación y los números de página de `@page`. No se usa una ruta HTTP interna: el HTML entra por `setContent`. `@react-pdf/renderer` queda descartado. Detalle y medidas: `docs/ADAPTATION.md` § «Exportación PDF». **Validación en runtime de Vercel: DEFERRED** (empaquetado: PASS).

**Resultado (Fase 5.2B, local).** El producto exporta bajo demanda desde un Route Handler que espera el resultado (`GET /api/adaptations/[id]/pdf`, `maxDuration` 60 s), sin cola ni persistencia. La vista y el PDF comparten `sheetModel` → `buildRenderModel`, y un test impide una segunda vía. Validación en runtime de Vercel: DEFERRED.

### ADR-008 · Contenido IA como JSON validado → componentes seguros
La IA nunca produce HTML ni CSS. Produce `MaterialDocument` (Zod). El servidor asigna los IDs estables de bloque (no se confía en IDs generados por la IA para evitar colisiones), valida y guarda. El renderer solo conoce tipos de bloque cerrados. El texto enriquecido se limita a un subconjunto inline (`**negrita**`, `_cursiva_`) parseado por nosotros; matemáticas en LaTeX con KaTeX y `trust: false`.

### ADR-009 · Cuotas como libro de movimientos (`usage_events`) con reserva atómica
Ver `docs/BILLING.md`. Reserva al crear el job, devolución idempotente si falla. La función SQL `consume_quota` bloquea por workspace para evitar carreras entre peticiones concurrentes.

### ADR-010 · Prompts en git, activación en base de datos
El contenido de los prompts vive en `prompts/<key>/v<N>.md` (revisable en PR y testeado por evals). Al desplegar, un script registra las versiones en `prompt_versions` (con hash). La versión **activa** de cada clave se elige en BD desde el admin, lo que permite revertir y hacer A/B sin desplegar. Nunca se edita una versión existente.

### ADR-011 · Analítica de producto propia y sin cookies
Eventos de producto en la tabla `product_events` (sin datos de alumnos) + Vercel Web Analytics (sin cookies) para páginas vistas. Así no hay terceros adicionales que tratan datos y se simplifica el aviso de cookies. Herramientas externas (PostHog UE, etc.) solo si la analítica propia se queda corta.

### ADR-012 · Rate limiting sin Redis
- Auth: los límites integrados de Supabase Auth.
- Análisis de materiales: `rate_limit_allowed` por usuario (subidas) y por workspace (análisis) + máximo de análisis simultáneos (índice único y comprobación en SQL).
- Acciones con coste: las cuotas ya limitan; además, la función SQL `rate_limit_allowed(key, window, max)` sobre una tabla con ventana deslizante para regeneración de bloques y subidas.
- Perímetro: reglas de rate limit del Vercel Firewall en `/api/*`.

### ADR-013 · Sin i18n en el MVP
UI solo en español, con el copy junto a los componentes. Las lenguas cooficiales (catalán, gallego, euskera) son un objetivo realista para más adelante; entonces se extraerá el copy a diccionarios. No se añade un framework de i18n antes de tiempo.

### ADR-016 · Subida y análisis de materiales (fase 3)
Subida en dos pasos (ADR-005) con validación **sobre los bytes**: `POST /api/uploads` (valida lo declarado, comprueba *rate limit*, crea `materials` + `material_files` y devuelve un token de subida firmada) → el navegador sube directamente a Storage → `POST /api/uploads/[id]/complete` (descarga el objeto en servidor, valida firma/tamaño/páginas, calcula SHA-256, reutiliza un análisis del mismo workspace o encola un job). Si la validación falla, se reclama el material para limpieza duradera y excluyente (029, ADR-035); no se borra desde una lectura antigua de la petición.

El análisis es un **job persistente** (`adaptation_jobs.kind = 'analyze'`; la unidad de cuota se reserva al encolarlo). Lo ejecuta **en el momento** la pantalla de progreso, con `POST /api/materials/[id]/analysis/run` (petición esperada, `maxDuration = 300`, plazo propio del job de 270 s); ver ADR-004. Estados del material: `uploading → uploaded → queued → analyzing → analyzed | failed`. La exclusión entre procesadores la garantiza la base de datos (lease + token de intento, ver `docs/DATABASE.md`). El endpoint de estado (`GET /api/materials/[id]/status`, cada 2 s) solo lee. Si el job sigue pendiente (terminó una espera de reintento o murió la Function), la pantalla vuelve a pedir su ejecución, así que recargar o volver más tarde basta. El cron **diario** limpia las subidas huérfanas y recupera, con el mismo processor, los análisis que nadie terminó.

El cliente `admin` (service role) se usa aquí para: URLs firmadas de subida y borrado de ficheros, ficheros y jobs (tablas sin escritura para usuarios), `ai_runs` y *rate limits*. Las lecturas y las ediciones del docente van por su propia sesión (RLS).

### ADR-017 · Pruebas con un backend que ejecuta las migraciones reales
`tests/e2e/fake-supabase.mjs` implementa el subconjunto de Auth, PostgREST y Storage que usa la app **sobre PGlite con las migraciones reales** (RLS, permisos por columna, triggers y funciones SQL de verdad). Lo que no imita es GoTrue, el gateway ni el servicio de Storage, así que no sustituye la prueba contra un proyecto real (`docs/SUPABASE_TESTING.md`). El proveedor de IA de los E2E es `mock:default`, que se rechaza en producción.

### ADR-018 · Cierre de la fase 3: cuota de análisis, política de reintentos y entrega del esquema
- **Cuota propia de análisis** (`monthly_analyses` en `plans.features`; Free 10 · Pro 100 · Max 250). Se reserva con `consume_quota` dentro de `enqueue_analysis_job` (misma transacción que crea el job, así que es atómica ante concurrencia) y se devuelve con `refund_quota` si el job falla sin entregar análisis. La caché no encola y por tanto no consume. Los límites técnicos (*rate limit* y análisis simultáneos) siguen siendo independientes.
- **`forceReanalysis`** (`requestAnalysis(…, { force })`): ignora la caché a propósito (`content_hash + prompt_version + schema_version` sigue siendo la identidad de la caché; cambiar de modelo no la invalida). La procedencia completa queda en `analysis_meta` (`provider`, `model`, `prompt_version`, `schema_version`, `analyzed_at`, `cache_hit`, `forced_reanalysis`).
- **Política de reintentos explícita y acotada** (`ANALYSIS_RETRY`): transitorios → reintento técnico; JSON inválido → 1 reparación; truncado → 1 regeneración limpia; rechazo del proveedor, entrada corrupta, petición rechazada y credenciales → nunca.
- **Entrega del esquema:** la gramática nativa de salida estructurada del proveedor no admite el análisis completo (comprobado con el modelo real). El proveedor cae a «JSON por instrucciones» (el JSON Schema real en el *system*) y Zod sigue siendo el contrato. Decisión de transporte, no de producto: el pipeline y el prompt no cambian.
- **`contextual_tags` eliminada** (migración 011): nada la usaba y invitaba a guardar etiquetas diagnósticas de menores (ver `docs/PRIVACY.md`).
- **Benchmark neutral respecto al proveedor:** mismo archivo, prompt, esquema y expectativas; solo cambia `provider:model` (`--model`). Un baseline de 3 fixtures **no** decide el modelo de producción ni cambia `ECONOMY`/`STANDARD`/`PREMIUM`.

### ADR-019 · `MaterialAnalysis` v3: contrato compacto, consistente y versionado
- **Prompt activo: v3** (`AI_ANALYSIS_PROMPT_VERSION=3`, cierre de la Fase 3); v1 y v2 siguen publicados e inmutables.
- **Dos contratos conviven.** El v2 (prompt `material_analyzer@v1`, el único validado con el modelo real) queda **congelado** en `material-analysis-v2.ts`; el v3 (prompt `material_analyzer@v2`) es la forma canónica que consume la aplicación. Un análisis v2 se **eleva a v3 al leerlo** (`upgradeAnalysisV2`): no se reescriben filas, no se reanaliza y no hay migración de BD (`materials.analysis` es JSONB). La caché exige que coincidan prompt y `schema_version`. Nada cambia de versión sola: `AI_ANALYSIS_PROMPT_VERSION` (por defecto 1).
- **Una entidad, un recuento.** Una tabla es un único *visual* con sus datos en `table` (ya no hay «tabla de contenido» más `table_image`); un gráfico lleva `chart`. Los recuentos los calcula el servidor sobre el grafo final con semántica documentada (`counts.ts`).
- **Una relación, una escritura.** El modelo escribe solo su lado de cada relación y el servidor deriva el inverso; el esquema almacenado rechaza los enlaces asimétricos. Lo ambiguo se descarta con aviso, nunca se adivina.
- **Las áreas de respuesta son de la actividad, no figuras**, para que una línea de respuesta no pueda tomarse por adorno; los campos administrativos tienen lista propia.
- **El modelo solo produce lo que solo el modelo sabe.** Se eliminan campos duplicados o calculables y las explicaciones largas de los elementos protegidos (ahora `type` + `importance` + `value`). Reducción medida del JSON de salida: 34-42 %; el coste teórico baja bastante menos (15-21 %) porque una parte de los tokens de salida es razonamiento y la entrada y la escritura en caché no cambian (ver `evals/material-analysis/README.md`).
- **Respuestas inferidas:** nunca son contenido original, nunca se muestran al alumno, nunca se protegen; solo comprueban la resolubilidad de una adaptación.
- **Sin gasto en esta fase:** el contrato se verifica con tests, fixtures sintéticos y el mock; la validación con el modelo real y con fichas reales es el siguiente experimento.

### ADR-020 · Adaptación en etapas con contratos versionados e invariantes deterministas (fase 4)
La adaptación no es una llamada: contexto determinista → plan (IA) → validación determinista → generación solo de lo que cambia (IA) → ensamblado e integridad deterministas → revisión de juicio (IA) → render. Tres contratos nuevos, versionados desde el día 1: `AdaptationPlan` v1 (decisiones compactas por id, no razonamientos), `MaterialDocument` v1 (semántico, con trazabilidad por bloque y la clave de respuestas separada del contenido del alumno; sustituye al borrador de la fase 0, que nunca se produjo ni persistió) y `PedagogicalReview` v1 (comprobaciones PASS/WARN/FAIL, no una nota). Las invariantes pedagógicas (objetivo, operación, datos, restricciones, escritura evaluada, texto fuente, respuestas) se comprueban sin IA y bloquean decisiones; lo que se conserva se copia del análisis sin modelo; las respuestas inferidas y los nombres de serie no llegan a los modelos que generan. Compatibilidad futura: cada contrato lleva `schema_version` y la lectura de versiones antiguas se hará como en `MaterialAnalysis` (elevar en memoria, nunca reescribir filas). Detalle: `docs/ADAPTATION.md`.

### ADR-014 · Workspace personal garantizado e idempotente
El alta crea perfil + workspace personal + membresía `owner` en la misma transacción que `auth.users` (trigger). Si alguna vez faltara (usuarios anteriores al trigger, fallo manual), `requireWorkspace()` llama a `ensure_personal_workspace()`, que es idempotente, usa un lock por usuario y solo actúa sobre `auth.uid()`. Un índice único impide dos workspaces personales por propietario. La cookie `aw` solo es una preferencia: se acepta únicamente si coincide con una membresía devuelta por la base de datos.

### ADR-015 · E2E sin proyecto real
Superado por ADR-017: el backend de pruebas ejecuta ahora las migraciones reales. La prueba contra un proyecto Supabase de pruebas sigue pendiente (`E2E_BASE_URL`, confirmación de email desactivada).

### ADR-021 · Sustitución visual con corrección informada y validación conservadora

La sustitución debe conservar el formato de respuesta que su contrato sabe representar, las acciones evaluadas y las restricciones corroboradas en la consigna. Un formato cerrado no se convierte en líneas porque conserve el tema. Se reutilizan los detectores de acciones y tokens críticos existentes; son controles heurísticos adicionales, no sustituyen la revisión pedagógica posterior.

`visual_substitute@v2` mantiene el esquema de salida de v1 y recibe el formato original. Tras una propuesta inválida, el segundo intento recibe únicamente códigos de validación permitidos, sin texto rechazado ni respuestas. Se conserva el máximo de dos intentos por actividad/ejecución; una negativa del proveedor, un error permanente o `feasible=false` no provoca corrección. Los errores transitorios conservan los reintentos técnicos existentes. La ficha solo cambia tras validar la propuesta; no se añade aprobación del docente. No hay migración, cambio comercial ni dependencia nueva. La eficacia del prompt con proveedores reales queda pendiente; el contrato se verifica con fixtures y mocks.

### ADR-022 · Selección única con opciones de la fuente y verificación matemática acotada

`MaterialAnalysis` v3 no tiene un campo estructurado de opciones: están en `instruction`/`context`; la respuesta está en `expected_answer` (`source`, `inferred` o `not_inferable`). `MaterialDocument` v1 sí representa `response: { kind: "choice", multiple: false, options: [{ id, text }] }`, con clave separada en `answer_key`. Se reutiliza ese contrato y el renderer CLARO; no hace falta una migración ni cambiar versiones del documento/análisis.

La Fase 8.2B.4 solo estructura listas completas, consecutivas y finales A)…H). Las etiquetas y textos quedan literales y en orden; los ids locales `option_a`… se derivan de las etiquetas, nunca del modelo. El ejecutor admite consignas reconocidas de lectura de la fracción coloreada de una barra/círculo, con fracciones propias como alternativas. Mantiene consigna, figura y número de partes. Para cada propuesta calcula todas las fracciones correctas contra el `VisualSpec`: exige una sola y la contrasta con la clave original inequívoca. Ningún cambio de opciones, solución, pasos o dificultad está autorizado en este bloque. Una fuente ambigua, complementos, tareas distintas o una transformación anterior con clave/instrucciones incompatibles se rechazan.

El prompt `visual_substitute@v3` se activa para `select_option` sin tabla corroborada; ADR-023 añade v4 para tablas. Los demás formatos conservan v2. El modelo recibe material, alternativas y necesidades funcionales, nunca la clave. Se reutilizan los dos intentos y los códigos seguros de #26. La revisión posterior sigue obligatoria. La figura ocupa el recurso original, las opciones pasan a `ActivityRewrite.response` (campo opcional compatible con planes visuales antiguos), y `applyVisualResolution` conserva ids de bloque, enlaces, procedencia y `answer_key`. Las respuestas inferidas solo contrastan coherencia; no se publican como clave docente. Los apoyos en bloques independientes y la presentación del perfil se conservan; una actividad ya transformada con pasos/requisitos no se sobrescribe.

Esta verificación prueba coherencia con el análisis y su clave, no certifica que el análisis haya leído bien un original ilegible. Nuevos dominios necesitarán verificadores propios. La conversión de formatos en el planificador (`needs_decision`) sigue fuera de alcance.

## Configuración

- `src/lib/config/env.public.ts` (solo `NEXT_PUBLIC_*`) y `env.server.ts` (`server-only`, esquema en `env.server-schema.ts`): validación con Zod, evaluada de forma perezosa. La app arranca sin claves de IA, Stripe ni `CRON_SECRET`; cada consumidor las exige cuando se use.
- Feature flags en env (`FLAG_*`), leídos en servidor: `MAX_PLAN_ENABLED`, `AI_IMAGES_ENABLED`, `MULTI_PROFILE_GENERATION`, `SCHOOL_WORKSPACES`, `GOOGLE_AUTH`, `ADVANCED_EDITOR`, `PROVIDER_FALLBACK`. Si un flag necesita cambiar sin desplegar, se mueve a `app_settings`.
- Ajustes operativos sin despliegue: tabla `app_settings` (routing de IA y A/B, umbrales de coste, reintentos), solo accesible con service role.

## Observabilidad

- Logs estructurados en JSON (`src/lib/logger.ts`) con `requestId`, `jobId` y `workspaceId`. **Nunca** contenido del material, alias ni notas.
- `ai_runs` para coste y latencia de IA; `adaptation_jobs` para el estado del pipeline.
- Alertas de coste: `DAILY_AI_COST_ALERT`, `MONTHLY_AI_COST_ALERT`, `MAX_SINGLE_JOB_COST` (servidor).
- Monitorización de errores (Sentry o similar en la UE): se decide en la Fase 7.

## Entornos

`local` (Supabase local con Docker + Stripe CLI) → `preview` (despliegues de Vercel por PR, con un proyecto Supabase de staging) → `production`. Las migraciones se aplican con la CLI de Supabase desde CI, nunca a mano.

### ADR-023 · Selección de una celda en tabla corroborada contra el PDF (Fase 8.2B.5)

**Contratos existentes:** `MaterialAnalysis.visuals[].table` contiene `headers`, `rows`, `unit`; `MaterialDocument` y CLARO ya admiten bloques `table` y respuestas `choice`. Se reutilizan sin migraciones ni cambios de versión. La sustitución visual añade datos opcionales `table` y `tableEvidence`; los planes antiguos siguen funcionando. La evidencia registra método `pdf_grid_text_v1`, SHA-256 de los bytes de la fuente, página y huella de la tabla. El contrato de auditoría usa `source_table_verified`; no existe un activo de imagen nuevo (asset=null).

**Fuente antes que propuesta:** incluso una tabla ya renderizada debe pasar la comprobación. `auto/table.ts` carga el original autorizado y comprueba sus bytes contra `materials.content_hash`. En la página indicada exige una única cuadrícula rectangular compatible, todas sus divisiones, un elemento de texto por celda en la posición correcta y tinta visible en su caja. Todos los encabezados y valores deben coincidir con la capa de texto (NFC y espacios normalizados, sensible a mayúsculas/acentos). No basta con que el análisis o el asistente afirmen que la tabla es fiel. Un recorte disponible tampoco evita esta comprobación.

**Alcance inicial deliberado:** tablas de 2–6 columnas y 1–12 filas, primera columna con identificadores únicos, encabezados únicos, celdas completas, sin celdas combinadas ni unidad separada (`unit=null`). Consigna reconocida: `Según la tabla, ¿qué {encabezado} corresponde a «{identificador de fila}»? Elige una opción.` Se toleran mayúsculas/espacios al reconocerla, pero la propuesta conserva literalmente la consigna extraída. Opciones consecutivas A)…H), todas valores textuales presentes en la columna consultada; se rechazan alternativas con dígitos o ajenas a ese vocabulario. No hay equivalencia numérica, sinónimos, conversiones, agregaciones, comparaciones ni inferencias. La fila/columna debe ser inequívoca, exactamente una alternativa debe coincidir con la celda y con la clave original `basis=source` (letra o valor textual inequívoco); una clave inferida no basta en esta vía.

**Separación del verificador:** `adaptation/table-choice.ts` comprueba relaciones entre celdas; reutiliza extracción y controles literales de `single-choice.ts`, no la prueba matemática de fracciones. Como tabla, consigna, opciones y ausencia de pasos adicionales son invariantes, no se transforma la consulta en escritura ni en lectura de una respuesta revelada. `visual_substitute@v4` recibe solo material, tabla corroborada, opciones y necesidades; nunca clave ni descripción visual potencialmente reveladora. La salida estricta no permite claves, resaltados o rótulos adicionales. Reutiliza el máximo de dos intentos por actividad/ejecución y códigos permitidos; no pide aprobación al docente. La revisión posterior y los reintentos técnicos existentes siguen vigentes.

**Aplicación:** misma identidad del bloque/recurso, tabla completa, enlaces, procedencia y clave separada. Se rechazan documentos editados/incompatibles, recursos ambiguos, varias dependencias o tablas compartidas con formatos ajenos a esta vía. No cambia el renderer CLARO: agrupación tabla/pregunta, encabezados y círculos vacíos existentes. Una tabla no corroborada o dos propuestas inválidas bloquean la entrega; no recurren a ilustración ni a una reescritura que elimine la consulta.

**Límites de la evidencia:** se corrobora la estructura y el texto extraíble del PDF con posiciones y tinta, no se realiza OCR independiente de sus glifos. Una capa de texto deliberadamente falsa superpuesta a otros glifos no queda certificada por este método. Tampoco se corrobora aquí la transcripción del enunciado o de la clave del análisis. Escaneos, fotos, celdas multilínea, cuadrículas sin bordes, tablas duplicadas y paráfrasis no reconocidas se rechazan. La cobertura es conservadora; las pruebas sintéticas no certifican todos los PDF ni el análisis con IA real.

**Verificación:** unitarias y transporte con mocks, PGlite local con orquestador real, tres PDF Chromium (tabla y regresiones de #27/fracciones), typecheck y lint. No se ha ejecutado IA de pago, SQL remoto ni validado Vercel.

### ADR-024 · Navegación sin pantallas vacías y movimiento que no altera el contraste (2026-10-13)

**Contexto:** la app enlazaba cuatro pantallas «Próximamente» sin contenido (Clases, Plantillas, Ayuda y Configuración) y Configuración repetía lo que ya mostraba Uso. La interfaz era correcta pero estática: sin respuesta al pasar el ratón ni esqueletos con forma real en la mayoría de secciones.

**Decisión:**
1. **Solo se enlazan pantallas con contenido real.** Se retiran `/app/plantillas`, `/app/ayuda`, `/app/clases` y `/app/configuracion` (y `coming-soon.tsx`). Redirigen de forma temporal desde `next.config.ts` a `/app`, `/como-funciona`, `/app/alumnos` y `/app/uso`, para que ningún enlace guardado dé un 404. Configuración se funde en **«Plan y cuenta»** (`/app/uso`), que acogerá la facturación con Stripe. Historial pasa a llamarse **«Adaptaciones»**, con la misma ruta (`/app/historial`) y filtros por estado (`?estado=`). Navegación: Inicio · Adaptar material · Materiales · Perfiles · Adaptaciones, y Plan y cuenta aparte.
2. **Movimiento propio en `globals.css`, sin dependencias.** Lo que lleva texto solo se anima con `transform`, nunca con opacidad: el texto conserva su contraste real en todo momento, también para las auditorías axe que corren justo al navegar. `prefers-reduced-motion: reduce` lo detiene todo.
3. **Carga por sección sin romper el 404.** Cada sección tiene su `loading.tsx` (grupos de rutas `(inicio)` y `(lista)`). Ninguno envuelve `/app/adaptaciones/[id]` ni `/vista`: el *streaming* enviaría la respuesta antes del `notFound()` y el 404 de otra cuenta pasaría a ser un 200.

**Consecuencias:** cuando Clases o Plantillas tengan contenido, vuelven al mapa con su ruta y se retira su redirección. Detalle en `docs/UX.md` (§ Mapa de rutas, § Navegación de la app y § Movimiento). Es un cambio de presentación: no hay migraciones ni cambios en datos, permisos, planes, cuotas, precios o IA.


### ADR-025 · Estudio pedagógico digital: identidad editorial sobre la interfaz existente (2026-10-14)

**Contexto:** la PR #29 sigue abierta. Su navegación simplificada, filtros, estados y cuenta son mejoras útiles, pero la dirección visual se apoyaba en degradados, iconos repetidos, tarjetas de métricas y animación ornamental. El usuario pide redirigir esa misma rama, preservando sus funciones.

**Decisión:**
1. Sistema web de papel cálido, blanco, tinta y azul editorial. Inter para interfaz y Georgia del sistema para titulares públicos, sin otra dependencia de fuentes. Filetes, numeración, jerarquía y espacio reemplazan decoración. Bordes de controles distintos de los separadores para conservar contraste.
2. La portada muestra dos hojas A4 con tabla, consigna y alternativas legibles, conservando exactamente los datos y sin dar la solución. Son una **demostración estática rotulada**, coherente con selección tabular existente, aislada con clases `sample-*`. No se reutiliza ni modifica el renderer del alumno para hacer marketing.
3. Inicio ordena acción principal → atención → en curso → materiales → fichas preparadas; cuotas secundarias. Materiales, perfiles y adaptaciones usan filas. Se reservan paneles blancos para documentos, formularios y decisiones concretas.
4. Se mantienen rutas, redirecciones, filtros, cuenta, permisos, carga y lógica existentes. Solo se conserva movimiento que comunica interacción, carga o estado; se sustituye la decisión de animación decorativa del punto 2 de ADR-024. Su navegación y protección de 404 (puntos 1 y 3) siguen vigentes.
5. Móvil conserva barra etiquetada y diálogo nativo. Texto ampliado y acciones envuelven sin recortarse. Las hojas ilustrativas pueden crecer al ampliar texto: accesibilidad antes que una proporción forzada.

**Validación y límites:** comparación antes/después en 10 pantallas × escritorio/móvil; Playwright focalizado con axe, teclado, subida, revisión, filtros y fixture imprimible; comprobación a 320 px con texto al 200 %. Proveedores simulados y PGlite local; no certifica IA real, Supabase remoto, Vercel ni auditoría con lector de pantalla. No hay cambios de SQL, Stripe, planes, cuotas, prompts, pipeline ni PDF. Detalle del sistema en UX y resultados reproducibles en DEVELOPMENT_LOG.

### ADR-026 · Experimento de figura única en escaneos (retirado; 2026-10-14)

La propuesta de `auto_visuals@v3` en PR #30 sustituyó un ancla de actividad por unicidad geométrica y la declaración del análisis. La auditoría demostró falsos positivos. **Nunca formó parte de main en `1929849` y no es una capacidad aceptada.** Código histórico en `71b6080` / `ccfbf3e`; evidencias en [auditoría](qa/pr30/README.md). Sustituida por ADR-027.

### ADR-027 · Procedencia verificada y rechazo de escaneos automáticos (2026-10-14)

**Alcance:** PR #30 se cierra como endurecimiento, no como Fase 8.2B.6 terminada. Frente a main se reproducen dos defectos: fuente precargada sin cotejar contra el SHA del localizador efectivo y aceptación por visión sin ancla de actividad. Los falsos positivos del criterio de figura única pertenecen exclusivamente al experimento de #30; no se ha comprobado la existencia de activos inseguros en producción.

**Decisión:** eliminar `auto/scan.ts`. El localizador existente rechaza páginas sin texto antes de recorrer píxeles y exige ancla/zona de actividad para aceptar, incluso con visión. Las páginas sin texto tampoco entran en visión ni corroboración de forma. Selección humana y vías ancladas con texto conservadas. `auto_visuals@v5` invalida decisiones anteriores sin migración ni borrado.

**Lectura/producción:** validar positivamente metadatos y geometría del localizador; humano con evidencia null, automático con evidencia completa de un motor conocido, ancla/zona y sin propiedad scan. La ausencia de datos no autoriza. El pin carga el localizador completo con RLS y comprueba id, SHA, receta, identidad, relación y ruta privada (incluido el formato pre-017). Los lectores y el productor comparten el control. Se contrasta además la fuente precargada con el SHA de la revisión realmente devuelta por la RPC.

**Consecuencias:** los recortes automáticos históricos sin ancla/evidencia suficiente dejan de entregarse y requieren corrección humana. Se conservan revisiones/objetos. No se garantiza identidad universal, no se revoca acceso del propietario a objetos históricos en Storage y no se recuperan documentos ya descargados. El motor conserva una sola página en la caché de alta resolución; sin benchmark Vercel. Sin OCR, modelos nuevos, cambios comerciales o de renderer. [Alcance, pruebas y recomendación MERGE técnico](qa/pr30/README.md).

### ADR-028 · Finalidades separadas y corpus de mejora con admisión cerrada (2026-10-15)

**Contexto:** queremos mejorar el análisis y las adaptaciones con fichas reales, pero hoy no existe:
- registro de aceptación de condiciones;
- autorización opcional;
- plazo de conservación aprobado;
- acuerdo con centros.

Además, las garantías de los proveedores no están verificadas ([auditoría](legal/AUDITORIA_DATOS.md)).

**Decisión:**

1. Tres finalidades que nunca se derivan entre sí:
   - **A**, servicio;
   - **B**, evaluación interna y mejora;
   - **C**, entrenamiento o ajuste fino.

   Aceptar los términos o subir un fichero solo cubre A.
2. **B** requiere una autorización explícita por material con:
   - finalidad;
   - SHA de los bytes;
   - versión y hash del aviso;
   - caducidad;
   - retirada.

   B también requiere una licencia verificada de derechos de autor y una revisión de privacidad sin hallazgos.
3. La seudonimización no cuenta como anonimización: cualquier dato de alumnado o de terceros excluye la ficha.
4. **C** está desactivado como literal de tipo (`trainingEnabled: false`).
5. Admisión manual y determinista (`src/lib/corpus/admission.ts`), que falla de forma cerrada:
   - la política vigente tiene mecanismo, aviso y plazo **pendientes**, así que solo admite fichas propias;
   - nada es retroactivo;
   - no hay copia automática desde producción;
   - las particiones `development`, `evaluation` y `holdout` no comparten bytes ni familia.

**Consecuencias:**
- Los contratos existen sin ningún llamador de producción.
- No hay casilla en la interfaz ni tabla hasta que el servidor pueda registrar la evidencia. El esquema y la RLS están
  propuestos, no aplicados ([propuesta §8](legal/FINALIDADES_Y_CORPUS.md#8-esquema-propuesto-en-supabase-no-aplicado)).
- Los textos legales son borradores sujetos a [revisión especializada](legal/REVISION_ESPECIALISTA.md).


### ADR-029 · Editor docente: borradores separados y CLARO compartido (2026-10-15)

**Decisión:** editar mediante un parche cerrado sobre la versión entregada, sin aceptar documentos arbitrarios del navegador. V1 permite `activity.prompt`, líneas/caja del mismo formato de respuesta y cuatro ajustes de presentación ya soportados. Todo lo demás procede de la versión base: identidad/orden de bloques, recursos, figuras, tablas, opciones, requisitos y clave.

`adaptation_drafts` (025) guarda revisiones append-only con base, autor, fecha, cambios y constancia del aviso de contenido. Es un borrador compartido del espacio, no una validación ni una fuente de entrenamiento. RLS permite leer a miembros; solo la RPC autenticada y con rol de escritura inserta. Bloquea la adaptación mientras comprueba base y última revisión, evitando sobrescribir desde una pestaña desactualizada. El endpoint valida Zod y el parche; toda lectura para renderizar vuelve a validarlo, incluido un registro insertado directamente mediante RPC. No se toca la versión entregada ni el original.

`sheetModel` se extrae de `load.ts` a un módulo puro, reexportado por el loader, para que editor, vista y PDF usen exactamente la misma proyección y `MaterialSheet`. El cliente solo recibe el documento sin clave/notas y las rutas de recursos ya autorizadas. La escala de la vista vive fuera del renderer y no altera la impresión. El PDF con `?borrador=N` requiere esa revisión persistida y la base actual, nunca sustituye silenciosamente por el original/otra revisión; revalida cambios, reconocimiento del aviso, procedencia, recursos esenciales y las guardas PDF existentes. La descarga normal continúa siendo la ficha generada.

**Seguridad pedagógica:** cualquier cambio de enunciado requiere reconocer el aviso de comprobación. No se registra como aprobado y no modifica el veredicto original. Las claves no pasan a la proyección del alumno. No se promete detectar respuestas o errores semánticos que un docente escriba en un enunciado.

**Entrega pequeña:** guardado explícito, historial local acotado, recuperación del último borrador y sin editor de estructura. No requiere rediseñar `MaterialDocument` ni cambiar prompts/modelos. Migración solo local en esta sesión; despliegue pendiente del proceso habitual.

### ADR-030 · Fundamentos de Adaptaula 2.0 alrededor de CLARO (2026-10-15)

**Decisión:** rediseño incremental, sin otro pipeline ni renderer. Etapa 1 extrae los tokens de interfaz a `src/styles/tokens.css` y composición a `chrome.css`; sigue Tailwind 4, Inter, Lucide y primitivas propias. Transparencia al 90 % y blur de 12 px solo en navegación/acciones; fallback sólido por soporte y preferencias. Modo claro hasta validar un oscuro completo. CLARO mantiene CSS, fuentes, geometría, proyección y exportación.

`AppShell` sigue recibiendo identidad/consumo autorizado desde servidor; `ShellFrame` solo gestiona la preferencia de plegado. Los hijos y el pie de sesión llegan como slots para no importar módulos de servidor desde cliente. Cookie de presentación `adaptaula_nav` (`compact`/`expanded`, `/app`, SameSite=Lax, un año), leída en SSR para evitar salto al recargar. No es autorización ni contiene identidad. La navegación compacta mantiene texto, no solo iconos. `AppLocation` describe la sección/ruta, no inventa título/estado documental ni consulta otro workspace. Los grupos de loading y los 404 de ADR-024 quedan intactos.

Móvil conserva diálogo nativo y cierra al pasar a escritorio para no dejar un modal invisible bloqueando la app. Foco, salto a main enfocable, etiquetas, preferencias visuales, reflujo y acceso a las mismas rutas se prueban con Playwright. `ActionBar` es un grupo con Tab nativo; no simula el contrato de teclado de una toolbar ARIA. No hay dependencia de animación ni código de las referencias externas.

**Alcance:** sustituye tokens y radios de ADR-025, no su aislamiento del PDF ni sus flujos. Cuenta, landing, comparación y precios tienen entregas específicas posteriores. Sin migraciones ni cambios de cuotas en etapa 1; política futura en [ADAPTAULA_2.md](ADAPTAULA_2.md). Referencias Bencho/Apple consultadas en Chromium tras resolver el bloqueo inicial de red; principios y alcance registrados en QA. [Pruebas y limitaciones](qa/adaptaula-2-etapa-1/README.md).

### ADR-031 · Workspace documental sobre las operaciones existentes (2026-10-16)

Etapa 2A parte de PR #39 integrada (`a6474a7`). `DocumentWorkspace` compone slots de documento/panel; las páginas siguen autorizando/cargando en servidor y solo entregan metadatos públicos del archivo (no `storage_path`) al visor. La adaptación mantiene `AdaptationView`, su DTO, acciones, polling y redirección final. No hay nuevo endpoint, máquina de estados ni renderer académico.

`OriginalDocument` sustituye `OriginalPreview` y usa exclusivamente el raster privado existente de la selección visual, una página por petición. Navegar repite la autorización de sesión/RLS; escalar solo cambia el ancho del visor. No cache compartida ni precarga de todas las páginas. La ruta mantiene sus límites, `private, no-store` y rechazo cerrado. El coste de descarga/rasterizado por cambio de página y la densidad de 110 ppp son límites existentes, no garantías de rendimiento en Vercel.

Ocultar el inspector usa `hidden`, conservando formularios/selección y seguimiento; abrir el siguiente paso enfoca su contenido. El resumen funcional es el existente `summarizeProfile`, sin mutar el perfil. La UI de solo lectura no ofrece acciones de material ni despacha el trabajo de análisis, aunque sigue observándolo. Autorización y RLS de servidor permanecen intactas.

CLARO, borradores, documentos generados, PDF, cuotas, prompts/modelos y contratos no cambian. Comparación y reorganización del editor pertenecen a 2B. Ver [QA](qa/adaptaula-2-etapa-2a/README.md); las pruebas sintéticas con proveedores simulados no certifican Hacer magia real.


### ADR-032 · Comparación privada y selección contextual sobre CLARO (2026-10-16)

Etapa 2B parte de #40 integrada (`330cb4f`). La ruta `/comparar` autoriza con `requireWorkspace` y el loader existente; proyecta la versión del alumno y revalida el último parche persistido, su base y reconocimiento pedagógico. No serializa claves, notas docentes ni rutas de almacenamiento. Un borrador inválido no aparece como versión disponible. Lectores comparan/descargan lo permitido sin herramientas de edición; servidor y RLS siguen aplicando los permisos existentes.

`DocumentComparison` compone `OriginalDocument` y `SheetPreview`: mantiene ambos montados al alternar en móvil y no sincroniza páginas. El PDF usa el endpoint existente y `?borrador=N` para la revisión concreta. No acepta cambios transitorios del cliente. `DocumentWorkspace` admite controlar la apertura del panel para enfocar los ajustes al seleccionar una actividad.

`SheetPreview` navega por páginas lógicas del RenderModel completo. `MaterialSheet`/`NodeView` reciben props opcionales de visibilidad/selección para pantalla. Su invocación por PDF sigue sin estas props: conserva todas las páginas y no incluye interacción. La proyección académica, CSS de impresión y motor PDF no cambian. `activityLocations` comprueba cantidad, orden, etiqueta y enunciado contra la proyección antes de asociar IDs de actividad y nodos. Si divergen, no habilita selección sobre el papel; permanece el selector explícito del editor. No se empareja por similitud textual ni se añaden IDs al contrato académico.

El editor conserva parche cerrado, historial local, guardado explícito append-only y control de conflictos. Se corrige la recuperación tras conflicto: un Link a la misma ruta retenía estado local; recargar mediante navegación completa recupera la revisión persistida. Sin schema, endpoints, prompts ni dependencias nuevos. Límites: último borrador de la base actual, sin autosave/historial visual completo, páginas lógicas distintas de posibles saltos físicos. [QA y capturas](qa/adaptaula-2-etapa-2b/README.md).


### ADR-033 · Mesa y biblioteca sobre lecturas autorizadas (2026-10-16)

Etapa 3A parte de #41 integrada (`740e2db`). La mesa conserva `requireWorkspace`, `workspace_usage`, `listMaterials` y `listAdaptations`: solo cambia prioridad visual y enlaces, sin agregar cálculos de estado. La biblioteca construye filtros exclusivamente de catálogos/valores permitidos, consulta materiales por `workspace_id` mediante RLS y aplica título/curso/asignatura/estado/orden en SQL antes de limitar a 200 filas. La búsqueda de título escapa comodines SQL. El historial sigue usando `listState`/`listHref`, muestra un máximo explícito de 100 y añade enlaces a las rutas autorizadas; el servidor conserva la última decisión sobre lectura, edición y descarga. Un rol lector no recibe acceso al editor. Las fichas no imprimibles siguen fuera del grupo preparado.

No se incorporan tablas, endpoints, renderer, facturación ni permisos nuevos. El límite de 100 del historial y 200 de biblioteca se comunica como límite, no como totalidad; paginación completa queda para una entrega posterior si el volumen lo requiere. [QA](qa/adaptaula-2-etapa-3a/README.md).


## ADR-034 — Perfiles progresivos y cuenta de sesión (etapa 3B)

Desde #42 integrada (`9f064ef`), se reutilizan `LearnerProfileInput`, presets, dimensiones, resumen, repositorio, entitlements y acciones. La búsqueda del directorio es local sobre datos autorizados; no persiste ni envía el alias como parámetro. El detalle comprueba primero existencia/acceso del perfil y después consulta su historial: un identificador malformado devuelve 404, sin provocar una consulta UUID inválida de adaptaciones. El rol de lectura obtiene resumen, nunca formulario ni acciones; autorización del servidor/RLS se conserva.

Plan y cuenta consume `workspace_usage` y `countActiveProfiles` sin nuevos cálculos comerciales. La única mutación nueva actualiza `profiles.full_name`, permitida por la política y grants existentes, con Zod y `requireUser`, filtro por ID de sesión y cliente de sesión (sin admin). Solo confirma éxito si retorna la fila, oculta errores internos y revalida el layout. Ignora identidades/columnas adicionales del formulario. No sincroniza metadatos de Auth: el nombre mostrado por la app proviene de `profiles`. Contraseña y salida reutilizan Auth sin cambiar sus mecanismos. No migración, precios/cuotas, Stripe, pipeline ni recopilación de correcciones.

## ADR-035 — Finalización de subida y limpieza con decisión atómica (2026-10-20)

A1: una selección antigua del cron no autorizaba borrar Storage. La migración 029 hace competir `complete_material_upload` y `claim_material_upload_cleanups` por el lock de la misma fila. El ganador se confirma en una transacción corta; ninguna llamada a Storage mantiene ese lock. La finalización solo usa bytes validados por el servidor y no es una RPC para clientes autenticados. Los triggers preservan identidad/ruta y bloquean publicación o reutilización de un material/ruta reclamados.

La ventana técnica es de dos horas, confirmada después de emitir el token y antes de entregarlo. Las filas heredadas reciben una ventana completa al migrar. La limpieza irreversible copia rutas en `material_upload_cleanups`, reclama con lease/token y confirma el borrado de filas solo tras verificar ausencia remota. Los resultados parciales, caídas y tokens antiguos conservan recuperación y contadores honestos. Las rutas persisten como lápidas con barridos posteriores para PUT tardíos; no se establece una purga jurídica automática.

Se descartan aumentar el antiguo plazo de 60 minutos sin exclusión, una segunda lectura de estado, borrar metadatos antes de Storage sin seguimiento y locks durante red. [Contrato, pruebas y procedimiento](qa/integridad-originales/README.md). La migración y el despliegue compatible deben realizarse con el cron antiguo parado y sus ejecuciones drenadas; no se han aplicado remotamente. Esta decisión no cambia el pipeline, CLARO, cuotas ni comportamiento pedagógico.


## ADR-036 — Vista previa binaria y versión de impresión explícita (2026-10-20)

El contador de páginas lógicas del editor no predice los saltos físicos de Chromium. Se mantiene la exportación única y privada `exportAdaptationPdf` y se muestran sus bytes validados en un iframe Blob con el visor nativo. No se añade composición CSS, rasterizado para el visor ni PDF.js al cliente. Las cabeceras `X-PDF-Page-Count`, `X-PDF-Byte-Length` y `X-PDF-Revision` corresponden al archivo validado. El cliente comprueba cuerpo completo, firma/cierre, longitud y revisión antes de habilitar vista/descarga.

La acción prepara solo a petición, evita dobles clics y limita la espera del cliente a 75 s. Una sesión de vista posee una única URL; su enlace de descarga consume esa misma URL sin volver a exportar. Se aborta la espera y se revoca al cerrar/cambiar/desmontar, con gracia de 60 s si se acaba de descargar. No hay persistencia ni caché pública. El servidor puede terminar un render ya iniciado aunque el cliente aborte.

El editor solo abre revisiones guardadas, con cambios pendientes bloqueados y sin sustitución por la generada. `borrador=N` conserva la revisión, y `version=N` fija su base generada: una base cambiada devuelve 409 `version_changed` antes de imprimir. El PDF preparado no cambia cuando aparece otra revisión. Se mantienen loader/RLS y controles de recursos, sin mutaciones de documentos, cuota ni IA. El consumidor anterior sin `version` conserva la exportación de la base actual.

El visor controla zoom y páginas según navegador; ausencia de soporte ofrece descarga accesible del mismo archivo. Los controles y anotaciones nativos no son parte del editor CLARO. [Contrato, pruebas, capturas y límites](qa/vista-previa-pdf/README.md). Vercel, Safari/iOS físico y la validación semántica permanecen pendientes.

## ADR-037 — Coherencia verificable y composición de figuras CLARO (2026-10-20)

Se conserva un renderer compartido, versionado `material_renderer@v5`. La proyección valida la VisualSpec efectiva antes de describirla/dibujarla. `withAdjacentFigures` agrupa recursos visuales anteriores de uso exclusivo dentro de una página lógica por `resource_block_ids`; no infiere relaciones por texto ni cambia documentos persistidos. Las rectas densas alternan rótulos sobre/bajo el eje, sin modificar posiciones, datos o respuestas. Las especificaciones no permiten denominador cero.

Se distinguen tres evidencias: consistencia intrínseca de datos del producto, comparación contra referencias manuales en `evals/claro-quality`, y semántica de imágenes que permanece sin verificar. El aviso docente no cambia la política de aceptación de imágenes ni el pipeline. No se añaden campos persistidos de supuesto aval pedagógico. Los tests y ocho fichas sintéticas no sustituyen evaluación humana. [Alcance, límites y resultados](qa/claro-calidad/README.md).

## ADR-038 — Recuperación localizada, estructura del original y causas visuales precisas (2026-10-21)

**Reparación de la generación.** Es por fragmentos y determinista cuando se puede:
- criba de bloques, aislamiento de la decisión que rompe el ensamblado y reparación local sin modelo;
- regeneración solo de las decisiones atribuidas (`GeneratorInput.only`) con fusión del borrador previo en el servidor;
- firma de fallos para no repetir una generación idéntica.

Las comprobaciones de la auditoría no se relajan y nombran las decisiones responsables. No hay nueva versión de prompt.

**Estructura del original.** Se lee del análisis con una regla de evidencia y se representa con dos áreas de respuesta de uso exclusivo del servidor (`fields`, `sequence`), compatibles con documentos anteriores. No se reduce la letra para ahorrar páginas.

**Apoyos.** Un apoyo que repite otro se pliega con su trazabilidad. Un apoyo que define lo evaluado es un fallo `answer_leak`.

**Figuras.** La parada visual distingue función desactivada o no ofrecida, plan, cupo y fallo temporal. **Decisión abierta:** la página original completa como anexo no se implementa. Puede llevar otras actividades y respuestas, no es accesible y exige verificar la identidad de la página. Además, no existe un contrato de entrega «asistida» (estado, copia, PDF y pruebas) que permita entregarla sin declararla completa. Si se retoma, requiere ese contrato primero. [QA](qa/hacer-magia-2/README.md).

## ADR-039 — Figuras genéricas localizadas por sus marcas (2026-10-22)

**Decisión.** Una figura genérica tiene firma determinista cuando todas las marcas que su análisis nombra (letras, números de flechas, medidas) están impresas en ese dibujo, una vez y legibles. Esas marcas salen de las palabras del análisis y de las actividades, nunca de un modelo, y se comprueban con la capa de texto del PDF.

**Alcance.** Solo para esas figuras:
- la página se lee por columnas;
- la figura puede preceder a su consigna;
- el recorte incluye sus marcas y el texto de sus propias cajas.

Rectas, barras y figuras sin marcas nombradas se comportan exactamente igual que antes. Los umbrales no cambian. El motor pasa a `auto_visuals@v6`, que invalida decisiones anteriores.

**Verificaciones.** Se separan identidad y fidelidad (verificables técnicamente) de la validez pedagógica, que nunca se declara automáticamente.

**Descartado.**
- OCR o visión con modelo para estas marcas.
- Redibujar figuras complejas.
- Entregar la página completa.

[VISUAL_RESOURCES.md](VISUAL_RESOURCES.md#figuras-con-marcas--recuperación-fiel-del-original-auto_visualsv6-2026-10-22).

## ADR-040 — Identidad editorial única y espacios de resolución deterministas (`answer_space@v1`, 2026-10-22)

**Ajuste #64 (2026-10-23):** `answer_space@v2` corrige el conteo de fracciones sin alterar la capacidad original. `material_renderer@v8` agrupa unidades pedagógicas completas y comparte el reparto de tareas con el ensamblador. No añade contratos ni otro renderer. [Reglas y límites](EDITORIAL.md#10-ajuste-de-maquetación-64-2026-10-23), [evidencia PDF](qa/maquetacion-pedagogica-64/README.md).

**Decisión.**
- **Diseño.** Sistema CLARO es el diseño por defecto y el único del producto. `standard` se conserva solo para renders históricos y comparaciones explícitas.
- **Espacio de respuesta.** Lo decide el servidor al ensamblar el documento (`src/lib/adaptation/answer-space.ts`) con reglas deterministas y versionadas, a partir de:
  - los campos estructurados del análisis (tipo, formato, área del original, dificultad y elementos protegidos);
  - la etapa, el curso y las necesidades funcionales del contexto.
- **Papel de las palabras.** Solo dimensionan (resultados, expresiones, datos, extensión indicada). La IA no fija tamaños, componentes ni estilos.
- **Contrato.** El contrato guardado se amplía de forma opcional (`grid.rows`, campo `grid` y `unit`). Lo que puede escribir un modelo no cambia.
- **Presentación.** `Presentation.answer_space = roomy` (solo con la política 2 y solo cuando cambia algo) amplía renglones y casillas para la motricidad fina o la letra grande.
- **Composición.** El render dibuja la cuadrícula en SVG con casillas enteras, muestra otra vez junto a la actividad las figuras pequeñas o comparadas de una hoja anterior y mide la paginación en el PDF.
- **Garantía física.** Ninguna propuesta del motor da menos superficie que el original, medida en mm con el renglón y la casilla del perfil (`capacityMm`, `atLeastOriginal`). Los topes solo limitan lo añadido.
- **Cuadrícula por demanda.** No tiene tope pedagógico (solo el de seguridad del contrato, 60 filas). Una cuadrícula larga se imprime en zonas de hasta 12 filas enteras, que pueden continuar en otra hoja. Los cálculos que piden dibujar o explicar tienen además su campo «Dibujo» o «Explicación».
- **Versión del renderer.** `material_renderer@v6`: cambia el contrato de lo impreso. No es clave de caché ni huella y no se guarda en los documentos, así que los históricos se leen igual.

**Alternativas descartadas:**
- **Diez tipos de respuesta nuevos:** los existentes, ampliados, bastan.
- **Que el modelo proponga tamaños o CSS:** no es reproducible y rompe la identidad.
- **Una cuadrícula por defecto en Matemáticas:** pondría cuadrícula donde se marca o se dibuja.
- **Un patrón de fondo CSS:** Chromium lo pierde en el PDF.
- **Optimizar el número de hojas:** reduciría el espacio útil.
- **Comparar por número de filas:** una fila de cuadrícula (7 mm), un renglón (10 mm) y un recuadro no miden lo mismo.
- **Un máximo de 12 filas en Primaria:** dejaba ocho operaciones sin sitio.

**Consecuencias.**
- Las adaptaciones nuevas tienen más espacio, y a veces más hojas.
- Los documentos guardados se leen igual.
- La línea base de tinta del *smoke* PDF se regenera para CLARO.

Detalle en [EDITORIAL.md](EDITORIAL.md) y [QA](qa/fase-b-editorial/README.md).

## ADR-041 — Identidad visual corporativa: piezas oficiales, tokens de marca y símbolo en la ficha (`material_renderer@v7`, 2026-10-23)

**Contexto.** La plataforma tenía un icono provisional y la palabra en texto, y ningún color salía de la marca. La persona responsable entregó dos imágenes oficiales, el símbolo y el logotipo, como única fuente de verdad. No había originales vectoriales.

**Decisión.**
- **Piezas.**
  - SVG fieles a las dos imágenes, con fidelidad medida contra el original: logotipo con IoU de 0,996 o más por color; símbolo con silueta de 0,9992 y error de color medio de 2,6/255;
  - variantes en grises y en una tinta, rasterizados con fondo transparente, favicon, icono de Apple y manifiesto (`public/brand/`, `src/app/`).

  Nunca se redibujan ni se recolorean.
- **Interfaz.**
  - `<Logo>`: el símbolo y el logotipo oficiales como imágenes estáticas en las proporciones del logotipo horizontal; con la barra plegada, solo el símbolo;
  - el azul marino de la marca es el color de interfaz (`foreground` y `primary-strong`); `#063f79`, el del círculo del símbolo, es el primario interactivo; el azul de marca es el acento (`#0060eb`) y el foco (`#0067fd`);
  - naranja, verde y cian, solo como acento puntual, con variantes accesibles medidas.

  Los estados conservan sus propios colores.
- **Forma.**
  - Los titulares pasan a Outfit, la tipografía más cercana al logotipo (medida contra él), en lugar de Georgia;
  - los pasos numerados llevan los colores de «aula» en su orden;
  - «Hacer magia», la acción de la IA, va en un degradado del azul de marca, para distinguirla de las decisiones del docente (azul marino);
  - la franja de marca aparece en dos sitios.
- **Ficha.**
  - En la cabecera CLARO, el símbolo sustituye a la palabra, a 6 mm. Es SVG en línea (`BrandSymbol`, datos en `src/lib/brand/symbol.ts`): vectorial en el PDF, sin URL y dentro de la CSP de impresión, sin pasar por los recursos fijados del docente;
  - el acento de la ficha pasa a ser el azul marino de la marca;
  - el renderer sube a `material_renderer@v7`: el contenido, el espacio de respuesta y la paginación son los de la v6.

**Alternativas descartadas:**
- **Imitar el logotipo con texto y CSS:** no es el logotipo oficial.
- **Vectorizar automáticamente sin medir:** deforma letras y curvas.
- **El símbolo como `<img>` o `data:` en la ficha:** se rasteriza o añade una imagen al PDF. En línea es vectorial y no toca la canalización de recursos.
- **El logotipo horizontal en la ficha:** compite con el contenido.
- **Usar los colores de marca como estados.**

**Consecuencias.**
- Los documentos guardados se leen e imprimen igual. La versión del renderer no se guarda ni es clave de caché: nombra lo que se imprime.
- Las huellas de modelo, CSS y HTML cambian, por la versión y por el símbolo.
- Las ocho fichas de la galería conservan sus hojas.
- Si aparecen los originales vectoriales del diseñador, sustituyen a estos SVG con los mismos nombres.

Detalle en [BRAND.md](BRAND.md) y [QA](qa/fase-c-marca/README.md). Esta entrega depende de la #56 (Fase B), sobre la que se construye.


## Piloto aislado de imágenes Max (2026-10-23)

Se conserva `illustrate` y CLARO: no hay un segundo pipeline ni renderer. Las representaciones exactas siguen con VisualSpec; el ejemplo estructurado de fracciones calcula datos distintos y enlaza su figura mediante `example_ref` al `worked_example` existente. `essential` distingue ayudas generadas opcionales en documentos nuevos; los históricos fallan cerrado. La lectura exige aprobación persistida y SHA, además de pertenencia a adaptación y RLS.

La disponibilidad de generación exige la configuración cerrada `AI_IMAGES_PILOT_*`, igualdad de backend y workspace, ausencia de Vercel Production, plan Max efectivo y las puertas existentes. La propuesta de cinco solo vive en fixtures PGlite: no modifica 026 ni condiciones comerciales. [Decisión y límites](qa/max-visuales/README.md). La clasificación y revisión semántica real de imágenes continúan requiriendo evaluación autorizada; el código no acredita que un modelo sea infalible.


## Piloto privado de Stripe TEST en producción (2026-10-23)

La decisión del fundador permite `production-pilot` en Vercel Production para un único backend y workspace. Se mantiene la generación de imágenes tras flag independiente. La migración 030 guarda una solicitud privada, asocia el Checkout TEST a una suscripción y caduca el plan efectivo sin Cron; solo modifica condiciones efectivas de esa concesión, no la tabla de planes. Se reutilizan `subscriptions`, cuotas e idempotencia transaccional de `stripe_events`; los eventos se registran con prefijo `pilot-test:`. Las suscripciones anteriores se rechazan para evitar sobrescribir condiciones. Una integración LIVE futura necesitará reconciliar/segregar explícitamente estos registros TEST antes de habilitar cobros. [Procedimiento](qa/stripe-piloto-produccion/README.md).
