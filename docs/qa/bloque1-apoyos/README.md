# Bloque 1 · apoyos que realizan el razonamiento del alumno (auditoría en modo sombra)

> Estado: `support_audit@v1` (#88) quedó **superado por la etapa 2.1** (`support_audit@v2`, más abajo): la regla vive ahora en un solo sitio, `assessment-safety.ts`.

Rama `claude/zealous-shannon-k7w4v4` sobre `main` (`7912530`, con las PR #86 y #87). Sin migraciones, sin despliegue, sin E2E, sin
llamadas de pago. **Primer paso: aviso interno.** No bloquea, no cambia la ficha, no pregunta nada al docente y no se muestra.

## El problema (adaptación `60bc9629…`, actividad 3a)

El glosario de `dec_6` salió de dos necesidades **bajas** (`background_knowledge_support`, `vocabulary_support`) y se aplicó a la
actividad cuya competencia evaluada es exactamente ese concepto («Explica qué indican las flechas del esquema»). Nada lo detectó:
`answers_not_leaked` compara con `expected_answer` y en 3a es `not_inferable`; el revisor de IA solo recibe el ámbito de la fuga
semántica cuando esa comprobación lo marca. Ninguna capa preguntaba si el apoyo **hace la operación evaluada**; solo se detectaba
la copia literal de la respuesta.

## Qué hace `support_audit@v1` (`src/lib/adaptation/support-audit.ts`)

Determinista, puro, con campos estructurados del análisis (nunca el verbo de una consigna). Para cada apoyo generado
(`origin` `support`/`extension`) ligado a una actividad:

| Código | Cuándo |
| --- | --- |
| `defines_evaluated_concept` | Entrada de glosario cuyo **término entero** es el concepto/operación/restricción protegidos (o el objetivo) de una actividad que pide explicar o interpretar (`short_answer`, `open_question`, `reading_comprehension`, `graph_interpretation`, `experiment`); o una idea clave que comparte ≥ 2 raíces con ello. |
| `reuses_task_data` | Ejemplo resuelto cuyo enunciado trabaja con los números de la propia tarea (un ejemplo es siempre análogo: otros datos). |
| `contains_answer` | Apoyo que lleva la respuesta que el análisis da (dada o deducida) para su actividad. |

Cada aviso lleva `low_need_only` (todas las necesidades que cubre son de nivel bajo: el caso del estanque). El resultado se guarda
en la carga de `deterministic_review` (`support_audit`), **fuera de la huella** (es una medición, no una entrada) y dentro de un
`try/catch`: nunca detiene la generación. Solo códigos, ids de bloque/actividad/decisión y recuentos: ni una palabra del material
ni de las respuestas. El registro de operación lleva únicamente códigos y ids de actividad.

## Pruebas

- `tests/unit/support-audit.test.ts` (10): el glosario de 3a avisa (`low_need_only`) y nada más en la ficha; no toca el documento; el
  registro no contiene texto; un glosario de otra cosa, un cálculo o un recordatorio de método no avisan; un ejemplo con los datos
  de la tarea avisa y el real (otros datos) no; apoyo con la respuesta avisa; necesidad alta frente a baja; raíces de contenido.
- `tests/db/magic-never-review.test.ts`: en la canalización real (PGlite) la ficha se entrega igual, la auditoría queda registrada
  en `deterministic_review` y solo contiene códigos e ids.

## Límites conocidos (declarados)

- Es léxica sobre campos estructurados: raíces de cinco letras. Puede avisar de un glosario legítimo cuyo término coincide con el
  concepto (por eso es aviso y se mide su precisión antes de que actúe) y no ve una paráfrasis sin palabras en común.
- No juzga la **resolución indirecta** (un apoyo que no nombra el concepto pero lo deja resuelto): eso necesita el revisor
  semántico, y un revisor nuevo es un prompt versionado.

## Siguiente (no incluido)

1. Medir el precio de falsos avisos con adaptaciones reales (`support_audit.warnings`, sin contenido).
2. Prevención en el plan: no añadir un glosario o idea clave por necesidades bajas sobre una actividad cuyo concepto evaluado es ese
   término (cobertura por otra decisión, o no ejecutar), sin devolver nada al docente.
3. Ámbito semántico para el revisor de IA (`answers_not_leaked` sin respuesta deducida), con `pedagogical_reviewer@v2`.

## Etapa 1 · medición con adaptaciones reales (2026-11-12, solo lectura)

22 adaptaciones del piloto (última versión de cada una), unos 110 apoyos en 5 fichas; unos 70 distintos revisados a mano y 16 pasados por el detector real.
Límites: pocas fichas y perfiles; las adaptaciones no guardan las dimensiones de cada decisión; el análisis pudo cambiar después.

| Resultado sobre 16 casos | n |
| --- | --- |
| Avisa y acierta (glosario de 3a) | 2 |
| Avisa por una razón equivocada (fracciones: dígitos sueltos) | 1 |
| No ve un error real (célula «Núcleo», analogía de la membrana) | 2 |
| Sin aviso y correcto (ejemplos de otro dominio o con otros datos, ideas clave de requisito) | 8 |
| Gris: tarjetas de criterio (primos, ser vivo, numerador/denominador) | 3 |

Hallazgos clave: (1) el ejemplo «Pista: *Contiene la información que dirige la actividad de la célula* → Núcleo» entregó la respuesta del ítem a) en una adaptación «ready»; no saltaba porque `contains_answer` buscaba la respuesta completa de varios apartados; (2) los dígitos sueltos dan falsos avisos y aciertos casuales; (3) la analogía «protege y separa el interior del exterior → la pared» comparte con la pista real («Regula el paso de sustancias entre la célula y el exterior») una sola raíz léxica: es un caso semántico; (4) ya existía `supportsDefiningEvaluatedConcepts` (bloqueante y muy estrecha: categorías de la propia consigna), lo que duplicaba el mecanismo.

## Etapa 2.1 · unificación (`support_audit@v2`)

Decisiones aprobadas: una tarjeta de criterio es válida cuando la actividad evalúa **aplicar** ese conocimiento y el alumno sigue haciendo la operación; no lo es si entrega el concepto, el razonamiento, la clasificación o el resultado evaluados (la necesidad alta justifica apoyos más intensivos, nunca sustituir el aprendizaje evaluado).

Un solo sitio (`assessSupports`, `assessment-safety.ts`; evidencias en `support-evidence.ts`) con la clase de cada hallazgo:

| Código | Evidencia | Acción |
| --- | --- | --- |
| `defines_listed_categories` (la protección de siempre) | verificable | **bloquea** (sin cambios) |
| `direct_answer_part` | verificable: una **parte** de la respuesta (apartados «a) … b) …»), completa, que la hoja no muestra ya | aviso |
| `example_solves_item` | verificable: un ejemplo cuyo resultado/pasos llevan esa parte | aviso |
| `example_near_item` | estructural: demuestra la misma relación («2/4 = 1/2» junto a «4/8 = 1/2»), forma reducida, con otros números | aviso |
| `example_reuses_data` | estructural: ≥ 2 números o fracciones **completos** de la tarea y la mitad o más de los suyos | aviso |
| `assigns_item_to_category` | estructural: un componente de la tarea asignado a una categoría de su tabla | aviso |
| `defines_evaluated_concept` | léxica: el término es el concepto evaluado y la actividad pide explicar o interpretar | aviso |

`cleared` (lo que parece un hallazgo y no lo es): `criterion_card` (tarjeta de criterio para aplicar: primos, ser vivo) y `lexical_coincidence` (una sola raíz o un solo número comunes). Ninguna coincidencia de dos números, palabras o categorías basta por sí sola; un hallazgo nuevo nunca bloquea (probado: solo `defines_listed_categories` tiene acción `block`). Registro: `deterministic_review.support_audit`, solo códigos, ids y recuentos.

Pruebas: `tests/unit/support-safety-real-cases.test.ts` (20, casos reales: 3a, «Núcleo», membrana, fracciones, primos, seres vivos, ejemplos legítimos, regresión de la protección actual) y `tests/unit/support-audit.test.ts` (10); la de base de datos comprueba el registro v2 en la canalización real.

Límite declarado: la analogía de la membrana (y «material genético» frente a «Contiene el ADN») no es detectable por palabras; queda para el revisor semántico (etapa 2.3). La sustitución funcional (2.2) y el revisor (2.3) siguen pendientes.
