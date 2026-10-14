# Arquitectura técnica

Prioridades al decidir: seguridad → simplicidad → mantenibilidad → UX → coste → escalabilidad realista.

## Visión general

Un **monolito Next.js** desplegado en Vercel, con Supabase como backend gestionado (Postgres + Auth + Storage) y Stripe para facturación. Sin microservicios, sin Redis, sin colas externas en el MVP.

```
Navegador ──► Next.js (Vercel, región fra1)
               ├─ Server Components / Server Actions (UI de la app)
               ├─ Route Handlers /api/* (uploads, jobs, Stripe, cron)
               ├─ proxy.ts (refresco de sesión + redirecciones de auth)
               └─ src/lib/ai ──► Anthropic / OpenAI (solo servidor)
                     │
               Supabase (UE) ── Postgres + RLS · Auth · Storage privado
                     │
               Stripe ── Checkout · Billing · Customer Portal · Webhooks
```

## Stack y versiones

| Capa | Elección |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack, `proxy.ts`) |
| UI | React 19, Tailwind CSS 4, primitivas propias (`components/ui`), Lucide |
| Formularios | Server Actions + Zod 4 (validación siempre en servidor); estado local en el cliente para el editor de perfiles |
| Datos | Supabase: Postgres, Auth, Storage, RLS (`@supabase/ssr`) |
| Pagos | Stripe (Checkout, Billing, Customer Portal, Webhooks) |
| IA | SDKs oficiales `@anthropic-ai/sdk` y `openai` detrás de `src/lib/ai` |
| PDF | HTML print con Chromium headless, usando el mismo renderer React (ver ADR-007) |
| Matemáticas | KaTeX (subconjunto LaTeX, `trust: false`) |
| Tests | Vitest (unit/integración), Playwright (E2E), PGlite + stub de Supabase (esquema, RLS y funciones SQL) |
| Hosting | Vercel (Fluid Compute, Node.js 24) + Supabase en región UE |

## Estructura del repositorio

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
3. `POST /api/uploads/:id/complete` descarga el objeto en servidor, verifica los *magic bytes*, el tamaño real y el número de páginas (PDF) y lo marca `uploaded`, o lo borra si no pasa.

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
Subida en dos pasos (ADR-005) con validación **sobre los bytes**: `POST /api/uploads` (valida lo declarado, comprueba *rate limit*, crea `materials` + `material_files` y devuelve un token de subida firmada) → el navegador sube directamente a Storage → `POST /api/uploads/[id]/complete` (descarga el objeto en servidor, valida firma/tamaño/páginas, calcula SHA-256, reutiliza un análisis del mismo workspace o encola un job). Si algo falla, se borran fichero y registros.

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
