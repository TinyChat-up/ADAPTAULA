# Motor de recreación pedagógica (piloto aislado)

Decisiones: [ADR-049, ADR-050 y ADR-051](ARCHITECTURE.md). Pantalla y modo «generar una vez»: [QA plataforma](qa/recreacion-plataforma/README.md).

> **ADR-051.** El producto entrega la ficha y los materiales, y muestra en pantalla la explicación que Claude redacta en la misma llamada del plan. Ya no hay guía ni clave en PDF; las respuestas quedan internas. Abrir una recreación lee el registro guardado (`view.ts`) sin llamar a ninguna IA; regenerar es explícito (`create.ts`). Informe del piloto: [qa/recreacion-pedagogica](qa/recreacion-pedagogica/README.md).

«Hacer magia» adapta la ficha original conservando sus actividades y su estructura. El motor de recreación usa la ficha como **fuente** de contenidos, objetivos y exigencia cognitiva, y diseña **actividades nuevas** según el perfil y el alcance autorizado. Esta primera entrega es un recorrido vertical aislado. No cambia «Hacer magia», ninguna ruta, ninguna tabla ni ninguna variable de producción.

## Estado de la ficha antes de usarla · Fase 0

En las nuevas generaciones, el verificador, la versión visible y la revisión guardada comparten los motivos de revisión. Una resta puede tener solución demostrada y seguir pendiente de comprobar si el alumno tiene que decidir la operación. El aviso indica qué actividades revisar y la revisión guardada identifica sus bloques. La equivalencia del razonamiento sigue pendiente para cada objetivo del verificador actual.

| Evidencia disponible | Consecuencia |
| --- | --- |
| Respuesta abierta con criterios | El docente valorará la producción cuando responda el alumno. Por sí sola, esta condición no exige revisar el diseño de la ficha. |
| Respuesta cerrada con evidencia textual | Las interpretaciones siguen pendientes de contrastar con la fuente. Las reglas detectan algunos tipos de pistas. La revelación indirecta sigue pendiente de revisión. |
| Esquema con relaciones respaldadas por citas | El significado y la dirección de las flechas quedan pendientes. |
| Recurso imprescindible ausente o actividad sin resolver | La ficha queda incompleta y se mantiene el bloqueo de entrega de Hacer magia. |

En la BD, `adaptations.status = ready` identifica una entrega. El estado de la versión distingue controles superados (`ready`), comprobaciones pendientes (`review`) y una ficha incompleta (`incomplete`). Una propuesta imprimible se puede descargar aunque queden comprobaciones pendientes antes de usarla con el alumnado. `approved_with_warnings` sigue siendo el dictamen técnico de entrega y cuota. Cuando falta el estado de la versión, la interfaz indica que la verificación carece de confirmación. Los avisos públicos de recreación usan textos aprobados por el servidor. Una advertencia sobre el sentido de una flecha conserva ese significado. Las versiones históricas conservan su documento y el dictamen registrado en su fecha. Un trabajo que retoma un plan anterior conserva la versión del verificador que lo examinó.

### Experiencia definitiva de Hacer magia

Después de crear un perfil sencillo una vez, el docente sube el original, selecciona el perfil y pulsa «Hacer magia». El motor analiza, diseña, fabrica y comprueba la ficha. El recorrido habitual tiene cero preguntas adicionales y entrega un documento listo para usar. La revisión de calidad corresponde al motor. Debe resolver internamente lo que pueda con reglas deterministas, revisión semántica independiente cuando corresponda, controles de los recursos fabricados y reparación localizada. Una comprobación esencial pendiente o un error grave impiden presentar la ficha como validada. Las incertidumbres del piloto actual siguen visibles hasta disponer de evidencia que las resuelva.

Una decisión docente excepcional solo se ofrece si la información falta en el perfil y su criterio puede mejorar significativamente el resultado. Como máximo, una pantalla breve con dos o tres opciones por decisión en lenguaje cotidiano y una recomendación cuando exista una razón pedagógica. Los fallos técnicos y las dudas del verificador corresponden al motor. Cualquier cambio de objetivos requiere autorización curricular explícita.

«Respuestas breves con apoyos» es la preferencia del ejemplo comentado. Puede orientar hacia consignas claras, apoyos visuales funcionales, comienzos de frase que preserven el razonamiento y espacio suficiente para escribir. Las respuestas pueden ser breves cuando la extensión no sea parte del objetivo. Si se evalúa redacción, argumentación escrita o producción textual, se conserva esa demanda salvo autorización curricular explícita.

### Siguientes entregas y evidencia necesaria para avanzar

| Fase | Entrega para revisión independiente |
| --- | --- |
| 1 · Perfil | Formulario y resumen pertinente por área. Comprobar autonomía con y sin ayuda, campos desconocidos, privacidad y lectura de perfiles anteriores. |
| 2 · Comprensión del original | Contrato por actividad con decisiones que corresponden al alumno, condiciones, recursos e incertidumbres trazables al original. |
| 3 · Dirección pedagógica | 3A propone y comprueba decisiones por actividad en casos controlados. 3B conecta la dirección al planificador existente en un recorrido simulado y comprueba qué se fabrica. |
| 4 · Fabricación | Cada herramienta demuestra un recorrido de encargo a PDF A4 mediante MaterialDocument y CLARO. Revisar la ficha impresa. |
| 5 · Proveedores y gasto | Comparar modelos por tarea, acotar la reparación y probar presupuesto compartido bajo concurrencia. Los ensayos de pago requieren autorización. |
| 6 · Sustitución gradual | Comparar calidad docente, errores graves, tasa de entrega y coste por ficha utilizable en Primaria y ESO. Conservar lectura histórica y retorno al motor previo. |

## Director pedagógico · Fase 3A

`directPedagogy(input, propuesta?)` es la interfaz interna de servidor en [director.ts](../src/lib/recreation/director.ts). Recibe el análisis v4 completo vinculado al original, el SHA-256 del archivo que conserva el servidor, la etapa y el curso, la asignatura verificada, el perfil y la autorización docente por ficha. Reutiliza `profileForSubject()`, `buildAdaptationContext()` y `checkPedagogicalScope()`. Si falta V4 devuelve un bloqueo explícito. V3 continúa como analizador predeterminado y el motor actual conserva su lectura de análisis y adaptaciones históricas.

La salida versionada `PedagogicalDirectionSchema` contiene una decisión por actividad. Registra qué cambiar, qué está prohibido, las necesidades de apoyo, los aprendizajes pertinentes, la evidencia y los requisitos de fabricación. Sus huellas vinculan el resultado al original, el análisis completo, el perfil pertinente y el contexto que se utilizaron. La salida es interna. Las citas del original son contenido no confiable. Las observaciones libres del perfil se cotejan solo en memoria y quedan fuera de la salida.

| Decisión | Qué propone y con qué límites |
| --- | --- |
| **Conservar** | Mantiene la actividad cuando no hay un cambio justificado. Si falta evidencia de la fuente o del apoyo necesario, conserva el original como referencia y devuelve `needs_evidence`. |
| **Facilitar** | Puede separar literalmente oraciones de la consigna, aportar espacio en blanco, distinguir visualmente secciones o aplicar ajustes de presentación. El espacio en blanco deja que el alumno elija y ordene sus operaciones. La navegación visual señala estructuras y mantiene el texto, sin resaltar el fragmento que resuelve una inferencia. |
| **Transformar** | Puede proponer una respuesta oral si la escritura es solo un medio de respuesta, hay una necesidad pertinente, el perfil la contempla y el docente autorizó metodología. Redacción, argumentación o restricciones explícitas de formato bloquean este cambio. |
| **Sustituir** | Examina una propuesta estructurada que conserva todas las obligaciones y pide un ejecutor compatible. En 3A se admite como candidata únicamente la respuesta abierta breve ya disponible en recreación. El planificador existente tendrá que diseñar la sustitución concreta y contrastar su equivalencia. |

**Qué comprueba el código.** El servidor deriva las obligaciones desde V4 y el grafo v3. Incluyen objetivos, operaciones, decisiones del alumno, evaluación, condiciones, datos, recursos enlazados y elementos protegidos del original. Cada propuesta cita las obligaciones que conserva. Omitir una operación como inferir, una condición como «con dos argumentos» u otro elemento protegido provoca rechazo. Las necesidades deben constar en el contexto y ser pertinentes para el cambio. El acceso conserva el formato de respuesta. La preferencia curricular guardada en un perfil carece de valor como autorización. La vía curricular queda bloqueada en 3A, incluso con una autorización válida. El registro y la presentación se mantienen acordes a la etapa de Secundaria, con independencia del apoyo o nivel competencial.

**Qué aporta el perfil.** El cotejo de aprendizajes se limita a coincidencias de texto completo con objetivos de su asignatura verificada. Una habilidad «con ayuda» o «todavía no» y una necesidad de refuerzo pueden dejar el apoyo pendiente aunque se conserve la actividad. «Sin valorar», incluido el historial, no cuenta como competencia demostrada. Los registros vinculados conservan su estado e índice interno. Una fortaleza, una dificultad de acceso o la falta de observaciones nunca justifican eliminar un objetivo.

**Límite de comprobación.** `design_candidate` indica que las restricciones estructurales permiten continuar al diseño. La equivalencia queda `pending` porque una lista de obligaciones no demuestra lo que pedirá la actividad fabricada. Las incertidumbres del análisis se conservan. Cualquier cambio requiere comprobación del contenido y del resultado renderizado, con atención a pistas, relaciones, demanda, recursos y accesibilidad. Una imagen nueva se declara fuera de la cobertura de este director. Los ensayos sintéticos no estiman calidad pedagógica ni tasa de entrega con materiales reales.

**Integración 3B.** Usar este contrato antes de proponer cambios en el planificador de recreación existente. Vincular el plan y sus recursos a las huellas y al identificador del original por actividad. Consumir únicamente `design_candidate` para diseñar cambios y mantener el texto y los recursos de `unchanged`. Respetar `needs_evidence` y `rejected` como bloqueos. Verificar después con `verifyPlan()` y con comprobaciones semánticas y de fabricación que examinen la actividad real. La respuesta oral tiene un componente en el ensamblador clásico. Su integración en la recreación y la ruta de cada apoyo hasta el PDF están pendientes. Esta fase no modifica el planificador, los contratos de recreación ni la cadena de Hacer magia.

## Integración aislada del director · Fase 3B

[Fase 3B](../src/lib/recreation/directed-pilot.ts) recibe un análisis V4, el PDF original, el perfil y la autorización por ficha. Llama a `directPedagogy()`, envía las candidatas al planificador existente por el transporte de salidas estructuradas y fabrica un `MaterialDocument`. La entrada de este piloto exige una respuesta simulada. V3 sigue siendo el analizador predeterminado. La ejecución habitual y las versiones históricas de Hacer magia conservan sus contratos y huellas.

| Estado del director | Acción |
| --- | --- |
| `unchanged` | El ensamblador literal conserva la actividad, su modo de respuesta y los recursos vinculados. Queda fuera de las actividades que el planificador puede cambiar. |
| `design_candidate` | El planificador recibe los cambios, necesidades funcionales pertinentes, prohibiciones y obligaciones de esa actividad. El servidor aplica exclusivamente los cambios autorizados. |
| `needs_evidence` / `rejected` | Todo el recorrido devuelve un bloqueo con las actividades afectadas. No se descarta actividad alguna para fabricar un documento parcial. |

El contrato aislado de plan v1 declara el id de origen, el id de resultado y las obligaciones conservadas. Solo se admite una correspondencia uno a uno. Una división, fusión, omisión, cambio fuera de alcance o recurso nuevo sin autorización bloquean el documento. El planificador recibe las citas dentro de `<untrusted_material>` y las necesidades como dimensiones e intensidades. Las observaciones libres, los estados e índices del perfil y sus huellas privadas se quedan en el servidor. El plan debe corresponder a la huella de su entrada reducida. El artefacto interno vincula el SHA-256 del original y las huellas del análisis V4 completo, el perfil, el contexto, el plan, los enlaces, el documento y sus recursos.

**Fabricación y comprobación.** La segmentación solo cambia espacios por separaciones de párrafo. El trabajo manuscrito puede recibir espacio adicional sin encabezados que dicten una operación. La orientación visual usa una caja neutra del renderizador. Para la respuesta oral autorizada se reutiliza el ensamblador existente. Una sustitución compatible pasa por `verifyPlan()`, el compilador de recreación y `auditFidelity()`. Además se comprueban por actividad los objetivos, etiquetas de operación, formato, criterios, datos, condiciones y la referencia exacta de los recursos. Se preservan textos, tablas y series del análisis. Una imagen original requiere un recurso fijado por hash, vinculado a ese PDF y a su referencia. Si un gráfico imprescindible no admite una representación fiel con el renderer actual, se bloquea. En PDF se comprueban A4, fuentes, páginas, imágenes fijadas y carga sin red. Las pruebas extraen las etiquetas y cifras del gráfico y comprueban que el recurso fijado llega a los píxeles del PDF.

**Límites.** Una estructura aprobada y un PDF técnicamente válido siguen en `review_pending`. Las pruebas de frases y recursos comparan con el análisis disponible. Una transcripción literalmente conservada puede contener errores del analizador. El verificador existente comprueba pistas cuando tiene evidencia fiable y la orientación solo puede usar texto fijo. Detectar pistas implícitas en una nueva pregunta abierta, comprobar el sentido de una inferencia, la adecuación a la autonomía declarada y la legibilidad para distintos perfiles requieren revisión adicional. Se rechaza la sustitución si falta un campo para representar la operación o una decisión del alumno. Las rejillas sin dimensiones verificadas y los cambios de presentación que solo afectan a algunas actividades también generan un bloqueo explícito.

**Antes de activar el recorrido.** Validar el análisis V4 con materiales reales autorizados, comprobar la procedencia y la legibilidad de imágenes y gráficos, añadir revisión semántica independiente de actividades y apoyos, y verificar la compatibilidad de las versiones con la aplicación. Para admitir división o fusión harán falta enlaces comprobables de cada obligación a los bloques correspondientes. Esta entrega cubre pruebas locales con datos sintéticos y uso de los ejecutores actuales.

## Consignas claras y apoyos concretos · Fase 4.1

Primera entrega de fabricación, solo en el piloto del director ([directed-supports.ts](../src/lib/recreation/directed-supports.ts)). Hacer magia en producción no cambia. Todo se deriva del original verificado, sin modelo ni información nueva.

| Apoyo | Qué hace | Límite |
| --- | --- | --- |
| Condiciones resaltadas | Con `segment_instruction` o `visual_navigation`, pone en negrita las citas literales de cómo responder: extensión, términos, unidades, método, formato y el razonamiento que se pide («Justifica el procedimiento», «con dos argumentos»). | Nunca datos (`required_data`, información) ni lo que el alumno debe seleccionar, inferir, clasificar, interpretar o elegir como criterio. Se omite una cita que contenga la respuesta esperada, que no aparezca literal o que ocupe más del 60 % de la consigna. Como máximo tres por actividad. El texto es idéntico salvo las marcas. |
| «Antes de entregar, comprueba» | Sustituye el cuadro genérico «Orientación» por una lista con esas mismas citas. Solo aparece si hay dos o más requisitos, o uno en una producción escrita extensa. | Sin requisitos no se imprime nada. No añade pasos de razonamiento ni pistas. Pasa por la auditoría de pistas existente. |
| Espacio para responder | `blank_workspace` reserva como mínimo 8 líneas si se evalúa redacción o argumentación. En el resto suma 2 líneas a las del original. | El espacio no lleva encabezados. Tope de 40 líneas. |

Si se pide `visual_navigation` y la actividad no tiene requisitos de forma que resaltar, no se imprime nada en su lugar. La traza lo declara (`unfabricated: ["visual_navigation"]`) y el resultado marca `checks.supports: "partial"`: el apoyo no se da por aplicado ni se sustituye por un cuadro genérico. La negrita que ya trae el original se conserva carácter por carácter. Adaptaula no añade marcas dentro de ella ni junto a ella, ni si el original deja marcas desparejadas. La verificación literal retira solo las marcas que Adaptaula añadió (`emphasised` en la traza).

Comprobado con la ficha sintética de 1.º de ESO en PDF A4 real: sin páginas vacías, datos sin resaltar y comprobación final después del espacio de escritura. La utilidad para el alumnado sigue pendiente de valoración docente con materiales reales.

## Recorrido

```
MaterialAnalysis + AdaptationContext (perfil → necesidades, límites, formatos)
   │  recreationInput()          sin identificadores ni texto libre; material como datos no confiables
   ▼
createRecreationPlanner()        proveedor de src/lib/ai + callStructured + recreation_planner v1 · tope de gasto · ai_runs
   │  RecreationPlanSchema       contrato recreation_plan@v1 (≤ 1 reparación con los motivos)
   ▼
verifyPlan()                     recreation_verify@v3: alcance, objetivos/operaciones, citas y cifras, soluciones, pistas,
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
| `VisualSpec` `diagram` | Esquema NUEVO diseñado por Claude (v7, ADR-059): cadena, ciclo, jerarquía o grupos; cada rótulo y relación respaldados por un hecho citado. Sin modelo de imagen. | Ninguno |
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
6. **Materiales** (`visuals`, `diagrams`, `materials`): `flow` con los rótulos del original, comprobados; desde v7, esquemas nuevos (`diagrams`) anclados a hechos citados (ADR-059); tarjetas para recortar (por ahora como estructura, se imprimen en la guía).
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
