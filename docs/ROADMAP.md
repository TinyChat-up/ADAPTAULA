# Roadmap de implementación

Regla: **una fase no termina hasta que `pnpm check` (typecheck + lint + unit + build) y los tests de la fase pasan.** No se construye sobre código roto. Cada fase se cierra con un resumen de decisiones y pendientes.

## Fase 0 — Cimientos y documentación ✅
- Proyecto Next.js 16 + TS estricto + Tailwind 4 + pnpm + Vitest.
- `CLAUDE.md`, `docs/*`, `.env.example`.
- Contratos Zod iniciales: `MaterialDocument`, `FunctionalProfile`, `AIProvider` (tipos).
- Tests unitarios de los schemas.
- **Esquema completo de base de datos adelantado** (para instalarlo una sola vez en Supabase): migraciones 001-006 (+ 007 de aprovisionamiento en Fase 1) (todas las tablas del MVP, RLS, Storage, cuotas) + seed, con tests en `tests/db`. Las fases siguientes añaden migraciones solo si hace falta cambiar algo.

## Fase 1 — Base de la aplicación ✅
- Tokens de diseño e Inter; primitivas propias de UI (sin shadcn por ahora); layout de marketing y de la app (sidebar escritorio + barra inferior móvil).
- Landing real y `/como-funciona`, `/precios` (leen los planes de la BD), `/privacidad`, `/terminos`, `/cookies` (legales **provisionales**, marcados como pendientes de revisión jurídica). La landing lleva un distintivo «Acceso anticipado» porque el motor de adaptación aún no existe.
- Supabase: clientes `client`, `server`, `admin` (aislado) y `proxy.ts`; ENV público/servidor con Zod; feature flags.
- Auth: registro, login, magic link, olvidé/restablecer contraseña, callback (con protección frente a redirecciones abiertas), logout; Google detrás de `FLAG_GOOGLE_AUTH`. Confirmación de email: depende de la configuración del proyecto Supabase.
- `requireUser` / `requireWorkspace` / `requireWorkspaceRole`; aprovisionamiento idempotente del workspace (migración 007).
- Onboarding de 3 pasos; dashboard con datos reales (sin simular); secciones de fases posteriores con estados vacíos honestos.
- **Tests:** unit (env, rutas seguras, workspace, fronteras cliente/servidor), BD (aprovisionamiento), E2E (rutas protegidas, axe, responsive).

## Fase 2 — Perfiles de alumnado ✅
- `/app/alumnos`: listado (loading, vacío, error, límite alcanzado), creación, edición, duplicado y borrado con confirmación; `checkEntitlement('profile.create')` con límites desde `plans`.
- Divulgación progresiva: información básica → 11 áreas → solo los controles de las áreas elegidas; 11 presets orientativos que no se guardan; resumen determinista «Así se aplicará» (sin IA).
- Se añadió el grupo de dimensiones «Ampliación y reto» (necesario para altas capacidades).
- Acceso a perfiles ajenos o a ids inválidos: 404 sin pistas.
- **Tests:** unit (presets → perfil funcional, `activeSupports`, resumen, validación, entitlements); BD (RLS, límites, ya cubiertos en `tests/db`); E2E contra `fake-supabase` (registro → onboarding → crear → editar → listado, límite Free, duplicar/eliminar, acceso cruzado).
- **Pendiente antes de producción:** repetir el E2E contra un proyecto Supabase real de pruebas (el fake no aplica RLS).

## Fase 3 — Subida de materiales y análisis — PHASE 3: CLOSED (2026-10-05)
Objetivo: **comprender** el material, no adaptarlo. Termina en `MaterialAnalysis` guardado y reutilizable.
- Migraciones 008 (elimina `learner_profiles.notes`) y 009 (estados de material, `confirmed_fields`, `analysis_meta`, jobs `analyze` con máquina de estados atómica, `adaptations.material_id` en `RESTRICT`, `ai_runs` con coste nulo y `material_id`).
- Subida segura en dos pasos con URL firmada; validación en servidor sobre los bytes (firma, tamaño, páginas, cifrado); hash SHA-256; Storage privado con ruta `<workspace>/<usuario>/<material>/<uuid>`; borrado seguro y limpieza de huérfanos.
- Capa de IA: `AIProvider` como transporte, alias → router → proveedor (Anthropic y mock; OpenAI reservado), salida estructurada + Zod + normalización con ids del servidor, reparación acotada, costes centralizados y `ai_runs` por llamada.
- `MaterialAnalysis` v2 y prompt `material_analyzer@v1` con protección frente a inyección.
- Job persistente con lease, reintentos y recuperación; caché por hash dentro del workspace; el análisis no consume cuota de adaptaciones.
- UI: `/app/adaptar`, `/app/materiales` (filtros, reintentar, eliminar) y `/app/materiales/[id]` (progreso real, resultado, corrección del contexto con procedencia).
- Evals de análisis (`evals/material-analysis`, 20 casos) y `docs/SUPABASE_TESTING.md`.
- **Pendiente (requiere credenciales):** primera ejecución de los evals con el modelo real; suite `tests/rls-real` y E2E contra un proyecto Supabase real; verificación en Vercel de la vista previa de PDF y de `after()` en producción.

### Cierre de la Fase 3 — evidencias reales (STANDARD = `claude-sonnet-5-5`, effort medium)
- **Primaria** (análisis real con el prompt anterior, `material_analyzer@v1`, 2026-10-04): estructura básica, fracciones, visuales y respuestas `inferred` correctos; ≈ $0,058 por análisis.
- **Geografía y Historia, 3.º ESO, escaneada** (`material_analyzer@v3`, una llamada, válida a la primera, 0 retries, 0 repairs): 1 tabla y 2 gráficos con valores y categorías correctos, 6 actividades, restricciones y datos numéricos, condición de escenario «sin reducir el número total de desplazamientos» protegida, áreas de respuesta y campos administrativos correctos, respuestas `inferred` exactas y ninguna respuesta abierta inventada. Coste $0,054098, 3.249 tokens de salida, 16,9 s.
- **Lengua, 1.º Bachillerato** (`material_analyzer@v3`, una llamada válida): texto de lectura preservado literalmente (`reading_text`), 5 actividades, restricciones de escritura (70-90 y 150-180 palabras) protegidas, ninguna respuesta abierta inventada. Coste $0,0550.
- **Alcance:** son tres fichas; **no** se afirma que todo tipo de material esté validado. Queda **validación continua durante la beta** (más asignaturas, escaneos de peor calidad, materiales largos) y la comparación ECONOMY pendiente de aprobación.
- **Deuda aceptada (no bloquea la Fase 4):** (1) el modelo puede inventar `series[].name` en gráficos de una serie aunque el prompt pida dejarlo vacío (regla de consumo en `docs/AI_PIPELINE.md`); (2) `essential` puede superar el 75 % de los elementos protegidos cuando pedagógicamente está justificado; (3) puede aparecer algún nombre de sección descriptivo no literal; (4) `necessary_visual` no representa bien algunos recursos textuales; (5) algún elemento protegido puede ser redundante con `resource_ids`.
- **Activo por defecto:** `AI_ANALYSIS_PROMPT_VERSION=3` (v1 y v2 siguen disponibles e inmutables).
- **Pendiente fuera de la fase:** suite `tests/rls-real` y E2E contra un proyecto Supabase real de pruebas; revisión de límites de plan con costes medidos.

## Fase 3.6 — `MaterialAnalysis` v3 (contrato compacto y consistente; sin llamadas reales)
Objetivo: dejar el análisis como contrato fiable de la Fase 4 antes de volver a gastar en APIs.
- **Contrato v3** (`src/lib/schemas/material-analysis.ts`) y prompt `material_analyzer@v2`; v1/v2 siguen leyéndose (`analysis/upgrade.ts`, sin reescribir filas ni reanalizar). Sin migración de BD (`materials.analysis` es JSONB).
- Tablas y gráficos como una única entidad con datos estructurados; áreas de respuesta físicas por actividad; campos administrativos aparte; `protected_elements` tipados con importancia; recuentos e inversas calculados por el servidor; relaciones simétricas por construcción.
- Utilidad de tamaño y coste teórico (`pnpm eval:analysis:size`), `--alias` / `--prompt-version` / `--model` en los evals para el benchmark STANDARD vs ECONOMY vs otro proveedor.
- Validado después con el modelo real (prompts v2 y v3); el prompt v3 es el activo (ver «Cierre de la Fase 3»).

## Fase 4 — Pipeline de adaptación
**Base arquitectónica offline: hecha (2026-10-05).** Contratos versionados `AdaptationContext` v1, `AdaptationPlan` v1, `MaterialDocument` v1 y `PedagogicalReview` v1; taxonomía de 20 estrategias; invariantes pedagógicas y revisión deterministas; ensamblado del documento sin modelo para lo conservado; trazabilidad original → decisión → bloque; corrección docente local; instrumentación de coste por etapa; mocks, `pnpm eval:adaptation:mock` y tests. Sin llamadas reales ni migraciones. Ver `docs/ADAPTATION.md` y ADR-020.
**Planificador:** `adaptation_planner@v1` publicado y validado con un experimento real (una llamada, $0,033). **Generador:** `material_generator@v1` (congelado) y `@v2` (fuente canónica, sin redundancia estructural; no activo hasta validarse), con capa de revisión humana del plan y auditoría determinista. Política 2 del constructor de contexto (H4), respuesta inferida textual como WARN a revisar y orden fuente determinista. `adaptation_planner@v2` publicado (no activo; v1 congelado) y validado con una llamada real en Primaria ($0,0227): válido a la primera, 4 decisiones, sin fugas. PlanReview real hecho (3 decisiones efectivas) y primera llamada de generator v2 en Primaria **detenida por esquema** (checklist global de 5 elementos frente a un tope de 4). Resuelto con el enrutado de ejecución (`execution.ts`): segunda llamada válida a la primera y todas las auditorías deterministas en verde (`dec_4` diferida al renderer). `pedagogical_reviewer@v1` publicado (no activo) y validado una vez en Primaria ($0,0184; fusión en servidor con autoridad acotada). Validación adversarial real del revisor superada (fuga semántica, pista, infantilización y redundancia detectadas; control seguro limpio): candidato a pipeline experimental, no producción. Planner v2 validado dos veces con modelo real (Primaria y Bachillerato, política 2): H1 y H4 resueltas, H5 parcial; candidato a default **experimental** con PlanReview. Pipeline integrado validado sobre Bachillerato (dos llamadas, $0,039; cadena limpia $0,124): sin fugas, sin pérdida de protegidos, decisión diferida preservada. El núcleo IA de la Fase 4 queda validado con caveats (H5 parcial, apoyos de baja utilidad, R1 del revisor). Orquestación real implementada offline (`src/lib/adaptation/orchestration/`, migración 013): máquina de estados con pausa humana obligatoria, versiones fijadas, idempotencia por etapa, leases, detección de intentos ambiguos, `ai_runs` por etapa y coste por etapa; sin cuotas ni UI. Cuotas de adaptación implementadas (migración 014: reservar al crear, consumir con la entrega, liberar al cancelar; sin precios nuevos). Capa web conectada (migración 015): comandos como Server Actions, jobs durables, worker con lease/fencing, reconciliador, cron `/api/cron/adaptations`, rutas de lectura privadas y DTO de estado. **UI de adaptación implementada** (`/app/adaptaciones/[id]`: sondeo, revisión docente del plan, generación, resultado temporal, errores, cancelación y entrada desde el material; sin visor del documento). **Fase 5.1:** renderer determinista de `MaterialDocument v1` (visor HTML/CSS A4 e impresión, `material_renderer@v1`, ruta `/app/adaptaciones/[id]/vista`). Localización humana de visuales originales con recorte determinista en servidor (migración 016, `pdfjs-dist` + `@napi-rs/canvas`). **Fase 5.2A:** motor PDF en local (sin base de datos ni rutas). **Siguiente:** validar el motor en una Preview de Vercel y, después, la 5.2B.
- Prompts planner/generator/reviewer/block_reviser v1; orquestador idempotente; `after()` + cron de recuperación; polling del progreso.
- Wizard `/app/adaptar` completo; varios perfiles (flag `MULTI_PROFILE_GENERATION`); devolución de cuota ante fallos.
- `/evals` con 30 casos + runner; primera medición real de coste y calidad (con presupuesto aprobado).
- **Tests:** unit (comprobaciones deterministas, reglas de reintento y escalado); integración (job completo con mock: éxito, fallo con devolución, fallo parcial, reanudación tras caída); E2E (subida → adaptación con mock → resultado).

## Fase 5 — Renderer, editor y PDF
- `MaterialRenderer` (todos los tipos de bloque, plantillas `estandar` y `secundaria-sobria` como mínimo, KaTeX).
- Editor por bloques (edición, mover, duplicar, eliminar, regenerar), autoguardado, deshacer/rehacer, versiones.
- Comparador; "¿Qué hemos adaptado?".
- **Spike PDF** (ADR-007) y después la implementación: A4, saltos de página, cabeceras y números de página, exports cacheados. **5.2A (motor) hecha en local:** `material_renderer@v2`, `renderPrintHtml`, `PdfEngine` (Chromium serverless), `PdfValidation` y `pnpm smoke:pdf` (1, 3 y 10 páginas, entre otros casos). **Validación en runtime de Vercel: PENDIENTE.** Después vienen la 5.2B (exportación durable: tabla, pins, Storage, jobs y rutas) y la 5.2C (UX).
- Feedback 👍/👎.
- **Tests:** unit (reducers del editor, mapeo de bloques); visual (snapshots del renderer); PDF de 1, 3 y 10 páginas (número de páginas, sin bloques cortados, texto seleccionable); E2E (editar → descargar).

## Fase 6 — Stripe, planes y cuotas
- Checkout, Portal y webhook idempotente; `subscriptions`, `billing_customers`, `stripe_events`.
- Plan efectivo, entitlements en todas las acciones, `/app/uso`, `/app/configuracion/facturacion` y `/precios` conectada.
- Copy de límite alcanzado en todos los puntos.
- **Tests:** unit (plan efectivo, periodos); integración (webhooks: firma, duplicados, orden invertido); E2E (Free genera 5 y la 6.ª se bloquea; upgrade con Stripe test + CLI; un fallo de IA no consume cuota).

## Fase 7 — Pulido, accesibilidad y seguridad (cierre del MVP)
- Auditoría WCAG 2.2 AA (axe + revisión manual con teclado y lector de pantalla).
- Cabeceras de seguridad + CSP con nonce; rate limits; revisión de logs sin datos sensibles.
- Admin mínimo: KPIs, jobs, coste de IA, prompts (activar versión).
- Retención (cron), exportar mis datos, eliminar cuenta.
- Analítica de producto (`product_events`) con todos los eventos del catálogo.
- Monitorización de errores (decisión: Sentry UE o alternativa).
- **Tests:** suite completa + E2E de seguridad (A no accede a B, en todas las entidades) + Lighthouse/axe.

**= MVP comercializable** (tras la revisión legal de `docs/PRIVACY.md`).

## Fase 2 del producto (post-MVP)
Max (flag) · generación de imágenes · clases y "Adaptar para 5ºA" · adaptación múltiple ampliada · comparador avanzado · más plantillas · ampliación de evals a 100+ casos.

## Fase 3 del producto
Centros: multiusuario, roles, panel de centro, biblioteca compartida, facturación institucional, límites compartidos, políticas de retención por centro, SSO si hay demanda, analítica agregada. Lenguas cooficiales.

## Decisiones abiertas

| Tema | Cuándo | Notas |
|---|---|---|
| Validación del PDF con Chromium en Vercel | Fase 5 (spike) | Alternativa: `@react-pdf/renderer` |
| Modelos OpenAI concretos (texto alternativo, imagen) | Fase 3 / Fase 2 del producto | Verificar IDs y precios en la documentación oficial |
| Margen Pro/Max con costes reales | Fase 4 | Ajustar cuotas, routing o precios con datos de `ai_runs` |
| Email transaccional (proveedor SMTP) | Fase 1 | Preferiblemente UE |
| Monitorización de errores | Fase 7 | |
| Revisión legal y fiscal (RGPD, IVA/OSS) | Antes del lanzamiento | Externa |
