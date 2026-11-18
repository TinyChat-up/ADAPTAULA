# Motor de recreación pedagógica (piloto aislado)

Decisiones: [ADR-049 y ADR-050](ARCHITECTURE.md). Informe del piloto: [qa/recreacion-pedagogica](qa/recreacion-pedagogica/README.md).

«Hacer magia» adapta la ficha original conservando sus actividades y su estructura. El motor de recreación usa la ficha como **fuente** de contenidos, objetivos y exigencia cognitiva, y diseña **actividades nuevas** según el perfil y el alcance autorizado. Esta primera entrega es un recorrido vertical aislado. No cambia «Hacer magia», ninguna ruta, ninguna tabla ni ninguna variable de producción.

## Recorrido

```
MaterialAnalysis + AdaptationContext (perfil → necesidades, límites, formatos)
   │  recreationInput()          sin identificadores ni texto libre; material como datos no confiables
   ▼
createRecreationPlanner()        proveedor de src/lib/ai + callStructured + recreation_planner v1 · tope de gasto · ai_runs
   │  RecreationPlanSchema       contrato recreation_plan@v1 (≤ 1 reparación con los motivos)
   ▼
verifyPlan()                     recreation_verify@v2: alcance, objetivos/operaciones, citas y cifras, soluciones, pistas,
   │                             equivalencia por objetivo (razonamiento siempre pendiente)
   ▼
resolveVisuals()                 A original · B esquema por código · C illustrate() (puerta, cuota, presupuesto, revisión)
   ▼
compileRecreation()              ficha del alumno · tarjetas recortables · guía breve · clave y revisión (procedencia)
   ▼
buildRenderModel → renderPrintHtml → Chromium   (el renderer y el motor PDF de siempre)
```

Código: `src/lib/recreation/{contract,verify,planner,visuals,compile,input,pilot}.ts`, `prompts/recreation-planner/v1.ts`. Piloto: `evals/recreation/pond-plan.ts`. Recorrido simulado: `tests/support/recreation-mocks.ts`.

> **Actualización ADR-050:** el estado de cada ejecutor ya no es el de la tabla siguiente.
> - `classify` sigue siendo `anchored`, ahora presentado como «sin comprobar».
> - `sequence` solo es `verified` según su `basis`: orden del texto, o temporal/causal demostrado con conectores.
> - `compute` solo es `verified` con cifras inequívocas.
>
> Las tarjetas se imprimen en su propia hoja. La guía se divide en guía breve y clave y revisión.

## Auditoría: qué se reutiliza

| Pieza existente | Uso en el motor | Cambios |
| --- | --- | --- |
| `MaterialAnalysis` (objetivos, textos, visuales, actividades) | Fuente de objetivos, citas y operaciones mínimas. No se usa `expected_answer`. | Ninguno |
| `buildAdaptationContext` + perfil (V2/V3) | Necesidades funcionales y presentación (letra, interlineado, tareas por página). | Ninguno |
| Alcance por ficha (`pedagogical-scope.ts`) | Mismo vocabulario: `accessibility` / `methodological` / `curricular`. El motor exige `methodological` y rechaza `curricular`. | Ninguno |
| `MaterialDocument` y su clave separada | La ficha nueva es un documento normal. Las soluciones cerradas van en `answer_key`, que la vista del alumno nunca imprime. | Ninguno |
| Formatos de respuesta `match`, `sequence`, `choice`, `true_false`, `fields`, `lines` y `sentence_starters` | Se rellenan con los ejecutores. | Ninguno |
| `VisualSpec` `flow` | Esquema del original redibujado con sus rótulos. Sin modelo de imagen. | Ninguno |
| Renderer CLARO, paginación, motor Chromium y validación PDF | Ficha y guía se imprimen igual que cualquier adaptación. | Ninguno |
| Revisión semántica (`pedagogical_reviewer@v2`) | **No** se usa aún. Lo semántico (por ejemplo, pistas cruzadas entre actividades) queda para la guía y el docente. | Pendiente |
| Almacenamiento, permisos, cuotas, versiones y `ai_runs` | **No** se conectan en el piloto (sin rutas ni tablas nuevas). La salida son dos `MaterialDocument`, la misma unidad que ya persiste `adaptation_versions`. | Siguiente entrega |

Piezas nuevas mínimas: contrato, verificador, compilador, entrada minimizada, prompt v1 (no ejecutado) y seis ejecutores.

## Contrato `recreation_plan@v1`

Siete partes separadas:

1. **Objetivos y nivel autorizado** (`scope`, `objectives[].level`): todos los objetivos del original, `kept`. `adjusted` solo existe con autorización curricular, que el piloto rechaza.
2. **Operaciones cognitivas** (`objectives[].operations`): identificar, localizar pruebas, clasificar, ordenar, interpretar relaciones, predecir, calcular, valorar, justificar y proponer. El servidor deduce las operaciones mínimas de cada objetivo a partir de los enunciados del original (`originalOperations`); el plan puede añadir operaciones, nunca quitar una.
3. **Estrategias metodológicas** (`strategies`): método y necesidades del contexto que lo justifican. Una necesidad que no está en el contexto se rechaza.
4. **Actividades nuevas** (`activities`): cada una cita sus objetivos, operaciones y estrategias. Si su enunciado se parece demasiado a uno del original (Jaccard ≥ 0,5), se rechaza por no ser nueva.
5. **Formatos y soluciones** (`executor` + `facts`): ver la tabla siguiente.
6. **Materiales** (`visuals`, `materials`): `flow` con los rótulos del original, comprobados; tarjetas para recortar (por ahora como estructura, se imprimen en la guía).
7. **Docente** (`guide`): visión general y qué observar en cada actividad.

### Ejecutores y cómo se conoce la solución

| Ejecutor | Respuesta impresa | Solución | Estado |
| --- | --- | --- | --- |
| `sequence` | casillas para numerar (`sequence`) | Orden de aparición de las citas en el texto, con posiciones distintas: única. Los ítems se imprimen en un orden que nunca es el de la solución. | `verified` |
| `compute` | `Operación:` / `Resultado:` + unidad (`fields`) | Aritmética sobre dos cantidades citadas con la misma unidad. | `verified` |
| `classify` | relacionar con letras (`match`) | Cada ítem citado va a un solo grupo: única por construcción. El grupo es conocimiento curricular, no se puede probar con las palabras. | `anchored` |
| `select` | opciones (`choice`) | Cada opción correcta cita su dato; el número de correctas coincide con el que anuncia el enunciado. | `anchored` |
| `true_false` | V/F | Cada afirmación cita su dato; no todas tienen el mismo valor. | `anchored` |
| `short_answer` | ≤ 4 líneas + inicios de frase | Criterios para el docente, nunca una respuesta modelo. | `teacher_review` |

**Ninguna actividad se da por válida solo porque el mismo modelo haya escrito su solución.** En `sequence` y `compute` el modelo no escribe la solución. En los formatos `anchored`, la guía avisa de que el sentido lo revisa el docente.

### Pistas

El verificador rechaza que un texto del alumno (enunciado, paso, inicio de frase o recurso visual) contenga:

- el resultado de un cálculo;
- la opción correcta de otra actividad;
- un ítem junto a su grupo;
- tres o más pasos de una secuencia en su orden.

Las pistas **semánticas** entre actividades (una afirmación V/F que confirma la opción de otra) no son detectables así. Por eso se revisaron a mano en el piloto y quedan como trabajo para el revisor semántico.

## Privacidad y seguridad

- `recreationInput` solo envía del alumno las necesidades (`dimension`, `level`). Nada de nombre, etiquetas, observaciones ni texto declarado del perfil V3. No envía las respuestas inferidas del análisis.
- El material va entre `<untrusted_material>`, con `<` y `>` escapados: un texto de la ficha no puede cerrar el bloque (probado).
- El alcance lo fija el servidor: un plan que declara otro alcance se rechaza.
- Texto plano con límites de longitud y sin marcas (`< > { }` y comillas invertidas).
- Sin llamadas a modelos en las pruebas. El planificador es una función inyectada.

## Límites de esta entrega

- El plan del estanque está **escrito a mano** con el contrato exacto que producirá un modelo. Prueba que el contrato y el servidor funcionan; no prueba la calidad de un plan generado por un modelo. El prompt v1 existe, pero no se ha ejecutado.
- Solo Ciencias de Primaria y una lectura. Sin adaptación curricular, sin modelo de imágenes y sin nuevas metodologías más allá de las seis.
- Las tarjetas se imprimen como tabla en la guía, no como una hoja de recortables con su propio diseño.
- No se conecta a almacenamiento, cuotas, versiones ni interfaz.
