# Apoyos visuales contextualizadores en ciencias y resultado explícito

Base `32c6ff2` (#73 integrada), rama `codex/apoyos-visuales-ciencias`. Sin servicios remotos, generación pagada, migraciones ni despliegue de producción.

## Qué muestra el caso recibido

El PDF aportado por el fundador tiene tres páginas A4, creado por Chromium el 26 de octubre de 2026 a las 12:07:39 UTC. `pdfimages -list` identifica el mismo objeto de imagen en las páginas 1 y 3 (577×341); no hay una segunda imagen distinta. El texto incluye glosario, pasos, tabla y organizador de explicación. El fundador informa de consumo cero en OpenAI. No hay evidencia de una ilustración adicional generada. No se publica el PDF recibido ni sus capturas en Git.

Esto **no permite comprobar por sí solo** las variables de Vercel, los intentos de brief/revisión, el consentimiento almacenado o los motivos concretos de rechazo. No se han consultado `ai_runs`, servicios remotos ni logs de producción.

**Despliegue identificado mediante GitHub:** el registro de deployments confirma que `adaptaula-omd0vlvir-kuoias-projects.vercel.app`, visible en las capturas anteriores, es el despliegue Production de `1a72c1c` (#72), del 26/10 a las 11:01:57 UTC. Production de #73 (`32c6ff2`, 12:05:35 UTC) figura como `adaptaula-cy25dl9vg-kuoias-projects.vercel.app`. Se consultaron solo metadatos de GitHub (`deployments` y `statuses`); no la configuración ni el runtime de Vercel. Usar el dominio público estable `https://adaptaula-nine.vercel.app/` para las pruebas posteriores. El PDF por sí solo no acredita qué despliegue lo generó. Una URL de despliegue antigua no recibe los cambios de un merge posterior.

Sí se demuestra una limitación de selección en el código de #72: la única escena adicional se buscaba para `problem_solving` y una lista pequeña de necesidades. Una pregunta abierta de ciencias con vocabulario explicado quedaba fuera aunque estuvieran el consentimiento, el plan y la configuración. La nueva regresión falla antes del cambio con cero llamadas al servicio de ilustración.

## Corrección

- Se permite evaluar también `open_question`, `short_answer`, `reading_comprehension` y `experiment`, para necesidades visuales/de comprensión/vocabulario implementadas realmente. Una etiqueta de asignatura por sí sola no habilita ni garantiza imágenes.
- Se mantiene como máximo **una escena adicional** y el límite/presupuesto total previo de ilustraciones. Sin consentimiento no se intenta; tampoco si una figura imprescindible ya ha quedado sin resolver.
- Una actividad con una imagen asociada por trazabilidad **o por vínculo de recurso** no recibe un duplicado. Las actividades de asociación, cálculo, clasificación y verdadero/falso no entran en este añadido contextual.
- El propósito exige ayuda a la comprensión, sin nombrar o representar la respuesta ni cantidades/resultados, y rechazar decoración. Se reutilizan brief, generación y revisión existentes. Un rechazo opcional se omite; los imprescindibles siguen bloqueando.
- Las figuras evaluadas, sus letras y sus relaciones no se sustituyen por otra ilustración libre. «Mejorar el dibujo A–D» no está implementado por este cambio: necesitaría preservar y verificar su correspondencia, no basta un modelo de imagen.
- Al entregar, el estado privado muestra el resultado de la versión actual guardada: ilustraciones IA, imágenes originales y figuras deterministas. Una misma imagen repetida se cuenta una vez. Cero ilustraciones se comunica explícitamente, sin afirmar que no hubiera llamadas rechazadas o gasto. No se cuentan solicitudes del plan como imágenes creadas.

La selección sigue siendo una heurística; la revisión de IA no es una garantía de utilidad pedagógica. El docente conserva la revisión final. Un perfil de «Acceso visual: letra ampliada y contraste» está orientado a legibilidad y alternativas, y no es equivalente a pedir ilustraciones adicionales.

## Pruebas y evidencia

- Unidad: pregunta científica/vocabulario, rechazo opcional, consentimiento, necesidad pertinente, actividades no compatibles y figuras ya vinculadas. Contador de resultados con recursos únicos y formato inválido, UI explícita cuando el resultado es cero.
- PGlite: estado sin resultado durante preparación y resumen derivado del documento guardado tras entrega, con permisos existentes.
- PDF de integración de la política: pregunta abierta sobre luz y plantas → servicio de ilustración programado → activo aprobado de prueba → mismo CLARO → PDF con el recurso junto al ejercicio. El dibujo es manual y sintético; **no es una imagen de OpenAI**.
- E2E escritorio/móvil: resultado con una ilustración aprobada sintética y otra revisión sin ilustraciones, acceso privado y PDF. No se sobrescribe la versión anterior del fixture.

Resultados: unidad/BD completa 2.005 correctas y 13 omitidas; focalizadas de UI/selección 33/33; PDF existentes focalizadas 11/11 más caso científico 1/1; `smoke:pdf` completo 78/78 y descarga por ruta real desde su traza local correctas; `smoke:raster` y comprobación de secretos correctos. E2E focalizadas 8/8. Typecheck/lint/build correctos (aviso previo `_id`). E2E completa **134 correctas, 4 omitidas, 16,6 min**, sin reintentos: omisiones de Checkout Max y del ensayo configurado opt-in, que exigen otro servidor/configuración. No se afirman aprobadas esas cuatro.

Evidencia sintética de UI: [resultado escritorio](capturas/resultado-escritorio.png), [cero escritorio](capturas/cero-escritorio.png), [resultado móvil](capturas/resultado-movil.png), [cero móvil](capturas/cero-movil.png). [PDF del recurso científico simulado](pdf/pregunta-abierta-con-apoyo-simulado.pdf), [captura del PDF](capturas/pdf-simulado.png). Son datos de prueba y un dibujo manual; no corresponden a un resultado de OpenAI ni al documento del usuario. [PR #74](https://github.com/TinyChat-up/ADAPTAULA/pull/74), sin merge.

Se usan binarios instalados por el fallo del lanzador pnpm: Vitest, Next, TypeScript, ESLint y Playwright. E2E exclusivamente contra el Supabase ficticio en memoria, `next dev`, `AI_MODEL_STANDARD=mock:default`, `E2E_BASE_URL=http://localhost:3100` y Chromium local. No se rebajan validaciones ni se usan credenciales reales.

## Límites y prueba posterior

No se modifica retroactivamente la ficha recibida. No se ha comprobado generación real, disponibilidad del modelo ni tarifas. Un rechazo del brief/revisión, falta de cuota, bandera o credenciales puede seguir dando cero ilustraciones; ahora ese resultado será visible. El resumen no es una factura ni una cuenta de llamadas.

Después de revisar e integrar, el fundador puede realizar un ensayo manual autorizado con un material sintético y una necesidad funcional apropiada. Comprobar finalidad, ausencia de respuestas, procedencia, legibilidad en grises y resultado explícito antes de imprimir. Si el recurso no aporta ayuda, rechazarlo; no forzar una imagen para completar el cupo. Una prueba real consume API aunque Stripe esté en TEST.
