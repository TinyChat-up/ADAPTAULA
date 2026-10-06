# Prompts

## Convenciones

- Ubicación: `prompts/<key>/v<N>.ts` (módulo TypeScript: se importa sin leer ficheros en tiempo de ejecución, lo que es fiable en Vercel). Exporta `key`, `version`, `schemaVersion`, el `system` prompt y el constructor del mensaje de usuario. El alias `@prompts/*` apunta a esa carpeta.
- **Inmutables**: una versión publicada no se edita nunca. Para cambiar algo se crea `v<N+1>`, se pasa por evals y se activa desde `/admin/prompts`.
- La versión activa de cada clave está en `src/lib/ai/prompts.ts` (`ACTIVE_PROMPT_VERSIONS`). El registro en `prompt_versions` y su activación desde `/admin/prompts` llegan con el panel de administración (fase 7); hasta entonces el código es la fuente de verdad.
- `ai_runs` guarda `prompt_key` + `prompt_version`, para atribuir calidad y coste a cada versión.
- El system prompt es **estático** (cacheable). Todo lo variable va en el mensaje de usuario, dentro de etiquetas XML (`<material_analysis>`, `<learner_profile>`…).
- La salida siempre es JSON validado con salidas estructuradas + Zod. Nunca HTML, CSS ni Markdown libre.
- Los datos que entran en los prompts son datos, no instrucciones: el contenido del material subido se envuelve en etiquetas y el system prompt indica que cualquier instrucción dentro del material es contenido a adaptar, no una orden (defensa frente a inyección de prompts).
- Estilo: instrucciones claras y con su motivo, sin MAYÚSCULAS enfáticas ni amenazas; ejemplos solo cuando aporten. Las reglas pedagógicas de los presets (`docs/PRODUCT.md`) se incluyen en el planificador como conocimiento de referencia, recordando siempre que se adapta por dimensiones funcionales.

## Catálogo

| key | Paso | Salida | Alias por defecto |
|---|---|---|---|
| `material_analyzer` | B | `MaterialAnalysis` | ECONOMY / STANDARD |
| `adaptation_planner` | C | `DraftAdaptationPlan` → `AdaptationPlan` v1 | STANDARD |
| `material_generator` | D | `GeneratedSegments` (bloques de `MaterialDocument` v1 solo para lo que cambia + `change_summary`) | STANDARD |
| `pedagogical_reviewer` | E | `AiReviewDraft` (solo comprobaciones no deterministas de `PedagogicalReview` v1) | STANDARD |
| `block_reviser` | edición | `Block` | STANDARD · low |
| `image_brief` | imágenes | `ImageBrief` | STANDARD · low |

## Diseño de cada prompt (v1)

### material_analyzer_v1 (implementado, `prompts/material-analyzer/v1.ts`)
Rol: especialista en análisis de materiales educativos. Debe **comprender el material sin modificarlo**: no lo adapta, simplifica, reescribe ni mejora.
- Describe estructura, instrucciones, actividades, textos, imágenes, tablas, gráficos, fórmulas, objetivos, dificultad, conocimientos previos y respuestas esperables cuando se infieren con confianza.
- Distingue contenido pedagógico esencial de elementos decorativos y marca los **elementos protegidos** que una adaptación posterior no debe destruir.
- Lo que no puede determinar se expresa con `confidence` baja o una **incertidumbre**; no inventa texto ilegible ni respuestas, y no atribuye diagnósticos ni necesidades al alumnado.
- **Material no confiable:** el fichero llega entre `<untrusted_material>` y `</untrusted_material>`; el system prompt establece que todo lo que contiene es dato a analizar, no instrucciones. Una frase dirigida a la IA dentro del material se registra como incertidumbre `embedded_instructions` y no se obedece. Las instrucciones reales van **después** del material.
- Salida: `MaterialAnalysisDraftSchema` (plano, sin campos opcionales ni nulos: desconocido = `""`, `"unknown"` o `0`). El servidor asigna los ids y produce el `MaterialAnalysis` almacenado (esquema v2, que hoy se lee como v3).

### material_analyzer_v2 (implementado, sin validar con el modelo real; `prompts/material-analyzer/v2.ts`)
Versión nueva (hoy ya no es la activa: lo es v3; se elige con `AI_ANALYSIS_PROMPT_VERSION=2` o `--prompt-version 2` en los evals). Conserva **literalmente** el prompt base del producto y la sección de material no confiable de v1; solo cambia «Cómo rellenar el esquema». Pide únicamente lo que solo el modelo puede saber:
- **No pide** recuentos, relaciones inversas, ids definitivos ni indicadores derivados (`has_answer_space`, `necessary_to_solve`…): los calcula el servidor.
- **Cada relación se escribe una sola vez**, en el elemento que depende de otro (la actividad lista sus recursos —textos y visuales— y objetivos; un elemento protegido o una incertidumbre listan sus destinos).
- **Cada cosa en un solo sitio:** una tabla es *un* visual con sus datos en `table`; un gráfico es *un* visual con categorías, series y unidad en `chart`; los campos de nombre/fecha van en `admin`; las líneas de respuesta son `answer_area` de la actividad, no visuales.
- `instruction` (lo que el alumno debe hacer) y `context` (solo lo necesario que no esté ya en un recurso y no repita la instrucción).
- **Elementos protegidos tipados y con importancia** (`essential`/`important`/`optional`), incluidas siempre las restricciones explícitas de la consigna (extensión, número de datos, tipo de razonamiento, unidades, formato). Nunca se protege una respuesta esperada.
- Una respuesta `inferred` solo con total seguridad; si la actividad es abierta o dudosa, se omite `answer`.
- Salida: `MaterialAnalysisDraftSchema` v3 (compacto, con campos opcionales; ver `docs/AI_PIPELINE.md`). Los ejemplos del prompt son genéricos, no tomados de ninguna ficha concreta.

### material_analyzer_v3 (implementado, sin validar con el modelo real; `prompts/material-analyzer/v3.ts`)
Misma salida y mismo esquema (`MaterialAnalysis` v3, sin v4) que v2. **Versión nueva porque v2 ya produjo un run real y una versión publicada no se edita** (los SHA-256 de v1 y v2 están fijados en `tests/unit/analysis-robustness.test.ts`). Solo cambia «Cómo rellenar el esquema», a raíz de los fallos del run real de v2:
- Las **condiciones que definen el problema** («sin reducir…», «exclusivamente…», mínimos y máximos, qué mantener o suponer) se protegen como `reasoning_constraint`/`response_constraint`; sin tipo nuevo ni frases fijas.
- **`importance` con criterio** (`essential` = alterar el objetivo, la respuesta, la dificultad evaluada o las condiciones; `important` = fidelidad y contexto; `optional`), con «no marques todo como essential».
- **Títulos, series, ejes, leyendas y unidades solo si figuran en el material**; si no, vacíos.
- `instruction` frente a `reading_text`: una introducción informativa no es una instrucción por preceder a una actividad.
El bloque system + esquema crece +4,5 % frente a v2 (≈ +264 tokens), por debajo de v1. **Es la versión activa por defecto** (`AI_ANALYSIS_PROMPT_VERSION=3`, validada con dos llamadas reales: Bachillerato y Geografía); v1 y v2 siguen disponibles e inmutables para trazabilidad. La caché de análisis incluye la versión del prompt, así que los materiales ya analizados con otra versión se conservan y no se reanalizan solos.

**`importance` (decisión):** el 75 % de `essential` es solo una señal blanda de los evals. Nada lo normaliza ni degrada automáticamente `essential` → `important` para cumplir una proporción: la corrección pedagógica pesa más que la distribución estadística.

De los tres prompts de la Fase 4 están publicados `adaptation_planner@v1` y `material_generator@v1` (inmutable; su SHA-256 está fijado en `tests/unit/adaptation-planner.test.ts` y su tabla de estrategias se contrasta con el código). `pedagogical_reviewer` sigue pendiente; su diseño de entrada y salida está fijado por los contratos de `docs/ADAPTATION.md`. ECONOMY no es el alias por defecto de ninguno: se descartó para el análisis por degradaciones materiales y no se asume suficiente aquí sin evals.

### adaptation_planner_v1 (publicado; `prompts/adaptation-planner/v1.ts`, `src/lib/adaptation/planner.ts`)
Rol: especialista en educación inclusiva y diseño de materiales. Recibe el `AdaptationContext` (solo necesidades aplicables, presentación ya resuelta, registro por edad, hechos de la ficha y conflictos con su resolución) y el material **sin respuestas inferidas** (`modelFacingAnalysis`), siempre como contenido no confiable. **No genera la ficha: decide.** Devuelve decisiones compactas por id; sin razonamientos largos.
El contrato viaja como JSON Schema en el *system* (`output.delivery = "prompted"`, una sola llamada facturada, sin sonda nativa); el prompt (≈ 4,7k caracteres) solo dice lo que un esquema no puede: prioridades, elementos protegidos, prohibición de respuestas y la tabla estrategia → acciones. Entrada: contexto + material (`<untrusted_material>`, con `<` y `>` escapados). Reglas: preservar el objetivo salvo adaptación `curricular` confirmada; cada cambio con una necesidad funcional del contexto; declarar en `preserves` los elementos protegidos de cada destino que modifica; no infantilizar ni reducir la demanda cognitiva cuando la dificultad no es lo evaluado; apoyos solo con finalidad; ejemplos siempre análogos (`uses_task_data: false`); seguir la resolución de cada conflicto. Las invariantes deterministas bloquean lo que no cumpla; una reparación como máximo.

### material_generator_v1 (publicado; `prompts/material-generator/v1.ts`, `src/lib/adaptation/generator.ts`)
Rol: redactor de materiales educativos accesibles que **ejecuta** decisiones ya aprobadas (no las toma). Recibe `<approved_decisions>` (decisiones efectivas con sus restricciones y apoyos autorizados) y `<untrusted_material>` (contenido original de cada destino y elementos protegidos). Escribe **solo** los bloques de los destinos que esas decisiones cambian o acompañan, de los tipos que cada decisión autoriza; lo conservado lo copia el servidor. Si no puede ejecutar una decisión sin romper una regla, la devuelve en `blocked` con un motivo. Salida: `DraftGeneratedSegments` (esquema en el *system*, una sola llamada). Lenguaje natural y accionable, aspecto maduro según la edad, sin relleno; conservar números, unidades, citas «…» y condiciones de la consigna; nunca escribir la respuesta de una tarea (los formatos cerrados nuevos llevan su clave aparte en `new_item_answers`); imágenes solo como petición (`requested`), nunca inventadas; nombres de serie de gráficos nunca como hechos. Devuelve también `change_summary`.

### adaptation_planner_v2 (publicado, no activo; `prompts/adaptation-planner/v2.ts`)
Versión nueva con su propio borrador (`DraftAdaptationPlan v2`, plan canónico `AdaptationPlan v1`); v1 permanece disponible e inmutable. Cambios: necesidades citadas por referencia local (`need_refs`), sin catálogo de dimensiones; listas vacías omitibles; sin `keep`; principio general «apoyo ejecutivo no es procedimiento académico»; decidir es opcional; consignas breves no se tocan sin barrera concreta; `uses_task_data` solo como metadato. Se valida con la política 2 del contexto. Ver `docs/ADAPTATION.md`.

### pedagogical_reviewer_v1 (publicado, no activo; `prompts/pedagogical-reviewer/v1.ts`, `src/lib/adaptation/reviewer.ts`)
Rol: revisor pedagógico independiente que **observa y evalúa, nunca corrige**. Recibe un contexto mínimo y determinista (`PedagogicalReviewContext`: texto visible, necesidades activas, decisiones aplicadas/rechazadas/diferidas, protegidos en juicio y, solo para la pregunta semántica abierta, las respuestas inferred como `internal_reference_only`). Devuelve `ReviewerFindings` (estricto): por hallazgo `check_key`, `target_ids`, `verdict`, `reason` (≤160) y `requires_human_review` opcional, solo sobre `answers_not_leaked` (incluidas pistas indirectas), `age_appropriate`, `no_infantilization` y `functional_supports_applied` (incluida la redundancia semántica). No puede contradecir una comprobación determinista ni cerrar un WARN estructural: la fusión la hace el servidor. Ver `docs/ADAPTATION.md`.

### material_generator_v2 (publicado, no activo; `prompts/material-generator/v2.ts`)
Versión nueva con su propio contrato de salida (`DraftGeneratedSegments v2`); v1 permanece disponible e inmutable. Mismo rol (ejecuta decisiones aprobadas, no las toma) con la **fuente canónica**: el sistema conserva la consigna y sus requisitos y el modelo solo escribe lo que las decisiones añaden, una vez y con una función distinta cada pieza; una consigna breve se conserva (`instruction_policy: "keep"`), los apoyos tienen un presupuesto de palabras y un apoyo que solo repetiría algo visible se declina en `skipped`. Ver `docs/ADAPTATION.md`.

### block_reviser_v1
Modifica **únicamente** el bloque indicado según la petición del docente ("Pon un ejemplo antes", "Reduce las alternativas de 4 a 3"), respetando los objetivos protegidos y el perfil. Devuelve un bloque válido con el mismo `id` y el mismo tipo, salvo que la petición exija otro tipo compatible.

### image_brief_v1
Crea un `ImageBrief`, no una imagen. La imagen debe ser clara, con solo los elementos necesarios, sin decoración inútil ni fondos complejos, adecuada a la edad y de composición inequívoca; sin texto salvo que sea imprescindible; sin estereotipos y con diversidad natural. Secundaria: estética informativa y madura. Primaria: puede ser más ilustrativa.
