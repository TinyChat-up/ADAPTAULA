# Calidad visual y PDF · correcciones acotadas

Fecha: 2026-11-13. Base: `main` `ae1ba94`. Rama: `codex/calidad-visual-pdf`.

**La prueba visual del caso real NO está superada.** Faltan dos archivos: el PDF original de «Un estanque en equilibrio» con sus fotografías y la adaptación defectuosa de siete páginas. No se han consultado servicios remotos ni generado otra adaptación mediante IA. Las evidencias de esta carpeta son renderizados locales con Chromium, no resultados nuevos del generador real ni materiales aprobados para alumnado.

## Diagnóstico y alcance

| Problema | Evidencia disponible y causa | Resultado / límite |
| --- | --- | --- |
| Fotografías originales desaparecidas | El fixture `tests/support/pond-case.ts` solo contiene dos tablas y un esquema; no contiene fotografías. En código, `literalUnits` descartaba un visual clasificado como decorativo aun estando explícitamente referenciado por una actividad. `autoTargets` tampoco intentaba localizar los clasificados como ilustrativos/decorativos aunque fueran utilizados. | Corregida esa contradicción reproducible: las referencias de actividad prevalecen. Las imágenes informativas sin actividad ya se conservaban. No se ha demostrado que esta sea la causa de las fotos del caso real. No se recupera una foto ausente del análisis ni se aceptan recortes no verificados. |
| No hay imágenes OpenAI | La disponibilidad se resuelve en servidor y depende de consentimiento persistido, flag, piloto, plan, configuración y cupos. La escena opcional perdía el motivo conocido detrás de `optional_support_unavailable`. | El plan visual conserva `illustrationsWithheld` y el motivo de la omisión opcional. No se atribuye una causa a una ejecución histórica sin sus artefactos. No se habilita ningún proveedor. |
| Color y perfil | En el fixture del repositorio: `contrast: normal`, `decoration: none`, apoyo visual alto y máximo de tres tareas por página. El azul marino y el petróleo ya están en `main`; el alto contraste usa negro intencionalmente. | No se fuerza color ni se cambia el perfil. Se conserva imagen referenciada aunque se reduzca decoración; pruebas de alto contraste y lectura en grises. El perfil efectivo de la ejecución real no está disponible. |
| Glosario separado | Un vocabulario colocado antes de su actividad no era reconocido como introducción al aplicar el máximo de tareas; sí lo era un ejemplo resuelto. | Viaja con la actividad cuando todas sus referencias corresponden a ella. No se mueve un vocabulario asociado a otra actividad. Prueba falla en `main`, pasa después. |
| Comprobación en hoja propia | El renderer solo mantenía juntas parejas finales de actividades, no actividad y comprobación corta. | Pareja final actividad/lista mantenida junta si la estimación combinada no supera media página útil. No se reduce espacio manuscrito. Prueba PDF falla antes. |
| Esquema pequeño o recortado | Una imagen física alta tenía ancho fijado y `max-height`: Chromium deformaba su relación de aspecto. Con una imagen 400×1200, la caja resultaba aproximadamente 0,64 en vez de 0,33. | Escalado proporcional de ambas dimensiones y `object-fit: contain`. Cuatro marcas extremas conservadas en PDF. No restaura un recorte que ya llegue incompleto, ni garantiza legibilidad de cualquier etiqueta diminuta. El esquema determinista del fixture está completo antes y después. |
| Cuadrícula desproporcionada | En 4a, «Escribe la operación.» se contaba como otro cálculo, además de determinar el descenso. | Solo al dimensionar, esa frase final explícita no añade una operación. Cuadrícula pasa de 9 a 5 filas (casilla de 7 mm, 63→35 mm de alto). Se conservan consigna, datos, mínimos del original y ajustes motores existentes. |
| Apoyos dominantes o redundantes | `main` ya elimina copias textuales verificadas de contexto (pruebas del bloque 2). Las ayudas del fixture incluyen glosario, ejemplos y comprobaciones funcionalmente distintos. | No se eliminan por longitud o por parecer similares. Riesgos semánticos identificados abajo; no se promete una reparación pedagógica automática con reglas de maquetación. |

Versiones: `material_renderer@v9`, `answer_space@v3`, `auto_visuals@v8`. Se mantiene compatibilidad con las evidencias anteriores y se admite la nueva versión del localizador en el validador persistido. No cambian umbrales de aceptación, SHA, permisos, cuotas, prompts ni contratos curriculares.

## Evidencia visual antes / después

Los archivos «antes» proceden de `ae1ba94` en un worktree aislado, ejecutando exactamente el mismo fixture de prueba. Los «después» proceden de esta rama. Huellas de los PDF y capturas en [SHA256SUMS](SHA256SUMS). Cada PNG reúne **todas** las páginas; los PDF permiten comprobarlas a tamaño real. Revisadas todas las páginas de estos casos, incluyendo contraste alto y conversión visual a grises.

| Caso | Antes | Después | Observación |
| --- | --- | --- | --- |
| Estanque, transcripción del repositorio | [PDF](antes/estanque-fixture.pdf) · [páginas](antes/estanque-fixture.png) | [PDF](despues/estanque-fixture.pdf) · [páginas](despues/estanque-fixture.png) | **5→5 páginas**, no 7→5. Mejora la proporción de 4a; mismos textos y esquema. |
| Cierre sintético | [PDF](antes/cierre.pdf) · [páginas](antes/cierre.png) | [PDF](despues/cierre.pdf) · [páginas](despues/cierre.png) | 2→2 páginas; la última deja de ser solo una comprobación. |
| Figura alta sintética | [PDF](antes/figura.pdf) · [página](antes/figura.png) | [PDF](despues/figura.pdf) · [página](despues/figura.png) | 1→1 página; proporción correcta y cuatro extremos presentes. |
| Vocabulario sintético | [PDF](antes/vocabulario.pdf) · [páginas](antes/vocabulario.png) | [PDF](despues/vocabulario.pdf) · [páginas](despues/vocabulario.png) | 2→2 por límite explícito de una actividad; vocabulario ahora en su hoja. |
| Alto contraste | — | [PDF](despues/estanque-alto-contraste.pdf) · [páginas](despues/estanque-alto-contraste.png) | 5 páginas; tablas, flechas y líneas legibles sin depender del color. |
| Simulación visual en grises | — | [páginas](despues/estanque-grises.png) | Conversión de las capturas, no prueba de una impresora física. |

Queda blanco amplio en la página 2 del estanque. Se conserva el límite de tareas y la frontera lógica del original: la página siguiente contiene «a partir de la lectura de la página anterior». Comprimir sin revisar esa referencia podría introducir otra incoherencia. No se declara cumplido el criterio de eliminar todas las páginas poco ocupadas.

## Informe pedagógico breve

- **Mejora demostrada:** proximidad entre actividad/apoyo y actividad/revisión; figura sin distorsión; cálculo simple con superficie proporcionada. Las representaciones, datos y enunciados no cambian. No se implementa adaptación curricular.
- **Riesgo alto pendiente:** en 3a se pregunta qué indican las flechas; el glosario define la relación alimentaria. Puede sustituir el razonamiento evaluado aunque no copie una respuesta literal. Ya estaba señalado en [bloque 2](../bloque2-estanque/README.md); no se da por resuelto.
- **Revisión docente necesaria:** el ejemplo de 4a explicita la resta con otros datos. Es válido como enseñanza guiada solo si elegir la operación no es parte de lo evaluado; si lo es, anticipa el procedimiento. La coincidencia o diferencia numérica no resuelve esa cuestión.
- **Necesidades preservadas:** comprobaciones de planificación y lectura pueden ser útiles; no se suprimen indiscriminadamente para reducir páginas. No se certifica que su intensidad sea óptima para un alumno real.
- **No verificable:** fidelidad de las fotografías, ausencia de recorte en el esquema real, adecuación al perfil de la ejecución y motivo efectivo de no llamar a OpenAI. Requieren los dos PDF y los artefactos privados autorizados de esa adaptación.

## Recorrido de los modelos y diagnóstico verificable

Se reutiliza el recorrido existente: análisis y plan → documento estructurado con referencias → resolución visual → revisión → recursos privados fijados por SHA → CLARO → Chromium. Para originales se intenta localizar y reutilizar; las reconstrucciones exactas utilizan datos corroborados. La ilustración solo entra por la política existente, con finalidad, actividad, objetivo, apoyos y revisión. Un original válido no se reemplaza por una imagen nueva. Un visual imprescindible no resuelto mantiene la parada; uno opcional rechazado se omite.

`illustrate/service.ts` conserva brief → validación → reserva → imagen → revisión → persistencia, hasta dos intentos por recurso, techo de tres ilustraciones por adaptación y presupuesto existente. No se añaden llamadas o reintentos. El localizador puede buscar una imagen antes excluida si existe una referencia explícita: conserva las mismas comprobaciones y límites, sin prometer coste cero en producción.

Para una adaptación concreta, inspeccionar **con autorización y sin copiar contenido privado a Git**:

1. `adaptations.context_snapshot`: `presentation` y `visual_supports.requested`, fijados al crearla; no deducirlos del perfil actual.
2. Último `adaptation_artifacts` de tipo `visual_resolution`: `payload.plan.illustrationsWithheld`, `needs[].attempts` y `needs[].resolution`. Sin artefacto no hay evidencia de que la etapa llegara a ejecutarse. Las ejecuciones antiguas pueden no tener el campo nuevo.
3. Motivos: `disabled` agrupa consentimiento/flag/aislamiento; **no identifica cuál de esos tres**. `not_offered` indica ausencia de oferta consultada; `plan`, falta de derecho efectivo; `service`, indisponibilidad de configuración o servicio; `quota`, agotamiento informado por el contrato. No inferir indisponibilidad histórica del estado actual de variables.
4. Un intento de ilustración puede terminar en `brief_rejected`, `quota_exhausted`, presupuesto o rechazo de revisión sin producir una imagen entregable. Consultar el código exacto del resultado y los registros `ai_runs` de esa adaptación (`image_brief`, `image`, `image_review`). `attempts: illustrate` no prueba por sí solo una llamada de imagen facturada.
5. La ausencia de `illustrationsWithheld` no garantiza generación ni disponibilidad: puede ser un artefacto antiguo, un original reutilizado o un recorrido que no pidió ilustración. No iniciar una nueva adaptación para «diagnosticar» por gasto.

Estos diagnósticos están en los artefactos autorizados existentes; no se ha añadido una pantalla pública ni expuesto texto, credenciales o rutas de Storage.

## Verificación reproducible

```bash
pnpm test
pnpm exec vitest run --config vitest.pdf.config.mts
pnpm typecheck
pnpm lint
pnpm build
pnpm check:privacy
```

Para reproducir solo las correcciones: `pnpm exec vitest run tests/unit/visual-quality.test.ts tests/unit/render-worked-example.test.ts tests/db/automatic-visuals.test.ts` y `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/visual-quality.test.ts tests/pdf/pond-layout.test.ts`.

Resultados de esta sesión:

- Unidad/BD completas: 2.515 correctas inicialmente y dos fallos por expectativas literales `material_renderer@v8`. Actualizadas a v9, repetidas las 37 pruebas de los dos archivos afectados: todas correctas. Resultado conjunto: **2.517 pruebas correctas; 18 omitidas y 1 pendiente**, sin repetir la suite completa. Última comprobación focalizada adicional: 13 correctas.
- Integración visual PGlite: 16 correctas. Detectó durante el desarrollo que faltaba admitir `auto_visuals@v8` en las evidencias; corregido, conservando la validación cerrada.
- Suite PDF completa: **98 correctas**. Añadidas después dos comprobaciones más (vocabulario y alto contraste); último archivo focalizado de 4 pruebas correcto. **100 casos PDF distintos comprobados**, no una segunda ejecución completa.
- Contraprueba aislada en `main`: mismo archivo de cuatro casos PDF, **3 fallan antes** (cierre, proporciones, vocabulario); contraste pasa. Las 16 pruebas previas del estanque pasan también en `main`.
- Typecheck correcto. Lint: 0 errores, 1 aviso preexistente (`tests/unit/analysis-run-auth.test.ts`, `_id`).
- **Build bloqueado**: `next/font` no puede descargar Inter/Outfit de `fonts.googleapis.com`. No se cambian fuentes, producto ni configuración para ocultarlo. `pnpm check` no se considera superado.
- Control de privacidad correcto. Control de secretos sin incidencias; no había secretos cargados para comparación por valor (no equivale a un escaneo completo de credenciales).
- Sin E2E, IA de pago, SQL remoto, migraciones, merges ni despliegues. La rama desactiva su despliegue automático en `vercel.json`.

## Decisión y siguiente paso

Cambios acotados preparados para revisión; **no dar por cerrada la calidad pedagógica real ni recomendar integración final** hasta resolver el build en un entorno con acceso a las fuentes y revisar original/adaptación defectuosa. La corrección semántica del apoyo de 3a y la elección de procedimiento de 4a requieren un caso de evaluación explícito, no eliminar contenido desde CSS. La API de GitHub devuelve `Forbidden` desde este entorno; la publicación de PR se registra en el cierre de la entrega sin inventar un número.
