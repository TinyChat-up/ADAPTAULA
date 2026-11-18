# PR #98 · Contraste con los dos PDF reales del estanque

2026-11-14. Misma rama `codex/calidad-visual-pdf`, sobre `4c4bc40`. Sin IA, producción, migraciones, cambios curriculares ni regeneraciones facturadas.

## Resultado y alcance

**La ficha real de siete páginas no está validada ni se entrega como corregida.** Se han inspeccionado todas sus páginas y la página original, extraído sus imágenes y reproducido un defecto de etiquetas con el renderer. Se corrige ese defecto (`3a`/`3b` en una sola línea con letra ampliada). Los ajustes previos de la PR conservan valor en sus regresiones, pero no demuestran que este documento real quede bien paginado.

El fixture anterior del repositorio no representa este caso: tiene cinco páginas adaptadas y una actividad 4a de cálculo que **no existe** en los PDF recibidos. No se utiliza para atribuir mejoras a estos archivos.

Los originales, sus imágenes y las comparativas de todas las páginas se conservan fuera de Git. El paquete descargable de evidencia permite revisar el caso sin publicar los materiales ni atribuir una licencia a las fotografías. La extracción técnica no demuestra derechos de reutilización.

## Identificación e integridad

| Papel en la comparación | Archivo recibido | Páginas | SHA-256 de los bytes recibidos |
| --- | --- | --- | --- |
| Original | `estanque_pdf_nativo_con_imagenes.pdf` | 1 A4 | `cb0bd21df2d77a2852366cdb83274a5f4317c574927babc44ec665c958a6ebef` |
| Adaptación defectuosa | `Un estanque en equilibrio (1).pdf` | 7 A4 | `3043572370607bd404da2990301e641d9105f8503d113cdc3234f93d1de92dd4` |

Se distingue el papel por el contenido, no por el nombre del archivo. El original contiene texto nativo, dos fotografías de contexto y cuatro imágenes del esquema. Las etiquetas y flechas del esquema no forman parte de esos cuatro bitmaps: extraer únicamente los objetos de imagen perdería información.

La lectura narrativa se conserva textualmente al normalizar espacios y excluir los contadores de página (711 caracteres). Se conservan las cuatro consignas 1, 2, 3a y 3b y los seis componentes que clasificar. Esto no certifica equivalencia pedagógica: los apoyos y las zonas de respuesta también condicionan lo que debe resolver el alumno.

## Comparación de todas las páginas

Todas remiten al mismo original de una página; no se inventa una correspondencia página a página entre versiones.

| Página adaptada | Observación comprobada | Valoración y estado |
| --- | --- | --- |
| 1 | Lista «Antes de entregar» al comienzo; lectura partida después hacia p. 2; faltan las dos fotografías de contexto. | La lista previa añade carga antes de leer. No reducir el tamaño de letra para forzar una página. **Pendiente:** orden y agrupación a partir del documento guardado. |
| 2 | Termina la lectura, actividad 1, dos líneas grandes, pasos y autocomprobación después del espacio de respuesta. | Dos cambios con su evidencia pueden necesitar más que dos líneas. Los pasos no dan los cambios concretos, pero llegan tarde y repiten la consigna. **Revisión docente** del espacio y del orden. |
| 3 | Ejemplo análogo de clasificación, actividad 2, tabla con tres filas y dos columnas y primera entrada del glosario. | La tabla conserva la clasificación solicitada. El ejemplo utiliza elementos distintos, pero proporciona el procedimiento: pertinencia dependiente de lo evaluado y del alcance autorizado. **Pendiente de revisión pedagógica.** |
| 4 | Solo la segunda entrada del glosario; página casi vacía. | **Defecto confirmado de presentación:** separación del apoyo respecto de la clasificación. No consta solucionado en este PDF por la PR. |
| 5 | Actividad 3a, esquema con etiquetas truncadas, cinco pasos grandes y glosario; no hay espacio de respuesta en esta página. Etiqueta de apartado dividida verticalmente. | **Defectos confirmados:** recorte incompleto, respuesta separada y `3a` partido. Solo este último queda corregido y probado aquí. **Riesgo pedagógico alto:** el título del esquema y la definición del glosario anticipan la relación evaluada. |
| 6 | Primero las líneas de 3a; después 3b, el mismo esquema y cuatro casillas de eslabones, seguidas de líneas. Etiqueta `3b` partida. | **Discrepancia comprobada:** el original no exige cuatro eslabones. Esa plantilla restringe las respuestas posibles. La repetición del esquema puede orientar a copiar la cadena dada. No se elimina espacio sin conocer las necesidades funcionales. |
| 7 | Continuación de líneas de 3b y dos comprobaciones finales. | Hoja de continuación con poco contenido; no se puede suprimir si deja espacio insuficiente. **Pendiente:** reajuste sin reducir capacidad manuscrita ni aumentar barreras. |

## Fotografías y recorte: qué se demuestra

1. Las dos fotografías contextuales del original no están incrustadas en la adaptación. El esquema sí conserva color; no es una desaparición general causada por alto contraste o impresión en grises.
2. La imagen del esquema de p. 5 y p. 6 es idéntica: 1482 × 180 píxeles, SHA-256 `e7a78b629e2f2dea680bfae6f812b458a259d33ff128715020f3201bdcb706c7`. **Los rótulos ya están cortados en sus píxeles.** Corregir las proporciones CSS no recupera texto que el recurso no contiene. Este caso tampoco es la figura vertical de la regresión sintética.
3. Se ha recuperado localmente el esquema completo del original con una selección manual revisada: página 1, rectángulo `(36, 626, 560, 699)` en puntos PDF, origen superior izquierdo de PyMuPDF. Incluye fotos, etiquetas y flechas. También son extraíbles las dos fotografías superiores. No requiere IA.
4. La selección es evidencia de recuperabilidad, **no** un localizador automático validado, una reparación de la adaptación persistida ni un recurso autorizado de Storage. Las pequeñas marcas de flecha duplicadas ya aparecen en el original; no se atribuyen a la adaptación.
5. El código corregido previamente conserva imágenes referenciadas frente a una clasificación contradictoria. No sabemos si las fotografías estaban inventariadas, referenciadas o descartadas por otra fase en esta ejecución. Sin análisis, resolución visual y localizador persistidos, atribuir la pérdida al análisis sería una hipótesis.

No se cambia el algoritmo de localización ni se amplían sus tolerancias a partir de un rectángulo inferido. Primero hay que identificar la receta y evidencia que aceptaron el recurso incompleto.

## Valoración pedagógica

- **Hecho:** la lectura y las preguntas principales se mantienen. **Límite:** conservar palabras no basta para conservar la demanda cognitiva.
- **Juicio fundamentado, gravedad alta:** en 3a la definición de la cadena describe la relación alimentaria que se pide interpretar. El alumno puede inferir la respuesta del apoyo sin interpretar las flechas. El encabezado del esquema también orienta la respuesta. La pertinencia debe comprobarse contra el objetivo y el alcance autorizado; no se considera un apoyo inocuo por no copiar literalmente una solución.
- **Discrepancia reproducible, gravedad media/alta:** las cuatro casillas de 3b introducen una cantidad de eslabones no exigida en el original. No hay evidencia de autorización para restringir así la tarea.
- **Juicio pendiente:** los pasos de observar y seguir flechas sustituyen parte de la planificación autónoma; podrían ser apropiados si el objetivo es comprender la relación y el perfil lo requiere, pero no si se evalúa elegir el procedimiento. El ejemplo de clasificación tiene el mismo condicionante. No se conocen el perfil fijado ni el plan de esta versión.
- **Accesibilidad:** el cuerpo ampliado (aproximadamente 18,8 pt) y las líneas amplias pueden responder a una necesidad real. No se reducen para perseguir un número de páginas. Las etiquetas cortadas, apoyos distantes, fragmentación de lectura y espacios de respuesta desconectados sí añaden barreras observables.
- **Color y grises:** la organización no depende exclusivamente del color. Se incluyen vistas locales en grises de todas las páginas; no equivalen a una prueba impresa ni a validar con alumnado la legibilidad de fotografías pequeñas. La pérdida de rótulos perjudica ambas versiones.

No se valida eficacia educativa ni se declara esta ficha apta para entrega al alumnado.

## Reproducción y datos que faltan

Un PDF final no conserva el `MaterialDocument`, las referencias de bloques, los saltos lógicos, los apoyos estructurados ni la instantánea del perfil. Un ensayo local de transcripción de todos los textos y uso del recorte incrustado, con el CLARO actual y propiedades inferidas, produjo **ocho páginas, no siete**. Es una reconstrucción no equivalente: sus páginas vacías y desbordamientos no se atribuyen como regresiones demostradas de la versión guardada. Tampoco se entrega como «después» corregido. Se evita completar datos ausentes para obtener una reducción artificial.

Para repetir la exportación exacta sin IA ni producción se necesita una copia local autorizada de:

1. `adaptation_versions.document`, `version`, `source` y `review` correspondientes al PDF descargado; si procede de una revisión docente, esa revisión exacta y su documento, no la última disponible.
2. `adaptations.context_snapshot`, `pipeline_versions`, `context_fingerprint` y `analysis_fingerprint`, sin alias ni identificadores personales. Permiten distinguir necesidades de presentación de decisiones del generador.
3. Análisis de `materials.analysis` y artefactos de plan, generación/revisión y `visual_resolution` de esa ejecución. Para las fotografías, son necesarios inventario, referencias de actividad y motivos de resolución/exclusión.
4. Los `material_visual_locators` referidos por la versión: método, revisión, coordenadas, `page_box`, `source_sha256`, huella de análisis, versión y evidencia; y los `material_visual_assets` seleccionados: bytes, dimensiones, SHA-256 y `recipe_version`. No sustituirlos por la revisión activa actual.
5. Commit/runtime que exportó el PDF y configuración de fuentes/presentación si difiere de la versión fijada. Contrastar la huella del original con la de esta entrega.

No hacen falta claves, cookies, acceso administrativo, reglas pedagógicas privadas completas ni un volcado de otras cuentas. No se han ejecutado consultas de producción.

## Corrección nueva y verificación

`nodes.tsx` identifica los apartados de un dígito y una letra. `material.css` impide su salto interno y comienza la guía vertical debajo del rótulo, manteniendo tamaño, margen, consigna y contenido. La inspección visual detectó que solo impedir el salto hacía rozar la guía con la letra; una segunda contraprueba reproduce y protege ese solapamiento. No se reescriben los documentos guardados. La regresión sintética utiliza `3a` y `3b`, alto contraste y fuente ×1,5; comprueba línea base en el PDF y separación respecto de la consigna y de la guía tanto en medio pantalla como impresión. Los identificadores más largos requieren otro tratamiento y no se fuerzan sin salto dentro de la columna fija.

Comandos focalizados:

```sh
pnpm exec vitest run tests/unit/print-html.test.ts tests/unit/render.test.ts tests/unit/visual-quality.test.ts
pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/visual-quality.test.ts tests/pdf/claro-quality.test.ts tests/pdf/pond-layout.test.ts
pnpm typecheck
pnpm lint
pnpm build
pnpm check:privacy
```

- **54 unitarias y 27 PDF correctas.** No se repite la suite completa.
- Contraprueba aislada de `3a/3b` contra `4c4bc40`: la nueva prueba falla por etiqueta partida; pasa con la corrección. Los dos PDF sintéticos antes/después están separados de los PDF reales en las evidencias.
- Typecheck correcto. Lint: cero errores, un aviso preexistente en `analysis-run-auth.test.ts` (`_id`).
- Build ejecutado y **bloqueado** por descarga de Inter/Outfit de Google Fonts. No se cambian las fuentes para ocultarlo; `pnpm check` no se declara superado.
- Sin E2E, pruebas de la aplicación en escritorio/móvil, IA de pago, servicios remotos de datos, migraciones, merge ni despliegue.

**Recomendación: NO MERGE como solución completa del caso real.** Las correcciones acotadas tienen pruebas, pero faltan la reproducción con el documento persistido y la revisión de apoyos que anticipan respuestas. Próximo paso: aportar ese paquete mínimo, imprimirlo con el único renderer existente y corregir únicamente las diferencias reproducidas, preservando el perfil y la capacidad de respuesta.

---

# Validación con los artefactos guardados (2026-11-18)

Continuación sobre `591efaa`. Ya están los artefactos que faltaban en la sección anterior: el documento guardado de la versión, su análisis, plan, revisión, generación, contexto de presentación y resolución visual, leídos **en solo lectura** con la autorización del propietario. No se ha modificado Supabase ni regenerado nada. Sin IA, E2E, migraciones, merge ni despliegue. Los PDF del usuario, el documento y las imágenes siguen fuera de Git; las pruebas que se suben usan equivalentes sintéticos.

## Reproducción exacta

| Comprobación | Resultado |
| --- | --- |
| Documento guardado → renderer de esta rama (CLARO, mismo recorte de 1482 × 180 px) | **7 páginas**, mismo reparto que el PDF descargado (p. 4 con una sola entrada de glosario; p. 7 de continuación). |
| Reconstrucción desde análisis + plan revisado + contexto + segmentos generados + resolución visual (`buildDocument` → `applyVisualResolution` → `addVisualSupports`) | **Idéntica** al documento guardado: los defectos no vienen de ediciones posteriores ni de datos perdidos. |
| Localizador automático, parte determinista, sobre la página original | El esquema (`vis_3`) solo pasa el umbral con la visión; las fotografías (`vis_1`) **no se buscan**. |

## Causas raíz

1. **Página casi vacía (p. 4).** El estimador de altura se queda corto: la unidad de la actividad 2 se calculaba en 134 mm y ocupa 243 mm; la 3a, «compacta» por filas (18), ocupa casi una página. Con «no partir» activado, Chromium la empuja entera a la hoja siguiente y después la parte igualmente. El bloque de figuras (esquema + tarjeta de pasos) era además indivisible.
2. **Apoyo más grande que la actividad.** Los cinco pasos «Cómo mirar las flechas» se dibujaban en dos columnas estrechas: unos 130 mm junto a un esquema de 18 mm.
3. **Esquema sin rótulos.** El recorte aceptado acaba justo encima de los rótulos «Algas · Larvas de insectos · Ranas · Garzas». El localizador solo añadía rótulos de una letra o número (los de una recta numérica), no nombres, aunque el análisis los lista en `visual.text`.
4. **Fotografías perdidas.** El análisis las clasifica como `illustrative` y ninguna actividad las usa. `autoTargets` no las busca y la política las omite (`optional_original`). No es un fallo del recorte ni del alto contraste.
5. **No hay imágenes nuevas (Claude/OpenAI).** El plan no pidió ningún apoyo visual generado de imagen; solo una figura por especificación (`steps`). La ruta de OpenAI no llega a evaluarse. Tampoco habría sido prioritaria: reutilizar una foto original válida va antes que generarla.

## Correcciones de esta actualización

| Corrección | Archivo | Prueba |
| --- | --- | --- |
| Solo se marca «no partir» (unidad y caja) lo que la estimación sitúa por debajo de **media página**: el estimador se equivoca por defecto y un «no partir» erróneo cuesta una hoja casi vacía. | `src/lib/render/model.ts` | `pdf-quality-real-case.test.ts`: falla con el tope anterior y pasa con el nuevo; una actividad corta sigue entera. |
| Estimación: tarjetas de pasos o fichas según su texto; glosario, ayudas, listas y organizadores según sus líneas. | `src/lib/render/model.ts` | Suites unitarias y PDF existentes. |
| Una actividad no compacta puede continuar entre sus figuras; cada figura sigue entera y la primera, con la consigna. | `material.css` | Regla verificada en CSS; ensayo real 7 → 6 páginas. |
| Cuatro pasos o más: uno por fila, mismo tamaño de letra y menos altura (unos 130 → 75 mm). | `material.css` | Ídem. |
| El recorte de una figura incluye los nombres de sus partes que el análisis lee, solo si **todos** aparecen a ≤ 8 mm y a lo ancho de la figura. Nunca texto corrido. Se aplica después de aceptar, así que no cambia qué región se elige. | `auto/locate.ts`, `auto/service.ts` | Unitarias sintéticas: crece con todos los nombres; no cambia si falta uno, si están lejos o si hay texto corrido. Página real: el recorte pasa de 0,0624 a 0,0906 de alto e incluye los cuatro rótulos. |
| Expectativa CSS de la matriz v3 actualizada a la regla de `3a/3b` que ya cambió esta PR (fallaba en `591efaa`). | `real-run-v3-matrix.test.ts` | Pasa. |

`auto_visuals@v8` y `material_renderer@v9` no se publicaron aún (la PR no está fusionada): el cambio va en esas mismas versiones.

## ANTES / DESPUÉS en el caso real (renderer de Adaptaula, PDF de Chromium)

El ANTES es el documento guardado con el recorte de producción. El DESPUÉS es el mismo documento con esta rama y el recorte con rótulos, recalculado desde la página original con el localizador nuevo. La comparativa de imágenes se entrega aparte y no se sube a Git.

| Criterio | ANTES | DESPUÉS |
| --- | --- | --- |
| Páginas | 7 | **6** |
| Páginas casi vacías sin justificar | p. 4 (1 % de tinta) y p. 7 (2 %) | **Ninguna.** La última (2,6 %) contiene las líneas de 3b y su autocomprobación. |
| Imágenes deformadas o cortadas | Esquema sin rótulos | Esquema con sus cuatro rótulos; proporción conservada. Sin recortes de borde en el PDF. |
| Fotografías útiles conservadas | No | **No (pendiente, ver abajo)** |
| Apoyos mayores que la actividad | Pasos ≈ 130 mm | Pasos ≈ 75 mm; el esquema sigue siendo pequeño (27 mm, como en el original) |
| Identidad (perfil con color) | Acento y esquema en color | Igual |
| Contraste y necesidades funcionales | Letra ampliada, líneas amplias | **Igual: sin reducir letra ni interlineado.** |
| Espacios de respuesta | 3 / tabla 3×2 / 3 / organizador + líneas | **Idénticos** |
| Páginas forzadas o letra reducida | — | No: el cambio solo afecta a dónde se puede cortar. |
| Respuesta junto al enunciado | 3a: líneas dos páginas después | 3a: líneas en la página siguiente. Mejora, pero sigue separada. |

## Valoración pedagógica (A–F), sin cambios de contenido en esta actualización

- **A · Objetivos y contenidos.** Se mantienen la lectura literal, las cuatro consignas y los seis componentes. No se reduce la demanda curricular.
- **B · Medidas de acceso.** Letra y líneas amplias, glosario y pasos son de acceso. Se conservan.
- **C · Apoyos visuales.** El esquema ya es legible. Las fotografías de contexto siguen ausentes. La tarjeta de pasos es un apoyo de método legítimo si el objetivo no es elegir el procedimiento.
- **D · Carga de lectura y escritura.** La lista «Antes de entregar» al inicio y los pasos de la actividad 1 añaden lectura antes de la tarea (pendiente de orden).
- **E · Riesgo de anticipar la respuesta.** **Alto en 3a:** la definición «Serie de seres vivos en la que cada uno se alimenta del anterior» dice lo que indican las flechas. El ejemplo de la actividad 2 enseña el criterio con otros elementos: aceptable como ejemplo de método. Este caso pertenece al revisor semántico (2.3), hoy en `off`; no se resuelve borrando a mano.
- **F · Coherencia de actividades y espacios.** 3b: el organizador de **cuatro eslabones** fija una longitud que el original no pide. Además el análisis la clasifica como redacción, así que recibe 10 líneas por curso **además** de las casillas: espacio duplicado. No se cambia la regla de redacción: una prueba fija deliberadamente que «Escribe sobre tu barrio» con 2 líneas impresas pase a 10 en 5.º.

## Resuelto / pendiente

**Resuelto y probado:** página casi vacía por «no partir» erróneo; bloque de figuras indivisible; pasos desproporcionados; esquema sin rótulos; etiqueta `3a/3b` (actualización anterior).

**Pendiente (con causa identificada):**

1. **Fotografías de contexto.** Necesitan una regla de destino (encabezado o lectura) para imágenes `illustrative` sin actividad, o extraer los objetos de imagen nativos del PDF. Hoy se omiten por diseño. Decisión de producto.
2. **3a: el glosario revela la respuesta.** Corresponde al revisor 2.3 (`REVIEWER_V2_MODE`), que sigue en `off` hasta validarse con el corpus.
3. **3b: cuatro eslabones fijos y espacio duplicado.** Es del planificador y del análisis, no del renderer.
4. **Líneas de 3a en la página siguiente a su enunciado.** Viene de la altura real de figuras y apoyos; no se fuerza con letra menor.
5. **Alto contraste sin identidad.** Los tokens son negro puro por regla probada («alto contraste es blanco y negro»). Un acento oscuro AAA sería una decisión de diseño.
6. **El estimador sigue siendo aproximado.** Una medición en Chromium antes de imprimir sería exacta, pero el motor de impresión no maqueta por contrato (ADR): se deja como propuesta.
7. **Recorte por la derecha (≈ 2 mm de la garza).** Lo decide el candidato que eligió el localizador con visión; no se amplía sin evidencia.

Pruebas de esta actualización: 1.993 unitarias y 515 de BD correctas; 101 PDF correctas; typecheck correcto; lint con 0 errores y el aviso preexistente `_id`; `check:privacy` correcto. No se ejecutan E2E ni `pnpm build` (bloqueado por Google Fonts, ver arriba).

**Recomendación:** fusionable como mejora de presentación con pruebas. **No** declara apta la ficha del estanque: siguen abiertos los puntos 1 a 3.
