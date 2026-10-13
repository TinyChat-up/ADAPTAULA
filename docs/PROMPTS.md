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
| `image_brief` | magia · ilustraciones | Especificación pedagógica de una ilustración (`illustration_brief`), validada por el servidor | STANDARD |
| `image_render` | magia · ilustraciones | Plantilla (no es una llamada a un modelo de texto): el prompt del modelo de imagen, construido desde el brief validado | IMAGE_QUALITY |
| `image_review` | magia · ilustraciones | Revisión por visión de la ilustración contra su brief (`illustration_review`); acepta el servidor | STANDARD |
| `visual_locator` | 8.2B.1 | Hipótesis de rectángulos (`visual_locations`) | STANDARD |
| `visual_support` | magia | Apoyo nuevo: pasos o tarjetas (`visual_support`) | STANDARD |
| `visual_rewriter` | magia | Actividad sin el visual que falta (`visual_free_activity`) | STANDARD |
| `visual_substitute` | magia | Actividad equivalente que sustituye a la que dependía de un visual perdido, con su figura como datos (`visual_substitute_activity`); se registra con el propósito `visual_rewrite` | STANDARD |

## Diseño de cada prompt (v1)

### visual_substitute_v2 (activo salvo para selección única; validado con mocks)

`prompts/visual-substitute/v2.ts` conserva la salida Zod de v1 y añade formato de respuesta original y códigos de rechazo del servidor. Lo activa la importación en `src/lib/materials/visuals/auto/assistants.ts`; este asistente no usa `ACTIVE_PROMPT_VERSIONS`. `ai_runs` registra `visual_substitute`, versión 2, con propósito `visual_rewrite`.

El material, objetivo, descripción y etapa se serializan como JSON dentro de `<untrusted_material>`, escapando los delimitadores. `<validation_feedback>` solo contiene códigos permitidos y deduplicados: nunca la propuesta rechazada ni valores de respuestas. La política permite hasta dos intentos por actividad/ejecución, con feedback solo tras una propuesta inválida; mantiene los reintentos técnicos del job. El contrato no representa opciones, parejas, ordenación o huecos: no debe convertirlos en escritura libre. Pruebas de límites, transporte y orquestación offline; calidad con IA real pendiente.

### visual_substitute_v3 (selección única; Fase 8.2B.4, validado con mocks)

`prompts/visual-substitute/v3.ts` se activa cuando `responseFormat=select_option` y no se suministra una tabla corroborada (con tabla se usa v4). Mantiene el propósito `visual_rewrite`, clave `visual_substitute`, versión 3 en `ai_runs`. v1/v2 permanecen inmutables. Añade `choice` con opciones, ids y `multiple=false`; `lines=0`, `steps=[]`. El objeto de figura es estricto: no admite rótulos, soluciones ni otros campos que el renderer no represente.

Recibe la consigna sin duplicar alternativas, objetivo, descripción visual, opciones originales, etapa y dimensiones funcionales; **no** `expected_answer`, clave ni datos identificativos. Todo campo variable se serializa en JSON escapado dentro de `<untrusted_material>`. El segundo intento recibe solo códigos permitidos (p. ej. `choice_options_changed`, `choice_correct_count`, `choice_answer_changed`, `choice_demand_changed`) sin revelar letras/valores de la solución.

La salida no constituye evidencia de corrección: el servidor comprueba literalidad, tipo, geometría, dificultad y una única respuesta numérica coincidente con la clave original. Alcance actual: lectura de fracciones coloreadas en barras/círculos, con listas A)…H) y consignas reconocidas; `feasible=false` si no puede proponer una figura equivalente. Los otros formatos siguen usando v2. Pendiente validar eficacia con IA real; no se han hecho llamadas pagadas.

### visual_substitute_v4 (selección sobre tabla; Fase 8.2B.5, validado con mocks)

`prompts/visual-substitute/v4.ts` se activa para `select_option` con tabla corroborada por el servidor. Conserva propósito `visual_rewrite` y clave `visual_substitute`; registra versión 4. Las versiones anteriores son inmutables. Extiende el contrato estricto de v3 con `table` tomado del esquema tabular de `MaterialAnalysis`, sin añadir contratos de documento ni migraciones.

Recibe consigna, objetivo, alternativas, etapa, necesidades funcionales y tabla completa entre delimitadores escapados de material no confiable. No recibe clave ni descripción visual. Debe copiar la tabla, enunciado y opciones; `figure=null`, `steps=[]`, `lines=0`, `multiple=false`. No puede marcar una opción, añadir metadatos de respuesta ni eliminar la necesidad de consultar la tabla. El segundo intento recibe solo códigos permitidos (`table_data_changed`, `table_reference_unverifiable`, etc.), sin valores de la solución.

El servidor valida por separado fuente, tabla literal y relación entre fila/columna/opciones contra la clave original. Alcance en ADR-023, no selección genérica. Calidad del prompt con IA real y despliegue en Vercel pendientes; todas las llamadas de esta fase son simuladas.

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

### visual_locator_v1 (publicado; `prompts/visual-locator/v1.ts`, `src/lib/materials/visuals/auto/vision.ts`)
Localiza en la imagen de una página las figuras que el análisis ya identificó: un rectángulo normalizado y una confianza por
figura, o `found=false`. Las descripciones van en `<untrusted_material>`. El servidor solo acepta un rectángulo que coincide con una
región encontrada por su propia geometría.

### block_reviser_v1
Modifica **únicamente** el bloque indicado según la petición del docente ("Pon un ejemplo antes", "Reduce las alternativas de 4 a 3"), respetando los objetivos protegidos y el perfil. Devuelve un bloque válido con el mismo `id` y el mismo tipo, salvo que la petición exija otro tipo compatible.

### image_brief_v1 (publicado con la migración 024; `prompts/image-brief/v1.ts`)
Crea la especificación pedagógica de UNA ilustración, no la imagen.
- **Recibe:** la actividad, su objetivo, la descripción del visual que falta, etapa, curso y asignatura, y los nombres de los apoyos
  funcionales de la ficha. El material va como JSON escapado dentro de `<untrusted_material>`.
- **Devuelve:** `feasible`, tipo, concepto, propósito, elementos imprescindibles (cada uno con un marcador numérico o una
  etiqueta), elementos prohibidos, composición, nivel de detalle, restricciones conceptuales y texto alternativo.
- **Reglas:**
  - los marcadores que nombra la actividad van sin el nombre del elemento;
  - ninguna etiqueta da la respuesta;
  - estilo sobrio en ESO y Bachillerato; claro sin infantilizar en Primaria;
  - `feasible: false` si la actividad depende de datos exactos, un mapa real o una persona o lugar concretos.
- **El servidor lo valida** (`validateBrief`) antes de pagar ninguna imagen. Ver `docs/VISUAL_RESOURCES.md` § Ilustraciones
  generadas.

### image_render_v1 (publicado con la migración 024; `prompts/image-render/v1.ts`)
Plantilla determinista, no un modelo. Construye el prompt del modelo de imagen a partir del brief validado:
- estilo fijo de ficha impresa CLARO: dibujo vectorial plano, contornos negros, fondo blanco liso, rellenos en grises claros
  (imprimible en blanco y negro), sin degradados, sombras, personajes ni decoración;
- la edad de la etapa y el nivel de detalle;
- los marcadores sin nombres;
- «no escribas ningún texto, número ni letra» cuando no hay marcadores ni etiquetas;
- los elementos prohibidos;
- en el segundo intento, las correcciones que dio la revisión.

El estilo es nuestro, no del modelo, y su versión entra en la huella del brief (idempotencia).

### image_review_v1 (publicado con la migración 024; `prompts/image-review/v1.ts`)
Revisor exigente por visión. Recibe la imagen y, como JSON escapado dentro de `<untrusted_material>`, el brief y la actividad.
- **Por cada elemento imprescindible:** si está, si su marcador es correcto y si su etiqueta es correcta.
- **Además:** elementos prohibidos presentes, errores conceptuales, texto añadido o ilegible, respuesta revelada, edad, si es
  imprimible y si sirve para la actividad, y un veredicto.
- **Su respuesta es solo evidencia:** acepta el servidor (`acceptReview`) y cada problema se convierte en una corrección para el
  segundo intento.
