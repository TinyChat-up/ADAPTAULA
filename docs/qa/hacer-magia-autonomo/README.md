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
- La figura nueva `flow` (recuadros y flechas) se dibuja solo si **el original lo corrobora** (`auto/flow.ts › corroboratesFlow`), con evidencia que no depende del modelo:
  1. la **capa de texto del PDF** imprime cada etiqueta como su propio cuadro de texto, **una sola vez**;
  2. están en **una fila o una columna**, en el orden de la cadena;
  3. entre cada dos etiquetas consecutivas **una línea continua de tinta cruza el centro del hueco** (el conector). Los bordes de las cajas no cuentan.
- Además, las etiquetas del PDF deben coincidir, una a una y en el mismo orden, con las del análisis. Si no, nada.
- **Sin evidencia → parada segura**, como antes (`visual_unavailable`). Una imagen subida (sin capa de texto), un texto del PDF fundido en una sola línea, flechas dibujadas como imagen sin trazo continuo o un orden distinto **no se reconstruyen**.
- Limitación asumida: solo PDFs con capa de texto. El estanque original debe pasar esta comprobación sobre su PDF real; **no se ha podido comprobar con el PDF del docente** (no se ha accedido a su archivo). Si no la pasa, la ficha sigue parándose, con la misma explicación honesta.

### 2.2 Conservar el original no es resolver una barrera

- Cuando una decisión retenida por el método V2.2 se resuelve conservando el original, se comprueba cada necesidad **alta** que atendía: ¿la cubre otra decisión aplicada (aprobada o editada) o la presentación? Si no, la necesidad queda **sin cubrir**: la adaptación **no se finaliza** automáticamente, se detiene antes de generar y la pantalla nombra esa necesidad (`unresolvedNeeds`). El docente puede elegir *Editar*, pero nadie se lo exige.
- Necesidades de intensidad baja o media no detienen la ficha por sí solas (criterio ya existente en `resolveAutomatically`).
- Esta comprobación se hace **antes de generar**. La revisión pedagógica posterior mantiene sus comprobaciones (`functional_supports_applied` sigue siendo advertencia, no bloqueo): ver riesgos.

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

1. **Cobertura posterior a la generación (principio 1).** La comprobación de «necesidad esencial sin cubrir» solo se aplica al resolver decisiones retenidas por V2.2. La revisión pedagógica posterior conserva `functional_supports_applied` como **advertencia**: una ficha puede salir con advertencia si una barrera importante queda con un apoyo débil. No se ha endurecido para no cambiar lo que ya funciona.
2. **Evidencia visual (principio 2).** Solo PDFs con capa de texto; no probado con el PDF real del estanque. La reconstrucción es de **etiquetas y orden**, no de la semántica de las flechas (se deja a la actividad). Un esquema con conectores distintos de una línea continua (curvas, flechas como imagen) no se reconstruye: parada segura.
3. **El perfil como fundamento (principio 3).** Con el planificador anterior las fortalezas apenas influyen; la afirmación «el perfil decide» es cierta para las necesidades y parcial para fortalezas, autonomía, formas de acceso y apoyos eficaces (ver tabla). No debe comunicarse al docente como completa.
4. **Primera ejecución real.** Ninguna de estas rutas se ha ejecutado con el modelo real ni con la ficha del estanque en producción.

Sin E2E ni llamadas de IA de pago; sin migraciones; sin despliegue.
