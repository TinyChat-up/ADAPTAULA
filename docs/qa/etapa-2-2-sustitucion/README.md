# Etapa 2.2 · sustitución funcional de apoyos que revelan la respuesta

Rama `claude/zealous-shannon-k7w4v4` sobre `main` (`ba7c116`, con #86–#89). Sin migraciones, sin despliegue, sin E2E, sin llamadas
de pago (generador simulado). Continúa la [etapa 2.1](../bloque1-apoyos/README.md): los avisos de allí siguen siendo avisos; aquí solo
**dos** señales pueden provocar una reparación, y ninguna cambia una necesidad.

## Qué provoca una acción y qué no

| Evidencia | Qué hace |
| --- | --- |
| **A · literal y fiable**: el apoyo lleva una **parte** de la respuesta que la hoja no muestra y que es fiable (la da la propia hoja, o es deducida **y** el material la contiene) | Reparación: regenera la decisión con la restricción; si lo repite, **una** sustitución; si no hay alternativa, se omite y se registra |
| **Declinado**: el generador se negó por `would_reveal_answer` | **Una** sustitución con otro apoyo que sirva la misma necesidad; sin alternativa, omitido y registrado, o parada honesta |
| **B · estructural** (datos de la tarea, misma relación, componente asignado) | Nunca una llamada por sí sola. Si ya se repara otra decisión, su restricción viaja en esa regeneración |
| **C · léxica** (el glosario define lo evaluado, actividad de explicar) | Restricción previa en la **primera** generación (qué no definir); sin llamada ni cambio de decisión |
| Respuesta solo deducida y sin apoyo en el material, `cleared` | Se conserva el apoyo; queda el aviso (ante la duda, no se toca) |

## Cómo se elige la alternativa (`support-substitution.ts`)

Determinista, sin modelo, sin secuencia fija. Un apoyo sustituye a otro **solo si sirve las mismas necesidades** (`kindServes`, derivado de
la taxonomía de estrategias): una pregunta guía no sirve el vocabulario ni un recordatorio sirve «ejemplos resueltos». Si el sustituto
deja una necesidad sin servir se completa con **un** apoyo seguro más (vocabulario secundario + pregunta guía; ejemplo de otro ámbito +
recordatorio del procedimiento); si no se puede, no hay alternativa. Luego debe pasar las invariantes y tener ejecutor (`viable`).
El orden depende de la actividad (explicar o interpretar prefiere la pregunta guía; aplicar un procedimiento, el recordatorio de método) y del
perfil (necesidades altas). Nunca se editan `target`, `dimensions` ni `preserves`: solo los apoyos. Nunca se baja la exigencia curricular: ningún
apoyo sustituto resuelve la consigna (su restricción lo prohíbe y la auditoría lo vuelve a comprobar).

## Cobertura honesta

Si una decisión se omite, cada necesidad se clasifica por lo más cercano que de verdad la sirve **para esa actividad** (`coverageOf`):
`same_activity` (otra decisión de esa dimensión sobre la misma actividad), `reachable_resource` (sobre un recurso que la actividad usa o sobre el documento
entero, `reaches`), `presentation` (la resuelve la presentación) o `none`. **La misma dimensión en otra actividad que no la alcanza no cubre nada, sea cual sea
el nivel de la necesidad.** Una necesidad **esencial** (alta) en `none` es la parada honesta de siempre; una media o baja se entrega y queda registrada como sin cubrir
(`uncovered`). El resultado se verifica en la **ficha final** (`resolutionOutcome`), no en el plan: `applied` solo si el apoyo (el sustituto o el restringido) está en
el documento y sirve todas las necesidades; `partial`, `not_generated`, `flagged`, `omitted` (otra decisión que de verdad alcanza la actividad, con su apoyo presente) o `uncovered`.

## La sustitución cambia solo el apoyo

La entrada de la revisión conserva su `action`, `response_target`, intensidad, nota, `support_requests`, su motivo y **todas** sus restricciones (las nuevas se añaden;
si ya no caben las seis no se sustituye). Cubre una decisión ya editada y la variante segura de una resolución autónoma de V2.2. «Ya sustituida» se lee de los artefactos
(sobrevive a reinicios), no de una marca en el texto del motivo.

## Ciclos y coste (sin llamadas nuevas), también tras reinicios

El límite es por entradas distintas del generador (3) y lo aplica la base de datos: probado con un worker que se reinicia entre cada etapa (una llamada por generación,
tres como máximo, una sola sustitución), con visitas repetidas tras la parada y pidiendo otra generación a mano (ni un ciclo nuevo ni una llamada, aunque se procese: reutiliza
la generación guardada).

## Ciclos y coste (detalle)

Dentro de las 3 generaciones de siempre. Peor caso: 1.ª genera → 2.ª regenera con la restricción → **3.ª es la sustitución**; si aun así falla, parada
honesta (probado: nunca una cuarta llamada). Mejor caso: la restricción basta y son 2. Un rechazo `would_reveal_answer` tarda 2 (la sustitución es la
2.ª). Las evidencias B y C no añaden ninguna. Cada regeneración es la llamada del generador que ya existía; no hay llamadas de otro tipo.

## Interruptor y ensayo

`SUPPORT_SUBSTITUTION_MODE` = **`dry_run` (por defecto, también si la dependencia falta)** | `on` (activación explícita y controlada) | `off`.

- `off`: comportamiento anterior intacto (sin restricción previa, sin comprobación nueva, sin registro).
- `dry_run`: no cambia la generación ni sus restricciones (la revisión automática y lo que recibe el generador son idénticos a `off`); solo anota qué haría:
  `automatic.support_guard` (qué decisiones recibirían la restricción previa) y `deterministic_review.support_resolution_dry_run` (qué reparación/sustitución habría).
- `on`: restricción previa, reparación y sustitución. La restricción previa se aplica **al final** de las resoluciones automáticas (`applySupportGuard`), sobre lo que cada
  decisión llevará de verdad (tras la variante segura o la alternativa de V2.2) y sin pisar sus restricciones.

## Trazabilidad (códigos e identificadores, sin texto)

Por decisión: actividad, bloques, disparador (`literal_answer`, `declined_reveal`, `structural_signal`), códigos, modo, acción
(`restricted`, `substituted`, `omitted`, `stopped`, `would_*`), tipos antes y después, necesidades (nunca editadas), cobertura y
`semantic_review: "pending_2_3"` (**`cleared` no es una validación pedagógica**). Se guarda en `execution_report` (`automatic.support_resolution`)
y el resultado verificado (`clean`/`flagged`/`omitted`/`uncovered`) en `deterministic_review.support_resolution_outcome`.

## Pruebas

- `tests/unit/support-substitution.test.ts` (19), `tests/unit/support-safety-real-cases.test.ts` (20), `tests/unit/support-audit.test.ts` (10).
- `tests/db/magic-never-review.test.ts` (+17 sobre la canalización real con PGlite): restringido→limpio, sustitución en la tercera generación,
  nunca más de tres, declinado→alternativa, necesidad esencial sin alternativa (parada), omitido con cobertura por otra decisión, legítimos
  intactos, incertidumbre (se conserva), ensayo, apagado, trazabilidad sin texto, y la **célula** («… → Núcleo»): restricción, sustitución y entrega.
- Ajustado `tests/unit/adaptation-generator.test.ts`: un rechazo por `would_reveal_answer` ya no se acepta en silencio.

## Pendiente

La analogía semántica (la «casa» y la membrana) y todo lo que no sea literal: etapa 2.3 (revisor semántico sin llamada extra).
