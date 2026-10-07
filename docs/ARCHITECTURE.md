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

### ADR-004 · Jobs de IA: tabla `adaptation_jobs` + ejecución en servidor con `after()`
Un pipeline completo (análisis → plan → generación → revisión) puede tardar de 30 s a 3 min.
- `POST /api/jobs` valida, comprueba entitlement, **reserva cuota**, crea el job y responde `202` al instante.
- El trabajo se ejecuta en la misma función con `after()` (`maxDuration` = 300-800 s en Fluid Compute).
- Cada paso persiste su resultado (`materials.analysis`, `adaptations.plan`, `adaptation_versions`), así que un reintento **reanuda** sin repetir pasos ya pagados.
- Un cron (`/api/cron/jobs`, cada minuto) recupera jobs con el lease caducado (`locked_until`) y los reintenta hasta `max_attempts`; después los marca `failed` y devuelve la cuota.
- La UI hace polling de `GET /api/jobs/:id` cada 2 s (más simple que Realtime; se puede cambiar sin tocar el pipeline).

Alternativas descartadas por ahora: Supabase Edge Functions (otro runtime y límites de tiempo), colas externas (más infraestructura). Si la durabilidad de `after()` + cron se queda corta, el siguiente paso es Vercel Workflow, porque cada paso ya es idempotente.

### ADR-005 · Subidas directas a Storage con URL firmada
Las funciones de Vercel limitan el cuerpo de la petición a 4,5 MB. Por eso:
1. `POST /api/uploads` valida el nombre, el MIME declarado, el tamaño y la cuota de páginas, crea `materials` + `material_files` con estado `uploading` y devuelve una **signed upload URL** del bucket privado `source-materials`.
2. El navegador sube el fichero directamente a Supabase Storage.
3. `POST /api/uploads/:id/complete` descarga el objeto en servidor, verifica los *magic bytes*, el tamaño real y el número de páginas (PDF) y lo marca `uploaded`, o lo borra si no pasa.

### ADR-006 · Capa de IA propia sobre los SDKs oficiales
`AIProvider` es **solo transporte** (`generateStructured`): los prompts, el parseo y la validación viven en los pipelines (decisión de la fase 3; antes la interfaz tenía un método por paso, lo que obligaba a duplicar prompts en cada proveedor). Hoy hay `AnthropicProvider` y `MockProvider`; OpenAI está reservado y se cablea cuando la comparación de la fase 4 lo necesite. Usamos los SDKs oficiales y no un SDK unificado de terceros, porque necesitamos control directo de la caché de prompts, el esfuerzo de razonamiento, la entrada PDF nativa, las salidas estructuradas y el desglose de uso de tokens para calcular costes. La lógica de negocio solo conoce alias (`ECONOMY`, `STANDARD`…); el mapeo alias → `proveedor:modelo` está en env. Detalle: `docs/AI_PIPELINE.md`.

### ADR-007 · PDF: HTML print con Chromium headless usando el mismo renderer
Un único `MaterialRenderer` React en modo `screen` o `print`, con los mismos tokens de diseño. Una ruta interna de impresión renderiza la versión aprobada y Chromium headless (Playwright + Chromium serverless en Vercel) genera un PDF vectorial A4 con CSS paged media (`@page`, `break-inside: avoid` por bloque, cabeceras y números de página).

Motivos: un solo renderer (sin divergencias pantalla/PDF), KaTeX y tablas funcionan tal cual, y control fino de los saltos de página. Hay que **validarlo con un spike en la Fase 5** (fichas de 1, 3 y 10 páginas; arranque en frío; tamaño de función). Alternativa si falla el despliegue: `@react-pdf/renderer` con un segundo renderer que comparta tokens. Nunca capturas de pantalla.

**Resultado (Fase 5.2A, local).** Se confirma el enfoque sin segundo renderer: `renderPrintHtml` (`react-dom/static`, porque Next 16 rechaza `react-dom/server` en el servidor) produce un HTML autocontenido con el mismo `MaterialSheet` y `material.css`, y `playwright-core` 1.63 con `@sparticuz/chromium` 153 lo imprime sin red, con la CSS de paginación y los números de página de `@page`. No se usa una ruta HTTP interna: el HTML entra por `setContent`. `@react-pdf/renderer` queda descartado. Detalle y medidas: `docs/ADAPTATION.md` § «Exportación PDF». **Validación en runtime de Vercel: PENDIENTE.**

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

El análisis es un **job persistente** (`adaptation_jobs.kind = 'analyze'`) ejecutado con `after()` en la misma función (`maxDuration = 300`). Estados del material: `uploading → uploaded → queued → analyzing → analyzed | failed`. La exclusión entre procesadores la garantiza la base de datos (lease + token de intento, ver `docs/DATABASE.md`). **Recuperación sin cron frecuente:** el endpoint de estado (`GET /api/materials/[id]/status`, consultado cada 2 s por la pantalla de progreso) relanza un job cuyo lease caducó o cuya espera de reintento pasó; recargar la página o volver más tarde basta. Un cron **diario** solo limpia subidas huérfanas (así encaja en el plan gratuito de Vercel).

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
