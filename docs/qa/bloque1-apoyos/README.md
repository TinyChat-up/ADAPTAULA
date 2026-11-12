# Bloque 1 · apoyos que realizan el razonamiento del alumno (auditoría en modo sombra)

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
