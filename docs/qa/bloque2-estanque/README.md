# Bloque 2 · orden, proximidad, duplicación y paginación (ficha «Un estanque en equilibrio»)

Rama `claude/zealous-shannon-k7w4v4` sobre `main` (`d4bf153`). Sin migraciones, sin despliegue, sin E2E, sin llamadas de pago.
Es una corrección del **ensamblado y la paginación** (`buildDocument`, `taskGroups`); no toca el análisis, los prompts, el planificador
(v2 y V2.2 comparten el ensamblado) ni el generador.

## Lo que se observó en la adaptación `60bc9629…` (planificador v2, política 3)

| Síntoma | Causa verificada en código y en el análisis almacenado | Corrección |
| --- | --- | --- |
| «Revisión final» antes de las actividades | `dec_8` apunta al documento con acción `add_support`. `buildDocument` solo mandaba al final los segmentos de documento cuyas decisiones eran todas `extend`; el resto iba arriba. | Una lista de comprobación de documento cuya decisión trae `self_check` (y no `checklist`) cierra la ficha. Recordatorios, estrategias y listas de pasos siguen arriba. |
| «Lee el texto con atención» tras la lectura | Es un texto `instruction` de la sección 1 (`ctt_2`) y su título. El orden de fuente es (página, sección, tipo, nº de id) y la lectura es `ctt_1`: salía primero. | Un texto `heading`/`instruction` sin actividades enlazadas, **idéntico al título de su sección** (metadato del análisis, nunca su redacción), encabeza la sección. |
| Componentes de la actividad 2 aislados en la página 1 | `ctt_3` (tipo `other`) está enlazado a `act_2`, pero `anchorResources` solo reubicaba ejemplos, fórmulas, definiciones y notas. | `other` e `instruction` enlazados por `resource_ids` viajan con su actividad, tras su ejemplo resuelto y antes de su tabla. |
| Enunciado de la actividad 5 repetido | El análisis copió `ctt_5` también en `act_7.context`; el prompt lo imprimía de nuevo. Lo mismo con `ctt_3` y `act_2.context`. | Duplicación **verificada** (palabras idénticas, texto no lectura, enlazado a esa actividad, misma página, ninguna decisión lo quita): el texto se conserva como recurso y viaja con su actividad; su copia en el contexto no se imprime. Una actividad reescrita que vuelve a traer el párrafo idéntico lo pierde; nunca queda vacía. |
| 4a y 4b en páginas distintas | `taskGroups` cuenta actividades; `[3a 3b 4a \| 4b 5 6]`. `groupActivities` existía pero la paginación no lo usaba. | `groupedTaskQuotas`/`activityQuotas`: un ejercicio con partes no se corta mientras cabe en una página (≤ máximo); uno mayor se corta en trozos del máximo. Mismo cálculo en el ensamblador y en el render. |

Coste asumido y declarado: con 3 tareas por página, `[3a 3b][4a 4b][5 6]` son tres páginas lógicas donde antes eran dos (con 4a/4b
partidas). Mantener juntas las partes cuesta una página cuando no caben dos ejercicios de dos partes en el máximo del perfil. No se
reduce tipografía ni espacio de respuesta para evitarlo (12,5 pt y líneas de 10 mm, medidos en el PDF).

## Pruebas que lo demuestran

- `tests/unit/pond-order.test.ts` (24): documento lógico con el **plan v2 y el plan v3 (V2.2)** de la misma ficha; ambos dan el mismo
  documento. Orden lectura/instrucción, componentes junto a la consigna, afirmación sin duplicar, revisión global al final,
  autocomprobaciones tras su actividad, grupos 3a/3b y 4a/4b, ninguna pérdida de consignas, tablas ni datos, revisión determinista y
  auditoría de generación sin fallos; duplicación **no** aplicada si las palabras difieren, el texto no es de la actividad, está en otra
  página, es una lectura o una decisión lo quita; cuotas de paginación.
- `tests/pdf/pond-layout.test.ts` (16, Chromium real): el PDF impreso, con posiciones de cada línea (`placedText`): orden vertical,
  páginas, adyacencia, una sola impresión de la afirmación y de los componentes, la revisión final última, sin texto fuera del área
  imprimible, sin textos superpuestos, sin páginas vacías, sin tinta en márgenes, tipografía y líneas de respuesta sin reducir.
- Sin la corrección, 19 de 24 pruebas unitarias y 10 de 16 de PDF fallan (comprobado revirtiendo solo `src/`).
- Ficha: `tests/support/pond-case.ts` (el análisis del estanque con sus ids, páginas, secciones y enlaces; sin respuestas) y
  `tests/support/pond-plan.ts` (las ocho decisiones y el borrador del generador con las formas reales).

## Pendiente (no se aborda aquí)

- **Bloque 1 (seguridad pedagógica):** el glosario de 3a sigue definiendo lo que se evalúa. Aviso interno primero, sin obligar al docente.
- **Distribución del espacio** (la actividad 2 queda sola en una hoja con dos tercios en blanco; `answer_space@v2` no depende de la necesidad motora o de escritura del perfil).
- Valoración del valor pedagógico de las imágenes, trazabilidad perfil→decisión y checks de severidad.
- Validar en producción con la ficha real tras desplegar.
