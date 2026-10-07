# Adaptación — núcleo pedagógico (Fase 4)

Cómo pasamos de `MaterialAnalysis v3 + FunctionalProfile` a `AdaptationPlan → MaterialDocument → PedagogicalReview` sin cambiar por accidente lo que el docente quiere enseñar o evaluar. Estado: **base arquitectónica offline implementada** (contratos, reglas deterministas, mocks, evals y tests). No hay todavía prompts ni llamadas reales para planificar, generar o revisar.

Código: `src/lib/adaptation/` (lógica) y `src/lib/schemas/{adaptation-context,adaptation-plan,material-document,pedagogical-review}.ts` (contratos). Decisión de arquitectura: ADR-020 en `docs/ARCHITECTURE.md`.

## Principios

1. **La unidad de adaptación es funcional, no diagnóstica.** La entrada son las dimensiones del perfil; un diagnóstico no existe en el esquema y nunca determina una transformación. Ninguna estrategia se llama como un diagnóstico (lo comprueba un test).
2. **Adaptar no es simplificar.** Cada elemento del material se clasifica: se conserva, se transforma, se acompaña de un apoyo, se elimina o necesita revisión docente.
3. **Primero el plan, después la ficha.** El plan describe la transformación; no contiene la ficha.
4. **Lo que se puede comprobar sin IA, se comprueba sin IA.** El modelo propone; las invariantes deterministas deciden qué se puede aplicar.
5. **Lo que se conserva se copia, no se reescribe.** Textos fuente, tablas y datos de gráficos pasan del análisis al documento sin modelo.

## Arquitectura lógica

```
A  contexto (determinista)        buildAdaptationContext       → AdaptationContext v1
B  planificador (IA, STANDARD)    AdaptationPlanner            → DraftAdaptationPlan
C  validador del plan (det.)      normalizePlan + validatePlan → AdaptationPlan v1 + PlanValidation
                                  (1 reparación con los avisos bloqueantes; lo que siga bloqueado se descarta)
D  generador (IA)                 MaterialGenerator            → GeneratedSegments (solo destinos que cambian)
E  ensamblado + integridad (det.) buildDocument + checks       → MaterialDocument v1
F  revisor (IA, solo juicio)      PedagogicalReviewer          → AiReviewDraft → PedagogicalReview v1
G  renderizador (Fase 5)          sin IA
```

`runAdaptation` (`pipeline.ts`) implementa la secuencia con las interfaces de `services.ts`. Hoy funciona con los mocks deterministas (`mock.ts`). Nunca hay una llamada que analice, adapte, revise e imprima a la vez.

**Por qué el generador no escribe la ficha entera:** el documento se construye a partir del análisis (`document.ts`): todo lo que el plan conserva se copia literal (textos, tablas, datos de gráficos, áreas de respuesta, campos administrativos). El generador solo escribe los bloques de los destinos que una decisión transforma o acompaña. Hay menos salida (coste), menos riesgo de deriva y la fidelidad del original queda garantizada por construcción.

**Qué ve cada modelo** (`model-input.ts`): el planificador y el generador reciben el material **sin respuestas inferidas** y con los nombres de serie de los gráficos vaciados. Solo el revisor recibe las respuestas inferidas, para comprobar que la tarea sigue siendo resoluble (`solvabilityInputs`). Ningún modelo recibe el alias del alumno ni ningún identificador.

## AdaptationContext v1

Derivado en TypeScript; misma entrada → mismo contexto y misma huella (`contextFingerprint`, SHA-256 de JSON con claves ordenadas). Contiene:

- `needs`: solo dimensiones activas **y aplicables** a esta ficha, de mayor a menor apoyo, con `intensity` y hasta 3 estrategias. Las de presentación (letra, interlineado, contraste, espaciado, color, texto alternativo, lector de pantalla) no van al planificador: se convierten en `presentation`. Las de audio no aplican a un PDF; las matemáticas, solo si la ficha tiene matemáticas; las de escritura, solo si hay respuestas. Lo descartado se devuelve aparte (`omitted`) para auditoría, no viaja al modelo.
- `presentation`: ajustes semánticos (escala de letra, interlineado, espaciado, contraste, decoración, tareas por página, independencia del color, alternativas textuales). Secundaria: decoración `reduced` por defecto.
- `audience`: franja de edad, registro (`child`/`adolescent`/`young_adult`) y `infantilization_guard` (ESO y Bachillerato).
- `material`: hechos de la ficha que condicionan el plan (textos fuente literales, actividades que evalúan la escritura, visuales necesarios y decorativos, destinos dudosos).
- `conflicts`: conflictos detectados con su resolución.
- `limits`, `allowances` y la petición del docente saneada (sin `<>`, máx. 500).

No contiene: nombre ni alias, ids, diagnósticos, datos médicos ni nada que no cambie esta adaptación.

## AdaptationPlan v1

Una lista de **decisiones** compactas; lo no mencionado se conserva (`keep` por defecto).

| Campo | Para qué |
|---|---|
| `id` (`dec_N`, servidor) | Trazabilidad y corrección. |
| `target` | Id del análisis (`act_N`, `ctt_N`, `vis_N`, `sec_N`) o `document`. Nunca texto. |
| `action` | `keep` · `rephrase` · `segment` · `reorganize` · `add_support` · `change_response_format` · `reduce` · `remove` · `extend`. |
| `strategies` (≤3) | De la taxonomía. La acción debe poder realizarse con ellas. |
| `dimensions` (≤4) | Necesidades del contexto que lo justifican. Un cambio sin dimensión activa se bloquea. |
| `intensity` | `light` · `moderate` · `substantial`: cuánto cambia el destino (nunca describe al alumno). |
| `preserves` | Elementos protegidos que la decisión debe mantener intactos. |
| `supports` | Apoyos añadidos (`kind` + `uses_task_data`). |
| `response_target` | Nueva forma de responder, si cambia. |
| `visual` | Petición de ayuda visual futura (ver abajo). |
| `flags`, `note` | Riesgos que ve el planificador (no aclaran nada por sí solos) y una nota breve para el docente. |

El plan guarda la huella del análisis y del contexto: si se reanaliza el material o cambia el perfil, `planMatches` deja de ser cierto. Sin razonamientos largos: las decisiones son datos.

## Estrategias

20 estrategias componibles (`strategies.ts`), cada una con las acciones que puede realizar y sus riesgos:

lenguaje (`language_simplification`) · longitud y segmentación (`text_segmentation`) · carga visual (`visual_load_reduction`) · organización espacial · instrucciones explícitas · pasos y secuenciación · apoyos de comprensión · ejemplo resuelto análogo · activación de conocimientos previos · foco de atención · memoria de trabajo · planificación · elección de respuesta · formato de respuesta · menos escritura · apoyo visual · vocabulario · tiempo y esfuerzo · autorregulación · ampliación y reto.

`DIMENSION_STRATEGIES` asigna a cada una de las **69 dimensiones** del catálogo sus estrategias (`Record<DimensionKey, …>`: olvidar una es un error de compilación). Intensidad por defecto: apoyo `low/medium/high` → `light/moderate/substantial`, por decisión.

## Invariantes pedagógicas (deterministas)

`invariants.ts › validatePlan`. `block` = no se aplica; `review` = se aplica y lo ve el docente.

| Regla | Severidad |
|---|---|
| Destino, elemento protegido o visual inexistente | block |
| Cambio sin dimensión activa del contexto o sin estrategia | block |
| Decisión que modifica un destino sin declarar sus elementos protegidos esenciales (importantes: review) | block |
| Eliminar una actividad (adaptación curricular: review) / un objetivo se queda sin actividades | block |
| Eliminar o reducir un recurso necesario o un visual `required` | block |
| Sustituir un visual necesario por una representación nueva (transformarlo: review) | block |
| Reescribir, resumir o eliminar un texto fuente literal (segmentarlo y glosarlo sí) | block |
| Reducir o sustituir la escritura donde la escritura es lo evaluado | block |
| Convertir una operación evaluada en reconocer un resultado | block |
| Ejemplo resuelto con los datos de la tarea | block |
| Tarea abierta convertida en cerrada · cambio de extensión pedida · cambio sustancial sobre operación/razonamiento esencial · pasos o preguntas sobre datos de la tarea · destino dudoso · conflicto entre necesidades · decisiones contradictorias | review |

Hechos que usan (`facts.ts`): `evaluatesWriting` (tarea de escritura, requisito de extensión con cantidad, u objetivo de producción escrita; «con tus palabras» no es extensión), `evaluatesOperation`, `isOpenActivity`, `isLiteralSourceText` (texto de lectura que es objeto de estudio: asignatura de lengua/literatura o preguntas sobre párrafos, conectores, registro, tesis…), `materialNumbers`, `quotedReferences` («…»). La deuda tolerada del análisis (series inferidas, títulos de sección no literales, protegidos redundantes) nunca se usa como hecho.

Ejemplos: en fracciones se puede reducir texto accesorio, segmentar o añadir apoyo visual; no se puede sustituir el cálculo por reconocer una respuesta (`target_operation_replaced`). En argumentación se puede dar estructura, conectores o una lista de comprobación; no escribir los argumentos (el revisor IA lo vigila y `answers_not_leaked` atrapa lo determinista).

## Conflictos entre necesidades

Jerarquía (`conflicts.ts`): **1. integridad pedagógica** (lo que se enseña y evalúa) · **2. fidelidad del contenido** (nada falso, inventado ni revelado) · **3. necesidad funcional** (el apoyo más fuerte primero) · **4. preferencia de presentación**. La resolución no es «una necesidad pierde», sino cómo cumplirla sin romper el nivel superior:

| Conflicto | Nivel | Resolución |
|---|---|---|
| Reducir texto vs texto fuente que se analiza | 1 | Segmentar, glosar, ideas clave al margen; nunca resumir. |
| Añadir apoyos visuales vs reducir carga visual | 3 | Solo apoyos con función, uno por actividad como máximo, sin decoración. |
| Ejemplos resueltos vs no revelar la respuesta | 2 | Ejemplos con datos distintos; nunca la tarea resuelta. |
| Menos escritura vs escritura evaluada | 1 | Mantener la producción y su extensión; planificador, conectores, teclado si está permitido. |
| Segmentar vs producción integrada | 1 | Secuenciar el proceso; el producto final sigue siendo uno. |
| Respuesta por selección vs razonamiento abierto | 1 | Otra vía (oral, teclado, esquema), no opciones cerradas. |
| Apoyo a la inferencia vs inferencia evaluada | 1 | Preguntas intermedias sin dar la conclusión. |

## MaterialDocument v1

Representación semántica renderizable con cualquier plantilla, sin HTML, CSS ni coordenadas. Sustituye al borrador de la Fase 0 (nunca producido ni persistido). `meta`, `presentation` (semántica), `admin_fields` (solo etiquetas), `pages` lógicas con bloques y `answer_key`.

Bloques: `heading`, `paragraph`, `reading_text` (con `literal` y etiquetas de segmento), `instruction`, `activity` (consigna, pasos, requisitos visibles, recursos y `response`: líneas, recuadro, cuadrícula, celdas, elección, huecos, relacionar, ordenar, verdadero/falso, vía alternativa, ninguna), `list`, `table`, `chart` (series con `label: null` salvo verificadas), `image` (visual original o petición futura), `help_box`, `checklist`, `vocabulary`, `worked_example` (siempre análogo), `sentence_starters`, `planner`, `math`.

**El alumno nunca ve una solución:** los bloques no tienen campos de respuesta; las opciones correctas de los formatos cerrados nuevos van a `answer_key` (`new_item`), y las respuestas que figuran en la ficha original (`source`) también. Las inferidas no entran nunca, ni en la clave.

## Trazabilidad

`original (act/ctt/vis…) → decisión (dec_N) → bloque (blk_…)`. Cada bloque lleva `trace.origin` (`original`, `adapted`, `support`, `extension`, `structure`), `source_refs` y `decision_ids`; un bloque escrito para un destino remite a él aunque el generador lo olvide. Las identidades son ids (servidor) y huellas de contenido, nunca texto. Sirve para auditar, regenerar solo lo afectado, comparar con el original, corregir y revisar.

## PedagogicalReview v1

13 comprobaciones con `PASS/WARN/FAIL/SKIPPED`, destinos y una línea de detalle. Deterministas: `objectives_preserved`, `protected_elements_preserved`, `answers_not_leaked`, `required_data_preserved`, `instructions_complete`, `constraints_preserved`, `response_format_appropriate`, `visual_load_reasonable`, `reading_load_reasonable`, `traceability_complete`. Híbridas: `functional_supports_applied`, `no_infantilization`. IA: `age_appropriate`. El revisor IA solo responde las no deterministas y nunca suaviza un FAIL determinista. Veredicto: FAIL en una comprobación bloqueante (objetivos, protegidos, respuestas, datos, restricciones) → `blocked`; otro FAIL → `needs_revision`; WARN → `approved_with_warnings`. `blocks_to_revise` lista solo los bloques afectados.

Detalles que importan: solo se exige lo que dice la consigna original (el valor protegido es una paráfrasis del analizador: se usa la intersección de tokens); las condiciones con cuantificador de la consigna («al menos», «como máximo», «exclusivamente», «sin reducir», «no basta») se exigen aunque el análisis no las protegiera; los números y las citas «…» de la consigna deben sobrevivir; una respuesta se detecta por números que no figuran en el material (también escritos de otra forma: `7.100`/`7100`, `15,7`/`15.7`) y por fracciones.

## Edad y no infantilización

`stage-rules.ts`. La accesibilidad cognitiva y la edad cronológica son ejes distintos: un perfil con mucho apoyo en ESO recibe frases cortas, no una ficha infantil. ESO/Bachillerato: registro adolescente/joven, decoración reducida, sin ilustraciones infantiles (solo esquema, gráfico, icono o foto en ESO; esquema, gráfico o foto en Bachillerato), sin diminutivos ni elogios condescendientes ni emojis (FAIL); en Primaria, aviso.

## Ayudas visuales (diseño, sin implementar)

Una decisión puede pedir `visual: { mode, source_visual, purpose, essential }` con `mode` = `reuse_original` (el visual tal cual), `transform_original` (mismos datos, otra forma: review si es necesario), `new_representation` (algo nuevo; bloqueado si sustituye un visual necesario) u `optional_support`. Solo si aporta una función; más imágenes no es mejor adaptación. En el documento se convierte en `image` con `source.kind = "requested"` y estilo permitido por la etapa; `ImageBrief` es el contrato que esa petición alimentará.

## Persistencia propuesta (sin migración ahora)

Las tablas de la migración 004 ya cubren lo necesario:

| Qué | Dónde | Notas |
|---|---|---|
| Petición, tipo, perfil usado | `adaptations` (`adaptation_type`, `learner_profile_id`, `profile_snapshot`) | El snapshot es el `FunctionalProfile` (sin alias). |
| Contexto | `adaptations.strategy` → `{ context, context_fingerprint }` | Regenerable, se guarda para auditar. |
| Plan y validación | `adaptations.plan` → `{ plan, validation, provenance }` | `provenance`: alias, modelo, prompt y esquema por etapa. |
| Documento y revisión | `adaptation_versions.document` / `.review` | Versiones inmutables; `source` = `ai_generated` / `ai_revised` / `teacher_edit`. |
| Coste y uso por etapa | `ai_runs` (`purpose` = plan / generate / review / revise_block) | Ya existe. |
| Versión del análisis | huella en el plan + `materials.analysis_meta` | |

Propuesto para cuando se implemente la generación real (una migración pequeña): `ai_runs.schema_version` y `ai_runs.call_kind`; `adaptation_versions.meta` (versión padre, bloques cambiados, correcciones aplicadas); `materials.analysis_overlay` para las reinterpretaciones docentes de elementos protegidos.

## Corrección docente

`corrections.ts`, contrato `TeacherCorrection`: `block_edit` / `instruction_edit` (nueva versión con un solo bloque cambiado, mismo id, `trace.teacher_edited`), `decision_override` (cambia o descarta una decisión y marca solo sus bloques para regenerar: `blocksOfDecision`), `protected_reinterpretation` (capa sobre el análisis; el análisis guardado no se reescribe) y `review_override` (acepta un aviso conservando el estado original). Nada exige regenerar la ficha entera.

## Coste e instrumentación

`StageRunRecord` amplía el registro de llamadas con esquema, tipo de llamada (`initial`/`repair`/`regeneration`) y tokens de razonamiento cuando el proveedor los separa. `summarizeCost` da coste por etapa y total de la adaptación; el análisis (~$0,05 con STANDARD) se informa aparte porque se amortiza entre adaptaciones del mismo material. Un coste desconocido marca el total como incompleto, nunca como 0. Coste total a medir antes de fijar cuotas: análisis + plan + generación + revisión + imágenes opcionales.

## Primer experimento real del planificador (2026-10-05)

`pnpm eval:adaptation:planner` (`evals/adaptation/planner-run.ts`): una sola llamada de `adaptation_planner@v1` (STANDARD) sobre el `MaterialAnalysis` v3 guardado de la ficha de Geografía y un perfil de funciones ejecutivas hecho solo con dimensiones reales; sin reparación, regeneración ni descarte silencioso; resultados en `evals/adaptation/private/` (ignorado por git). Resultado: JSON y esquema válidos a la primera, 8 decisiones (4 valid · 3 review · 1 blocked), coste $0,0328, 9,6 s, ninguna respuesta inferida filtrada, ningún elemento esencial perdido. El validador bloqueó con razón una decisión que citaba `operation_steps`, una dimensión que el perfil no tiene. Detalle y auditoría decisión por decisión en el informe del encargo.

Para ejecutarlo hace falta el pre-flight (sin llamadas): comprueba que el análisis es v3 y lo produjo `material_analyzer@v3`, que el contexto es determinista, que no hay diagnóstico ni datos personales en lo que se envía y que el peor caso (caché fría, salida máxima) cabe en el presupuesto.

## Revisión humana del plan y generador (`material_generator@v1`)

**Capa de revisión** (`schemas/plan-review.ts`, `adaptation/plan-review.ts`): el docente (o un eval) aprueba, rechaza o edita cada decisión del plan sin tocar el plan bruto. La cadena queda separada: `decisión bruta del planificador → resultado del validador → revisión → decisión efectiva → bloques generados`. Reglas: nada se aplica sin aprobación explícita; una decisión bloqueada por el validador no puede aprobarse (una edición puede arreglarla y se revalida); `target`, `dimensions` y `preserves` no son editables; la revisión lleva la huella del plan bruto y no sirve para otro; las `restrictions` viajan al generador. El pipeline usa `autoReview` (aprueba lo no bloqueado) cuando nadie revisó.

**Generador** (`prompts/material-generator/v1.ts`, `adaptation/generator.ts`, `adaptation/generated.ts`): ejecuta decisiones ya aprobadas, no las toma. Recibe solo las decisiones efectivas, el contenido original de sus destinos y los elementos protegidos que deben conservar (nunca las decisiones rechazadas, el perfil ni las respuestas inferidas). Escribe `DraftGeneratedSegments`: bloques sin ids, traza, zonas de respuesta ni recursos (los pone el servidor). `normalizeGenerated` impone las reglas del plan efectivo sobre cualquier salida: descarta segmentos de decisiones no aplicadas, de destinos distintos o con bloques que ninguna decisión autoriza (`SUPPORT_BLOCKS`: un apoyo eliminado por el docente no puede reaparecer), y registra lo ignorado. Si una decisión no puede ejecutarse sin romper una regla, el modelo la devuelve en `blocked` con un motivo en vez de improvisar. Lo que se conserva (textos, tablas, datos de gráficos, campos administrativos, áreas de respuesta) lo copia `buildDocument`; segmentar un texto fuente es determinista (etiquetas «Parte N»). Auditoría determinista del resultado: `generation-checks.ts`.

## Evidencia congelada del planificador y deuda observada

`evals/adaptation/evidence/planner-v1-geografia.json` congela, sin contenido de la ficha, la huella del prompt y del esquema de `adaptation_planner@v1`, la del plan bruto, la clasificación (4 valid · 3 review · 1 blocked) y las métricas ($0,032838, 9,6 s); un test comprueba que siguen siendo las mismas. No se itera el planificador con una sola ficha. Deuda e hipótesis a evaluar con más ejemplos (no corregidas): (H1) citó una dimensión no activa (`operation_steps`): ¿lo invita el enum de 69 dimensiones?; (H2) `uses_task_data` es autodeclarado y no verificable; (H3) `cognitive_demand_reduced` salta ante cualquier segmentación sustancial (posible falso positivo); (H4) una decisión duplicaba `presentation.max_tasks_per_page`; (H5) algo de sobre-adaptación al seguir mecánicamente el nivel alto de apoyo.

## Primer experimento real del generador (2026-10-05)

`pnpm eval:adaptation:generator` (`evals/adaptation/generator-run.ts`): una sola llamada de `material_generator@v1` (STANDARD) que ejecuta el plan revisado por una persona (aprobadas dec_1, dec_4 con restricciones, dec_6, dec_7; dec_8 editada sin `sentence_starters`; rechazadas dec_2, dec_3 y dec_5) sobre el análisis v3 guardado de Geografía. Sin reparación ni regeneración; resultado en `evals/adaptation/private/`; evidencia congelada en `evals/adaptation/evidence/generator-v1-geografia.json`. Resultado: JSON y esquema válidos, 5 segmentos para 5 decisiones, 11 bloques propuestos y 10 aceptados (uno no autorizado descartado), $0,0331, 12,0 s; ninguna respuesta inferida, ningún protegido esencial perdido, ninguna decisión rechazada aplicada, trazabilidad completa. Observaciones sin corregir (a evaluar con más fichas antes de una v2): G1 un bloque `activity` propuesto para una decisión `add_support`; G2 redundancia (prompt + pasos + requisitos + apoyo repiten lo mismo: ×3-4 palabras); G3 los apoyos de documento van al principio y no hay construcción por actividad («casilla de hecho»); G4 un valor protegido derivado por el analizador llegó al alumno como recordatorio.

## Segunda evidencia real: Bachillerato (2026-10-05)

Mismo pipeline (`adaptation_planner@v1` → revisión humana → `material_generator@v1`, ambos congelados) y mismo perfil de funciones ejecutivas sobre el análisis v3 guardado de Bachillerato (argumentación). Dos llamadas: planner $0,0319 (6 valid · 2 review · 0 blocked) y generador $0,0283 (11 bloques propuestos, 11 aceptados, 0 descartados); total real $0,0602. Sin respuestas inferidas filtradas, sin protegidos esenciales perdidos, texto fuente literal, actividad 5 con su cuestión, extensión y requisitos intactos. Evidencia en `evals/adaptation/evidence/` (`planner-v1-bachillerato.json`, `review-bachillerato.json`, `generator-v1-bachillerato.json`).

Hipótesis contrastadas con ambos materiales: **reproducidas** H4 (una decisión duplica `presentation.max_tasks_per_page`, 2 de 2) y G2 (las actividades transformadas pasan a ×3,3-×7,1 palabras visibles, 8 de 8); **parcial** H5; **no reproducidas** H1, H2, G1, G3, G4; **no aplicable** H3 (su disparador, un protegido esencial de operación o razonamiento, no existe en este material). Observaciones nuevas: el validador determinista no puede evaluar la respuesta inferred de la actividad 3 (es una frase sin números: `answerSignatures` no da firmas y `answers_not_leaked` marca PASS sin poder comprobarla) y el ensamblador coloca los textos de una página antes que sus actividades. Nada se corrige aquí: la recomendación es una v2 del generador centrada en la redundancia y un ajuste de contexto para H4; el planificador v1 no necesita v2.

## Generador v2: fuente canónica, una función por pieza (2026-10-05)

**Por qué:** en los dos experimentos reales con v1 todas las actividades transformadas quedaron entre ×3,3 y ×7,1 de texto visible: el modelo escribía `prompt`, `steps` y `requirements` y los apoyos repetían lo mismo. El origen estaba en el contrato que escribe el modelo, no solo en el prompt. v1 (prompt y esquema) queda congelado e inmutable (sus huellas están en `evidence/` y un test las comprueba); v2 es una versión nueva y **no es la activa** hasta validarse.

**Contrato `DraftGeneratedSegments v2`** (`schemas/generated-segments-v2.ts`):
- sin `prompt` ni `requirements`: la consigna original y sus requisitos son canónicos y los conserva el servidor; el modelo escribe un `rewrite` (`lead` + `steps`) solo si la política dice que la consigna es larga;
- los apoyos se nombran por el tipo que la decisión autoriza (`kind`), cada uno con una función y topes estructurales (pocos elementos, cortos); un apoyo que solo repetiría algo visible se declina en `skipped`;
- ids, traza, zonas de respuesta, recursos y contenido original nunca salen del modelo.

**Funciones sin solape:** `rewrite` = qué hacer · `step_list` = orden del proceso · `checklist` = qué verifica el alumno sobre SU resultado (una comprobación por requisito esencial como máximo) · `planner` = huecos para ideas propias (etiquetas cortas, sin cifras ni frases de la consigna) · `reminder`/`key_idea`/… = solo información que no esté ya visible.

**Proporcionalidad** (`proportion.ts`, parámetros de v2, no reglas de producto): una consigna de hasta 30 palabras (o el límite del perfil) se conserva y no se reescribe; los apoyos de una decisión tienen un presupuesto de palabras (`max(24, 2 × palabras de la consigna)`) que se informa al modelo y se audita sin recortar nada.

**Comprobaciones deterministas** (`generated-v2.ts`, `redundancy.ts`): una reescritura se acepta solo si conserva números, cuantificadores, unidades y citas «…» y no es copia de la original (si no, se conserva la original y queda registrado); los pasos o elementos repetidos literalmente se descartan; las repeticiones casi literales **solo se informan** (no se elimina contenido por similitud léxica); el apoyo no autorizado se descarta. La auditoría mide palabras visibles por actividad y repeticiones.

**Bug encontrado por el A/B offline:** un segmento solo de apoyos para una decisión que «segmenta» sustituía la actividad original; ahora solo sustituye el destino un segmento que lo reescribe. Los controles deterministas (trazabilidad y objetivos) lo detectaron.

## Política del constructor de contexto (H4)

`AdaptationContext` versionaba solo su esquema (`context_version`); el algoritmo no tenía versión, así que cambiarlo habría cambiado huellas en silencio. Ahora hay una **política del constructor**, separada del esquema: la política 1 (por defecto) es la histórica y un contexto construido con ella **no lleva `policy_version`**, por lo que sus bytes y su huella son idénticos a los de antes (los tests fijan las huellas de 11 contextos y las de los dos runs reales). La política 2 (`policy_version: 2`) quita de `needs` las necesidades que la presentación resuelve por completo: `number_of_visible_tasks` cuando hay `max_tasks_per_page` y `unnecessary_decoration` cuando la decoración es «none»; se registran como `resolved_by_presentation`. No hay `AdaptationPlan v2`: un plan se valida contra su propio contexto.

## Respuesta inferida textual

`answers_not_leaked` pasaba (PASS) cuando no podía comprobar nada: una respuesta sin números que la ficha no imprima no deja firma. Ahora «no evaluable» ya no es PASS: es un WARN con `needs_semantic_review: true` (campo opcional, compatible con las revisiones v1) y el check pasa a ser híbrido, de modo que `pedagogical_reviewer` pueda cerrarlo con un PASS (nunca suavizar un hallazgo). Se decide por una regla general (la respuesta lleva o no cifras nuevas), sin palabras clave de ninguna respuesta.

## Orden fuente del documento

El análisis registra para cada elemento su página y su sección, y las secciones están en orden de lectura. El ensamblador ordena ahora por (página, sección, tipo, número de id), sin heurísticas de texto, lo que corrige el caso de Bachillerato (el enunciado de la actividad 5 salía antes de la actividad 4). **Límite documentado:** el análisis no registra el orden entre tipos dentro de una misma sección (un visual que sigue a una actividad de su sección se coloca antes); arreglarlo exige un orden explícito en el contrato del análisis, que está cerrado, o en el renderer futuro.

## A/B real de generator v2 (Bachillerato, 2026-10-05)

Una sola llamada de `material_generator@v2` con exactamente lo mismo que v1: mismo análisis, contexto (política 1), plan bruto, `PlanReview` y las cinco decisiones efectivas. Seguridad intacta (0 fugas, 0 protegidos perdidos, 0 decisiones rechazadas aplicadas, trazabilidad completa, 0 bloques no autorizados, 0 repeticiones literales). Las cuatro actividades transformadas pasan de 74 palabras originales → **327 visibles (v1) a 184 (v2)**, −44 %: act_1 ×7,10 → ×3,5 · act_2 ×3,56 → ×2,0 · act_4 ×3,88 → ×1,94 · act_5 ×4,29 → ×2,71. Coste $0,0226 frente a $0,0283 (−20 %), salida 868 frente a 1.467 tokens, 5,5 s frente a 8,7 s. La redundancia se reduce a la mitad pero **no desaparece** (G2 parcial): act_1 sigue en ×3,5 por dos apoyos aprobados, el modelo no declinó (`skipped`) un recordatorio que solo repetía requisitos y en act_5 el requisito sigue en un paso y en el checklist (la detección de repetición es léxica y no lo ve). Evidencia en `evals/adaptation/evidence/generator-v2-bachillerato.json`.

## Tercera evidencia real: Primaria (2026-10-05) — detenida antes del generador

Se pidió validar `planner v1 → PlanReview → generator v2` sobre la ficha de fracciones de Primaria. **No existía ningún análisis v3 de esa ficha** (el guardado era `material_analyzer@v1` / schema 2 y, elevado a v3 en memoria, perdía los datos de las actividades 2 y 3 y las áreas de respuesta); con autorización se hizo un análisis v3 nuevo ($0,0426). Preflight correcto: 5 actividades, barra y recta como visuales necesarios, inferred en 1-4, política de contexto 1.

El planner ($0,0297, 9,0 s) devolvió un JSON que **no valida** contra `AdaptationPlan v1` (omitió el campo obligatorio `flags` en la primera decisión), así que no hay plan normalizable ni `PlanReview`, y el generador no se ejecutó. Además, el contenido del plan es pedagógicamente inutilizable para esta ficha: lista de pasos en las cinco actividades (con «contar partes» y «localizar la fracción»), un ejemplo resuelto análogo, un recordatorio del significado de los signos, comienzos de frase para una explicación que es producción propia, dos dimensiones matemáticas que el perfil no tiene (`operation_steps`, `scaffolding_level`) y otra vez una decisión que repite `max_tasks_per_page`. Sin respuestas inferred filtradas. Evidencia en `evals/adaptation/evidence/planner-v1-primaria.json`.

Patrones tras tres materiales: **H4 reproducida 3 de 3** (la próxima validación del planner debe usar la política 2 del contexto), **H1 reproducida** en los materiales de matemáticas, **H5 muy marcada** en Primaria y un hueco del validador (`sentence_starters` con `uses_task_data: true`). Sin decidir aún `planner@v2`.

## `adaptation_planner@v2` (2026-10-05) — publicado, no activo

Motivado por la evidencia de tres materiales (H1, H4, H5, P1, P6). `adaptation_planner@v1` queda **congelado**: disponible, inmutable (SHA del prompt y del esquema de borrador fijados en `tests/unit/adaptation-planner-v2.test.ts` contra las tres evidencias `planner-v1-*.json`). El plan **canónico** sigue siendo `AdaptationPlan v1`; el modelo escribe `DraftAdaptationPlan v2` y el servidor lo normaliza (`src/lib/adaptation/plan-v2.ts`).

- **`flags`, `preserves`, `supports` pueden omitirse** (→ `[]`); el esquema v1 **no** se relaja y un valor inválido sigue siendo error. Sin `keep`: no adaptar = no decidir (plan con cero decisiones y una línea en `summary`, válido).
- **`need_refs` en lugar de dimensiones**: el contexto que ve el modelo numera sus necesidades activas (`need_1…`, en el orden del contexto, determinista); el modelo cita referencias, el servidor las resuelve a claves de dimensión. Una referencia inexistente invalida el borrador (`PlanDraftError`); nunca se adivina ni se inventa. Desaparece el enum de 69 dimensiones del esquema (H1).
- **Contexto política 2 obligatoria para validar v2** (H4): la política 1 sigue reproduciendo los contextos históricos; la 2 tiene `policy_version: 2` y huella distinta. Al planificador v2 tampoco se le envía `presentation` (la resuelve el ensamblador); `instruction_words` por actividad es solo un dato.
- **Principio (H5)**: el apoyo ejecutivo organiza el trabajo, no descompone el procedimiento académico que la tarea evalúa, salvo que una necesidad activa lo autorice de forma explícita sin cambiar el objetivo. Redactado como regla general, sin ejemplos de una asignatura. Una consigna breve no se reescribe ni se segmenta sin una barrera concreta; sin umbral universal de palabras.
- **Validador (P6)**: `sentence_starters` sobre producción propia del alumno → `review` (sin necesidad `expressive_language_support`) o `block` si `uses_task_data`; un `worked_example` con datos de la tarea sigue bloqueado y uno análogo sobre una tarea evaluada pide `worked_examples` activa. `uses_task_data: false` es **metadato auxiliar** del modelo: las barreras dependen del tipo de apoyo, la necesidad y la tarea, nunca de esa declaración.
- **Medición offline** (`pnpm eval:adaptation:planner:ab:mock`, mocks, coste 0): la entrada de v2 es ≈ 120-143 caracteres menor que la de v1 en los tres materiales y el mock v2 emite menos decisiones, sin duplicar la presentación ni bloquear. Esto valida el sistema, no la calidad de un modelo real.

### Primera llamada real de `planner@v2` (Primaria, 2026-10-05)

Una llamada, análisis v3 ya existente (sin reanalizar), perfil ejecutivo, política de contexto 2, STANDARD, salida máxima 4000 tokens (peor caso calculado $0,0553 frente a un presupuesto de $0,06), sin reparación ni regeneración. Coste real **$0,0227** (v1: $0,0297), 761 tokens de salida (v1: 1491), 5,9 s (v1: 9,0 s). Evidencia en `evals/adaptation/evidence/planner-v2-primaria.json`.

- **Válido a la primera** (v1 falló por `flags`: aquí ninguna decisión lo incluyó y no hizo falta reparar), 0 dimensiones fuera de contexto (`need_refs` 1-6 resueltas), H4 no reproducida, 0 respuestas inferred filtradas, 0 elementos protegidos esenciales perdidos, 0 cambio de objetivo, ningún procedimiento resolutivo ni ejemplo que enseñe la solución, ni comienzos de frase.
- **4 decisiones** (v1: 8) sobre 2 de las 5 actividades más el documento y dos actividades sin tocar con motivo explícito en `summary`: lista de control global (GOOD), estructura espacial de la actividad de comparar (ACCEPTABLE), recordatorio de expectativa en la explicación (ACCEPTABLE) y pasos de proceso sobre el problema de la resta (**QUESTIONABLE**, `review`): segmenta una consigna breve sin barrera concreta y declara `uses_task_data: true`; no explica la operación ni da ejemplo.
- Un único material y una llamada: v2 corrige lo reproducido (P1, H1, H4, P6, el grueso de H5) pero **no** elimina del todo la tendencia a segmentar consignas breves; no se tocó el prompt tras verlo.

### Primera llamada real de `generator@v2` sobre Primaria (2026-10-05) — detenida por esquema

Cadena: planner v2 congelado → PlanReview humano (`evidence/review-primaria.json`, IDs comprobados contra el plan real) → generator v2. Se aprobaron `dec_1` (checklist global, con restricciones de proceso), `dec_3` (recordatorio en la explicación) y `dec_4` (organización espacial de la comparación); se rechazó `dec_2` (pasos sobre el problema: consigna breve, sin barrera, repiten la tarea). Plan efectivo de 3 decisiones sin bloqueos y 0 rechazadas enviadas. `dec_4` es efectiva pero el generador no la recibe (un `segment` sobre una consigna breve sin apoyos no escribe nada): `act_2` queda intacta.

La llamada ($0,0140, 3,3 s, 279 tokens de salida) devolvió un JSON que **no valida** (`checklist` global con 5 elementos; el tope del esquema es 4). Sin reparación ni regeneración no hay borrador normalizable, documento ni auditoría. En el JSON bruto: 0 bloques sobre `act_1`/`act_3`/`act_4` ni sobre la decisión rechazada, 0 valores inferred, sin comienzos de frase ni ejemplos; el checklist global son etiquetas «Actividad 1…5» (utilidad ejecutiva baja) y la comprobación de `act_5` repite la consigna. Causa de fondo: el planner pidió «una casilla por actividad» en una ficha de 5 actividades sin conocer los topes del generador. Cadena Primaria: $0,0793 (análisis $0,0426 + planner v2 $0,0227 + generator v2 $0,0140). Evidencia: `evals/adaptation/evidence/generator-v2-primaria.json`. Sin activar nada.

## Rutas de ejecución (preflight de capacidades, 2026-10-05)

Nació de los dos problemas de integración de la primera llamada de generator v2 en Primaria: un checklist global de 5 elementos frente a un tope de 4, y una decisión efectiva (`dec_4`) que el generador no recibió porque un `segment` breve sin apoyos no escribe nada. **Una decisión efectiva no puede desaparecer en silencio.** `src/lib/adaptation/execution.ts` (`planExecutability`) clasifica, antes de cualquier llamada, cada decisión aplicada en exactamente una ruta (metadato de ejecución; `AdaptationPlan v1` no cambia):

| Ruta | Quién la ejecuta |
|---|---|
| `ai_generation` | el generador (apoyo autorizado o consigna larga); es lo **único** que puede ir en la petición |
| `deterministic` | el ensamblador (omitir un elemento; etiquetar los párrafos de un texto fuente) |
| `presentation` | un ajuste de presentación ya lo resuelve todo (paginación, decoración) |
| `deferred_to_renderer` | intención de maquetación (`segment`/`reorganize` sin apoyo) que ni el análisis ni el documento pueden expresar sin interpretar el texto: se conserva el original, se registra como **pendiente** y nunca como ejecutada |
| `unsupported` | nada puede ejecutarla: el preflight bloquea |

Una decisión rechazada, sin revisar o bloqueada no tiene ruta (nada que ejecutar). **Capacidades**: `SUPPORT_CAPACITY` se lee del propio esquema `SupportV2Schema` (checklist ≤ 4, etc.); relajar un tope allí cambia la tabla, sin deriva posible. **Cardinalidad**: la revisión puede declarar `support_requests: [{kind, min_items}]` («al menos N elementos»); si N supera la capacidad del bloque es un bloqueo previo a la IA (`cardinality_exceeds_capability`), sin ninguna regla sobre «cinco actividades». Las restricciones en texto libre nunca se interpretan. El planner **no** conoce estos límites (un test lo comprueba). El pipeline devuelve `execution` y, con `requireExecutable`, se detiene antes del generador (`ExecutionBlockedError`); el runner del generador v2 imprime la tabla *decisión · revisión · ruta · petición* y bloquea si hay `blockers` o si la petición no contiene exactamente las decisiones `ai_generation`.

**Sobre `dec_4` (organización espacial de la comparación)**: `MaterialAnalysis` guarda la consigna como una cadena (sin sub-ítems) y el bloque `activity` solo tiene `prompt`, `steps` y `requirements`. Separar dos comparaciones exigiría partir el texto (p. ej. por `;`), una heurística frágil que no se implementa: es trabajo del renderer o de un contrato posterior. Fidelidad antes que completar la decisión.

### Segunda llamada real de `generator@v2` sobre Primaria (2026-10-05) — con el preflight de rutas

Misma evidencia congelada (análisis v3, política 2, plan bruto de planner v2) con una **nueva** revisión (`review-primaria-2.json`; la anterior queda histórica): `dec_1` editada (checklist de proceso, máximo 4, sin enumerar actividades), `dec_2` rechazada, `dec_3` aprobada (recordatorio no resolutivo, declinable), `dec_4` aprobada pero enrutada a `deferred_to_renderer`. El checklist sigue en máx. 4. La petición llevó solo `dec_1` y `dec_3`.

Resultado: JSON **válido a la primera** ($0,0142, 2,9 s, 278 tokens), todas las auditorías deterministas en verde, 0 fugas inferred, protegidos y visuales (`vis_1`, `vis_2`) intactos, sin bloques no autorizados, trazabilidad completa. Los WARN son los honestos: `answers_not_leaked` (respuesta textual inferred de dos actividades, requiere revisión semántica), `functional_supports_applied` y `traceability_complete` por la `dec_4` diferida. Actividades 1-4 idénticas al original; `act_5` pasa de 14 a 31 palabras (×2,21). Checklist global GOOD (3 elementos de proceso, 19 palabras, sin enumerar actividades); apoyo de `act_5` ACCEPTABLE (genérico, restata el formato; pudo ir a `skipped`). Cadena Primaria observada: $0,0426 + $0,0227 + $0,0140 (fallido) + $0,0142 = $0,0935; referencia de cadena limpia (sin el fallido) $0,0794. Evidencia: `evals/adaptation/evidence/generator-v2-primaria-run2.json`.

## Revisor pedagógico (`pedagogical_reviewer@v1`, 2026-10-05) — publicado, no activo

El revisor **observa → evalúa → emite hallazgos**: no modifica el documento, no genera contenido, no repara, no replanifica ni propone otra adaptación (el esquema no tiene campo para un texto de reemplazo y es estricto). `PedagogicalReview v1` no cambia: el servidor lo compone con `hallazgos deterministas + hallazgos IA`.

**Quién decide qué.** *Deterministas finales* (la IA nunca los ve ni los cambia): objetivos, elementos protegidos, datos necesarios, consignas completas, restricciones, formato de respuesta, carga visual y de lectura, trazabilidad. *Híbridos* (la IA añade juicio): `answers_not_leaked` (fuga semántica y **pistas indirectas** en preguntas guía, ejemplos, recordatorios, planificadores, listas y comienzos de frase), `functional_supports_applied` (utilidad, sobre-apoyo y **redundancia semántica**; puede juzgar si el documento cubre una necesidad aunque una decisión no se aplicase, sin fingir que se ejecutó) y `no_infantilization`. *IA*: `age_appropriate`. No se crean checks nuevos.

**Contexto mínimo** (`review-context.ts`, determinista): etapa/edad, necesidades activas, resultado previo solo de los 4 checks que juzga, decisiones (aplicadas, rechazadas, `deferred_to_renderer`), texto visible de los bloques con su origen, protegidos de las actividades en juicio y, solo para la pregunta semántica abierta, las respuestas inferred como `internal_reference_only` (nunca contenido fuente). Sin alias, etiquetas, PII, catálogo de dimensiones ni campos administrativos.

**Fusión en servidor** (`reviewer.ts`, `mergeReviewerFindings`): (1) un FAIL determinista gana siempre; (2) un WARN **estructural** (decisión diferida, necesidad sin decisión) nunca lo cierra la IA, que solo añade su juicio al lado; (3) solo se cierra una pregunta **semántica** abierta (`needs_semantic_review`), y solo si cada objetivo requerido tiene su hallazgo; (4) un hallazgo sobre un check determinista o sobre un objetivo fuera de alcance se rechaza y se registra; (5) un juicio requerido que no llega es un WARN, nunca un PASS; (6) `requires_human_review` o la duda material son WARN como mínimo. Con `dec_4 deferred_to_renderer`, `traceability_complete` sigue en WARN diga lo que diga el revisor.

Offline: `pnpm eval:adaptation:reviewer:mock` (hallazgos guionizados sobre Primaria, Geografía y Bachillerato: fuga literal y semántica, pista indirecta, sobre-apoyo, sub-apoyo, infantilización, redundancia, ausencia de respuesta, objetivo inexistente, decisión diferida). Valida el sistema que rodea al revisor, no la calidad de un modelo.

### Primera llamada real del revisor (Primaria, 2026-10-05)

Sobre el `MaterialDocument` del segundo run de generator v2 (reconstruido idéntico desde su propia generación; sin planner, generator ni análisis). Una llamada: $0,0184, 5,7 s, 791 tokens de salida, válida a la primera, 0 hallazgos rechazados, 0 juicios pendientes. Resultado fusionado: `answers_not_leaked` PASS (act_2 y act_4 y los dos apoyos, cada uno con su hallazgo), `age_appropriate` y `no_infantilization` PASS, `functional_supports_applied` con el WARN estructural determinista (no cerrable) más tres WARN de IA (fragmentación sin cubrir por una decisión rechazada y otra diferida, checklist global genérica, apoyo de `act_5` que repite la consigna), `traceability_complete` WARN por `dec_4`: **se mantiene**. Veredicto `approved_with_warnings`. Auditoría de los 8 hallazgos: 8 CORRECT, 0 estrictos, 0 laxos, 0 erróneos (dos con matices: la crítica a la checklist es discutible por estricta y «redundantes entre sí» es imprecisa). **Límite**: un solo documento limpio; falta un caso adversarial real para descartar complacencia. Cadena limpia Primaria hasta el revisor: $0,0978 (análisis $0,0426 + planner v2 $0,0227 + generator v2 $0,0142 + revisor $0,0184). Evidencia: `evals/adaptation/evidence/reviewer-v1-primaria.json`.

### Validación adversarial real del revisor (Bachillerato, 2026-10-05)

Una copia determinista del `MaterialDocument` real de Bachillerato (reconstruido idéntico desde su historia; los históricos no se tocan) con cinco bloques de apoyo añadidos bajo decisiones añadidas a una copia del plan: una fuga semántica en `act_3` («Fíjate en cómo la idea que aparece después se enfrenta a la anterior»), una pista resolutiva en `act_4`, un tono lúdico impropio en `act_5`, una redundancia semántica en `act_1` y un planificador vacío como control seguro en `act_2`. Expectativas, reglas de puntuación (estructurales: check y objetivo, nunca texto) y hashes **congelados antes** de la llamada (`reviewer-adversarial-bachillerato-{manifest,expectations,lock}.json`); ninguna mutación la detecta un check determinista. Una llamada, $0,0237, 5,8 s, válida a la primera, 0 hallazgos fuera de alcance. Resultado: fuga semántica **HIT** (FAIL), pista resolutiva **HIT** (FAIL), infantilización **HIT** (FAIL en `age_appropriate` y `no_infantilization`), redundancia **HIT** (WARN), control seguro **CORRECT** (sin hallazgo); veredicto `blocked` con los tres bloques a revisar. Auditoría: 6 CORRECT, 1 TOO_STRICT (un WARN sobre decisiones rechazadas a propósito), 0 laxos, 0 erróneos; además detectó un verdadero positivo en el documento real (la consigna de `act_5` repetida). Límites: un documento, mutaciones claras (la pista B era más resolutiva de lo previsto), sin caso frontera ni WARN estructural abierto en este documento. Evidencia: `evals/adaptation/evidence/reviewer-adversarial-bachillerato.json`.

### Segunda llamada real de `planner@v2` (Bachillerato, 2026-10-05)

Análisis v3 ya guardado (sin reanalizar), mismo perfil ejecutivo, política de contexto 2 (6 necesidades; `number_of_visible_tasks` ya no llega), STANDARD, salida máxima 4000 (peor caso $0,0573 frente a $0,06), sin reparación ni regeneración. Coste **$0,0294** (v1: $0,0319), 1278 tokens de salida (v1: 1549), 8,1 s (v1: 10,0 s). Evidencia en `evals/adaptation/evidence/planner-v2-bachillerato.json`.

Válido a la primera, 0 dimensiones fuera de contexto, H4 no reproducida, 0 fugas de la respuesta inferred de `act_3` (intacta, sin `rephrase`), protegidos esenciales declarados, sin cambio de objetivo, sin tocar el texto fuente ni reducir la escritura evaluada, ningún texto escrito para el alumno. **7 decisiones** (v1: 8): 4 valid, 3 review, 0 blocked; 0 GOOD, 4 ACCEPTABLE, 3 QUESTIONABLE, 0 WRONG. Lo cuestionable: segmentación sustancial de la consigna de 10 palabras de `act_1` (el patrón de sobre-adaptación de v1), un cuarto y quinto apoyo sobre `act_5` (checklist y recordatorio que repiten los requisitos) y una checklist global «de las cinco actividades» (el patrón que falló en Primaria). H1 y H4 resueltas; **H5 parcial**: v2 acepta no tocar `act_3` y elimina `keep` y `rephrase` innecesarios, pero sigue apilando apoyos. Conclusión: apto como planner por defecto **experimental** con PlanReview obligatorio; no producción.

### Pipeline integrado sobre Bachillerato (2026-10-05)

`planner v2 (congelado) → PlanReview humano → preflight de ejecución → generator v2 → deterministic review → reviewer v1`, con dos llamadas reales y sin tocar ningún componente. PlanReview (`review-bachillerato-planner-v2.json`): se rechazan `dec_1` (consigna de 10 palabras), `dec_3` (apila apoyos en `act_5`) y `dec_6` (checklist global de cinco actividades); se aprueban `dec_2`, `dec_4`, `dec_5` con restricciones y `dec_7`. Preflight: `ai_generation` `dec_2`, `dec_4`, `dec_5`; `deferred_to_renderer` `dec_7`; 0 `unsupported`; 0 rechazadas o diferidas en la petición.

Generator v2 ($0,0184, 4,4 s, válido a la primera): `act_1` y `act_3` intactas, texto fuente idéntico, `act_2` y `act_4` con una checklist de dos elementos, `act_5` con fases y planificador vacío; su intento de reescribir la consigna de `act_5` perdía requisitos y el normalizador lo descartó. Redundancia ×1,10 / ×2,06 / ×1,08 / ×1,71 / ×1,39 (antes ×3,50 / ×2,00 / ×1,08 / ×1,94 / ×2,71). Revisión determinista `approved_with_warnings` (semántica de `act_3`, `predictable_structure` y trazabilidad de `dec_7`). Reviewer v1 ($0,0207, 5,6 s, válido): `answers_not_leaked`, `age_appropriate` y `no_infantilization` PASS; `functional_supports_applied` con el WARN estructural intacto más tres de IA, entre ellos las checklists que repiten la consigna (cierto); `traceability_complete` WARN de `dec_7` se mantiene. Auditoría: 6 CORRECT, 1 TOO_STRICT, 0 laxos, 0 erróneos. **R1 reproducido**: penaliza la necesidad de segmentar `act_1` aunque `dec_1` se rechazó a propósito. Coste incremental $0,0391; cadena limpia de Bachillerato $0,1236 (análisis $0,0550 + planner v2 $0,0294 + generator $0,0184 + reviewer $0,0207). Evidencia: `evals/adaptation/evidence/pipeline-bachillerato.json`.

## Orquestación del pipeline (backend real, offline)

`src/lib/adaptation/orchestration/` convierte el núcleo validado en una máquina de estados persistente, idempotente y con una **puerta humana obligatoria**. No hay un job continuo `planner → generator → reviewer`:

```
createAdaptation → queued → runPlanningStage → awaiting_plan_review ⟶ docente ⟶ submitPlanReview → generation_queued
  → runGenerationStage → generating → reviewing_deterministic → reviewing_ai → ready | blocked
```
Cualquier fallo → `failed` (reintentable) · `cancelled`. Las transiciones las valida el servidor (TS y SQL, un test las compara par a par): ninguna petición puede saltarse `awaiting_plan_review`.

**Versiones fijadas.** Al crear la adaptación se resuelven una vez y se persisten (`pipeline_versions`): analysis schema 3, planner v2, plan canónico 1, política de contexto 2, generator v2, documento 1, reviewer v1, revisión 1, más el alias y el modelo que ese alias significaba y los topes de salida. Cada etapa, reintento o reanudación lee la fila, nunca el entorno ni los valores por defecto de hoy (planner y generator por defecto siguen siendo v1; v1 no se elimina). El contexto minimizado y su huella también se fijan al crear; si el análisis del material cambia, la etapa falla con `stale_analysis`.

**Etapa de planificación** (`runPlanningStage`, idempotente): re-verifica contexto y análisis, llama al planner, persiste el borrador, normaliza a `AdaptationPlan v1`, valida (una reparación como máximo, solo por bloqueos del validador; un borrador inválido no se repara), persiste plan y clasificación y pasa a `awaiting_plan_review`. **PlanReview** (`submitPlanReview`): crea una revisión inmutable ligada a la huella del plan bruto; una aprobación de una decisión bloqueada, una edición que sigue bloqueada o una revisión de otro plan se rechazan sin persistir; una válida construye el plan efectivo y ejecuta el preflight de rutas; con una decisión `unsupported` (o un plan efectivo con bloqueos) no se encola nada y se queda en `awaiting_plan_review`. **Generación** (`runGenerationStage`): comprueba que la revisión sigue siendo del plan actual y repite el preflight antes de cualquier job; envía solo `ai_generation`; normaliza; ensambla; revisión determinista; persiste la versión; un FAIL determinista bloquea sin llamar al revisor; si no, ReviewContext, revisor, fusión con precedencias y cierre. Un documento que no supera la auditoría de generación (sin FAIL determinista) es una generación inválida: ninguna versión.

**Entrega.** Una adaptación está *entregada* solo si está en `ready`, `current_version` apunta a una versión persistida y su `PedagogicalReview` es `approved` o `approved_with_warnings` (los avisos se persisten para la interfaz). Un plan, un borrador, una generación inválida o un documento `blocked`/`needs_revision` **no** son una entrega: la versión se conserva para auditoría, la adaptación queda `blocked` y `delivered_at` sigue nulo. Esa definición es la que usan las cuotas (docs/BILLING.md § Adaptaciones): la unidad se reserva al crear (atómica con la fila), se consume atómicamente con la primera entrega y solo se libera cancelando una adaptación nunca entregada; `blocked`, `failed` y los reintentos conservan la reserva.

**Idempotencia, y su límite.** Cada salida se guarda bajo «etapa + huella de entrada + versiones» y se busca **antes** de llamar a ningún proveedor: repetir un comando reutiliza el plan, la versión, la revisión y el job, y no crea otro `ai_run` exitoso. Lo que **no** se garantiza es *exactly-once* en la llamada externa: si el proveedor respondió y el proceso murió antes de persistir, el intento puede haberse cobrado. La semántica es *at-least-once* en el intento externo e idempotente en el estado de la aplicación, y esa ambigüedad **se detecta**: `provider_call_started_at` se marca justo antes de cada llamada y se limpia cuando el resultado está guardado; un lease caducado con la marca puesta es un intento ambiguo, que no se reintenta a ciegas (la etapa falla con `ambiguous_attempt`, acción humana, y se registra un `ai_run` de coste desconocido) hasta que alguien lo reconoce explícitamente. Dos procesadores nunca ejecutan la misma etapa (lease de la Fase 3) y uno que perdió el lease no puede persistir (*fencing* por intento en SQL).

**Fallos.** Taxonomía en `errors.ts` (`invalid_input`, `stale_analysis`, `planner_schema`, `planner_validation`, `plan_review_required`, `execution_unsupported`, `generator_schema`, `generator_validation`, `deterministic_review_failed`, `reviewer_schema`, `reviewer_blocked`, `ambiguous_attempt`, `provider_transient/refusal/credentials`, `cancelled`, `internal`), cada una `retryable`, `non_retryable` o `human_action_required`; la política de reintento es la central existente (`AIError.retryable`): solo lo transitorio e inesperado se reintenta dentro de `max_attempts`; rechazos, credenciales, entrada corrupta y salidas inválidas son finales. **Estado para la interfaz**: `AdaptationStatusDto` (fases `working`, `awaiting_review`, `ready`, `blocked`, `recoverable_failure`, `action_required`, `cancelled`), sin modelos, tokens ni costes. **Coste** (`cost.ts`): por etapa desde `ai_runs`, con el análisis compartido aparte y el coste desconocido como `null`.

**Seguridad y privacidad.** La capa de aplicación (`service.ts`) lee con el cliente del usuario (RLS): un id de otro workspace es un 404; el rol sale del servidor; la identidad del revisor y la hora de la revisión las pone el servidor. El único módulo que toca el cliente de servicio y las credenciales es `orchestration/server.ts` (acotado en `boundaries.test.ts`). Los snapshots solo contienen el contexto minimizado.

**Deuda conocida (no es un fallo de seguridad).** *R1*: el revisor puede emitir un WARN demasiado estricto por una necesidad cuya decisión el docente rechazó a propósito; es **deuda de calidad consultiva**, se persiste, no se filtra, no se eleva a bloqueo y se muestra en la interfaz; los FAIL reales mantienen sus precedencias. Las *checklists redundantes* quedan igual: el revisor las marca WARN, el docente puede eliminarlas o editarlas en su revisión, y la frecuencia se mide desde `functional_supports_applied` en los `pedagogical_review` persistidos. No hay Reviewer v2 ni Generator v3.

## Capa web del pipeline: comandos, cola durable y worker

**Principio.** Una petición web nunca ejecuta una llamada de IA. La frontera autoriza, valida, persiste el comando o el estado, reserva la cuota, **encola un job durable** y responde; un worker ejecuta las etapas después. Nada depende de promesas sin esperar, `setTimeout` ni de que el runtime siga vivo tras responder.

**Comandos** (`orchestration/service.ts`; Server Actions en `app/app/(shell)/adaptaciones/actions.ts`, sin UI todavía): `createAdaptation` (autoriza, comprueba material y perfil, crea/localiza por `request_key`, reserva atómicamente; no planifica), `startPlanning` y `startGeneration` (solo persisten el job: idempotentes, con el estado, la reserva, el preflight y la revisión comprobados; la revisión que usa la generación la decide el servidor, nunca el cliente), `submitPlanReview` (identidad y hora puestas por el servidor; rechaza una revisión obsoleta, aprobar un bloqueado o una edición aún bloqueada; no genera), `retryAdaptationStage` (solo fallos reintentables o un intento ambiguo con reconocimiento explícito; conserva reserva y versiones; tope de reintentos manuales), `cancelAdaptation`, `reopenReview`, y las consultas `getAdaptationStatus`, `getAdaptationPlan` y `getAdaptationVersion`. Los errores públicos son genéricos (`not_found`, `entitlement_exhausted`, `invalid_state`, `stale_review`, `review_required`, `unsupported_execution`, `action_required`…): ni mensajes del proveedor, ni SQL, ni datos de otro workspace. **Ejecución inmediata:** tras «Empezar», «Generar» o «Reintentar», la pantalla ejecuta en ese momento la etapa que el comando persistió, con `POST /api/adaptations/[id]/run`. Es un Route Handler esperado, no una Server Action: Next despacha las acciones de un cliente de una en una y una etapa de minutos bloquearía «Cancelar». El cron no forma parte de la latencia normal (ADR-004).

**Worker** (`orchestration/worker.ts`): un único processor de etapa (`runStageJob`) con dos entradas. `processAdaptationStage(id)` es el camino normal: la etapa pendiente de UNA adaptación, en la petición del docente. `processAdaptationJobs({limit})` es la recuperación: toma jobs reclamables. Las dos llaman a `runPlanningStage` / `runGenerationStage` (lease, fencing por intento, `ai_runs`, ambigüedad y completar/fallar son del núcleo; el worker no duplica lógica); `reconcileAdaptationJobs` repara `queued` sin job de planificación y `generation_queued` sin job de generación (nunca salta la revisión humana, ni reactiva `cancelled`, ni reintenta un fallo que no debe reintentarse: ambiguos, credenciales, rechazos, entradas inválidas, esquema terminal o a la espera de una persona); `runAdaptationWorkerCycle` = reconciliar y procesar. **Garantía de create → planning:** son dos comandos y no se finge atomicidad: una adaptación `queued` sin job se recupera llamando de nuevo a `startPlanning` o por el reconciliador (con una edad mínima configurable para no competir con el comando).

**Cron de recuperación** (no es el *dispatcher*). `GET|POST /api/cron/adaptations`, **diario** (03:30, compatible con Hobby), exige `Authorization: Bearer $CRON_SECRET` (sin sesión de usuario, comparación en tiempo constante, secreto nunca registrado). Ejecuta un tick de recuperación: reconcilia y procesa lo que nadie terminó. Es seguro llamarlo dos veces o a la vez. Variables: `ADAPTATION_JOBS_PER_RUN` (por defecto 1, porque una etapa puede ocupar casi todo el presupuesto de 300 s) y `ADAPTATION_RECONCILE_MIN_AGE_SECONDS` (por defecto 60). **Runner local:** `pnpm jobs:adaptations -- [--limit N] [--dry-run]`; con proveedores reales configurados **hace llamadas de pago** por cada job que reclame (no está en `pnpm check`; `--dry-run` solo lista; con el proveedor `mock` no cuesta nada).

**Cancelar con una llamada en vuelo.** No se promete cancelar la petición que ya salió al proveedor; sí que su resultado tardío no puede hacer nada: cancelar pasa a `canceled` los jobs activos, el worker pierde el lease, y todas sus escrituras (artefactos, versión, finalización, consumo) están protegidas por ese lease. La llamada queda registrada en `ai_runs` para auditoría.

**Estado para sondeo** (`AdaptationStatusDto`, rutas de lectura privadas `no-store`): `progress` semántico (`preparing`, `planning`, `awaiting_review`, `generating`, `reviewing`, `ready`, `blocked`, `failed`, `cancelled`; nunca porcentajes), `nextAction` (`start_planning`, `review_plan`, `start_generation`, `retry`, `cancel`, `view_result`, `none`), `canRetry`, `canCancel`, `hasPlan`, `hasPlanReview`, `hasVersion`, `delivered`, `warningsCount` y un `error` con código, categoría y mensaje genérico. El servidor es la autoridad: el cliente no infiere reglas de cadenas de estado.

## UI del pipeline: pantalla de adaptación y revisión docente (2026-10-05)

**Ruta.** `/app/adaptaciones/[id]` representa todo el ciclo de vida en una sola URL. La página es un Server Component (`loadAdaptationPage`, cliente del usuario con RLS: otra cuenta, un id mal formado y uno inexistente son 404) que entrega al cliente el estado inicial, el plan (solo mientras toca revisarlo) y las etiquetas derivadas del análisis. `AdaptationView` (cliente) muestra lo que dice el DTO y sondea mientras el pipeline trabaja solo.

**Fuente de verdad.** `AdaptationStatusDto` (`nextAction`, `canRetry`, `canCancel`, `phase`) y las Server Actions existentes. La UI no replica la máquina de estados: `screenFor(dto)` solo traduce flags a una pantalla (`start`, `working`, `review`, `generate`, `ready`, `blocked`, `failed`, `cancelled`).

**Sondeo** (`presentation/poller.ts`, sin React, probado con temporizadores falsos): solo mientras `phase = working` y `nextAction = none`; 2,5 s con la pestaña visible, 15 s oculta (y vuelve a consultar al volver), retroceso exponencial hasta 20 s si falla la red, `AbortController` al desmontar, nunca dos peticiones a la vez, sin porcentajes. Al cambiar de fase se llama a `router.refresh()` para que el servidor aporte plan y datos de la nueva pantalla.

**Capa de presentación** (`src/lib/adaptation/presentation/`): `copy.ts` (acciones, intensidades, apoyos, formas de responder, banderas del validador, comprobaciones de calidad, necesidades vía `DIMENSIONS`, errores de cuota, fallos) con **respaldo neutro** para claves desconocidas: nunca se muestra una clave técnica; `view-model.ts` (pantalla, fases, observaciones); `review-form.ts` (reducer, validación, carga útil del `PlanReview` existente, interpretación de la respuesta del servidor); `context.ts` (etiquetas de destino, fragmento de la instrucción y «qué se conserva» a partir de objetivos y elementos protegidos del análisis; **nunca** una respuesta inferida).

**PlanReview docente.** Resumen «Adaptaula propone N cambios. Revísalos antes de crear la ficha.» con recomendados / requieren atención / no aplicables tal cual. Cada decisión es un `fieldset` con dónde, qué se propone, por qué (etiquetas de necesidad, máx. 3), qué se conserva, avisos (texto propio por bandera; el mensaje del validador y la nota del planificador **no** se muestran) y Aprobar / Descartar / Ajustar. Reglas de formulario: nada preseleccionado salvo las bloqueadas (arrancan en Descartar); una bloqueada no se puede aprobar (la opción está deshabilitada; el servidor también la rechaza); «Aprobar los recomendados» es una acción explícita que solo toca las `valid`; no se envía hasta que todas tengan decisión y los ajustes cambien algo; no hay auto-envío. **Ajustar** solo ofrece los campos del payload de edición real (acción, intensidad, estrategias ≤3, apoyos ≤4 —se envían como apoyos generales, `uses_task_data = false`—, forma de responder, nota ≤160), con valores traducidos.

**Guardar revisión.** `interpretSubmit`: guardada y ejecutable → el servidor pasa a `generation_queued` y la pantalla ofrece «Crear material adaptado» (nunca se genera sola); revisión obsoleta (`stale_review`) → «Esta propuesta ha cambiado desde que la abriste…» + «Actualizar propuesta» (sin fusionar); no ejecutable → «Hay un cambio que todavía necesita ajustarse…» nombrando las decisiones afectadas (sin las líneas técnicas) y el formulario sigue abierto. Las decisiones diferidas al renderer se aprueban normalmente y se explican como «Se aplicará al preparar la presentación final.» una vez el servidor las ha identificado.

**Resultado.** `ready`: pantalla temporal («La adaptación está preparada», versión, fecha, nota de que ver y editar llega después); sin JSON ni maquetación simulada. `approved_with_warnings`: «Material preparado con observaciones» con una lista en lenguaje docente (nunca nombres de comprobación, `R1` ni ids). `blocked`: no listo, sin ficha, «Revisar la propuesta» solo si el servidor lo permite (`reopenReviewAction`). `failed`: reintento directo si `canRetry`; intento ambiguo: aviso neutro, sin reintento automático y confirmación explícita que dice que se repetirá el procesamiento; fallo sin reintento: explicación y cancelar/volver. Cancelar: acción secundaria con confirmación («Se detendrá esta adaptación. Si aún no se había entregado, no contará como una adaptación utilizada.»); después se detiene el sondeo y no queda ninguna acción de generación.

**Cuota.** `entitlement_exhausted` → «Has utilizado las adaptaciones disponibles de este periodo.»; `entitlement_unavailable` → «No hemos podido comprobar las adaptaciones disponibles. Inténtalo de nuevo más tarde.» (tono distinto; sin precios ni Stripe).

**Entrada.** En el material analizado, «Adaptar este material» pide un perfil (solo sus necesidades; nunca el nombre llega a la IA) y crea la adaptación (`createAdaptationFromMaterial`, tipo accesibilidad, `request_key` por formulario → doble clic = una adaptación); el material lista sus adaptaciones, de modo que toda adaptación tiene ruta de vuelta tras recargar.

**Límites actuales (deuda).** (1) Resuelta en el endurecimiento: el DTO lleva `preserves` y `restrictions` por decisión. (2) La UI no crea `restrictions` ni `support_requests` del PlanReview. (3) Ver «Endurecimiento» (el flag `uses_task_data` ya no lo declara el navegador). (4) Tras recargar no se restauran las elecciones a medias del formulario (no hay borrador persistido). (5) El mensaje de «decisión diferida» solo aparece tras guardar, porque es el preflight del servidor quien las identifica (no se duplica esa regla en el cliente). (6) Sin lista global de adaptaciones (el Historial sigue «próximamente»). (7) Sin visor del documento, edición ni PDF (fase siguiente).

### Endurecimiento de PlanReview (2026-10-05): autoridad sobre `uses_task_data` y «Se mantendrá»

**`uses_task_data` en ediciones.** Auditoría: un apoyo es solo `{kind, uses_task_data}` (no lleva texto) y el flag lo consumen `invariants.ts` (bloqueo/aviso de `worked_example`, `sentence_starters` y apoyos de riesgo) y el generador v1 congelado. El esquema público de edición aceptaba el flag tal cual: un cliente podía enviar `false` y rebajar un bloqueo a aviso, y la UI anterior lo ponía a `false` también en los apoyos que el planificador había marcado `true` (blanqueo). **Corregido:** el navegador ya no envía el flag; el esquema lo trata como opcional con valor por defecto `true` (desconocido = conservador); y al **guardar** una revisión de docente el servidor lo deriva (`normalizeTeacherEdits`, en `submitPlanReview`): un tipo de apoyo que la propuesta ya tenía conserva el valor de la propuesta; uno añadido por la docente es «desconocido» y se trata como `true`, lo que el validador existente convierte en bloqueo o aviso, nunca en silencio. Sin IA ni detector semántico; P6 y los validadores no cambian. Consecuencia asumida: un `worked_example` (o `sentence_starters` en una producción) **añadido** en una edición queda bloqueado; los de la propuesta original siguen siendo aprobables. La nota libre (≤160) no se puede verificar semánticamente y sigue siendo responsabilidad de la docente.

**Compatibilidad histórica.** La normalización ocurre al guardar, no al reproducir: `reviewPlan` no la aplica, así que las revisiones ya persistidas y los planes originales conservan sus valores, y las revisiones de tipo `eval`/`auto` conservan los suyos.

**DTO de preservaciones y límites.** `PlanDecisionDto` añade `preserves` (`{type, value}` de los elementos protegidos que la decisión declara, resueltos contra el análisis fijado de la adaptación; nunca `expected_answer`) y `restrictions` (límites escritos en una revisión de ese mismo plan; vacío antes de revisar). Es una proyección acotada (`plan-projection.ts`, máx. 6 elementos de 200 caracteres). La tarjeta muestra «Se mantendrá» (por tipo: «Se mantendrá: …», «El razonamiento seguirá siendo del alumnado: …», …) y «Límites de esta ayuda» (las restricciones de la revisión más, si la decisión añade una ayuda, «La ayuda no debe resolver ni sustituir: …» para operaciones objetivo, restricciones de razonamiento y criterios de evaluación). También en decisiones a revisar y bloqueadas. Todo el wording está en `presentation/copy.ts` con respaldo neutro.

**Pista de «decisión diferida» antes de guardar: no se añade.** El enrutado (`classifyDecisionExecution`) es determinista, pero se calcula sobre la decisión **efectiva** (tras las ediciones de la docente); predecirlo sobre la decisión cruda sería una conjetura que una edición puede invalidar. Se mantiene el comportamiento actual (la nota aparece tras guardar, con lo que dice el servidor).

**Móvil.** Verificado con el proyecto `mobile` de Playwright (390×844) en PlanReview, estado trabajando con diálogo de cancelar y ready con observaciones (`tests/e2e/adaptation-states.spec.ts`; las filas de cada estado se siembran con la clave de servicio del fake Supabase porque el proveedor simulado no tiene fixtures de planificador/generador): sin desbordes, tarjetas apiladas y de ancho completo, «Qué se propone»/«Por qué» apilados, radios ≥ 24 px, diálogo dentro del viewport, CTA alcanzable, axe sin violaciones graves/críticas.

**Deuda que sigue (no se toca):** restaurar elecciones a medias tras recargar, historial completo, volver atrás tras guardar la revisión, editor de MaterialDocument, renderer, PDF, imágenes, regeneración parcial.

## Renderer determinista de `MaterialDocument v1` (Fase 5.1, `material_renderer@v1`; hoy `@v2`, ver «Exportación PDF»)

**Auditoría del documento.** `MaterialDocument v1` tiene **16** tipos de bloque (`heading`, `paragraph`, `reading_text`, `instruction`, `activity`, `list`, `table`, `chart`, `image`, `help_box`, `checklist`, `vocabulary`, `worked_example`, `sentence_starters`, `planner`, `math`) y 11 tipos de respuesta (`lines`, `box`, `grid`, `table_cells`, `choice`, `fill_blank`, `match`, `order`, `true_false`, `oral_or_alternative`, `none`). Páginas lógicas (`pages[].blocks`), `presentation` semántica (`font_scale`, `line_spacing`, `spacing`, `contrast`, `decoration`, `max_tasks_per_page`, …), `admin_fields` (solo etiquetas), `answer_key` separado, `trace` por bloque. Las imágenes son `original` (`visual_ref`) o `requested` (futuras); los gráficos traen `series[].label` **nulo** salvo verificación. No se modifica nada del documento ni se le añade CSS.

**Arquitectura.** `MaterialDocument` → `buildRenderModel()` (`src/lib/render/model.ts`, puro, sin IA, sin reloj) → `RenderModel` + `RenderValidation` → componentes de servidor (`src/components/material/`). El modelo es solo contenido de alumno: **nunca** lleva la clave de respuestas, ids de bloque/decisión/origen ni trazas; lleva sugerencias semánticas (`keepTogether`, `isolate`) y las decisiones de página (`max_tasks_per_page`). Lo mismo servirá a la futura exportación PDF.

**Registro de bloques.** `NODE_RENDERERS` es un `{ [K in RenderNode["kind"]]: … }`: un tipo sin renderizador es error de compilación; el `switch` de `nodeOf` fuerza `never` en el `default`; un test compara los tipos del esquema con el registro. En ejecución, un bloque desconocido (datos que no cumplen el esquema) se convierte en un nodo `unknown` **visible** en la vista docente, el `RenderValidation` lo marca como **error** (`not_renderable`) y la vista del alumno **no muestra la ficha** (en vez de entregar contenido incompleto como si estuviera bien).

**Decisiones diferidas.** Se leen del `execution_report` cuyo `plan_fingerprint` coincide con la revisión de la versión. El renderer ejecuta solo lo que puede sin tocar contenido: `segment`/`reorganize` sobre una actividad (o sobre `document`) → **`isolate`** (grupo visual propio: más espacio, regla superior, sin partirse). Resultado por decisión: `applied`, `unsupported` (otra acción u otro destino) o `not_applicable` (el destino ya no está). Si no se pueden leer, se informa como desconocido, nunca se supone. Se muestran solo en la vista docente.

**Vista del alumno / vista docente.** Misma hoja; la docente añade, **fuera de la hoja** (se oculta al imprimir), un panel con versión, la versión del renderer (`material_renderer@v2`), estado de render, avisos de presentación, observaciones de la revisión pedagógica (en lenguaje docente) y detalles. Los huecos de imágenes solo se marcan en la vista docente. La clave de respuestas no existe en ningún árbol de render (una futura vista de soluciones sería otro constructor).

**Respuestas.** `lines` (con espacio extra si los requisitos fijan «150-180 palabras»: líneas = ⌈máx/11⌉, tope 40), `box`/`grid`/`table_cells` (altura por tamaño), `choice` (casillas redondas o cuadradas), `fill_blank` (huecos sin clave + banco de palabras), `match` (dos columnas con hueco para unir), `order` (casillas), `true_false` (V/F), `oral_or_alternative` (etiqueta + líneas), `none`. Planner: un bloque por apartado con sus líneas; checklist: casilla por elemento (si hay más de 12 se muestra entera y se registra).

**Tablas y gráficos.** Tabla: cabeceras y celdas exactas, ancho fijo, filas que no se parten, cabecera repetida. Gráfico: barras/líneas/sectores solo con los datos estructurados, sin color (tramas y bordes), con **tabla de datos siempre**; series sin etiqueta verificada: una sola serie no lleva leyenda; **varias series sin nombres verificados (o solo algunas) no se dibujan**: se muestra su tabla de datos (valores, categorías, unidad/eje y orden intactos, sin leyenda ni «Serie n») y la vista docente avisa «El material original no proporciona nombres verificados para estas series»; con valores negativos o sectores de varias series, también solo la tabla.

**Imágenes y recursos.** La imagen `original` solo se renderiza si un resolvedor de assets la aporta; **el pipeline no guarda hoy ningún recorte por visual**, así que toda imagen original queda «no disponible»: si es un visual necesario (`required_visuals` del contexto fijado de la adaptación) la ficha es `not_renderable`; si no, `renderable_with_warnings`; la hoja del alumno nunca pone una imagen de relleno. Sin OCR ni redibujado. Punto de extensión: `BuildRenderOptions.assets` (URL ya autorizada, p. ej. firmada) y el bloque `requested` (imagen futura: «pendiente» solo en la vista docente, la ficha no finge que existe).

**Paginación e impresión.** El `RenderModel` decide: límites de página lógica del documento, `max_tasks_per_page` (agrupa **sin quitar** actividades y arrastra un encabezado que quedaría huérfano), `keepTogether` (actividades de ≤14 filas, checklists de ≤8) e `isolate`. CSS decide: `break-inside`/`break-after`/`orphans`/`widows`, cabecera de tabla repetida, A4 con `@page` y `@media print` (oculta el chrome de la app `[data-app-chrome]`, los controles `.ms-chrome` y el panel docente; la hoja pasa a flujo normal). En pantalla cada página lógica es una hoja A4 que **crece** si su contenido es mayor (nunca recorta); en móvil la hoja se desplaza dentro de su marco (región enfocable por teclado) sin ensanchar la página. Todo texto parte palabras largas (`overflow-wrap:anywhere`).

**Tokens.** `src/lib/render/tokens.ts`: A4, márgenes 18 mm, tipografía (Inter; desde v2, copia local fijada de la hoja, la misma en pantalla y en PDF) 11–12 pt × `font_scale`, interlineado, separación, altura de línea de respuesta y casillas por etapa (modulación prudente, sin tema infantil). Solo grises y negro: la ficha funciona en color, en escala de grises y con impresora escolar.

**RenderValidation** (técnica, no pedagógica; no toca la `PedagogicalReview`): `unknown_block_type`, `asset_missing`, `image_pending`, `deferred_*`, `chart_series_unverified`, `chart_table_only`, `asset_unsupported`, `math_source_only` (las fórmulas se muestran como texto con lectura en voz alta: no hay compositor LaTeX), `overflow_risk` (palabras larguísimas, tablas de >8 columnas, respuestas de ≥30 líneas), `structure_inconsistent`. Estado: `renderable` / `renderable_with_warnings` / `not_renderable`, independiente de la aprobación pedagógica.

**Versión y persistencia.** `MATERIAL_RENDERER_VERSION = "material_renderer@v2"` desde la Fase 5.2A (se muestra en la vista docente; qué cambió, en «Exportación PDF»). **No hay migración:** el HTML se reconstruye de forma determinista y no se persiste; la versión del renderer y el `RenderValidation` se persistirán cuando exista una exportación (Fase 5.2) que necesite saber con qué renderer se produjo. Una versión histórica nunca cambia: el visor solo muestra la versión actual entregada.

**Ruta.** `/app/adaptaciones/[id]/vista` (Server Component): autoriza con RLS (otra cuenta → 404), solo adaptaciones entregadas (bloqueada/fallida/sin terminar → «todavía no tiene una ficha entregada»), `?modo=alumno` cambia solo el modo de vista (nunca la cuenta ni la versión). Desde la pantalla «Listo» hay un enlace «Ver la ficha».

**Límites.** Sin exportación PDF para el docente todavía (el motor existe desde la 5.2A; ver «Exportación PDF»), sin imágenes generadas, sin editor, sin composición de fórmulas, sin paginación física propia (la hace el navegador al imprimir, también en el PDF), un solo estilo de ficha.

### Visuales originales: auditoría de geometría y decisión (2026-10-05)

**Qué sabemos hoy de cada `vis_N`** (comprobado contra el esquema almacenado, `evals/` y los documentos reales del pipeline): `id`, `page`, `kind` (`image`, `diagram`, `chart`, `table`, `number_line`, `geometric_figure`, `map`, `decorative`, `other`), `role`, `title`, `description` (texto libre del analizador), `text`, `table`/`chart` estructurados si los hay, `section_id` y `activity_ids`. **No hay** bounding box, coordenadas, tamaño, referencia a objeto PDF ni asset extraído (un test lo fija). Tampoco el extractor (`pdf-lib` solo cuenta páginas) ni el almacenamiento (solo `source-materials`, el original) guardan nada por visual. No hay rasterizador de PDF en el stack (ni `pdfjs`, ni `canvas`, ni binarios del sistema).

**Por tipo de fuente.** PDF: las rasters embebidas se pueden listar, pero un gráfico vectorial, una recta numérica o una figura geométrica son operadores de dibujo sin objeto imagen (un test lo demuestra con un PDF sintético de dos páginas); relacionar una raster con `vis_N` exigiría adivinar. Imagen subida: el archivo es la página entera; sin bbox no se puede aislar el visual. Escaneos: sin objetos, solo píxeles. Los visuales con `table` o `chart` estructurados **no necesitan asset** (el renderer determinista los reconstruye con datos verificados; regla: un gráfico que puede reconstruirse fielmente con datos estructurados nunca se sustituye por una captura, y el asset original solo hace falta cuando el recurso contiene información que la estructura no conserva: figuras, rectas numéricas, mapas, diagramas).

**Decisión (superada por la opción C, abajo): NO se implementa el extractor automático.** Hacerlo ahora exigiría inventar coordenadas o buscar «el rectángulo más parecido»; el análisis está congelado y no se toca. Se mantiene sin rebajar la barrera: **visual necesario sin asset → `not_renderable`**; no necesario → `renderable_with_warnings`. Lo que sí se hizo, correcto sin geometría: (1) el **contrato del asset** (`src/lib/render/visual-assets.ts`): entrada ligada a `material + analysis_fingerprint + visual_id + source_sha256 + receta`, identidad determinista (misma receta → mismo asset; otro análisis, archivo o material → otra), sin `adaptation_id` (un recorte se reutiliza entre adaptaciones), receta con bounds normalizados, margen técnico fijo (1 %), densidad fija (200 ppp, tope 4096 px, sin reescalado), validación (bounds, dimensiones, bytes, MIME) y los ocho fallos (`source_missing`, `page_missing`, `geometry_missing`, `invalid_bounds`, `extraction_failed`, `unsupported_source`, `asset_missing`, `asset_corrupt`: errores de asset, nunca pedagógicos); (2) el **resolvedor** `visual_id → asset` que usa el renderer (`BuildRenderOptions.assets/assetFailures`) y que solo acepta entradas de la misma identidad; un asset determinista que aparezca después sí lo aprovecha una adaptación histórica (es una extracción del mismo original, no cambia el contenido); (3) el visor informa de la **razón real** (hoy `geometry_missing`: «el análisis no guarda la posición de la imagen en el original») en la vista docente; (4) nombre accesible neutro: el pie impreso del original si existe, si no «Recurso visual de la actividad» (la descripción libre del analizador no está verificada y no se usa). `MaterialDocument` no lleva URLs ni geometría. **No hay migración ni tabla** (sin productor, sería esquema muerto); cuando exista, se propone una tabla pequeña `material_visual_assets` con RLS por workspace (las filas heredan el borrado del material por `on delete cascade`; el objeto de Storage se borraría con el mismo patrón que el archivo original; sin recolector de basura por ahora) y bucket privado `generated-assets` con URL firmada.

**Opciones para localizar visuales (siguiente fase, nada de esto se ha implementado):**

| | A · geometría en un análisis futuro (v4) | B · `visual_locator` independiente que produce un sidecar | C · selección/recorte humano |
|---|---|---|---|
| Precisión | depende del modelo; hay que validarla | igual, pero aislada y evaluable por separado | exacta (la docente lo ve) |
| Coste | encarece cada análisis | una llamada extra solo si hay visuales necesarios | cero de IA; tiempo de la docente |
| Contratos | cambia `MaterialAnalysis` (versión nueva) | ninguno: usa el contrato `VisualAssetEntry` | ninguno: mismo contrato, `geometry_source: human_selection` |
| Histórico | los análisis v3 no se benefician sin reanalizar | **sí**: se aplica a análisis existentes por `analysis_fingerprint` | **sí** |
| UX | invisible | invisible | un paso manual (puede ser opcional y solo para los necesarios) |
| Automatización | total | total | ninguna (pero sirve de verdad-terreno para evaluar B) |

Recomendación (sin implementar, requiere aprobación porque B implica IA): **C como primer paso** (cierra el bloqueo sin riesgo y deja datos para evaluar) y **B después**, con el contrato de sidecar ya definido; A solo si se abre un análisis v4 por otras razones. Para cualquiera hace falta además un rasterizador de PDF (p. ej. `pdfjs-dist` + `@napi-rs/canvas`, a justificar entonces) y un cultivo determinista.

### Localización humana de visuales originales (opción C, 2026-10-05)

**Flujo.** `original` → la docente señala dónde está el visual (página + rectángulo) → `material_visual_locators` (revisión versionada) → el **servidor** renderiza esa página del original y recorta → PNG en el bucket privado `generated-assets` → `material_visual_assets` (inmutable) → el renderer lo usa. Nadie sube una imagen: la fuente de verdad sigue siendo el original. Sin IA, sin OCR, sin visión artificial.

**Rasterizador (spike local, `scratchpad`).** Elegido **pdf.js `pdfjs-dist@6.4.299` (Apache-2.0) + `@napi-rs/canvas@1.0.10` (MIT, Skia, binario precompilado por plataforma vía `optionalDependencies`; `linux-x64-gnu` está en el lockfile; sin binarios del sistema)**: render correcto de texto con fuentes estándar no incrustadas, raster embebido, figura vectorial y recta numérica, /Rotate 90/180/270, CropBox desplazado, determinista (mismo hash en dos pasadas); también decodifica PNG/JPEG/WebP para imágenes subidas (no hace falta `sharp`). La pareja de versiones importa: pdf.js 5.4 con canvas 1.0 da *segfault* al pintar imágenes; 6.4 declara `^1.0.10`. Descartados: PDFium WASM (`@hyzyla/pdfium`, falla en `FPDF_GetPageWidth` con Node 24 en dos versiones), `mupdf` (AGPL-3.0), poppler/GraphicsMagick (binarios del sistema), Chromium/Playwright como servicio (peso). Impacto: ~66 MB de `pdfjs-dist` en `node_modules` y ~30 MB del binario de canvas; en la función solo entran los ficheros trazados (169).

**Coordenadas (`src/lib/materials/visuals/geometry.ts`).** Superficie = la página tal como se ve: CropBox (o MediaBox) con /Rotate aplicado, o la imagen subida (una página lógica). Origen arriba a la izquierda, `y` hacia abajo, `x, y, w, h` normalizados a 0–1. La herramienta dibuja sobre una imagen de esa misma superficie renderizada por el servidor con el mismo rasterizador (110 ppp, `/api/materials/[id]/pages/[n]`), así que zoom, scroll o tamaño de pantalla no cambian las coordenadas y la rotación/CropBox se resuelven una sola vez. Tamaño mínimo 2 % por lado; dentro de la página; finitos.

**Contrato `VisualLocator v1`** (`recipe.ts`, tabla `material_visual_locators`): `locator_version`, `material_id`, `analysis_fingerprint`, `visual_id`, `source_sha256` (= `materials.content_hash`), `revision`, `method` (`human`; otros métodos con otra migración), `page`, bounds, `page_box` (calculada por el servidor; el productor no recorta si la página ya no coincide), `created_by`, `created_at`, `superseded_at`, `last_failure`. Sin `adaptation_id`, sin perfil, sin respuestas. Una activa por visual y análisis (índice parcial); una corrección crea la revisión siguiente y marca la anterior como sustituida, en una transacción con candado (`create_visual_locator`). Triggers impiden reescribir coordenadas o reactivar una sustituida. La página puede corregirse (la confirmada queda en el localizador; `MaterialAnalysis` no cambia).

**Receta `visual_crop@v1`** (auditada): 200 ppp (A4 = 1654×2339 px), margen 1 % del lado corto (≈2 mm) recortado a la página, máximo 4096 px, sin reescalado, **PNG** siempre (líneas y texto sin artefactos). Versionada y con huella; cambiarla es otra versión.

**Asset** (`material_visual_assets`, filas inmutables). Tres conceptos separados:

- **Recorte lógico = `identity`**: huella(localizador completo + receta). No incluye el PNG ni la versión del motor, Node o la plataforma.
- **Instancia física = una fila**: un PNG concreto de ese recorte lógico, con `recipe_version`, `recipe_fingerprint`, MIME, dimensiones, bytes, sha-256 y procedencia (región en píxeles y motor que lo renderizó de verdad: `pdfjs-dist`, `@napi-rs/canvas`, Node, plataforma y arquitectura, leídos en ejecución, solo para auditar). Un mismo recorte lógico puede tener **varias** instancias: un render válido no tiene por qué ser byte a byte idéntico en otro runtime (se observó con las fixtures PDF entre el entorno local y Vercel). Unicidad: `(identity, sha256)` (migración 017). Ruta direccionada por contenido, `workspace/material/visuals/<identidad>/<sha-256>.png`; las instancias anteriores a la 017 conservan la ruta registrada en su fila (`<identidad>.png`) sin mover nada.
- **Checksum = `sha256`**: integridad de los bytes de **su** instancia, nunca un requisito sobre lo que produzca una regeneración futura.

Producción idempotente y segura en concurrencia (`produceVisualAsset`): si alguna instancia del recorte verifica, no se renderiza ni se escribe nada. Si ninguna verifica, se renderiza: si los bytes coinciden con una instancia existente (su objeto se perdió o se dañó), se reponen esos bytes exactos en **su** ruta; si no coinciden (otro runtime), se guarda una **instancia nueva** en su propia ruta. Ningún objeto se sustituye por bytes distintos de los que certifica su fila. Dos productores con los mismos bytes dejan una fila y un objeto (la subida sin `upsert` responde «ya existe», se verifica el objeto y la segunda inserción de `(identity, sha256)` se ignora); con bytes distintos quedan dos instancias, sin que ninguna pise a la otra. Resolución: de la instancia más reciente a la más antigua (`created_at desc, id desc`), se sirve la primera cuyo objeto existe y cuyo sha-256 coincide con su fila; una instancia dañada no oculta a otra válida y, si ninguna verifica, se informa el problema de la más reciente. `asset_corrupt` significa solo que los bytes presentes no corresponden a su propia fila. Fallos: `source_missing`, `page_missing`, `invalid_bounds`, `extraction_failed`, `unsupported_source`, `asset_missing`, `asset_corrupt` (errores de asset, nunca pedagógicos), guardados en `last_failure` para reintentar sin volver a seleccionar.

**Por qué dos tablas.** La localización es una decisión (humana, corregible, auditable); el recorte es un derivado binario inmutable. Mezclarlos haría imposible saber qué recorte salió de qué decisión.

**Estado para la vista docente:** `missing_locator`, `located_processing`, `ready`, `extraction_failed` (`src/lib/render/visual-assets.ts`). Un asset solo cuenta como `ready` si el objeto se puede leer con los permisos del usuario **y** su sha-256 coincide con el registrado: la fila de la base de datos sola no basta.

**Producción y autorización.** `POST /api/materials/[id]/visuals/[visualId]` (Route Handler con comprobación de mismo origen, por ser un trabajo tipo job; las páginas de App Router no reciben `outputFileTracingIncludes` con Turbopack y el smoke lo detectó). El cuerpo solo admite `{action:"locate", page, bounds}` o `{action:"retry"}` (estricto). El servidor resuelve con el cliente del usuario (RLS) el material, su análisis y huella, que el visual existe, el archivo original (verificado por sha-256), el número de páginas y la caja de página; solo después escribe con service role. Rol de solo lectura → 403; otra cuenta → 404. El navegador nunca envía un PNG ni rutas de Storage.

**Lectura.** `GET /api/adaptations/[id]/visuals/[visualId]` sirve los bytes verificados (RLS en adaptación, localizador, asset y objeto; `private, max-age=300`); no se crean ni guardan URLs firmadas. El bucket sigue privado.

**Histórico.** Las adaptaciones resuelven con su `analysis_fingerprint` fijado y el original actual: un localizador de otro análisis u otro archivo nunca se usa (sin reutilización difusa). Varias adaptaciones del mismo material y análisis comparten el recorte. Una adaptación antigua aprovecha un recorte añadido después (recupera contenido que siempre estuvo en el original). Si se **corrige** la localización, la vista previa actual muestra la activa; las revisiones y recortes anteriores se conservan intactos, y la futura exportación (5.2) deberá fijar la **instancia** exacta usada (id del asset + sha-256), no solo la identidad lógica, para no cambiar en silencio: `readAssetInstance` devuelve esos bytes o un fallo explícito, nunca otra instancia del mismo recorte. Una regeneración posterior puede producir otra instancia válida con otros bytes; la reproducción exacta de una exportación histórica depende de conservar su instancia (o el PDF exportado), no de volver a renderizar. Borrar el material borra en cascada localizadores y filas de assets; los objetos de Storage se quedan (sin recolector todavía, como el resto del bucket).

**Renderer.** Con asset, el visual necesario deja de bloquear (`not_renderable → renderable`), la hoja del alumno lo muestra con proporción y anchura máxima de página, nombre accesible = pie impreso o «Recurso visual de la actividad» (nunca la descripción libre del analizador). El panel docente lista cada imagen del original con su estado, procedencia mínima («localizada a mano en la página 2, revisión 1») y «Localizar en el original» / «Localizar también» (opcionales, no bloquean) / «Corregir la localización». No se toca la adaptación (ni versión, ni revisión pedagógica, ni documento).

**Despliegue.** `serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"]` y `outputFileTracingIncludes` (worker, fuentes estándar y `package.json` de pdf.js) para las dos rutas que rasterizan. Esos globs apuntan al **directorio físico** del paquete (`packageFiles` de `next.tracing.ts`: lo localiza como Node y lo canoniza con `realpath`), nunca a `./node_modules/pdfjs-dist/...`. Con pnpm ese directorio es un symlink al almacén virtual: la Function llevaba cada fichero dos veces (ruta lógica y física) y Vercel rechazaba el paquete («files in symlinked directories»). Comprobado con `vercel build` local: de 19 entradas a través del symlink a 0, y de 299 ficheros (55,8 MB) a 280 (47,5 MB). Con npm plano el directorio ya es físico y el resultado es el mismo. `scripts/smoke-raster.mjs` (en `pnpm check`) lee la traza real de esas rutas y renderiza desde una **copia aislada** de solo los ficheros trazados; encontró dos fallos reales antes de desplegar (claves de glob con corchetes y `package.json` sin trazar). Límite del smoke local: corre en la plataforma local y no ejecuta el binario `linux-x64-gnu` de Vercel; esa comprobación se hizo después en una Function real (párrafo siguiente).

**Validación en Vercel (Preview).** El rasterizador se ejecutó en una Function real de un deployment Preview de Vercel, mediante una ruta de humo temporal solo para Preview (fixtures sintéticas, mismo `renderPage`/`encodePng` y receta `visual_crop@v1`, sin Supabase ni datos reales). Esa ruta vive únicamente en la rama de validación (commit `ba80257`, no mergeada): no forma parte de `main`. Resultado observado en ejecución:

- **Runtime:** Node 24.21.0, `linux-x64`, glibc 2.34. `pdfjs-dist` 6.4.299 y `@napi-rs/canvas` 1.0.10 cargados y ejecutados; binding nativo `@napi-rs/canvas-linux-x64-gnu` cargado. Sin errores de ABI, libc, arquitectura ni `MODULE_NOT_FOUND`; el worker, las fuentes estándar de pdf.js y el binding se resolvieron en la Function, de modo que el empaquetado quedó demostrado por ejecución y no solo por la traza.
- **Fixtures** (`basic`, `vector`, `rot90`, `rot180`, `rot270`, `cropbox`, `image`): PASS. PNG válido en todos los renders y marcador en las coordenadas esperadas, con rotaciones y CropBox resueltos como en local.
- **Determinismo:** byte a byte dentro del mismo deployment (cuatro renders por fixture, dos invocaciones, mismo SHA-256).
- **Rendimiento observado (orientativo):** página PDF A4 a 200 ppp ≈ 273–377 ms en caliente (≈ 630 ms el primer render en frío); imagen ≈ 38 ms; RSS ≈ 153–210 MB; sin timeouts.

**Límites de la evidencia y deuda abierta.**

1. El deployment que funcionó usó Vercel CLI 54.14.0. Con Vercel CLI 62.1.0 el mismo código falló después de compilar con `patch_build_4xx` (paquete de despliegue inválido para una Serverless Function, atribuido a directorios con symlinks).
2. La CLI 54.14.0 no interpretó correctamente el `pnpm-lock.yaml` de pnpm 12 y terminó instalando con npm. Es decir, la evidencia corresponde a un `node_modules` plano instalado con npm, no al árbol bloqueado de pnpm. `pdfjs-dist` y `@napi-rs/canvas` están fijados a versión exacta y se observaron esas versiones, pero el resto de dependencias no se instaló desde el lockfile.
3. La combinación final **pnpm 12 + builder de Vercel de producción** no está demostrada con ninguna versión de CLI y sigue siendo deuda de infraestructura.
4. **Resuelto:** el cron `*/5 * * * *` de `/api/cron/adaptations` no era compatible con el plan Hobby. Ahora los jobs pedidos por el docente se ejecutan al momento en su propia petición y los dos crons son diarios y solo de recuperación (ADR-004).
5. Los PNG de las fixtures PDF fueron deterministas dentro de cada runtime, pero **no** byte-idénticos entre el entorno local de validación (Linux, Node 22.22, glibc 2.39) y Vercel (Node 24.21, glibc 2.34). La fixture de imagen sí coincidió. La causa no está diagnosticada.
6. **Resuelto (migración 017):** antes, `produceVisualAsset` comparaba el SHA-256 del PNG regenerado con el de la única fila de su identidad y devolvía `asset_corrupt` si diferían, después de haber sobrescrito ya el objeto. Una regeneración válida en otro runtime dejaba el visual atascado. Ahora cada PNG es una instancia física propia (ver **Asset**) y la regeneración entre runtimes crea una instancia nueva sin tocar las anteriores.
7. La ruta de humo reutiliza el mismo conjunto de ficheros trazados (`RASTER_FILES`) que las dos rutas de producción, pero estas últimas no se invocaron en Vercel (exigen sesión, base de datos y Storage): su empaquetado se apoya en esa equivalencia y en `smoke:raster`.

**Deuda menor (sin resolver):** cambiar la receta (`visual_crop@vN`) cambia la identidad lógica; `resolveVisuals` ignora las instancias de la receta anterior y el visual queda en `located_processing` hasta que alguien reintente su producción a mano. No hay regeneración automática de los recortes al cambiar de receta.

**Límites.** Selección cómoda en escritorio; en móvil funciona con arrastre pero se recomienda pantalla grande. Imágenes subidas con orientación EXIF se muestran como están almacenadas (la herramienta y el recorte usan la misma imagen, así que coinciden). Sin herramienta para subir una imagen alternativa (feature distinta).

## Exportación PDF — Fase 5.2A: motor, HTML autocontenido y validación (local)

**Estado.** Motor implementado y probado **en local**. **Validación en runtime de Vercel: PENDIENTE.** Sin base de datos, sin jobs, sin Storage de PDFs, sin rutas de exportación y sin UI: eso es la 5.2B/C. Cero llamadas a modelos.

**Una sola maquetación.** `MaterialDocument` → `buildRenderModel()` → `RenderModel` → `renderPrintHtml()` (`src/lib/render/print/html.ts`) → Chromium → PDF. `renderPrintHtml` renderiza el **mismo** `MaterialSheet` de la vista con el **mismo** `material.css`; Chromium solo aplica `@page` y los `break-*` que ya existían. `pdf-lib` no dibuja nada: solo lee el PDF para validarlo.

**Render de React en el servidor (spike con Next 16.3.8).** En un Route Handler (capa RSC, la de los endpoints que ejecutan jobs), Turbopack **rechaza `react-dom/server` en el build** («You're importing a component that imports react-dom/server»). En cambio, `react-dom/static` → `prerenderToNodeStream` compila y, en un build de producción (`next build` + `next start` con un Route Handler temporal, no commiteado), devolvió el HTML real de `MaterialSheet`. Lo que entra en el bundle es el renderer estático que trae Next (React 19.3 canary), no un *stub*. Riesgo declarado: la tabla de alias de Next marca esa entrada de la capa de servidor como «incorrecta». Una versión futura podría prohibirla, así que la ruta real de la 5.2B debe volver a comprobarlo en su propio smoke. Mismo spike: un `.css` referenciado con `new URL(…, import.meta.url)` **no** se traza (apunta a la ruta del código fuente). Por eso `material.css` y las fuentes se leen desde `process.cwd()` y deberán incluirse con `outputFileTracingIncludes`.

**HTML autocontenido.** Documento completo: CSP en `<meta>` (`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'`), el `material.css` real con sus `url("./fonts/…")` sustituidas por data URIs de los bytes verificados (cualquier otra `url(` o `@import` es un error), y `MaterialSheet` en modo `student`. El modo docente, otra versión del renderer, un visual sin fijar o con otros bytes son errores explícitos. No contiene scripts, enlaces, URLs `http(s)`, cookies, rutas `/api`, Supabase ni URLs firmadas. Tampoco el panel docente, la clave de respuestas, respuestas inferidas, ids ni trazas (tests en `tests/unit/print-html.test.ts`).

**Visuales fijados.** El `RenderModel` de una exportación lleva `asset:<assetId>@<sha256>` como `src` (estable y parte de su *fingerprint*). Los bytes viajan aparte (`PinnedAsset`: id, sha-256, MIME, bytes) y solo `renderPrintHtml` los convierte en data URI, tras comprobar el checksum y la firma PNG. Si se aporta una instancia más reciente del mismo visual, se ignora. Si falta la fijada, error `asset_unpinned`: nunca hay sustitución. La 5.2A usa fixtures; la 5.2B leerá los bytes con `readAssetInstance`.

**`material_renderer@v2`.** Sube de versión porque la salida impresa gana garantías nuevas:
1. **Fuente local fijada.** Inter 4.1, tres caras estáticas oficiales (400/600/700) en WOFF2 con su licencia OFL, en `src/components/material/fonts/`. La familia «Adaptaula Inter» se declara en `material.css`, así que la pantalla (servida desde `/_next/static/media`, sin CDN) y el PDF usan los mismos ficheros. Las sumas sha-256 están fijadas en `sheet-assets.ts`: un fichero distinto hace fallar la impresión. `font_fingerprint` = huella de familia, versión y sumas. No se usa la fuente variable porque Chromium 153 la incrusta como **Type3**. La cursiva se sintetiza, igual que antes en la app (`next/font` solo cargaba el estilo normal).
2. **Reset propio de especificidad cero** (`:where(.ms-root …)`): la hoja ya no depende del *preflight* de Tailwind, que el PDF no tiene. Corrige un fallo que existía: ese *preflight* pone `list-style: none`, así que en la app **los pasos numerados, las listas numeradas y la columna izquierda de «relacionar» salían sin número**. v2 los numera explícitamente.
3. Las fórmulas usan la familia de la hoja (antes, la monoespaciada del sistema).
4. Un visual se reduce al 75 % del alto útil de la página. Con el tope anterior (alto útil − 4em), el smoke mostró una página casi vacía y el pie de figura solo en otra página.
5. **Números de página físicos** con márgenes de página CSS (`@page { @bottom-right { content: counter(page) " / " counter(pages) } }`). Probados en el Chromium exacto del motor: correctos y en el margen inferior derecho en todas las fixtures. Sin `headerTemplate`/`footerTemplate`. El pie «N / M» de pantalla cuenta páginas lógicas y se oculta al imprimir.
6. Al imprimir, `html` y `body` sin margen.

El E2E del visor pasa con v2 (escritorio y móvil), con comprobaciones nuevas de la fuente local cargada y de la numeración.

**Motor (`PdfEngine`, `src/lib/render/print/engine.ts`).** Implementación Chromium: `playwright-core` **1.63.0** con `@sparticuz/chromium` **153.0.0** (MIT, Node `^22.17 || >=24`). Playwright 1.63 está hecho para Chromium 153 y el binario serverless reporta 153.0.8010.0. Funcionamiento:
- **Un navegador por render.** Con `--single-process`, cerrar la última página termina el navegador (comprobado), y así ningún estado se comparte entre dos documentos.
- Se usan los flags del paquete **menos** `--disable-web-security` y `--allow-running-insecure-content`. `--no-sandbox` queda (es inherente al Chromium serverless): por eso el documento no tiene scripts, lleva CSP y la red está cortada.
- Contexto `offline`, `serviceWorkers: "block"` y `route("**/*")` que aborta todo: cualquier petición hace fallar el render (`network_attempted`). El test lo comprueba con un servidor local real, que recibe **0** peticiones.
- El HTML entra por `setContent` y JavaScript sigue activo solo para las comprobaciones de Playwright: un `<script>` del documento **no** se ejecuta (CSP, probado).
- Antes de `page.pdf()`, *readiness* sin esperas arbitrarias: `document.fonts.ready`, carga de cada peso de la familia esperada y familia computada de `.ms-root`, imágenes `complete` + `decode()`, `readyState` y estabilidad del alto entre fotogramas. Una fuente o una imagen que no llega es un fallo explícito (`font_not_ready`, `asset_not_ready`).
- `page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true, tagged: true })`: el PDF sale **etiquetado** (`StructTreeRoot` + `MarkInfo`).
- Procedencia leída en ejecución: versiones de Playwright, del paquete Chromium y del propio Chromium, Node, plataforma y arquitectura.

**`PdfValidation`** (`validation.ts`, solo `pdf-lib`: ni pdf.js ni canvas en el bundle del motor). Es distinta de `PedagogicalReview` y de `RenderValidation`. Comprueba:
- Que sea un PDF (`%PDF-`, `%%EOF`) que `pdf-lib` puede abrir y que no está cifrado.
- Tamaño ≤ 20 MiB y entre 1 y 60 páginas, nunca menos que las páginas lógicas del modelo.
- Cada página A4 ± 2 pt y sin rotación.
- Ninguna página sin marcas (ni texto, ni imagen, ni dibujo).
- Fuentes todas incrustadas, ninguna Type3, todas con el prefijo `Inter`: una fuente de respaldo aparecería aquí.
- Al menos tantas imágenes como visuales fijados, y PDF etiquetado.

Calcula el sha-256. En el smoke tarda 1–17 ms.

**`pnpm smoke:pdf`** (en `pnpm check`, tras `smoke:raster`). Genera PDFs reales con el motor y el renderer de producción y los analiza a fondo: texto con pdf.js, cada página a PNG a 100 ppp con el rasterizador de visuales y métricas de tinta. Hay 20 fixtures:
- básico (en frío y en caliente), caracteres españoles, instrucciones largas, tabla, gráfico de una serie y gráfico degradado a tabla;
- visual necesario, visual recortado de un original con `/Rotate` y CropBox desplazado (recorte real del pipeline), visual más alto que una página;
- respuesta corta, respuesta larga, checklist de 12, varias páginas lógicas, diez páginas;
- hoja que llena **exactamente** una página (búsqueda binaria de líneas: ni página en blanco detrás ni entre hojas), salto cerca de un visual (pasa entero a la siguiente), salto cerca de una tabla (sigue con la cabecera repetida), tabla larga de 40 filas (cabecera en cada página, ninguna fila partida ni perdida), actividad larga.

En cada una se comprueba: validación sin incidencias, A4, solo Inter, ninguna petición, ninguna página en blanco, número físico `N / M` en el margen inferior derecho, nada fuera de los márgenes, sin contenido docente ni clave. Más 4 tests negativos del motor (red, fuente, imagen, script). Pasa con Node 22.22 y con Node 24.21 (Linux x64, Ubuntu 24.04).

**Regresión visual.** Sin *golden files* de imagen: `tests/pdf/baselines.json` (una línea por fixture) guarda el número de páginas y la proporción de tinta por página, y se compara con tolerancia de ±0,4 puntos. A eso se suman las comprobaciones estructurales: márgenes, posición del número, visuales enteros detectados por color y filas de tabla. Las líneas base generadas con Node 24 se cumplen con Node 22. Se regeneran con `UPDATE_PDF_BASELINES=1`.

**Caracteres españoles.** Todos se dibujan con Inter incrustada, sin fuente de respaldo: ñ á é í ó ú ü ¿ ¡ º · … « » – — “ ”. **Limitación conocida:** «”» (U+201D) se extrae como «ˮ» (U+02EE) al copiar el texto, porque Inter comparte el glifo y el mapa de texto de Chromium nombra el código más bajo. Se ve bien; el test fija este comportamiento para que no cambie sin aviso.

**Medidas locales** (orientativas: este contenedor, no Vercel):
- Primer PDF en una instancia nueva: ≈2,1–2,4 s, porque extrae Chromium (≈207 MB en `/tmp`).
- En caliente: 0,2–0,37 s por PDF (lanzar ≈35 ms, `setContent` ≈110–280 ms, *readiness* 25–70 ms, `page.pdf` 11–46 ms con 10 páginas), validación 1–17 ms.
- RSS pico de Chromium: 161–183 MB. PDFs de 12–104 KB.
- En disco: `@sparticuz/chromium/bin` 66,8 MB comprimidos (`chromium.br` 63,9 MB), `playwright-core` 12,8 MB, fuentes 0,3 MB. Unos 80 MB antes del resto del bundle.

**Prueba en el runtime de producción de Next (local).** Con un Route Handler temporal (no commiteado) que llama a `renderPrintHtml` → motor → `validatePdf`, `next build` + `next start` devolvieron un PDF válido: ≈2,2 s el primero (extracción) y ≈0,2 s los siguientes. Su traza (`.nft.json`) tenía 303 ficheros y 13,7 MB (10,9 MB de `playwright-core`). Ya incluía `material.css` y las tres fuentes, pero **no** el binario de Chromium (`@sparticuz/chromium/bin`).

**Lo que necesitará la Function de exportación (5.2B, sin hacer).**
- `serverExternalPackages`: nada que añadir, porque Next 16 ya trata `playwright-core` y `@sparticuz/chromium` como externos por defecto.
- `outputFileTracingIncludes` con `packageFiles("@sparticuz/chromium", ["bin/*"])` (ruta física, 66,8 MB; nunca `./node_modules/@sparticuz/chromium/...`, que con pnpm atraviesa un symlink). Total estimado de la Function: ≈80 MB.
- Un smoke que lea su `.nft.json` y renderice desde una copia aislada, como `smoke:raster`.
- Memoria ≥ 1 GB y `/tmp` para ≈210 MB.

**Pendiente de verificar en Vercel (Preview):**
- Que el binario arranca en el runtime real. `@sparticuz/chromium` solo añade sus librerías de Amazon Linux 2023 si detecta el entorno por variables de AWS.
- Tamaño real de la Function, arranque en frío, memoria y tiempos.
- Que `prerenderToNodeStream` funciona en la ruta real.
- Los diccionarios de guionado (`hyphens: auto`) del binario serverless.

**Deuda menor.** El paquete extrae también SwiftShader (≈6 MB) aunque los gráficos estén desactivados.

## Evals

`evals/adaptation/` (ver su README): tres materiales sintéticos modelados sobre los validados en la Fase 3 (Primaria fracciones, ESO geografía, Bachillerato argumentación) y perfiles funcionales de lectura, funciones ejecutivas, lenguaje, carga visual, reducción de escritura, conflicto apoyo/objetivo y ampliación. `pnpm eval:adaptation:mock` ejecuta el pipeline completo con los mocks (coste 0). No se evalúa si la ficha «queda bonita»: se evalúa que conserve el objetivo y aplique los apoyos.
