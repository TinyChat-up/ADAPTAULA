# Etapa 2.3 · revisión semántica de los apoyos (`pedagogical_reviewer@v2`)

Rama `claude/zealous-shannon-k7w4v4` sobre `main` (`fcd7741`, con #90). Sin migraciones, sin despliegue, sin E2E, sin llamadas de pago
(revisor, generador y planificador simulados). **Instalada y apagada por defecto** (`REVIEWER_V2_MODE=off`): con el valor por defecto el
comportamiento es el del revisor v1 sin ningún cambio. `SUPPORT_SUBSTITUTION_MODE` sigue en `dry_run` y no se ha tocado ninguna variable de
Production.

## Qué resuelve

Un apoyo debe **dar acceso** a la tarea; no debe hacer lo que la actividad evalúa. Las etapas 2.1 y 2.2 detectan lo verificable (una parte de la
respuesta literal en el apoyo). Lo demás —el glosario que explica qué indican las flechas, la analogía de la casa que deja deducir la
función de la membrana, el ejemplo «… → Núcleo» cuando la respuesta no es deducible— solo lo puede juzgar un revisor. El revisor v1 lo veía a
veces, pero como WARN (no repara) y nunca juzgaba apoyos sin una respuesta deducida. La 2.3 hace que **cada apoyo reciba su juicio**, que el
servidor decida qué puede cambiar ese juicio y que lo confirmado se repare con la maquinaria ya existente, sin una llamada extra.

Principios: acceso ≠ respuesta; un apoyo puede enseñar un procedimiento sin resolver el ítem evaluado; no toda coincidencia conceptual es un
error; la intensidad de una necesidad no autoriza que el apoyo haga la competencia evaluada; lo problemático se repara o sustituye sin
abandonar la necesidad; las decisiones parten del perfil funcional.

## El interruptor y sus combinaciones

`REVIEWER_V2_MODE` (`off` por defecto) decide con qué revisor se **crea** una adaptación (las versiones se fijan al crearla) y qué
consecuencias tiene su juicio. Es independiente de `SUPPORT_SUBSTITUTION_MODE`, que solo decide si un hallazgo confirmado puede **sustituir**
un apoyo.

| `REVIEWER_V2_MODE` | `SUPPORT_SUBSTITUTION_MODE` | Qué pasa |
| --- | --- | --- |
| `off` | cualquiera | Revisor v1 exacto: mismo prompt, mismo contexto, mismas claves de artefacto, sin juicios ni registro. |
| `shadow` | cualquiera | Revisor v2: **una** llamada, juicios guardados junto a la revisión (`semantic`). **Los juicios semánticos no tienen consecuencias** (ni FAIL, ni WARN, ni restricción, ni bandera, ni sustitución). **Pero no es transparente**: esa misma llamada da también los hallazgos generales (edad, tono, apoyos funcionales) y pueden diferir de los de v1, con lo que el veredicto y la entrega pueden cambiar respecto a `off` (ver «Qué garantiza `shadow`»). |
| `on` | `off` | Un hallazgo confirmado hace fallar `answers_not_leaked`; la corrección automática lo repara con una restricción; si se repite, el apoyo se omite solo si sus necesidades siguen cubiertas, o parada honesta. Nunca sustitución. |
| `on` | `dry_run` | Igual que la fila anterior; además queda anotado en `semantic.dry_run` qué sustitución **habría** hecho. Nunca se sustituye en silencio. |
| `on` | `on` | Como `on` + `off`, y si el hallazgo se repite tras la restricción, **una** sustitución por un apoyo de la misma necesidad (2.2), en la 3.ª generación como muy tarde. |

Una adaptación fijada con v1 ejecuta v1 sea cual sea el interruptor; una fijada con v2 y el interruptor apagado también ejecuta v1 (sin
contexto semántico, sin juicios, sin registro). `shadow` y `on` comparten la misma clave de pregunta al modelo y solo `on` tiene su propia revisión fusionada, de modo que pasar de
`shadow` a `on` sobre un documento ya preguntado debería fusionar lo guardado sin una segunda llamada (diseñado así; **sin prueba de extremo a
extremo**: las pruebas cubren cada modo por separado y la reanudación).

## Qué garantiza `shadow` (y qué no)

Comprobado con una prueba en la que el v2 da hallazgos generales distintos de los del v1 (`tests/db/support-semantic.test.ts`): **un FAIL
general que el v1 no habría emitido hace que `shadow` no entregue donde `off` entrega**, y un WARN distinto cambia el veredicto. La causa no es
el juicio semántico (no hay ninguna comprobación semántica en la revisión), sino que en `shadow` la **única** llamada es la del prompt v2 y sus
hallazgos generales se fusionan como siempre. No existe forma de saber, con una sola llamada, qué habría dicho el v1.

| Garantía | Con una llamada (como está) | Con dos llamadas (v1 decide, v2 mide) |
| --- | --- | --- |
| Los juicios semánticos no tienen consecuencias | **Sí** (probado) | Sí |
| Los hallazgos generales, el veredicto y la entrega son los de `off` | **No**: pueden diferir | **Sí**: la llamada que decide es la v1, con el mismo prompt, contexto y claves que `off` (queda solo la variación de muestreo que ya existe entre dos ejecuciones de `off`) |
| La medición es la del prompt que usará `on` | Sí | Sí (la llamada v2 es la de `on`) |
| Coste en `shadow` | el de v2 (≈ +35 % sobre v1) | v1 + v2 ≈ **+0,026 $ por revisión** sobre `off` (≈ 2,3× el coste de la revisión); peor caso por adaptación ≈ +0,25 $; se puede acotar a una medición por adaptación (la del primer documento) ≈ +0,026 $ por adaptación |
| ¿Hace falta autorización? | ya implementado | **sí: es otra llamada de pago; no se ha añadido** |

Alternativa descartada: una segunda llamada «ligera» solo con los juicios. Sería más barata (≈ +0,008 $), pero mediría un prompt distinto del
que usará `on` y sus resultados no valdrían como evidencia para activarlo.

**Recomendación.** Usar `shadow` de una llamada solo donde una diferencia de veredicto sea aceptable y medible (staging o el workspace del
piloto, con revisión humana de los casos que cambian), y, si se quiere la garantía fuerte en un entorno real, autorizar el `shadow` de dos
llamadas durante la fase de medición (y solo entonces). Nada de esto es necesario para `off`, que sigue siendo el v1 exacto.

## Contrato de salida (`ReviewerFindings` v2)

Los hallazgos de v1, sin cambios, más `support_judgments` (opcional, como máximo 12):

```json
{
  "findings": [ { "check_key": "…", "target_ids": ["blk_…"], "verdict": "PASS|WARN|FAIL", "reason": "≤160" } ],
  "support_judgments": [
    { "block_id": "blk_…", "class": "performs|hints|legitimate|unsure",
      "how": "states_concept|performs_operation|resolves_item|assigns_item|gives_result|analogy_of_item|other",
      "protected_id": "prt_N", "reason": "≤120" }
  ]
}
```

- `how` y `reason` solo se exigen cuando el juicio no es «legítimo»; `protected_id` cuando es `performs`.
- **Saneado limitado a errores formales** (`sanitizeReviewerV2`): se corta una razón demasiado larga, se descarta una clave sobrante de un
  juicio, se descartan los juicios que pasan del límite. Todo en recuentos, nunca un valor de la respuesta. **No** se repara: un id
  inventado, una clase o un veredicto inventados, un hallazgo con una clave sobrante, un campo obligatorio ausente, una respuesta cortada,
  rechazada o que no es JSON. Eso es un `reviewer_schema` y aplica el **reintento acotado de la PR #85** (dos llamadas como máximo por
  revisión, también tras reanudaciones).
- Lo que no llega **nunca** es una aprobación: un juicio ausente, un id que no se preguntó o una respuesta sin `support_judgments` dejan el
  apoyo en `unjudged` y generan un aviso (WARN).

## Qué recibe el revisor y qué se juzga

`buildPedagogicalReviewContext(..., { semantic: true })` añade, sin tocar nada de lo anterior, tres bloques calculados por el servidor
(`support-semantic.ts`, `buildSemanticScope`):

- `supports`: cada apoyo generado que puede llevar contenido (glosario, ejemplo resuelto, idea clave/recordatorio, preguntas guía, lista de
  comprobación, comienzos de frase), con su actividad, su tipo y **las necesidades funcionales que atiende** (el motivo del apoyo). Los
  planificadores y la estructura son procedimentales y no se juzgan.
- `activities`: qué pide cada una (`explain` o `apply`, de campos estructurados, no de la consigna) y **qué evalúa**: sus elementos
  protegidos (concepto, operación, razonamiento, fórmula) y sus objetivos.
- `signals`: los avisos mecánicos de la 2.1 y lo que ya se vio como tarjeta de criterio. Orientan; no deciden.

Se evalúa **aunque la respuesta no sea deducible** (`not_inferable`): ya no depende de `required_targets`.

### Más de 12 apoyos

El contrato admite 12 juicios y el servidor nunca pregunta por más. Si la ficha tiene más, un criterio determinista elige: primero lo que
lleva más evidencia mecánica, luego el tipo de apoyo que más puede cargar (un ejemplo antes que un recordatorio), luego el orden de la ficha;
lo elegido se envía en el orden de la ficha. Lo que queda fuera se registra (`unjudged` / `over_limit`) y genera un aviso:
**nunca se da por aprobado.** El límite de 8 de la propuesta se amplía a 12 porque un juicio «legítimo» cuesta ~25 tokens (sin razón ni
`how`) y el presupuesto de salida pasa de 2.000 a 2.600 tokens (peor caso del contrato: unos 1.800); un presupuesto superado es una respuesta
rechazada, nunca una más corta en silencio.

## Qué puede cambiar un juicio (`judgeSupports`, determinista)

| Estado | Condición | Consecuencia (solo en `on`) |
| --- | --- | --- |
| **confirmed** | `performs` + `how` concreto (concepto enunciado, operación realizada, ítem resuelto o asignado, resultado dado) + `protected_id` de un elemento **evaluado de esa actividad** | FAIL de `answers_not_leaked` sobre el apoyo; reparación |
| **suspected** | `hints`, `unsure`, `analogy_of_item`, `performs` sin cita válida, juicios contradictorios, tarjeta de criterio, un ejemplo que «enuncia un concepto» o un apoyo que no habla de lo evaluado | un WARN único; nunca bloquea |
| **legitimate** | `legitimate` | nada |
| **unjudged** | sin juicio o fuera del límite | un WARN (`needs_semantic_review`) |

Guardas contra falsos positivos: `states_concept` solo confirma sobre una actividad de **explicar** y si el apoyo comparte al menos dos
palabras de contenido con el elemento citado o los objetivos; un ejemplo resuelto no «enuncia un concepto»; una tarjeta de criterio solo se
confirma si resuelve o asigna un ítem o da el resultado; **una analogía nunca se confirma por serlo** (decisión 2 del usuario): solo si el
revisor demuestra que resuelve un ítem o sustituye la operación (otro `how` con elemento citado).

El FAIL dice: el apoyo, la actividad, el elemento protegido y qué sustituye (texto fijo por `how`: sin contenido de la ficha ni de la IA).

## Reparación y conexión con la 2.2

1. Un FAIL semántico bloquea la ficha y activa `attemptCorrection` (la maquinaria de siempre, dentro de `MAX_GENERATION_CYCLES = 3`).
2. La regeneración recibe una restricción fija según el `how` (`SEMANTIC_RESTRICTIONS`: «no definas ni expliques lo que la actividad pide
   explicar…», «no puedes resolver ningún ítem…»): se conserva la necesidad, solo desaparece lo que hacía el trabajo del alumno.
3. Si el mismo fallo se repite, y **solo con `SUPPORT_SUBSTITUTION_MODE=on`**, el hallazgo entra en `planRepair` como bandera
   `semantic_confirmed` y puede sustituirse **una vez** por un apoyo que sirva las mismas necesidades (`planSubstitution`). Con `dry_run` u `off`
   no se pasa bandera alguna.
4. Cobertura honesta: `semantic.needs` marca cada decisión `clear` / `suspected` / `unjudged` / `flagged`; solo `clear` puede leerse como «la
   necesidad está aplicada». Los registros de sustitución llevan `semantic_review: "confirmed"`. Una necesidad esencial sin cobertura es la
   parada honesta de siempre.

## Coste máximo

Precios del repositorio (`costs.ts`, sonnet-5-5: 2 $/M entrada, 10 $/M salida) y medidas reales de 16 revisiones del piloto (entrada media
3.393 y máxima 4.809 tokens; salida media 704 y máxima 969; coste medio 0,0194 $, ~5 s).

| | Entrada | Salida | Por llamada |
| --- | --- | --- | --- |
| v1 (medido) | media 3.393 · máx. 4.809 | media 704 · máx. 969 | media 0,0194 $ · máx. observado ≈ 0,024 $ |
| v2 (estimado) | + ~1.100 de media (sección del prompt ~650 + unidades/actividades/señales) · peor caso + 1.600 | + ~300 de media · tope 2.600 | media ≈ **+35 %** (≈ 0,026 $) · peor caso ≈ 0,042 $ |

- **No hay ninguna llamada independiente nueva**: la revisión sigue siendo **una** llamada, con el reintento acotado de la PR #85 (dos como
  máximo por revisión, también tras reinicios: probado).
- **Peor caso por adaptación**: 3 generaciones × (1 generación + hasta 2 peticiones de revisión) = **6 llamadas de revisión**, las mismas que con v1.
  El sobrecoste del revisor es ≤ 6 × (0,042 − 0,024) ≈ **0,11 $**; el caso típico (1 ciclo, 1 petición) ≈ **+0,007 $**, y dos ciclos ≈ +0,014 $.
  El coste del generador no cambia. Las cifras de v2 son una **estimación**, no una medida: hay que medirlas en `shadow` (apartado siguiente).
- Los ciclos y las reanudaciones conservan los límites: tres generaciones como máximo (también en BD), una revisión por ciclo, y volver a visitar
  una adaptación terminada no llama a nadie (probado).

## Corpus, evaluación y activación

Ver [`evaluacion-propuesta.md`](evaluacion-propuesta.md) (qué datos históricos existen de verdad —11 documentos con revisión v1, 9 del
piloto—, evaluación pequeña de ≈ 1 $, estadística proporcional a la muestra, protocolo de validación humana) y
[`diseno-retirada-semantica.md`](diseno-retirada-semantica.md) (una sola regeneración semántica y retirada determinista; diseño, no
implementado).

- **Corpus exploratorio de 27 apoyos** (`evals/support-semantic/corpus.ts`): 15 legítimos, 8 que hacen la competencia, 1 pista excesiva y 3
  ambiguos. **Con esta muestra no se puede afirmar una precisión alta**: cero falsos positivos entre 15 legítimos acota la tasa real solo por
  debajo del 18 % (95 %). Las etiquetas del equipo son provisionales y **nunca** son la referencia.
- **Hoja ciega** [`hoja-ciega.md`](hoja-ciega.md) + [`hoja-ciega-respuestas.csv`](hoja-ciega-respuestas.csv): sin ninguna etiqueta previa; cada
  respuesta registra quién la da (`human`, `human_ai_assisted`, `ai`). **Una revisión asistida por IA es un revisor, no dos.** Regenerar con
  `pnpm exec tsx evals/support-semantic/export-blind-sheet.ts`.
- `evals/support-semantic/score.ts` (puro, probado): falsos positivos sobre legítimos (primera prioridad), falsos negativos en ayudas que
  entregan respuestas, cotas exactas del 95 %, casos necesarios sin fallo (29 para ≤ 10 %, 59 para ≤ 5 %), nivel de las etiquetas, saltos de
  confirmado a legítimo entre repeticiones, cambios de entregabilidad respecto a v1 y coste por adaptación válida y entregada. Marca
  `evidence: "exploratory"` mientras la muestra no permita una afirmación.

## Procedimiento de validación posterior (requiere autorización; no se ha ejecutado)

1. Etiquetado humano de la hoja ciega (0 $; ver la propuesta).
2. Evaluación pequeña con el modelo real (≈ 0,7–1,3 $; tope 3 $ **solo con autorización expresa**): corpus agrupado por ficha ×3 y los 9
   documentos del piloto ×2.
3. Escalón piloto (`on` con la sustitución en `dry_run`, workspace controlado, cada confirmado revisado por una persona) y, solo si se
   alcanzan los tamaños necesarios, v2 como revisor por defecto con una sola llamada (sin v1 en paralelo).

## Pruebas

- `tests/unit/support-semantic.test.ts` (59: incluye estadística, procedencia de las etiquetas y la hoja ciega): modos, versiones fijadas, prompt v2 (v1 intacto por huella), contexto (v1 idéntico), contrato y
  saneado, casos reales con el revisor simulado (estanque, célula, fracciones, primos, seres vivos), revisor ideal y revisor excesivo,
  juicios ausentes o inventados, más de 12 apoyos, fusión, conexión con la 2.2 y medición.
- `tests/db/support-semantic.test.ts` (23, PGlite con las migraciones reales): `off`, `shadow`, `on` con la sustitución en `off`/`dry_run`/`on`,
  restricción → repetición → sustitución, parada honesta sin cuarta llamada, lo legítimo intacto, analogía como sospecha, juicio ausente o
  inventado, reintento acotado, reanudación sin llamadas y trazabilidad sin contenido.

## Riesgos pendientes

- **La precisión del modelo no está medida**: todo lo anterior prueba la política del servidor con un revisor simulado, no al modelo. Un
  falso positivo confirmado puede consumir ciclos y acabar en parada honesta (la peor consecuencia); por eso `on` exige medir antes.
- **Etiquetas provisionales** y corpus pequeño (27): no autorizan nada por sí solos.
- **Confirmar exige un elemento protegido evaluado de esa actividad**: si el análisis no marcó concepto u operación para una actividad, sus
  apoyos solo pueden quedar en sospecha (falso negativo posible, nunca un bloqueo injustificado).
- **El guarda léxico de `states_concept`** exige dos palabras de contenido en común: una paráfrasis sin ninguna puede quedarse en sospecha.
- **El sobrecoste de v2 es una estimación** (+35 %), pendiente de medir en `shadow`.
- Los ids de bloque cambian entre generaciones: los juicios valen solo para su revisión.
- Una adaptación creada con el revisor v2 y que después se apaga seguirá usando v1 (sin pérdida), pero no hay migración de las ya creadas.
