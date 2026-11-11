# «Hacer magia» autónomo: diagnóstico del estanque y rediseño

## 1. Qué pasó con «Un estanque en equilibrio» (5.º de Primaria; solo lectura de Supabase, 2026-11-11)

Adaptación `2c195f0c…`, modo `automatic`, plan Max, workspace piloto. Reconstruido solo con sus artefactos (`adaptation_artifacts`, `adaptation_jobs`, `ai_runs`, `material_visual_autolocations`, análisis del material). Sin contenido de alumnado.

| Pregunta | Resultado comprobado |
|---|---|
| ¿Qué planificador se ejecutó? | **El anterior (`adaptation_planner` v2, contexto política 2), no V2.2.** `pipeline_versions.planner.prompt_version = 2`, sin `rules` y sin `ai_runs.rules_sha256`. El agente V2.2 no intervino: el flag no estaba activo. Ningún fallo de esta adaptación es atribuible a V2.2. |
| ¿Dónde se paró? | En el **orquestador, por la política visual**: `automatic_stop = visual_unavailable` sobre `vis_2`, tras generar la ficha y su revisión determinista. Las 8 decisiones del plan se aplicaron (la resolución automática aprobó las dos con aviso). |
| ¿Qué era `vis_2`? | Un **esquema de cuatro recuadros unidos por flechas** («Algas → Larvas de insectos → Ranas → Garzas»), imprescindible para las actividades 3a y 3b. El análisis (**análisis**) lo describió completo: etiquetas y orden. |
| ¿Por qué no se recuperó del PDF? | La localización automática (`auto_visuals@v7`) hizo una llamada de visión (confianza 0,96) pero **no pudo ajustar la hipótesis a los objetos del PDF** (`hypothesis_not_snapped`: `unique=false`, `clean=false`, visión en desacuerdo con la geometría). Sin recorte, no hay original recuperable. |
| ¿Por qué no se reconstruyó? | **Escalón de la política visual que faltaba.** El renderizador solo sabía dibujar figuras matemáticas (barra, recta, círculo, cuadrícula). Un esquema de flechas no tenía familia dibujable: `generateEquivalentFigure` devolvía `null`, la figura era imprescindible (`required`) y no dibujable, así que tampoco se podía reescribir ni sustituir. |
| ¿Por qué no se ilustró? | Imágenes generadas desactivadas (`illustration_unavailable`). Era correcto: un esquema con datos no debe generarlo un modelo de imagen. |
| ¿Quién ve «Dos ayudas podrían contradecirse»? | La **validación del plan** (`invariants.ts`), **no el planificador**: marcaba `needs_conflict` en *cualquier* decisión sobre un destino con un conflicto ya detectado (ejemplos resueltos), aunque la decisión cumpliera la guía que resuelve ese conflicto. Falso positivo de copy y de lógica. La resolución automática no se detuvo por él; el docente lo vio al elegir **Editar** en el panel de parada. |

Por tanto: análisis correcto, planificador correcto (el anterior), **política visual con un escalón ausente**, **validador con avisos espurios**; el orquestador solo cumplió su contrato (no entregar con un hueco).

## 2. Qué cambia (y qué NO garantiza)

### 2.1 Imágenes: una figura solo se redibuja con evidencia del original

- El `text` y la `description` del análisis salen de **la misma lectura del mismo modelo**: son una sola afirmación (`flowClaim`), no dos testigos. Por sí solas **no dibujan nada**.
- La figura `flow` (recuadros y flechas) se dibuja solo si **el PDF original lo corrobora** (`auto/flow.ts › corroboratesFlow`), con lo que el propio PDF imprime y sin modelo:
  1. **Flechas = glifos de la capa de texto** («→», «->»…) en **una sola fila**, exactamente una entre cada dos cajas. El glifo es también la evidencia del **sentido**: una flecha hacia la derecha entre una caja a su izquierda y otra a su derecha significa flujo de izquierda a derecha, el orden de la afirmación. Flechas hacia la izquierda, dobles o verticales, o cualquier otro número → nada.
  2. **Etiquetas = el texto entre las flechas**, agrupado por cajas. Una etiqueta partida en varias líneas de la misma caja («LARVAS DE» / «INSECTOS») se une en orden de lectura antes de compararla.
  3. **Cajas realmente dibujadas**: cada etiqueta dentro de un rectángulo cerrado de tinta (cuatro lados) que no contiene ningún otro texto.
  4. Cada caja, en orden, coincide con la etiqueta de la afirmación; nada impreso en la banda del esquema que no pertenezca a una caja.
- **Probado con el PDF real del estanque** (`Ficha_prueba_Adaptaula_Estanque_5Primaria`, página 2, sin modelos de pago): la primera versión del algoritmo (etiquetas individuales y línea continua de tinta) **no lo reconocía** (etiqueta partida, flechas como caracteres). Con la versión actual **lo corrobora**. El PDF no se guarda en el repositorio: las pruebas reproducen su geometría (coordenadas medidas) y comprueban además las variantes que **no** deben pasar: flecha invertida o doble, orden distinto, sin cajas, texto extra, etiqueta repetida o distinta, y un PDF generado con raster real.
- **No se ha relajado nada para llegar ahí**: se sustituyó la evidencia por otra más fuerte (el glifo da el sentido; la línea de tinta no lo daba y se retiró).
- Límites asumidos (parada segura en todos): imagen sin capa de texto; conectores dibujados como línea o imagen sin glifo de sentido; esquemas en columna o con ramas; cajas sin borde.

### 2.2 Conservar el original no es resolver una barrera, y cubrir es cubrir PARA ESA ACTIVIDAD

- Cuando una decisión retenida por V2.2 se resuelve conservando el original, se comprueba cada necesidad **alta** que atendía: ¿la cubre otra decisión aplicada **que alcance esa actividad**, o la presentación? Si no, la adaptación **no se finaliza**: se detiene antes de generar y la pantalla nombra la necesidad (`unresolvedNeeds`).
- **«Alcanzar» (`reaches`)**: la otra decisión actúa sobre la **misma actividad**, sobre el **recurso** con el que trabaja (texto o figura) o sobre la actividad que usa ese recurso, o es un apoyo de **todo el documento**. Una decisión sobre **otra actividad** con la misma dimensión **no cubre**. (Antes, `resolveWithheldAutonomously` y `resolveAutomatically` daban por cubierta una necesidad si cualquier decisión usaba la misma dimensión, en cualquier actividad: era un fallo. La corrección automática tras generar (`losesCoverage`) tenía el mismo defecto y también se ha corregido, **solo para necesidades altas**: las medias y bajas conservan su lectura anterior para no ampliar el alcance.)
- Necesidades de intensidad baja o media no detienen la ficha por sí solas (criterio ya existente).
- Pruebas: la misma dimensión en otra actividad **no** cubre; en la misma actividad o en el documento, sí. Cuatro pruebas de base de datos daban por «cubierta» una necesidad alta con una decisión de **otra** actividad y entregaban la ficha; se han reescrito: ahora el caso válido lleva una decisión que cubre **la misma actividad**, y hay una prueba nueva que comprueba que, con la cobertura en otra actividad, **la decisión no se descarta y la ficha no se entrega**.

### 2.3 Resto

- **Conflictos.** `needs_conflict` solo si la decisión hace lo que la guía prohíbe (`conflicts.ts › conflictViolated`); una clave de conflicto desconocida conserva la lectura prudente.
- **V2.2 sin preguntas.** Una decisión retenida se resuelve internamente: variante segura → alternativa → original conservado, con causa y motivo en el informe de ejecución (`autonomous-resolution.ts`). «Revisar antes de crear» no cambia: allí las confirmaciones siguen siendo del docente.

## 3. El perfil funcional: qué se ha conseguido realmente y qué falta

**Principio:** no adaptamos un material para un diagnóstico ni para una categoría; adaptamos un material concreto para un alumno concreto a partir de su perfil funcional.

### Conseguido (comprobado con pruebas)

- Las **necesidades** del perfil (apoyos por dimensión) son lo único que justifica un cambio: toda decisión cita las suyas y el validador rechaza lo que no responde a ninguna. Con la misma ficha, perfiles distintos producen **decisiones distintas** y un perfil sin necesidades aplicables deja la ficha como está (A, B y C).
- Las **barreras y fortalezas declaradas** (catálogo cerrado, sin diagnósticos ni texto libre) viajan al contexto. Cada decisión aplicada guarda una **justificación trazable**: necesidad, barrera declarada que reduce, fortaleza declarada que aprovecha y lo que conserva (`execution_report.automatic.justifications`).
- **Alcance real de las fortalezas:** hoy **solo desempatan**: en la política de contexto 3 reordenan las estrategias candidatas de cada necesidad (nunca añaden una ni cambian una necesidad). No deciden por sí solas qué se hace. Con el planificador anterior (v2) no hay instrucción propia que las use: su efecto es el orden de las candidatas. Con V2.2, las reglas privadas del método las aplican. **Eso no es todavía «el perfil como fundamento»**: es el perfil como fuente de necesidades más un desempate por fortalezas.
- 4 fortalezas nuevas de acceso y respuesta en el catálogo (elegir entre opciones, listas de pasos, tareas cortas, organizadores gráficos).

### Falta (no se ha hecho, para no ampliar el alcance sin decidirlo)

| Falta | Estado |
|---|---|
| **Autonomía** (cuánto trabaja solo/a, con qué ayuda) | No existe en el perfil. |
| **Formas de acceso y de respuesta** como datos propios (oral, selección, dictado, teclado…) | Solo hay las dimensiones de respuesta (`alternative_response`, `selection_based_response`…) y 1–2 fortalezas; no un apartado de «cómo accede y cómo responde». |
| **Apoyos eficaces** («qué funciona») | No se registra qué apoyos le han funcionado. |
| **Información insuficiente o contradictoria** | No hay distinción explícita entre *conocido* y *desconocido* en el perfil: una dimensión ausente se lee «no valorada» y una barrera declarada sin apoyo no se contrasta. |
| **Orientación al crear el perfil** | No hay ayuda para completar fortalezas ni avisos de perfil pobre. |
| **Prompt que use fortalezas** (`adaptation_planner@v4`) | No existe: las versiones publicadas no se editan y una nueva exige evaluarla con el modelo real (coste). |
| **Pantalla «Consultar decisiones»** | La justificación se guarda; no hay pantalla que la muestre. |

Cualquier ampliación debe mantener perfiles funcionales, observables e individuales, sin diagnósticos ni etiquetas clínicas obligatorias, sin texto libre sobre el alumnado y con catálogo cerrado.

## 4. Riesgos pedagógicos pendientes antes de recomendar el merge

1. **`functional_supports_applied` sigue siendo solo una advertencia (después de generar).** La comprobación actual es por **dimensión**, no por actividad (basta una decisión con esa dimensión usada en cualquier sitio) y su resultado máximo es `WARN` («Alguna necesidad no queda del todo cubierta»). Una ficha puede salir con advertencia aunque una barrera importante siga sin resolver en una actividad concreta. No se ha endurecido en esta PR para no introducir bloqueos sin datos.

   **Propuesta para distinguir una insuficiencia crítica y comprobable de una observación menor** (no implementada):
   - *Crítica* solo si se cumplen **todas**: (a) la necesidad es de intensidad **alta**; (b) existe una actividad donde la demanda es **medible** con un predicado determinista que ya tenemos (consigna por encima de `max_instruction_words`; texto por encima del límite de lectura; más tareas visibles que `max_visible_tasks`; menos líneas de respuesta que las que pide la tarea); (c) **ninguna decisión aplicada alcanza esa actividad** para esa dimensión (`reaches`) ni la presentación la cubre; (d) el elemento final de la ficha **sigue superando el límite** medido. Entonces: una corrección automática acotada y, si persiste, parada honesta (no se entrega como válida).
   - *Observación menor* en cualquier otro caso: intensidad media o baja, necesidad sin predicado medible (p. ej. memoria de trabajo, ansiedad), cobertura parcial o apoyo equivalente. Se mantiene `WARN`, visible en «Conviene que compruebes estos puntos», sin bloqueo.
   - *Despliegue por fases*: primero **en modo sombra** (calcular y registrar en el informe de ejecución sin bloquear) durante un periodo de fichas reales, medir falsos positivos con el criterio de la docente, y activar el bloqueo solo para las dimensiones medibles con tasa de falsos positivos nula. Hasta entonces, no hay bloqueos injustificados.
2. **Evidencia visual (principio 2).** Solo PDFs con capa de texto y flechas como glifos (el estanque real sí pasa; ver §2.1). La reconstrucción es de **etiquetas, orden y sentido de izquierda a derecha**, no de lo que significa cada flecha (se deja a la actividad). Otros esquemas (flechas como dibujo, columnas, ramas) no se reconstruyen: parada segura. Solo se ha comprobado un PDF real; cada esquema nuevo puede requerir una variante.
3. **El perfil como fundamento (principio 3).** Con el planificador anterior las fortalezas apenas influyen; la afirmación «el perfil decide» es cierta para las necesidades y parcial para fortalezas, autonomía, formas de acceso y apoyos eficaces (ver tabla). No debe comunicarse al docente como completa.
4. **Primera ejecución real.** Ninguna de estas rutas se ha ejecutado con el modelo real ni con la ficha del estanque en producción.

Sin E2E ni llamadas de IA de pago; sin migraciones; sin despliegue.
