# Etapa 2.3 · propuesta de evaluación del revisor v2 (sin ejecutar nada de pago)

Estado: **propuesta**. No se ha hecho ninguna llamada de pago ni se ha modificado Supabase; `REVIEWER_V2_MODE` sigue en `off` y
`SUPPORT_SUBSTITUTION_MODE` en `dry_run`. Objetivo: la mayor calidad pedagógica con el mínimo gasto razonable y **una sola llamada ordinaria del
revisor v2 por adaptación, sin v1 y v2 en paralelo de forma permanente**. Tope previsto de una evaluación de pago: **3 USD**, sujeto a
autorización expresa.

## 1. Qué datos históricos existen de verdad (lectura de solo lectura, 2026-11-13)

Solo recuentos y agregados sobre `adaptations`, `adaptation_artifacts`, `adaptation_versions` y `ai_runs` de producción; no se ha leído
contenido de ningún material ni se ha escrito nada.

| Dato | Valor |
| --- | --- |
| Adaptaciones | 33 (32 automáticas), 11 entregadas, todas fijadas con el revisor v1 |
| Con revisión de IA de v1 guardada **y** documento guardado | **11** (7 materiales, 3 workspaces); **9** en el workspace del piloto (5 materiales) |
| Con apoyos que el v2 juzgaría | 11 de 11; **57 apoyos** (48 en el piloto: 6 ejemplos resueltos, 3 glosarios, 9 ideas clave o recordatorios y unos 30 listados, comprobaciones o comienzos de frase); máximo 8 por documento, **ninguno supera 12** |
| Veredicto de v1 en esos 11 | los 11 `approved_with_warnings`; **ninguno bloqueado ni con FAIL**; 8 con un WARN de IA en `answers_not_leaked` |
| Con registro de la auditoría 2.1 o de la sustitución 2.2 | 0 (esas etapas no han dejado datos en producción) |

Consecuencias: **no hay 40 documentos comparables, hay 11 (9 del piloto)**; v1 no bloqueó nunca ninguno, así que el único cambio de
entregabilidad que puede aparecer es que v2 **empiece** a bloquear; y no hay revisiones antiguas de v1 con una fuga confirmada con la que
comparar. Los 2 documentos de workspaces ajenos al equipo no se tocarían sin autorización expresa: la propuesta usa los 9 del piloto.

### Coste real de referencia (11 adaptaciones entregadas, `ai_runs`)

| | USD |
| --- | --- |
| Total medio por adaptación entregada (planificar + generar + revisar) | **0,0694** (mediana 0,0693; máximo 0,0939) |
| de ello, revisión (v1) | 0,0195 (28 %) |
| de ello, generación (1,27 llamadas de media; 3 de 11 regeneraron) | 0,0227 |
| de ello, planificación | 0,0257 |
| Revisión v1 por llamada (16 llamadas, 2 fallidas) | 0,0189 |
| Generación por llamada | 0,0176 |

El v2 añade ≈ +0,007 por revisión (estimado, +35 %): **≈ +10 % sobre el coste por adaptación entregada**. Una regeneración innecesaria (generador +
revisión) cuesta ≈ 0,037, es decir, **más de cinco veces ese sobrecoste**: evitar regeneraciones por sospechas vale más que ahorrar en la revisión.

## 2. Evaluación pequeña y representativa (propuesta)

| Paso | Qué | Llamadas | Coste estimado |
| --- | --- | --- | --- |
| **E0** | Etiquetado humano de la hoja ciega (ver §4) | 0 | 0 $ |
| **E1** | El v2 sobre los 27 apoyos del corpus, **agrupados por ficha** (6 documentos de 2–7 apoyos), 3 repeticiones: estabilidad y errores | 18 | 0,27–0,54 |
| **E2** | El v2 sobre los **9 documentos del piloto** ya revisados por v1, 2 repeticiones: deriva de los hallazgos generales y cambios de entregabilidad | 18 | 0,36–0,76 |
| Reserva | Repetir lo inestable o ampliar el etiquetado con lo que E2 confirme o sospeche | ≤ 12 | ≤ 0,5 |
| **Total** | | ≈ 36–48 | **≈ 0,7–1,3 $; tope propuesto 1,5 $** (muy por debajo de 3 $) |

- **Por qué agrupar por ficha en E1:** un documento de varios apoyos es lo que ve el revisor en producción, y cuesta 6 llamadas por repetición
  en lugar de 27. Inconveniente: los apoyos de una misma ficha se influyen; los casos críticos se repiten aislados solo si hace falta (reserva).
- **E2 sin tocar nada:** reconstruye el contexto de revisión desde lo ya guardado (documento, plan, contexto, análisis) y llama al v2 **sobre
  el documento tal cual se entregó**; no regenera ni escribe en Supabase (los resultados van a un fichero local). Requiere un script de
  reproducción (gratis de escribir) y, para cada documento, la revisión v1 guardada como referencia.
- **Representatividad:** E1 cubre las seis clases y las fichas de los casos reales; E2 la distribución real de apoyos del piloto (sobre todo
  listas y recordatorios, pocos ejemplos resueltos). Las dos juntas son pocas para una conclusión estadística: son **exploratorias**.
- **Lo que E2 no puede decir:** si v1 se perdía fugas (no hay etiqueta humana de esos 48 apoyos). Para eso hay que etiquetar a mano lo que v2
  confirme o sospeche y una muestra de ~10 apoyos que v2 llame legítimos (muestreo, no etiquetar todo).

## 3. Estadística proporcional a la muestra

Con el corpus de 27 (etiquetas provisionales), **15 apoyos legítimos y 8 que hacen la competencia** (3 ambiguos fuera de las tasas):

- **Cero falsos positivos entre 15 legítimos acota la tasa real de falsos positivos solo por debajo del 18 % (95 %).** No demuestra una
  precisión alta.
- **8 de 8 verdaderos positivos tienen un límite inferior de Wilson de 0,68**: tampoco permite afirmar un recall alto.
- Para acotar la tasa de falsos positivos en ≤ 10 % sin ver ningún fallo hacen falta **29** apoyos legítimos; para ≤ 5 %, **59** (regla de
  los tres: ≈ 3/n). Un solo falso positivo entre 29 ya deja la cota por encima del 10 %.
- Por eso el informe de `score.ts` marca `evidence: "exploratory"` hasta tener esos tamaños, y las exigencias antiguas («≥ 40 apoyos, ≥ 10
  positivos, Wilson ≥ 0,85») se sustituyen por exigencias por escalón (`EVIDENCE` en `score.ts`, probadas):

| | Escalón **piloto** (`on` con sustitución en `dry_run`, workspace controlado, cada confirmado revisado por una persona) | Escalón **por defecto** (v2 sustituye a v1 para toda adaptación nueva) |
| --- | --- | --- |
| Apoyos legítimos etiquetados sin falso positivo | ≥ 29 (cota ≤ 10 %) | ≥ 59 (cota ≤ 5 %) |
| Apoyos que hacen la competencia | ≥ 10 | ≥ 18 |
| Etiquetas | una persona, aunque asistida por IA (un revisor, no dos) | una persona sin solo-IA, y segunda persona en todos los casos críticos o ambiguos |
| Falsos negativos (hace la competencia y ni se sospecha) | cada uno examinado | ídem, ninguno sin explicar |
| Estabilidad | ningún apoyo pasa de confirmado a legítimo entre repeticiones | ídem |
| Entregabilidad frente a v1 | cada documento que cambia, examinado por una persona | ídem |
| Fallos de esquema | ≤ 2 % | ≤ 2 % |
| Coste | ≤ +0,01 $ por adaptación válida entregada sobre la referencia de 0,0694 | ídem |

Prioridades, en este orden: **(1)** falsos positivos sobre apoyos legítimos, **(2)** falsos negativos en ayudas que entregan respuestas,
**(3)** cambios de entregabilidad respecto a v1, **(4)** estabilidad de los juicios (los que pasan de confirmado a legítimo, no la
concordancia media), **(5)** coste por adaptación válida y entregada (todo el gasto del grupo, incluidas regeneraciones, reintentos y las no
entregadas, entre las entregadas; un coste desconocido lo deja desconocido). Para 9–11 documentos no hay «tasa» de cambio de entregabilidad:
cada cambio es un caso que se examina.

## 4. Validación humana del corpus

- La **hoja ciega** (`hoja-ciega.md` y `hoja-ciega-respuestas.csv`) muestra, por apoyo, la actividad, lo que evalúa, la necesidad que atiende y el
  apoyo, **sin ninguna etiqueta previa** del equipo ni de ninguna IA, ni su motivo, ni el juicio esperado, ni si el apoyo es real o una variante.
  El orden está mezclado con una semilla fija y los apoyos renombrados (B01…B27). La clave que los relaciona con el corpus
  (`evals/support-semantic/clave-hoja-ciega.json`) no contiene etiquetas.
- **Procedencia de cada etiqueta** (`label_source`): `human`, `human_ai_assisted` o `ai`. **Una revisión asistida por IA es un revisor, no
  dos**; una etiqueta de IA que nadie haga suya no es una etiqueta; solo dos personas distintas con `human` cuentan como independientes
  (`entryLevel`, probado). El informe dice el nivel de todo el conjunto (el de su entrada más débil).
- **Casos críticos o ambiguos** (12 del corpus: los que hacen la competencia, la pista excesiva, los ambiguos y cualquiera cuya etiqueta final
  difiera de la provisional): se contrastan con otro especialista si lo hay; el informe cuenta cuántos siguen sin segunda persona.
- Cuando haya respuestas, un script (gratis, pendiente) las une al corpus con la clave y comprueba que cada fila tiene fuente y revisor.

## 5. Regeneraciones y retirada determinista de un apoyo confirmado

Ver [`diseno-retirada-semantica.md`](diseno-retirada-semantica.md) (diseño y pruebas; **no implementado**).

## 6. Cuándo v2 sustituye a v1, con una sola llamada

1. **E0** etiquetas humanas (0 $) → 2. **E1 + E2** (≈ 1 $, exploratorias; solo si el etiquetado no encuentra el corpus defectuoso) →
3. **escalón piloto**: `shadow`/`on` con la sustitución en `dry_run` en el workspace del piloto, cada confirmado revisado por una persona, y a
   medida que se acumulan casos se amplía el etiquetado hacia 29 legítimos → 4. **escalón por defecto**: v2 pasa a ser la versión de revisor de las
   adaptaciones nuevas (`EXPERIMENTAL_PIPELINE.reviewer = 2`), `REVIEWER_V2_MODE` se elimina y v1 queda publicado pero sin uso. En ningún paso
   hay dos revisores permanentes. Si el escalón por defecto no se alcanza, se queda en piloto o se vuelve a `off`; nada se activa «por defecto» sin autorización.

## 7. Lo que NO se hace

Ninguna llamada de pago, ningún cambio en Supabase, ninguna regeneración de documentos, ninguna activación de `shadow` ni `on` en Production,
ningún E2E ni despliegue. El `shadow` de dos llamadas (v1 decide, v2 mide) sigue sin implementarse.
