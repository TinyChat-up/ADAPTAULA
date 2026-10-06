# Pipeline de IA

Principio: **no pedir nunca "hazme un PDF adaptado"**. El proceso se divide en pasos con contratos Zod, cada uno persistido, medido y reintentable.

```
A Ingesta ─► B Análisis ─► C Plan ─► D Generación ─► E Revisión ─┬─► F Render (React/PDF)
  (sin IA)    (1 vez por    (por       (por perfil)    (por perfil) │
              material)     perfil)                                 └─► revisar bloques fallidos (máx. N)
```

## Capa de proveedores (`src/lib/ai`)

El proveedor es **solo transporte**: recibe un prompt, contenido (texto, PDF, imagen) y el schema Zod de salida, y devuelve texto sin confiar. Los prompts, las reglas de negocio, el parseo, la validación y la normalización viven en los *pipelines*, así que cambiar de proveedor es configuración.

```
src/lib/ai/
  types.ts            AIProvider (generateStructured), ModelSelection, StructuredRequest/Response, AIRunRecord
  errors.ts           AIError con categorías (not_configured, provider_unavailable, rate_limited, timeout, auth, bad_request,
                      refusal, truncated, invalid_output, unknown) y failureMessage() para el usuario (sin proveedor ni modelo)
  config.ts           alias → modelo por defecto, esfuerzo, parámetros del análisis (única tabla de modelos del código)
  registry.ts         alias → { provider, model, effort } desde AI_MODEL_<ALIAS> (env) o los valores por defecto
  router.ts           createProvider(selection): anthropic · mock (rechazado en producción) · openai (reservado, no disponible)
  runtime.ts          arma la configuración del análisis desde el entorno
  providers/anthropic.ts   AnthropicProvider (SDK oficial, streaming, salida estructurada, PDF/imagen en base64)
  providers/mock.ts        MockProvider (desarrollo, E2E y harness de evals; marcadores MOCK_FAIL/INVALID/TRUNCATED/REFUSAL/SLOW)
  costs.ts            tabla de precios única → coste estimado (null si el modelo no tiene precio)
  structured.ts       extracción de JSON, parseo y descripción de errores de validación sin contenido
  prompts.ts          registro de prompts y versión activa
  pipeline/analyze.ts análisis: modelo → parseo → Zod (borrador) → normalización → Zod (almacenado), con reparación acotada
```

`generateStructured(request)` devuelve `{ text, stopReason, usage, provider, model, latencyMs }`. El pipeline registra cada llamada en `ai_runs`. Los pasos de adaptación (plan, generación, revisión) seguirán este mismo patrón en la fase 4.

### Alias de modelo

La lógica de negocio solo conoce alias. Formato en env: `proveedor:modelo` (+ esfuerzo por defecto).

| Alias | Valor inicial | Uso |
|---|---|---|
| `ECONOMY` | `anthropic:claude-haiku-4-5` | Free; tareas sencillas; revisiones de un solo bloque |
| `STANDARD` | `anthropic:claude-sonnet-5-5` | Pro/Max por defecto |
| `PREMIUM` | `anthropic:claude-opus-5-5` | Escalado excepcional (ver routing) |
| `IMAGE_FAST` | `openai:<modelo de imagen económico>` | Max: recursos visuales |
| `IMAGE_QUALITY` | `openai:<modelo de imagen de calidad>` | Max: solo cuando haga falta |

Las alternativas de OpenAI para los alias de texto (la familia "GPT-6" de la especificación) y los IDs exactos de los modelos de imagen **deben verificarse en la documentación de OpenAI** antes de configurarlos; no se codifican. Ningún nombre de modelo aparece en la UI.

Notas de los modelos Claude actuales (para la implementación de la Fase 4):
- Sonnet 5.5 y Opus 5.5 no permiten desactivar el razonamiento; se controla con `output_config.effort` (`low`…`max`). Opus 5.5 tiene `medium` por defecto y Sonnet 5.5 `high`: **fijar siempre el esfuerzo de forma explícita**.
- Salidas estructuradas mediante `output_config.format` (JSON Schema generado desde Zod) + validación Zod posterior.
- El *tool choice* forzado no está disponible en estos modelos: usar salidas estructuradas.
- Gestionar `stop_reason: "refusal"` y activar el fallback del servidor (`fallbacks: "default"`) cuando proceda.
- PDF nativo como bloque `document` (base64) en el análisis; las imágenes como bloque `image`.

## Routing basado en calidad

`routing.ts` decide `(alias, effort)` por **paso**, no solo por plan:

| Situación | Análisis | Plan / Generación | Revisión |
|---|---|---|---|
| Free | ECONOMY | ECONOMY | ECONOMY |
| Pro/Max, material sencillo | STANDARD · low | STANDARD · low | STANDARD · low |
| Pro/Max, material medio | STANDARD · low | STANDARD · medium | STANDARD · low |
| Pro/Max, complejo (`complexity ≥ 0.7`, varias necesidades, curricular, ciencias/matemáticas densas, varias páginas) | STANDARD · medium | STANDARD · high | STANDARD · medium |
| La revisión falla en algo **crítico** tras reintentar | — | **PREMIUM** · medium (solo bloques afectados) | STANDARD |

- La complejidad (0-1) la calcula el análisis (densidad, páginas, relaciones entre ejercicios, notación).
- El escalado a PREMIUM consume un presupuesto mensual por workspace (`features.premium_escalations_per_month`); Max lo tiene más alto. Si se agota, se entrega el resultado señalando al docente los bloques a revisar.
- Toda la tabla es configurable en `app_settings.ai_routing`, para hacer A/B sin desplegar.

## Pasos

### A · Ingesta (sin IA)
PDF, JPG, PNG, WEBP. Validación de MIME por *magic bytes*, tamaño (`features.max_file_mb`), número de páginas (`features.max_pages_per_material`) y hash sha256. El fichero va al bucket privado `source-materials`. El escaneo de malware queda pendiente de infraestructura (se documenta como riesgo aceptado del MVP: los ficheros nunca se ejecutan ni se sirven públicamente).

### B · Análisis — `material_analyzer@v1` (activo) y `@v2` (implementado en la fase 3.6, sin validar con el modelo real)
Entrada: el fichero original (PDF nativo o imagen) + el contexto que el docente haya **confirmado** (etapa, curso, asignatura, tema). Nunca datos del alumnado: en esta fase no interviene ningún perfil.

Cada versión del prompt va emparejada con el contrato que produce (`src/lib/ai/prompts.ts`): **v1 → esquema v2** (histórico; sus filas se leen elevadas a v3 en memoria) y **v2 → esquema v3**. La versión en uso se elige con `AI_ANALYSIS_PROMPT_VERSION` (por defecto 1): nada cambia solo. El resto de la app consume siempre la forma v3 (`MaterialAnalysis`).

**`MaterialAnalysis` v3** (`src/lib/schemas/material-analysis.ts`):
- **Identificación:** título e idioma (texto leído tal cual), etapa, curso, asignatura (con su `slug` del catálogo si encaja) y tema con su `confidence`.
- **Intención pedagógica:** propósito, objetivos, conocimientos implicados, conocimientos previos y dificultad.
- **Secciones y textos** (`texts`: instrucciones generales, lecturas, ejemplos, definiciones, fórmulas, notas), con página; cada texto sabe qué actividades lo necesitan.
- **Visuales** (`visuals`): **una entidad por elemento**. Tipos `image`, `diagram`, `chart`, `table`, `number_line`, `geometric_figure`, `map`, `decorative`, `other`; función (`role`: `required`, `informative`, `illustrative`, `decorative`); título; descripción breve; y **datos estructurados**: una tabla lleva `table` (cabeceras, filas, unidad) y un gráfico `chart` (tipo, categorías, series de valores, unidad, etiquetas de ejes). Si los datos no se leen con seguridad, se conserva la descripción y se registra una incertidumbre `unstructured_data`; el servidor hace lo mismo si una serie no encaja con sus categorías.
- **Campos administrativos** (`administrative_fields`): nombre, fecha, curso o grupo, número de lista, identificador, nota, firma. Solo que existen (tipo y rótulo, nunca un dato real); las líneas de guiones y los números de página no se guardan.
- **Actividades:** número visible, página, tipo, `instruction` (lo que el alumno debe hacer), `context` (solo si hay enunciado, datos u opciones necesarios que no estén ya en un recurso ni repitan la instrucción), `resource_ids` (los textos y visuales que necesita), objetivos, formato de respuesta, **`answer_area`** (lo que ofrece la ficha original: ninguno, una línea, varias líneas con su número aproximado, recuadro, cuadrícula, espacio amplio, celdas de tabla), respuesta esperable, dificultad y confianza.
- **Elementos protegidos** (`protected_elements`), compactos: `type`, `importance` (`essential`, `important`, `optional`), `value` y destinos. Tipos: objetivo de aprendizaje, operación objetivo, concepto, datos necesarios, unidades o magnitudes, recurso necesario, **condición de la respuesta**, **condición de razonamiento**, criterio de evaluación, vocabulario necesario, formato exigido, fórmula, otro.
- **Incertidumbres:** `kind`, destinos, nota breve y confianza.

**Una sola semántica para los recuentos** (`structure.counts`, `src/lib/analysis/counts.ts`, siempre calculados por el servidor sobre el grafo final): `sections`, `activities`, `responses_required` (actividades con respuesta que producir), `answer_spaces` (actividades cuya ficha original ofrece un área física de respuesta), `reading_texts`, `examples`, `formulas`, `tables` (visuales `table`), `charts`, `images`, `figures` (diagramas, figuras, rectas, mapas y otros no decorativos) y `decorative`. Una entidad solo está en una categoría, porque tiene un único `kind`: nada puede contarse dos veces.

**Regla para consumidores del análisis (Fase 4 incluida):** `chart.series[].name` es metadata **potencialmente inferida**, no texto necesariamente presente en el material (el modelo puede nombrar una serie única a partir del título aunque el prompt pida dejarla vacía, y el contrato no tiene procedencia). Por tanto: no se muestra automáticamente al alumno, no se convierte en elemento protegido, no es evidencia textual del material y no se exige conservarlo en una adaptación. Hay que apoyarse en categorías, valores, unidades, título y ejes explícitos y relaciones verificables. No se borra por heurística (algunos documentos sí los imprimen). Test de consumidor: `tests/unit/analysis-robustness.test.ts`.

**`importance`:** el umbral del 75 % de `essential` es una señal blanda de evals, nunca una normalización: no se rebaja ningún elemento para cumplir una proporción.

**Respuestas esperables** (`expected_answer.basis`): `source` (figura en la ficha: contenido original), `inferred` (la dedujo el modelo) o `not_inferable` (sin valor). Una respuesta inferida **nunca** es contenido original, **nunca** se muestra al alumno automáticamente (la UI de actividades no la pinta), **nunca** se convierte en elemento protegido (el normalizador lo descarta) y solo sirve para comprobar después que una adaptación sigue siendo resoluble (`src/lib/analysis/answers.ts`: `statedAnswer` vs `solvabilityHint`). El prompt v2 pide `inferred` solo con total seguridad.

**Dos esquemas, un patrón (ADR-008):** el modelo produce el *borrador* y el servidor produce el análisis almacenado. El borrador v3 (`MaterialAnalysisDraftSchema`) **solo pide lo que únicamente el modelo puede saber**: ids locales cortos (`a1`, `v2`) solo para enlazar, **cada relación escrita una sola vez** (actividad → recursos y objetivos; elemento protegido o incertidumbre → destinos; elemento → sección) y campos opcionales cuando hay algo que omitir. El servidor (`src/lib/analysis/normalize.ts`) valida con Zod, asigna ids estables (`act_1`, `vis_2`…), **deriva las relaciones inversas** (`visual.activity_ids`, `text.activity_ids`: por construcción no hay enlaces asimétricos y el esquema almacenado los rechaza), infiere la sección por página solo si es inequívoca, calcula `structure`, saca del texto las líneas administrativas y los números de página, descarta un contexto que repite la consigna, completa en un recurso protegido todas las actividades que lo usan, funde elementos protegidos idénticos y **descarta, no adivina, toda relación ambigua**. Cada reparación deja un aviso en `analysis_meta.warnings` (código y número, nunca contenido).

**Lo que v3 ya no pide al modelo ni guarda** (frente a v2): `content` (repetía la consigna), `knowledge_required` (queda en los objetivos), `complexity` y `difficulty_rationale` (sin uso), `summary` de las secciones, `rationale` de los elementos protegidos, la confianza del título, el idioma y los objetivos, `legible`, `has_answer_space` y `necessary_to_solve` (derivados), `visual_elements[].activity_ids` y `protected_elements[].visual_ids` (relaciones inversas o fundidas en `resource_ids`), `confidence` de los visuales y de la respuesta, la incertidumbre `answer_not_inferable` (ya lo dice la ausencia de respuesta) y las tablas como contenido de texto.

**Compatibilidad con v2** (`src/lib/analysis/upgrade.ts`, `parse.ts`): un análisis v2 se eleva a v3 **al leerlo**, sin tocar la fila ni reanalizar. Se repara lo inequívoco: una tabla guardada dos veces (como contenido y como `table_image`) se funde en una sola entidad, los enlaces actividad ↔ visual se completan por ambos lados, las líneas administrativas y los números de página salen del texto, el `content` que repetía la consigna desaparece, los recuentos se recalculan y un elemento protegido «figura necesaria» se completa con todas las actividades que usan la figura. Un área de respuesta que v2 no distinguía queda como `unknown` (no se inventa). Cada reparación se informa como aviso al leer.

Se **sustituye** el antiguo `source_document` (el material como bloques `MaterialDocument`): las actividades y los textos ya contienen la transcripción fiel, y los bloques se construirán (o se pedirán al modelo) en la fase 4 con un esquema pensado para generar, no para describir.

**Flujo y robustez** (`pipeline/analyze.ts`): modelo → parseo → Zod → normalización → persistencia. Los reintentos siguen una política explícita (sección *Errores y reintentos*) y están acotados por construcción: no hay bucles abiertos. Hay un plazo global del job (270 s) por debajo de `maxDuration` (300 s).

**Entrega del esquema: nativa o por instrucciones.** El proveedor rechaza las gramáticas de salida estructurada por encima de un tamaño (HTTP 400 *«compiled grammar is too large»*). El análisis completo (≈ 90 campos obligatorios anidados) **no cabe**, ni siquiera quitando tres de sus nueve secciones (medido con peticiones de `max_tokens: 1`, que se rechazan antes de generar y no cuestan nada). Además, con este SDK y Zod 4 los `enum` y los rangos viajan como texto de `description`, no como restricción de la gramática.

Por eso el proveedor (`providers/anthropic.ts`) prueba primero el modo **nativo** y, si lo rechaza por tamaño, cae —en la misma llamada y recordándolo durante la vida del proceso— al modo **por instrucciones**: el JSON Schema real (con sus `enum` y límites) va en un segundo bloque del *system*, con `cache_control`, y la respuesta se valida igualmente con Zod (más la única reparación). El contrato (Zod), el prompt `material_analyzer@v1` y el pipeline no cambian: es una decisión de transporte.

Consecuencias: (1) sin decodificación restringida, la primera respuesta puede salir inválida con más frecuencia (1 de 3 en el primer benchmark, reparada); (2) el bloque del esquema son ≈ 6.300 tokens por llamada: ≈ 0,0013 USD si se lee de caché y ≈ 0,016 USD si hay que escribirla (1,25×); (3) los esquemas de la fase 4 (`MaterialDocument`, aún mayor) tendrán el mismo problema y habrá que partirlos o usar este mismo modo.

**Caché y reutilización:** el análisis canónico vive en `materials.analysis` y la procedencia en `materials.analysis_meta`. Al completar una subida se calcula SHA-256 de los bytes recibidos (`content_hash`); si **en el mismo workspace** existe un material `analyzed` con el mismo hash, la misma `analysis_prompt_version` (`material_analyzer@v1`) y el mismo `schema_version` (**`content_hash + prompt_version + schema_version`**), el análisis se copia (`cache_hit: true`, coste 0) sin llamar al modelo ni consumir cuota. Nunca se reutiliza entre workspaces (no se puede inferir que otro usuario subió un fichero), ni un análisis fallido o de otra versión. Cambiar solo de modelo **no** invalida la caché (queda en el meta); cambiar el prompt o el esquema, sí. Las adaptaciones futuras (una ficha para 5 alumnos) leen `materials.analysis` y no reenvían el fichero.

**`forceReanalysis` (ignorar la caché a propósito):** `requestAnalysis(ctx, materialId, { force })` (`materials/service.ts`) es la única puerta de entrada en el servidor. Con `force: true` no se consulta la caché y se encola un análisis nuevo, que gasta una unidad de cuota como cualquier llamada al modelo. La UI lo usa en «Volver a analizar» (material ya analizado); «Analizar» y «Reintentar» (material subido o fallido) usan `force: false` y pueden reutilizar un análisis idéntico. El indicador viaja en `adaptation_jobs.input.force` y acaba en el meta.

**`analysis_meta` (procedencia, necesaria para los benchmarks; nunca contiene contenido):** `provider`, `model` (el que respondió, no solo el configurado), `model_alias`, `effort`, `prompt_key`/`prompt_version`, `schema_version`, `analyzed_at`, `attempts`, `cost_usd`, `cache_hit`, `forced_reanalysis`, `source` (`model` | `reused`), `reused_from_material_id` y `warnings`. Un análisis reutilizado conserva el proveedor, el modelo y la fecha del original y marca `cache_hit: true`.

**Contexto confirmado por el docente:** `materials.confirmed_fields` lista lo que el docente ha corregido (`title`, `stage`, `grade`, `subject`, `topic`). Al completar un análisis, solo se rellenan los campos **no** confirmados y con confianza ≥ 0,6 (y válidos en el catálogo); lo confirmado nunca se pisa, tampoco al volver a analizar. Lo confirmado se envía al modelo como `<teacher_context>`.

**Cuota y abuso:** analizar **no consume** la cuota de adaptaciones: tiene la suya, `monthly_analyses` (Free 10 · Pro 100 · Max 250, en `plans.features`, ajustable sin desplegar).

- La unidad se **reserva en la misma transacción que crea el job** (`enqueue_analysis_job` → `consume_quota`, lock por workspace y tipo: dos peticiones simultáneas nunca superan el límite).
- Se **devuelve** (`refund_quota`, idempotente) si el job termina fallido sin entregar análisis, incluido el agotamiento de intentos. Un fallo reintentable no devuelve nada hasta que sea definitivo.
- Una reutilización de caché no encola nada y por tanto no reserva.

Además, límites técnicos independientes (`ANALYSIS_LIMITS` en `src/lib/materials/config.ts`): 30 subidas por usuario y hora, 20 análisis por workspace y hora (reintentos incluidos) y 3 análisis simultáneos por workspace (índice único + comprobación en `enqueue_analysis_job`). El uso técnico queda en `ai_runs` (tokens, incluida la escritura en caché, y coste por llamada).

### C–E · Plan, generación y revisión (Fase 4)

Diseño completo en **`docs/ADAPTATION.md`** (ADR-020). Base offline implementada en `src/lib/adaptation/`; los prompts y las llamadas reales aún no existen.

- **A · Contexto (determinista):** `AdaptationContext` v1 derivado del perfil funcional, la etapa y el análisis: solo necesidades activas y aplicables, ajustes de presentación, límites, registro por edad, hechos de la ficha y conflictos resueltos. Nunca alias, ids ni diagnósticos.
- **B · Plan — `adaptation_planner_v1` (pendiente):** produce `DraftAdaptationPlan` (decisiones compactas: destino por id, acción, estrategias, dimensiones, intensidad, elementos protegidos que conserva, apoyos). Recibe el material **sin respuestas inferidas** y con los nombres de serie vaciados (`model-input.ts`).
- **C · Validación (determinista):** `normalizePlan` (ids `dec_N`, huellas del análisis y del contexto) + `validatePlan` (invariantes pedagógicas). Una reparación con los avisos bloqueantes; lo que siga bloqueado se descarta, nunca se aplica.
- **D · Generación — `material_generator_v1` (pendiente):** produce `GeneratedSegments`: solo los bloques de los destinos que una decisión cambia o acompaña. Lo que se conserva lo copia `buildDocument` desde el análisis, sin modelo. El servidor asigna los ids de bloque (`blk_…`) y la trazabilidad.
- **E · Integridad + revisión:** `PedagogicalReview` v1 con 13 comprobaciones concretas (10 deterministas, 2 híbridas, 1 IA). `pedagogical_reviewer_v1` (pendiente) solo responde las no deterministas, recibe las respuestas inferidas para comprobar la resolubilidad y nunca suaviza un FAIL determinista. Si algo falla, se regeneran solo `blocks_to_revise` con `block_reviser_v1`.

### F · Render (sin IA)
JSON aprobado → `MaterialRenderer` (pantalla) → impresión → PDF (ADR-007).

### Revisión de un bloque — `block_reviser_v1`
Entrada: el bloque, los bloques vecinos (contexto), la petición del docente ("Haz esta pregunta más corta"), el perfil funcional y los objetivos protegidos. Salida: **un** bloque compatible con `MaterialDocument` v1, con el mismo `id` y la misma trazabilidad. Por defecto STANDARD · low (ECONOMY en Free). Consume `block_revision`, no `adaptation`.

### Imágenes (Max, `AI_IMAGES_ENABLED`)
1. `image_brief_v1` (modelo de texto) → `ImageBrief`: propósito pedagógico, edad, concepto, objetos, composición, fondo, complejidad, etiquetas, elementos prohibidos, notas de accesibilidad y texto alternativo.
2. Modelo de imagen `IMAGE_FAST` (o `IMAGE_QUALITY` si el brief lo requiere) → asset privado en `generated-assets`.
3. Consume `image` (límite mensual independiente). Primaria: puede ser ilustrativa. Secundaria: informativa y madura. Sin texto en la imagen salvo que sea imprescindible; diversidad natural, sin estereotipos.

## Varios perfiles a la vez

Un job con N perfiles: un análisis (cacheado) y luego plan → generación → revisión por perfil, en paralelo con concurrencia limitada (3). Cada perfil es una `adaptation` independiente: si falla una, las demás se entregan (`status = partial`) y solo se devuelve la cuota de la fallida.

## Qué datos salen hacia el proveedor de IA

| Se envía | No se envía nunca |
|---|---|
| Contenido del material subido | `display_name` (alias) del alumno |
| Etapa, curso, asignatura, tema | `notes` del perfil |
| Dimensiones del perfil funcional | Etiquetas diagnósticas: no existen en el esquema (`contextual_tags` eliminada en la migración 011) |
| Tipo de adaptación y petición del docente | Nombre o email del docente, IDs internos |

Las peticiones a los proveedores usan configuraciones sin entrenamiento con datos del cliente y, cuando sea posible, retención mínima o nula (ver `docs/PRIVACY.md`).

El campo `notes` de los perfiles ya no existe (migración 008); la fila «notes del perfil» de la tabla de arriba se conserva como recordatorio de que ninguna nota libre llega a la IA.

## Errores y reintentos

**Política de reintentos del análisis** (`ANALYSIS_RETRY` en `src/lib/ai/config.ts`; `jobFailureDecision` en `errors.ts`). Cada categoría tiene un tope; nada es un bucle abierto:

| Fallo | Política |
|---|---|
| Red · timeout · 5xx/sobrecarga · rate limit | Reintento técnico acotado: 2 reintentos del SDK dentro de cada llamada **y** reintentos del job con espera (`retryBackoffSeconds`), hasta `max_attempts` (3). Tras agotarlos, el job falla y la cuota se devuelve. |
| JSON completo pero inválido (Zod) | **Como máximo 1** reparación, enviando solo las rutas y reglas que fallaron (nunca valores). El tope no se puede subir por configuración (`AI_ANALYSIS_MAX_REPAIR_ATTEMPTS` ≤ 1). |
| Salida truncada (`max_tokens`) | **Como máximo 1** regeneración **limpia** (el JSON cortado nunca se repara ni se reenvía) con un presupuesto de salida ×1,5 hasta 64.000 tokens; si no queda margen que dar, no tiene sentido repetir y falla como `truncated`. |
| Seguridad / rechazo del proveedor | Nunca se reintenta ni se intenta eludir. |
| Entrada corrupta o no válida, petición rechazada, credenciales | Nunca se reintenta. |
| Error inesperado | Reintentable dentro del presupuesto de intentos del job; se registra como `unexpected`. |

Reparación y regeneración comparten un máximo de 3 llamadas por intento del job (1 + 1 + 1). El motivo de cada respuesta rechazada (rutas del esquema, sin valores) se registra en el log (`analysis_output_invalid`) y en los informes de los evals.

Reglas generales del producto:

1. Errores transitorios (429, 5xx, timeouts): reintento del SDK (2) con backoff.
2. Salida no válida según el schema: un intento de reparación enviando el error de validación; si vuelve a fallar, el paso falla.
3. `PROVIDER_FALLBACK`: si un proveedor está caído, el alias tiene un `fallback` configurado con el otro proveedor (solo para fallos de proveedor, no de contenido).
4. Si el job falla sin entregar material: `refund_quota`, `ai_runs` con el error, y la UI muestra *"No hemos podido terminar esta adaptación. No se ha descontado de tu límite."*

## Caché y coste

- Prompts de sistema estáticos al principio de la petición, con `cache_control` (prefijo estable: nada variable en el system prompt).
- **El coste de una llamada tiene cuatro partes:** entrada no cacheada, lecturas de caché (0,1× de la entrada), **escrituras de caché (1,25×)** y salida (incluye el razonamiento). `ai_runs` guarda las cuatro (`input_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) para poder reconstruir el coste estimado. La caché de prompts dura ~5 minutos: con uso esporádico casi todas las llamadas **escriben** el bloque estático (≈ +0,015 USD por análisis con el esquema en el prompt); con ráfagas lo leen.
- Análisis una vez por material; los pasos siguientes usan el análisis (JSON) en lugar del PDF.
- Las revisiones de bloque envían solo el bloque y sus vecinos.

**Barreras de coste (servidor):** en la fase 3, `MAX_SINGLE_JOB_COST_USD` **registra un aviso** (`analysis_cost_above_threshold`) cuando un análisis lo supera, pero no bloquea trabajos legítimos; abortar o pausar con `DAILY_AI_COST_ALERT_USD`, `MONTHLY_AI_COST_ALERT_USD` y `app_settings.ai_paused` queda para cuando haya datos reales de coste.

### Estimación inicial de coste (a validar en la Fase 4 con `ai_runs` reales)

Supuestos: ficha de 2 páginas, esfuerzo bajo o medio, caché de prompts de sistema. Precios Anthropic por millón de tokens: Haiku 4.5 $1/$5 · Sonnet 5.5 $2/$10 · Opus 5.5 $4/$20.

| Paso (STANDARD) | Entrada | Salida (incl. razonamiento) | ≈ USD |
|---|---|---|---|
| Análisis (amortizable) | 6k | 3k | 0,04 |
| Plan | 4k | 1,5k | 0,02 |
| Generación | 6k | 4k | 0,05 |
| Revisión | 8k | 1,5k | 0,03 |
| **Total por adaptación** | | | **≈ 0,10-0,15** |

**Riesgo de margen a vigilar:** un usuario Pro que agote 75 adaptaciones costaría unos 8-11 USD, cerca del ingreso neto (9,99 € con IVA ≈ 8,26 € sin IVA, menos comisiones de Stripe). Max con 150 adaptaciones + 50 imágenes puede superar su precio. Es viable porque el uso medio suele quedar muy por debajo del máximo, pero hay que medirlo. Palancas, por orden: (1) revisión determinista + revisión IA ECONOMY en materiales sencillos; (2) esfuerzo `low` por defecto; (3) análisis con ECONOMY cuando el material sea sencillo; (4) ajustar las cuotas en `plans` sin desplegar. Free (ECONOMY) ≈ 0,03 USD por adaptación → ≈ 0,15 USD/usuario/mes.

## Evals

**Análisis de materiales (implementado):** `evals/material-analysis/` — 20 casos sintéticos, puntuación estructural y semántica, ejecución con el modelo real, comparación entre proveedores, fichas reales privadas y plantilla de evaluación humana (`pnpm eval:analysis*`; ver su README). Lo que sigue describe el sistema completo previsto para el pipeline de adaptación.

### `/evals` (adaptación, fase 4)

Crítico para cambiar prompts y modelos sin intuiciones. Estructura:

```
evals/
  cases/<id>/case.yaml     contexto, perfil funcional, tipo, petición, criterios
  cases/<id>/source.pdf    material original (preparado internamente, sin datos reales)
  rubric.md                criterios de evaluación humana
  run.ts                   ejecuta el pipeline (proveedor real o mock) y puntúa
  results/                 resultados por fecha + versión de prompt + modelo (gitignored)
```

`case.yaml` define `must` (p. ej. "conserva los 4 ejercicios de fracciones", "ninguna instrucción > 12 palabras"), `must_not` (p. ej. "no añade pictogramas", "no cambia el objetivo") y `expected_characteristics`. Se puntúa con comprobaciones deterministas + un juez IA con rúbrica + evaluación humana periódica (`rubric.md`). Objetivo: 30 casos en la Fase 4 (Primaria/ESO/Bachillerato × matemáticas, lengua, ciencias, sociales e inglés × las necesidades del catálogo, incluidas combinaciones), 100+ después. Ejecutar evals con proveedores reales cuesta dinero: siempre con un presupuesto aprobado.
