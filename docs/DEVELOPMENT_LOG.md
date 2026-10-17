# Registro de desarrollo

PR de esta entrega: [#44](https://github.com/TinyChat-up/ADAPTAULA/pull/44), abierta y sin merge.

Registro compartido entre Codex y Claude Code. Añadir una entrada por bloque: base, rama/PR, cambios, verificaciones, límites y siguiente acción. Nunca incluir secretos, materiales privados o datos del alumnado.

## 2026-10-17 — Adaptaula 2.0, etapa 4B: experiencia pública y primera ficha

- Base verificada: PR #44 fusionada en `c925c33`; rama nueva desde main. Se reutilizan Auth, componentes visuales, datos de planes, CLARO como referencia visual y la subida existente.
- Landing y «Cómo funciona»: demostración sintética con alternancia original/adaptación/comparación/revisión, cinco pasos reales, avisos honestos. Onboarding reducido a una pantalla con capacidades actuales de `workspace_usage` y primera subida por defecto. Auth reorganizada conservando acciones y seguridad.
- Verificación: 8 E2E focalizados (escritorio/móvil), 32 unitarias, typecheck, lint de área modificada, build y escáner de secretos correctos; capturas reales en [QA 4B](qa/adaptaula-2-etapa-4b/README.md). Sin paid AI, Stripe, Supabase remoto, cambios de modelos/prompts, datos reales ni recolección.
- Siguiente: integrar manualmente esta PR tras revisar los resultados; comprobar correos de Auth y precios efectivos en staging.

## 2026-10-17 — Adaptaula 2.0, etapa 4A: política comercial y límites reales

- Base comprobada: #43 fusionada en `5867d30`; rama `codex/adaptaula-2-planes-cuotas` desde main. No incluye 4B.
- Migración 026 idempotente y seed: cuotas Free 1/2, Pro 15/30, Max 30/50, perfiles 2/30/100 y páginas 5/15/25; precios 0/24,90/49,90 €/mes IVA incluido. Catálogo nuevo sin imágenes ni precios Stripe. Filas anteriores con referencias o IDs de Stripe preservadas y retiradas del catálogo; suscripciones y consumo intactos.
- `/precios` dinámica con tres planes, sin contratación ni importes anuales; cuenta con avisos de cuota real y renovación. Reflow de precios/cabecera corregido tras detectar desbordamiento al 200 %.
- Verificación: 134 pruebas focalizadas unitarias/PGlite y 14 E2E distintos superados; typecheck/build correctos; lint sin errores (un aviso preexistente); escáner de secretos correcto. Capturas reales de escritorio/móvil y limitaciones en [QA 4A](qa/adaptaula-2-etapa-4a/README.md).
- No se inspeccionaron clientes reales ni se aplicaron migraciones remotas. No APIs pagadas, Stripe, cambios de modelos/prompts ni validación pedagógica real. Las condiciones comerciales anteriores requieren revisión antes del despliegue autorizado.
- Siguiente: revisar e integrar 4A manualmente; después implementar 4B sobre main. No merge automático.

## 2026-10-17 — Adaptaula 2.0, etapa 3B: perfiles y Plan y cuenta

- **Base:** `origin/main` / `9f064ef`, #41 y #42 confirmadas MERGED por GitHub. Rama nueva `codex/adaptaula-2-perfiles-cuenta`. Entorno existente reutilizado con la skill de setup; ninguna dependencia nueva. Instrucciones, continuidad, arquitectura, UX, seguridad y guía local Next de formularios leídas.
- **Implementado:** directorio con búsqueda local por alias/filtro real de curso, capacidad del plan, áreas/intensidades progresivas y resumen existente. Conserva CRUD, duplicación y dimensiones. Lector sin controles de escritura; límite impide ofrecer duplicación. Cuenta con análisis/adaptaciones/perfiles separados, disponibles y periodo, edición validada de nombre propio y feedback, contraseña y cierre de sesión existentes.
- **Seguridad:** nombre mediante sesión, Zod, `profiles.full_name`, RLS y grants actuales. No acepta otro ID ni columnas del navegador, no usa admin y confirma fila antes del éxito. Perfil inexistente/inválido se rechaza antes de consultar adaptaciones. No cambia cuotas, precios, pipeline, modelos/prompts, CLARO, comparador, borradores, originales, RLS, Stripe ni Supabase remoto. Sin migraciones ni llamadas pagadas.
- **Defectos comprobados:** UUID inválido llegaba a la consulta del historial y daba error en vez de 404; corregido el orden de carga. Área de apoyos desbordaba con texto al 200 %: grid y texto acotados. Enlace inicial a `/forgot-password` redirigía por sesión activa: se usa `/reset-password`, que autentica y conserva Auth existente. Corregidas carreras del arnés al capturar URL/cerrar sesión y aserción del resumen que buscaba un nombre de preset inexistente.
- **Pruebas:** 82/82 focalizadas (seis archivos, PGlite), 26 escenarios E2E distintos aprobados (16 perfiles existentes + 10 perfiles/cuenta/workspace/editor actuales). Typecheck, lint completo y build PASS; único aviso lint previo `_id`. Escaneo de secretos PASS. Capturas reales en escritorio/móvil inspeccionadas; axe, teclado, colores forzados, movimiento reducido y 320 px/texto 200 %. Editor descarga PDF real de un documento sintético y conserva original/generada. No validación pedagógica de Hacer magia real ni suite completa.
- **Excepción de ensayo:** se interrumpió un intento del spec histórico `teacher-workflow` al esperar el encabezado antiguo «Actividades detectadas». No se cuenta como aprobado ni se cambia producto para satisfacerlo. Se completaron los recorridos vigentes `document-workspace` y `sheet-editor`; actualizar el spec histórico queda pendiente.
- **Evidencia:** [QA y seis capturas](qa/adaptaula-2-etapa-3b/README.md). Fixtures y cuentas sintéticas, PGlite/Supabase simulado local, STANDARD/PREMIUM mock, imágenes desactivadas. Sin credenciales nuevas ni servicios externos.
- **Límites:** búsqueda sobre perfiles cargados, sin paginación nueva ni versiones/autoguardado de perfiles. Nombre de app en `profiles`, sin sincronizar metadatos Auth. Entrega de correo y Auth/Vercel remoto no comprobados. Misma selección de seis materiales recientes desde un perfil; no se amplía su contrato.
- **Publicación:** [PR #43](https://github.com/TinyChat-up/ADAPTAULA/pull/43), abierta sin merge. Implementación `ed2616f`, documentación/capturas `7faf9dd`.
- **Siguiente:** revisar esta entrega 3B; después etapa 4 (pantallas públicas y política comercial) mediante migración y pruebas propias, manteniendo los precios/cuotas actuales hasta entonces.

## 2026-10-16 — Adaptaula 2.0, etapa 3A: mesa, biblioteca e historial

- **Base:** PR #41 MERGED comprobada en GitHub (`740e2db`), rama `codex/adaptaula-2-mesa-biblioteca-historial` desde main limpio. Leídos AGENTS/CLAUDE, estado, roadmap, producto, arquitectura y UX. #41 y otras PR no modificadas.
- **Implementación:** mesa reordenada por atención, nuevo material, trabajo, preparado y reciente, con uso real discreto. Biblioteca con búsqueda SQL por título, curso, filtros existentes y orden; controles secundarios en desplegable nativo, sin desbordamiento a 320 px/texto 200 %. Historial muestra origen, fechas, versión generada y accesos a comparar/editar/descargar según estado y rol. La ficha de material conserva su propia lista de adaptaciones. Fallo de consulta de adaptaciones ya no equivale a vacío.
- **Integridad:** materiales aún en subida excluidos siempre, incluso con URL manipulada; consultas scoped al workspace y RLS existente. Sin backend de adaptación nuevo, pipeline, CLARO, borradores, cuotas, RLS, migraciones, Stripe ni APIs de pago. Políticas Free/Pro/Max objetivo siguen para etapa 4; 3B queda pendiente.
- **Defectos reproducidos:** campos selectores y botones desbordaban en lectura ampliada; un enlace a una ancla de adaptaciones inexistente se retiró; título y acciones del historial se comprimían en una sola línea. El primer control nativo de filtros se cerraba durante la elección del curso por controlar React su estado `open`; se dejó bajo control nativo. Un ensayo de análisis simulado agotó una espera, luego el mismo escenario pasó sin cambios de pipeline.
- **Verificación:** 92 pruebas focalizadas/PGlite + 2 pruebas de acciones del historial, seis E2E escritorio/móvil distintos y dos repeticiones focalizadas de biblioteca tras ajustar el desplegable. Typecheck, lint, build y escaneo de secretos PASS; aviso previo `_id` de lint. Capturas inspeccionadas, axe, teclado/foco, colores forzados, reduced motion y 320 px/texto 200 %. Ver [QA y seis capturas](qa/adaptaula-2-etapa-3a/README.md). Los documentos y cuentas son sintéticos y la adaptación preparada, determinista; no validan modelos reales.
- **Publicación:** [PR #42](https://github.com/TinyChat-up/ADAPTAULA/pull/42), abierta y sin merge. Implementación `7248afe`, QA `323be71`.
- **Límites/siguiente:** biblioteca limitada a 200 resultados, historial a 100 recientes y ambos lo dicen. Falta paginación completa y explorador de todas las revisiones. Revisar 3A antes de 3B (perfiles y Plan y cuenta); etapa 4 comercial solo después. Sin merge automático.

## 2026-10-16 — Adaptaula 2.0, etapa 2B: comparación y edición contextual

- **Base:** `origin/main` / `330cb4f`, #40 MERGED confirmada. Rama nueva `codex/adaptaula-2-comparacion-editor`; no se modifica otra PR ni se hace merge. Continuidad, arquitectura, UX, QA anterior e instrucciones leídas; entorno existente reutilizado con la skill de setup, sin dependencias nuevas.
- **Implementado:** ruta privada `/comparar`, original y CLARO en paralelo/alternancia móvil, zoom/páginas independientes, generada frente a último borrador guardado y descarga de versión explícita. Editor existente dentro del workspace 2A, selección contextual por papel/teclado/selector, panel plegable, presentación global progresiva, acciones y feedback junto a los ajustes. Conserva guardado, recuperación, aviso pedagógico, deshacer/rehacer y PDF real.
- **Integridad:** misma proyección/renderer y CSS académico; props opcionales solo para navegación/selección en pantalla. Asociación de actividad verificada contra la proyección antes de habilitarla. No serializa claves/notas ni rutas privadas; borrador inválido no se presenta como descargable. Original y generada sin cambios. No schema, RLS, cuotas, precios, modelos/prompts, Stripe ni Supabase remoto.
- **Defectos reproducidos y corregidos:** recargar tras conflicto mediante Link a la misma URL retenía el estado local (prueba del botón real falló antes del arreglo); ahora recarga completa con confirmación nativa. Selector/alternancia desbordaban a 320 px/texto 200 %; contenedores acotados y controles con reflujo. Se verifican las dos vistas ampliadas.
- **Pruebas:** 144/144 focalizadas (11 archivos, incluye integración PGlite), 9/9 PDF focalizado; smoke PDF posterior incluye 39/39 pruebas (no sumar las 9 de nuevo), traza y petición real local. 12/12 E2E distintos (escritorio/móvil: comparación, permisos, conflicto, editor y workspace previos); recorrido principal repetido 2/2 tras último ajuste visual y ampliación de comprobación de texto. Typecheck, lint completo, build, smoke raster/PDF y escaneo de secretos PASS. No suite general de aplicación. Capturas reales inspeccionadas; axe, teclado/foco, reduced motion, colores forzados y reflujo. No certificación WCAG ni validación Vercel.
- **Evidencia:** [QA, ocho capturas y comandos](qa/adaptaula-2-etapa-2b/README.md). PDF propio de dos páginas, cuentas ficticias y proveedor simulado; documento generado sembrado como fixture determinista. La exportación es real; Hacer magia con modelos reales sigue sin validarse. Sin llamadas pagadas.
- **Límites:** páginas lógicas de CLARO pueden diferir de saltos físicos del PDF; último borrador de la base actual, sin historial visual completo/autosave; figuras/tablas/opciones/estructura protegidas. No se promete validación pedagógica del contenido escrito por un docente.
- **Publicación:** [PR #41](https://github.com/TinyChat-up/ADAPTAULA/pull/41), abierta y sin merge. Código `93a5e68`, QA `447a494`; preview Vercel pendiente al publicar.
- **Siguiente:** revisión de la PR 2B y, tras integración explícita, etapa 3 (mesa docente, biblioteca, perfiles, historial y cuenta). Mantener APIs pagadas y experimentos pospuestos.

## 2026-10-16 — Adaptaula 2.0, etapa 2A: workspace documental

- **Base:** `origin/main` / `a6474a7`; #39 MERGED verificada por API y Git. Rama nueva `codex/adaptaula-2-workspace`; #20 no se modifica. Leídos AGENTS/CLAUDE, continuidad, arquitectura, UX, seguridad y guías locales de Next. Reutiliza los fundamentos de etapa 1 y sus referencias de diseño, sin código externo ni dependencias nuevas.
- **Implementado:** `components/workspace/` compone original/panel sobre las rutas existentes. Visor privado de una página, zoom relativo al ancho, ajuste, navegación y recuperación ante error. Papel sólido y visible al recorrer el panel en escritorio; panel ocultable sin desmontar formularios/polling y acceso con foco al siguiente paso. Subida por arrastre/explorador, nombre/peso, cambio/quitar, validación y estados de red reales. Resumen determinista de apoyos del perfil; detalles secundarios progresivos. Retirado el visor antiguo, sin renderer paralelo.
- **Seguridad y estados:** los Server Components pasan solo cuatro metadatos del archivo al visor, nunca la fila completa. La cuenta de lectura observa el análisis sin despachar trabajos ni mostrar acciones de escritura. Se conserva autorización de servidor; ninguna modificación de RLS. Estado en cola sin animación de procesamiento ficticia.
- **Verificación:** 146/146 focalizadas (nueve archivos; componentes, importaciones, editor, materiales/cuotas/borradores PGlite), 9/9 PDF Chromium, 40/40 escenarios E2E distintos en lotes sobre escritorio/móvil. Componentes y recorridos afectados repetidos tras ajustes; no sumados de nuevo al total. Typecheck, lint y build PASS; un aviso previo `_id` en lint. Smoke raster/PDF PASS sobre artefacto local. Axe, teclado, foco, 320 px/texto 200 %, error/reintento del visor, permisos 404/401, rol lector, integridad SHA del original, editor guarda/recupera/deshace/rehace/descarga PDF.
- **Defectos reproducidos y resueltos durante la entrega:** carga del raster anterior a hidratación mantenía el estado «Cargando»; aviso largo desbordaba en 320 px/texto 200 %; serialización de `storage_path` en props no visibles (regresión E2E antes/después). Dos carreras del arnés se corrigen esperando redirect y consumo de reanálisis; fixture de documento listo sustituida por un MaterialDocument sintético válido. No se relajan cuotas, guardas o comprobaciones de PDF.
- **Evidencia:** [capturas reales, comandos, alcance y límites](qa/adaptaula-2-etapa-2a/README.md). Diez capturas con PDF propio de dos páginas, cuentas ficticias y proveedor simulado. El análisis fijo del doble no describe fielmente el PDF: no es validación pedagógica del generador ni revisión docente. El bloqueo visual simulado se conserva y no entrega PDF; la descarga se comprueba mediante el editor con documento determinista válido.
- **Límites:** raster existente a 110 ppp, sin OCR/capa de texto nueva ni medición de documentos grandes en Vercel. Zoom relativo al contenedor, no escala física. Editor, vista de adaptación y PDF siguen en sus rutas; el comparador y herramientas contextuales nuevas son **2B pendiente**. No prompts/modelos, pipeline, CLARO interno, cuotas/planes, Stripe, migraciones, Supabase remoto, APIs pagadas ni recopilación de correcciones.
- **Publicación:** [PR #40](https://github.com/TinyChat-up/ADAPTAULA/pull/40) abierta desde la rama indicada. Implementación/pruebas `7488ab9`, documentación/capturas `3c33eed`. Sin merge.
- **Siguiente:** revisar e integrar 2A antes de iniciar 2B sobre main actualizado. Reutilizar estos slots y el editor CLARO de #38; no implementar un segundo editor.

## 2026-10-15 — Adaptaula 2.0, etapa 1: fundamentos y navegación

- **Base:** `origin/main` / `7e5ef52`, PR #38 integrada y confirmada también por API. Rama nueva `codex/adaptaula-2-fundamentos`. #20 era la única PR abierta antes de esta entrega; no se modifica. Lectura de AGENTS/CLAUDE, estado, roadmap, producto, UX, arquitectura y guías locales Next 16.3.
- **Implementado:** tokens semánticos y superficies propias, componentes base renovados, lateral plegable con texto y preferencia SSR, ubicación por sección, navegación móvil flotante, diálogo accesible y cierre al pasar a escritorio. `ActionBar` en el editor CLARO existente, sin cambios de datos/renderer. Foco, contraste, reduced-motion/reduced-transparency, forced-colors, alto contraste y reflujo. Sin dependencia nueva.
- **Referencias:** navegador Chromium sobre Bencho y Apple. Red bloqueada inicialmente; tras guardar dominios preservando la configuración existente y aplicarse el acceso, las páginas se pudieron estudiar. `/blocks` de Bencho devuelve 404; catálogo en `/`, ejemplos concretos disponibles. Principios y decisiones en QA, ningún código/asset externo importado. API de GitHub también recuperada.
- **Pruebas:** 129/129 focalizadas (17 nuevas de componentes, contexto y contraste), 9/9 PDF Chromium, 8/8 E2E escritorio/móvil. Typecheck, lint y build PASS; solo aviso previo `_id`. Axe en recorridos existentes y preferencias, 320 px/texto 200 %, foco móvil no tapado, editor guarda/recupera/exporta y conserva original. Modelos simulados/fixtures sintéticos; ninguna validación pedagógica de Hacer magia real.
- **Correcciones de verificación:** resumen lateral visible al plegar por cascada CSS, corregido. Nombre accesible de Perfiles conservado en texto sr-only para no coincidir con selector amplio de campo de pruebas. Indicador local Next interceptaba el clic inferior de un test: botón verificado por teclado, indicador oculto solo en capturas. Tipos temporales generados por Next y caché aislada retirados antes del check final; dos llamadas React.createElement del test corregidas para lint. No se debilitan aserciones de permisos, cuotas o PDF.
- **Evidencias:** [QA, capturas y comandos](qa/adaptaula-2-etapa-1/README.md). Dirección integral en [ADAPTAULA_2.md](ADAPTAULA_2.md); ADR-030. Se actualizan producto, UX, roadmap y estado con alcance implementado/pending separado.
- **Límites:** modo claro; contexto del shell es de sección, no título/estado inventado de un job. Workspace completo, comparación, reorganización específica de pantallas y precios/cuotas nuevos quedan para etapas posteriores. Sin migraciones, prompts/modelos, consumo de APIs pagadas, Stripe, Supabase remoto, entrenamiento ni cambios de CSS/renderer de CLARO.
- **Publicación:** [PR #39](https://github.com/TinyChat-up/ADAPTAULA/pull/39) abierta desde `codex/adaptaula-2-fundamentos`. Commits de implementación `40d4e21` y `c7338d6`, evidencia `464f169`; sin merge.
- **Siguiente:** revisión humana de esta primera PR; etapa 2 desde main actualizado tras integración, concentrada en documento y herramientas contextuales. Sin merge automático.

## 2026-10-15 — Editor docente mínimo operativo

- **Base y rama:** `origin/main` / `b192735`, nueva `codex/editor-docente-claro`. El remoto ya incluía el merge de #37 al iniciar; no se modificó ni fusionó esa PR. Leídos AGENTS/CLAUDE, estado, roadmap, arquitectura, adaptación, UX y seguridad.
- **Reutilizado:** MaterialDocument, roles/workspace, loader de recursos privados, CLARO, exportación Chromium y guardas del PDF. Existían versiones/vista/PDF y edición del plan, pero no editor de la ficha entregada. `sheetModel` pasa a un módulo puro compartido/reexportado: sigue habiendo una única llamada de producción a `buildRenderModel`.
- **Implementado:** ruta `/app/adaptaciones/[id]/editar`, acceso desde vista, enunciados, cuatro ajustes de presentación, líneas/caja, vista A4 ajustable, undo/redo acotado, guardado/revisión, recuperación y PDF de esa revisión. Estado de cambios, errores conservando edición y rechazo de conflictos entre pestañas. La ficha generada y su PDF no cambian.
- **Persistencia:** migración 025, solo PGlite local: revisiones append-only separadas, base/autor/fecha/aviso, RLS de miembros, RPC autenticada con rol de escritura y bloqueo/versión optimista. Parches Zod cerrados, validados antes de guardar y de renderizar. Sin acceso admin nuevo ni cambios de cuota/AI runs.
- **Seguridad pedagógica:** todo enunciado cambiado requiere aviso/reconocimiento explícito de comprobación; nunca validado automáticamente. Sin edición de tablas, figuras, opciones, pasos, requisitos ni claves. La clave/notas se excluyen del cliente y del modelo de alumno. No se promete detectar errores/respuestas escritos manualmente. La numeración de CLARO permanece en una línea al ampliar texto.
- **Pruebas:** 94 focalizadas en ocho archivos; 9 PDF con Chromium real en dos archivos; 2 E2E desktop/mobile con guardado, recuperación, descarga y original intacto; controles sin incidencias graves/críticas de axe. Typecheck, lint y build PASS (aviso previo `_id` en lint). No suite completa ni validación pedagógica del generador real. Lint inicial incluyó la caché temporal de Next; retirada la salida generada, el comando normal pasó. Ajustes de tsconfig generados por Next retirados del diff.
- **Evidencia:** [alcance, comandos y capturas sintéticas](qa/editor-docente/README.md); PDFs y capturas adicionales en `/workspace/artifacts/editor-docente/`.
- **Límites:** sin autosave, historial navegable o publicación como versión canónica; páginas lógicas en pantalla y paginación física al exportar. Migración remota/despliegue pendientes. No APIs pagadas, Supabase remoto, Stripe, entrenamiento, prompts/modelos ni cambios de producción desplegada.
- **Publicación:** implementación `458d79e` publicada en `codex/editor-docente-claro`. La creación de PR devolvió `Forbidden` por GraphQL (`gh pr create`) y REST POST `/pulls`, incluso con ejecución de red autorizada. No hay número de PR confirmado ni merge. [Formulario de apertura](https://github.com/TinyChat-up/ADAPTAULA/pull/new/codex/editor-docente-claro); descripción preparada en `/workspace/artifacts/editor-docente/DESCRIPCION_PR.md`. Siguiente acción: abrir/revisar esta primera entrega y probar su uso con docentes antes de ampliar la edición.

## 2026-10-15 — Fase III: calidad pedagógica y referencias docentes (experimental)

- **Base y rama:** `origin/main` en `370a9d8`; la PR #36 está integrada. Rama nueva: `claude/fase-3-calidad-pedagogica`.
- **Material:**
  - 8 fichas originales y una guía docente enviadas por el usuario, extraídas en modo solo lectura **fuera de Git**, con sha-256
    registrados.
  - División fijada antes de leerlas en detalle: desarrollo 01, 02, 04, 06 y 08; reserva 03, 05 y 07.
  - La guía solo alimenta la clave de corrección.
  - Sin datos de alumnado.
- **Cambios** (`evals/pedagogical-quality/`):
  - `contract.ts`: referencia, original, adaptación, estado docente y resultado;
  - `evaluate.ts`: criterios A–E sobre `src/lib/adaptation/text.ts`;
  - `adapter.ts`: adaptador controlado, sin acceso a la clave;
  - `mutations.ts`: 16 tipos de error;
  - `figure-review.ts`: revisión humana de figuras ligada a material, página, región y recorte visto;
  - `cases.ts`, `fixtures.ts` (6 fichas propias), `metrics.ts` y `run.ts` (`pnpm eval:pedagogy`);
  - `tests/unit/pedagogical-quality.test.ts` y una prueba nueva en `tests/unit/boundaries.test.ts`.
- **Ajuste durante el desarrollo:**
  - El control de copia literal del plano fallaba porque la frase de una respuesta ya estaba impresa en otra pregunta.
  - Las frases impresas en el original pasan a ser datos, como los números.
  - Falsos bloqueos en desarrollo: 3/15 → 0/15.
- **Resultados** (referencias sintéticas provisionales; ninguna validada por un docente):
  - **Propias:** 37/37 errores verificables y 0/18 falsos bloqueos.
  - **Desarrollo:** 52/52, 0/15, fugas 12/12 y figuras 13/13.
  - **Reserva**, ejecutada una vez con la reserva congelada por sha-256: 28/29, 0/9, fugas 8/8 y figuras 7/7.
    - No detectado: tabla de gramática sin la petición de rasgos, porque la cabecera seguía impresa.
  - **Errores no verificables:** 0/14 detectados en total; todos llegan como pendientes para el docente.
- **Entregado al usuario fuera de Git:**
  - paquete de revisión `revision-docente-fase3.html`, con la referencia, la adaptación de referencia, la candidata puntuada y
    ejemplos incorrectos de cada ficha;
  - `ficha-evaluacion.csv`.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/pedagogical-quality.test.ts tests/unit/boundaries.test.ts tests/unit/figure-geometry-v2.test.ts tests/unit/adaptation-review.test.ts tests/unit/pedagogical-equivalence.test.ts`
    → **96/96 PASS**;
  - `pnpm typecheck` PASS;
  - `pnpm lint`: 0 errores (sigue el aviso previo `_id`);
  - `pnpm eval:pedagogy` sobre las propias, el desarrollo y la reserva.
  - No se ejecutaron suite completa, build, SQL, modelos de pago ni Stripe.
- **Riesgos:**
  - El mismo autor escribió referencias, adaptaciones, errores y reglas.
  - La reserva es pequeña.
  - Los patrones de fuga son manuales.
  - D y E siguen siendo humanos.
  - No se ha probado el generador real.
- **Siguiente acción:** registrar la revisión del docente (ROADMAP §12) y medir el generador contra las referencias revisadas.

## 2026-10-15 — Fase II: recuperación geométrica de figuras (prototipo)

- **Base y rama:** `origin/main` en `ae603e6`; la PR #35 está integrada. Rama nueva: `claude/fase-2-geometria-figuras`.
- **Corpus:** las diez fichas sintéticas externas, en copias y fuera de Git. Línea base Fase I reproducida: 1/10 candidatas y 0
  recortes.
- **Causas medidas en el marco enderezado:**
  - zonas a todo el ancho que colapsan con dos columnas (05);
  - etiquetas a más de 4 mm (01);
  - partes separadas (04);
  - firma de barra rota por una mota (02);
  - recta en la página sin enderezar (03);
  - sin evidencia para el reloj (08);
  - «Mirael» (10);
  - B sin leer por el OCR (09).
- **Cambios** (`evals/visual-location/geometry.ts`, `locate-v2.ts`, `geometry-cases.ts`, `geometry-eval.ts`):
  - localizador autónomo `figure_geometry@v2` (sin caja humana) con enderezado y coordenadas de vuelta al original;
  - zonas por columna y ancla tolerante de respaldo;
  - figura con sus partes y etiquetas, sin contar las letras de la consigna;
  - exclusión de reglas verticales y sombras de escáner;
  - recuadros vacíos solo si la consigna nombra un rectángulo;
  - firmas: barra (rechaza tablas y partes desiguales), recta (rechaza barras), esfera, polígono y cuadrícula.
- **Ajustes durante el desarrollo:**
  - métrica de etiquetas por centro de caja (la caja tipográfica es mayor que la tinta);
  - exigencia de todas las etiquetas para «correcta»;
  - restos OCR («|», «x=») no cuentan como texto corrido;
  - umbral de tinta central de la esfera (la prueba sintética lo detectó).
- **Resultados:**
  - **Corpus:** 9/10 correctas, 0 erróneas; 09 queda por OCR.
  - **Desarrollo geométrico:** 5/6 correctas, 5/5 negativas rechazadas.
  - **Reserva** (una vez, sin ajustar después): 2/6 correctas, 1 candidata en la negativa de respuesta dibujada, 4/5 negativas
    rechazadas.
  - **Recortes aprobados:** 0 en todas las ejecuciones.
  - **Rendimiento:** geometría 153 ms/página (mediana) en el corpus; pico RSS 509 MB.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/ocr-*.test.ts tests/unit/visual-location-*.test.ts tests/unit/figure-geometry-v2.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts`
    → **144/144 PASS**;
  - `pnpm typecheck` PASS;
  - `pnpm lint`: 0 errores (sigue el aviso previo `_id`);
  - `pnpm eval:geometry` sobre el corpus, el desarrollo y la reserva.
  - No se ejecutaron suite completa, build, SQL, modelos de pago ni Stripe.
- **Riesgos:**
  - Las diez fichas y el desarrollo geométrico sirvieron para ajustar.
  - La reserva es pequeña y sintética.
  - La geometría no detecta respuestas dibujadas, por lo que el bloqueo semántico es imprescindible.
  - El reconocimiento de formas depende de palabras de la consigna.
- **Siguiente acción:** fase de calidad pedagógica (ROADMAP §11).

## 2026-10-15 — Fase I: mejora real del reconocimiento de fichas (piloto OCR)

- **Base y rama:** `origin/main` en `153721a`; la PR #34 está integrada. Rama nueva: `claude/fase-1-reconocimiento-ocr`.
- **Corpus:**
  - ZIP de diez fichas sintéticas adjuntado por el usuario y extraído fuera del repositorio;
  - originales en solo lectura, evaluación sobre copias y SHA-256 de los 35 ficheros verificado al terminar.
  - **Línea base reproducida exactamente:** 36/44 etiquetas, 7 perdidas, 1 confundida y 7 espurias; WER 11,6 % y CER 3,8 %;
    16/20 consignas encontradas, 15 asociadas, 1 sin verificar; 1/10 candidatas.
- **Diagnóstico con evidencia:**
  - PSM 8 inventa «Los» o «Lol» a partir de una C;
  - los 3 y 9 del reloj tocan sus marcas;
  - rayos y marcas del reloj se leen como N, A, 1 o 7;
  - Tesseract separa las columnas en bloques, pero el piloto las reagrupaba por altura;
  - «¿Cuántos» (30) y «Observa el» (0) se descartaban por confianza;
  - «Mirael» se lee unido incluso al releer.
- **Cambios** (`recognition.ts` con 15 pruebas, escritas antes de cada regla y vistas fallar, salvo la de la regresión, añadida con su corrección; `engine.ts`; `metrics.ts` y `run.ts` usan líneas de
  Tesseract): un componente equivale a un carácter (respaldo PSM 10), caja por altura, O/0 por fila, separación de marcas, rechazo
  de trazos rectos, texturas repetidas, relectura de letras sueltas, glifo con borde y escalado suave, líneas de Tesseract con orden
  por filas y palabras de baja confianza con contexto.
- **Descartado:** releer líneas con PSM 7. No mejoraba (WER 9,5 frente a 9,4 %) y añadía 16 llamadas y un worker.
- **Regresión detectada y corregida:** una «E» con confianza de palabra 9 en el fixture histórico degradado `answer_leak`. Ahora se
  exige confianza de palabra.
- **Resultados:**
  - **Corpus:**
    - etiquetas 43/44, con precisión 100 % y 0 espurias;
    - consignas 19/20 encontradas y asociadas, 0 incorrectas y 0 sin verificar (tolerante 20/20);
    - WER 9,4 % y CER 2,6 %;
    - llamadas 82 → 59;
    - pico RSS 565 → 558 MB;
    - mediana 1.991 → 2.094 ms.
  - **Adversariales de desarrollo:** etiquetas 15/25 → 24/25.
  - **Reserva** (ejecutada una sola vez): etiquetas 17/24 → 22/24, espurias 7 → 1, WER 11,4 → 4,5 %.
  - **Fixtures históricos (55):** sin regresiones en etiquetas, anclas ni WER; CER 1,6 → 1,5 %.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/ocr-*.test.ts tests/unit/visual-location-*.test.ts tests/unit/boundaries.test.ts` →
    **121/121 PASS**;
  - `pnpm typecheck` PASS;
  - `pnpm lint`: 0 errores (sigue el aviso previo `_id`);
  - `pnpm eval:ocr` sobre el corpus, los adversariales y los fixtures, todos `complete`.
  - No se ejecutaron suite completa, build, SQL, migraciones, modelos de pago ni Stripe.
- **Riesgos:**
  - Las reglas se diseñaron viendo las diez fichas, que no son independientes.
  - La evidencia independiente es una reserva pequeña y sintética.
  - Se rechazan «I» y «l» de palo.
  - Los tiempos y la memoria no se han medido en Vercel.
- **Siguiente acción:** Fase II de reconocimiento geométrico (ROADMAP §10).

## 2026-10-15 — Políticas legales y corpus de mejora autorizado (preparación, sin recolección)

- **Base y rama:** `origin/main` en `1d4d07c`; la PR #33 es ancestro. Rama nueva: `claude/politicas-legales-corpus`.
- **Lectura:** AGENTS, CLAUDE, PROJECT_STATUS, ROADMAP, PRIVACY, ARCHITECTURE, AI_PIPELINE y la QA de las diez fichas.
- **Auditoría del código:** subida, Storage, workspaces, borrados, envíos a la IA, logs, evals y páginas legales.
- **Discrepancias encontradas:**
  - no hay registro de aceptación ni autorizaciones;
  - los originales se guardan con sus metadatos;
  - no existen borrado de cuenta, exportación ni job de retenciones (solo la limpieza de subidas abandonadas);
  - los objetos de `generated-assets` no se borran al borrar la adaptación;
  - las llamadas a Anthropic y OpenAI no llevan parámetros de retención ni de región.

  Detalle en [AUDITORIA_DATOS.md](legal/AUDITORIA_DATOS.md).
- **Proveedores:**
  - Se consultó la documentación pública de Anthropic y OpenAI (retención, entrenamiento, ZDR y residencia) y la existencia de
    los DPA de Supabase y Vercel.
  - **No se comprobaron** los contratos aceptados ni la configuración de las cuentas; todo eso queda PENDIENTE.
- **Diseño** (ADR-028, [FINALIDADES_Y_CORPUS.md](legal/FINALIDADES_Y_CORPUS.md)):
  - finalidades A, B y C separadas;
  - autorización explícita por material, ligada a bytes, aviso, caducidad y retirada;
  - licencia de derechos de autor separada del permiso de datos personales;
  - exclusión total de datos del alumnado y de terceros (la seudonimización no cuenta como anonimización);
  - centros como responsables, con acuerdo específico para otros fines;
  - límite del desaprendizaje documentado;
  - registro del corpus con particiones separadas;
  - esquema y RLS propuestos, sin aplicar.
- **Código:**
  - `src/lib/schemas/improvement-corpus.ts` y `src/lib/corpus/admission.ts`, sin llamadores en producción;
  - `evals/corpus/` (sintético) y `.gitattributes` para conservar el SHA de las muestras;
  - borradores de `/privacidad` y `/terminos`, sin controles;
  - correcciones en `PRIVACY.md` y `AI_PIPELINE.md`.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/improvement-corpus.test.ts tests/unit/legal-pages.test.ts tests/unit/boundaries.test.ts` →
    **28/28 PASS**;
  - `pnpm typecheck` PASS;
  - `pnpm lint`: 0 errores (sigue el aviso previo `_id`);
  - `git diff --check` PASS.
  - No se ejecutaron suite completa, build, E2E, SQL, migraciones, modelos ni Stripe.
- **Riesgos:**
  - los textos legales son borradores sin validez de garantía;
  - la política del código depende de que nadie rellene sus campos sin la revisión jurídica;
  - los metadatos de los originales y las retenciones siguen sin resolver.
- **Siguiente acción:** revisión especializada ([lista](legal/REVISION_ESPECIALISTA.md)). En paralelo, Fase I técnica sobre
  fichas propias (ROADMAP §9).

## 2026-10-14 — Corrección focalizada de anclas y etiquetas tras diez fichas

- **Base y rama:** `origin/main` en `37c381b`, merge de PR #32, con `939b123` como ancestro verificado. Rama nueva `codex/corregir-anclas-etiquetas-ocr`. Leídos AGENTS/CLAUDE, estado, roadmap, arquitectura, piloto/prototipo e informe local de las diez fichas.
- **Reproducción antes del arreglo:** 17/24 pruebas iniciales fallaron: numeración/extensión de cajas penalizadas por sus centros, evidencia insuficiente o referencias contradictorias sin estado propio y palabras ordinarias convertidas en etiquetas. Regresiones adicionales para numeración en referencia, selección tolerante y agregación: 29 pruebas nuevas finales.
- **Cambios:** `evals/ocr-pilot/anchor-association.ts`, métricas y reporte separan hallazgo de asociación verificable. Soporte del mismo prefijo en región anotada, referencias coherentes, X dentro de referencia y límite vertical existente de 3 mm; mezcla de actividades, evidencia insuficiente o empate quedan sin verificar. Parser `instructionLabels()` exclusivo del prototipo exige enumeraciones explícitas completas, sin «es» inventada. Versiones audit3/proto3; motor y matcher intactos.
- **Mismo corpus:** manifiesto y diez imágenes originales byte a byte, fuera de Git. Veinte referencias coherentes sin cambios; proceden de generación sintética, no de doble anotación humana. Red bloqueada durante OCR, supervisor de 2 GiB/600 s. Ejecución completa en 11,872 s; pico RSS muestreado del grupo de procesos 540.114.944 bytes, no garantía absoluta de memoria ni medida Vercel.
- **Antes → después:** exacto 16 →16 encontradas; 0 →15 correctamente asociadas; 1 sin verificar por columnas y 4 omitidas. Tolerante 17 encontradas, 16 asociadas, 1 sin verificar y 3 omitidas. Texto/etiquetas/confianza/llamadas iguales por ficha en ambos modos: 36/44 etiquetas, WER 11,6 % y CER 3,8 %. Geometría sin cambios: 1/10 candidatas, 0 aprobaciones. La firma de recta ya fallaba: solo desaparece el requisito inventado que ocultaba ese bloqueo.
- **Verificación:** 100/100 pruebas focalizadas en siete archivos; typecheck PASS; lint sin errores y aviso previo `_id`; diff check PASS. Binarios locales equivalentes porque pnpm intentó reinstalar y escribir fuera del workspace. Sin suite completa, build ni evaluación histórica de 55 condiciones-página; el reporte audit2 queda identificado como histórico.
- **Límites y decisión:** MERGE como reparación del evaluador experimental. OCR real (C, palabras unidas), columnas, firmas y verificaciones semánticas siguen pendientes; no se activa Hacer magia ni se aprueba ningún recorte. Sin cambios de producción, geometría, reconocimiento, dependencias, UI, Supabase, Stripe, SQL o migraciones. No llamadas pagadas ni publicación del corpus/documentos.
- **Evidencia y publicación:** [comparación por ficha](qa/ocr-anclas-etiquetas/README.md). Salida local en `/workspace/ocr-correccion-anclas-20261014/`. Corrección `20fd658` publicada en la rama nueva; ningún documento del corpus añadido a Git. Crear la PR falló tanto con `gh pr create` (GraphQL) como con REST POST `/pulls`: `Forbidden`. No hay número de PR confirmado ni merge. [Formulario de PR preparado con la rama](https://github.com/TinyChat-up/ADAPTAULA/pull/new/codex/corregir-anclas-etiquetas-ocr); título y descripción listos en `DESCRIPCION_PR.md` dentro de la salida local. Siguiente acción: abrir/revisar esa PR antes de modificar otra variable.

## 2026-10-14 — Auditoría independiente del piloto OCR, PR #32

- **Base verificada:** misma rama `claude/piloto-ocr-local`, local y remota en `53ee15b`, main en `bafae45`. Leídos AGENTS/CLAUDE, estado, roadmap, arquitectura, QA #30, propuesta, piloto y prototipo #31. Dependencias instaladas con lockfile congelado; modelo local descargado una vez, SHA fijado comprobado. Ningún documento privado ni llamada de pago.
- **Reproducción previa:** 12 pruebas adversariales fallaron contra el piloto inicial: cuatro asociaciones de etiquetas incorrectas (detección compartida, confusión intermedia reutilizada, error junto a lectura correcta ocultado y duplicado contado repetidamente); ancla de otra columna considerada correcta; CER por unidades UTF-16; ruido estructurado de 1.024 glifos sin presupuesto; cuatro rutas de escape y caja normalizada que desbordaba la página.
- **Métricas corregidas:** asociación voraz uno a uno por distancia, con desempate por índices sin preferir el texto correcto. Cada detección cuenta una vez en precisión; duplicados y espurias no desaparecen. CER Unicode, WER/CER explícitos con denominadores y límites de trabajo; anclas con criterio de solapamiento y desvío de centros en X/Y. Corpus real: ancla humana `anchorTextIndex`, líneas humanas `instructionTextIndices` para evitar recuperar texto de otra consigna repetida y array de transcripción en orden humano. Los sintéticos mantienen referencia derivada del matcher como limitación orientativa.
- **Motor:** recorrido con stack tipado y descarte temprano de listas de píxeles de componentes grandes/motas; presupuestos de 12 Mpx, 20.000 componentes, 512 glifos y 64 reconocimientos de etiquetas. Agrupación cuadrática aún existente, ahora acotada. Timeout de 30 s por pasada de página y 30 s para la pasada completa de etiquetas; límite entre etapas de 10 min. Pruebas de guía unida, tamaños distintos, cajas fuera de borde, confusiones 1/I, 0/O y B/8. No se modifica el localizador de producción.
- **Privacidad/loader:** corpus fuera de cualquier checkout Git; rutas relativas y realpath, rechazo de escapes y symlinks externos; manifiesto ≤2 MB, archivos ≤20 MB, ≤30 páginas/documento, ≤150 páginas anotadas, límites de dimensiones antes de decodificar imágenes y renderizar PDF. Referencias sin tinta se rechazan como anotación inválida. Informes reales sin transcripciones, etiquetas/read, respuestas ni IDs/tipos libres; solo ordinales, estados, códigos y recuentos. Logs reales ordinales y error CLI genérico. Informes anteriores invalidados al iniciar; publicación solo tras completar y `run-status.json` exige `complete`; fallo sin reportes parciales. Pruebas con temporales sintéticos y un sentinel de privacidad.
- **Rotación/red:** pruebas analíticas ±3°/±4,5° a 150/300 ppp y dos reconocimientos Tesseract ±3° a 150/200 ppp de palabra cercana al borde. El centro vuelve al marco original; la AABB se expande al hacer doble rotación. En la primera reejecución un ajuste de referencia introdujo esa expansión en el orden de lectura: detectado y corregido antes de publicar. La ejecución final completa y las pruebas OCR corrieron con HTTP/HTTPS/TCP/TLS/fetch bloqueados mediante preload Node heredado por workers. No hay descarga durante el reconocimiento.
- **Resultado final vs 53ee15b:** 135 etiquetas correctas/135 detecciones/135 referencias, sin cambios en este conjunto; no se demuestra inflación de la cifra concreta. Anclas exactas 108/115 dentro de tolerancia (antes 109); tolerantes 111/115 (antes 113); las cajas parciales/desplazadas también penalizan. WER/CER global con etiquetas 4,0 %/1,7 % (antes 3,9 %/1,6 % implícitos); denominadores 2.120 palabras/11.245 caracteres. Candidatos 19/30, referencia 23/30, sobre 145 propuestas guionizadas, 115 negativas; 0 erróneos observados y 0 recortes aprobados. **Son 11 documentos ×5 condiciones dependientes**, no 55 muestras independientes. Informe regenerado; los denominadores añadidos después se derivan de sus ensayos guardados, sin repetir reconocimiento.
- **Rendimiento local:** pico RSS muestreado 1.089 MB (proceso completo), máximo 2.759 ms/página con etiquetas; 171 llamadas de etiquetas, máximo 18/página. La velocidad no es comparable con el contenedor anterior. Model/data: paquete spa declara MIT; Tesseract/core y upstream Tessdata Best Apache-2.0; procedencia y SHA documentados. Fronteras de imports verificadas; no se ejecutó build/file tracing ni prueba Vercel.
- **Verificación final:** 77/77 pruebas focalizadas en siete archivos (métricas, auditoría, loader, runtime OCR local, boundaries y las dos suites de visual-location); typecheck PASS; lint sin errores y con aviso previo en `analysis-run-auth.test.ts`; diff check PASS. No suite completa, build, SQL, migraciones, Supabase, Stripe ni cambios UI/producción.
- **Recomendación:** MERGE únicamente como piloto experimental. Memoria, decodificación de PDF comprimido y trabajo nativo no tienen cota absoluta por los temporizadores: usar proceso local aislado con límites del sistema, preferentemente PNG/JPEG saneados inicialmente. Identidad, integridad pedagógica y respuesta visual continúan no verificables; 8.2B.6 pendiente. Siguiente paso: 20–30 fichas autorizadas sin datos personales, anotadas por dos personas, separadas por origen con reserva independiente, antes de integrar OCR o pagar propuestas multimodales.

## 2026-10-14 — Piloto OCR local sin API de pago (viabilidad, no producción)

- **Base y rama:** `origin/main` en `bafae45`; la PR #31 es ancestro (`git merge-base --is-ancestor 1cee7ca origin/main`). Rama
  nueva: `claude/piloto-ocr-local`.
- **Leído antes de empezar:**
  - AGENTS y CLAUDE;
  - la propuesta 8.2B.7 auditada;
  - la QA de PR #30;
  - `evals/visual-location` tras la auditoría `91848b6`;
  - ROADMAP y PROJECT_STATUS.
- **Fase 1 · motor:**
  - Comparación documental de tesseract.js, Tesseract nativo, PaddleOCR/RapidOCR, docTR/EasyOCR, Surya y OCR en la nube.
  - Elegido **tesseract.js 7.0.0**: Apache-2.0, WASM y sin binarios nativos; es el único que podría ir en el mismo runtime Node.
  - Instalado como devDependency exacta, con `postinstall` bloqueado en `pnpm-workspace.yaml`.
  - Modelo `spa` 4.0.0_best_int (2,1 MB) descargado una vez desde jsDelivr a `evals/ocr-pilot/.cache/` (ignorada por Git), con
    el sha-256 fijado.
- **Fase 2 · prototipo** (`evals/ocr-pilot/`):
  - **Entrada:** el OCR solo recibe los píxeles del raster escaneado. La capa vectorial se usa únicamente para puntuar.
  - **Hallazgo 1:** la pasada de página (PSM 3 y PSM 11) pierde **todas** las etiquetas aisladas. Se añade una pasada que relee
    cada glifo aislado (PSM 8, lista blanca).
  - **Hallazgo 2:** sin enderezar, 3° mezcla líneas y 4,5° casi vacía la lectura. `rotateAuto` lo corrige a 3° y 4,5°, pero no
    a 8°. Las cajas se devuelven al marco de la página.
  - **Métricas:** palabras y caracteres (en orden de lectura enderezado, sin guiones bajos de los campos de rellenar), consignas,
    anclas exactas y tolerantes, etiquetas (leída, confundida, perdida, duplicada, espuria), desvíos y candidatos del prefiltro de
    #31 con la caja humana. Las de candidatos se calculan con la capa OCR y con la de referencia.
- **Fase 3 · resultados** sobre 11 fixtures **sintéticos** × 5 condiciones (limpio 300, escáner 300, escáner 150, girado +3° 200,
  degradado 200), con el motor «página + etiquetas»:
  - **Texto:** 100 % de palabras y caracteres en limpio y escáner; 97,6 % de palabras girado; 83 % de palabras (94,6 % de
    caracteres) degradado.
  - **Etiquetas:** 135/135, sin confusiones, duplicados ni espurias; desvío del centro con p90 de 0,09 mm.
  - **Anclas:** 109/115 exactas, 0 mal asignadas. Con el comparador tolerante, 113/115.
  - **Candidatos:** 19/30, frente a 23/30 con referencia (18/18 en limpio y escáner, 1/6 girado, 0/6 degradado). 0 erróneos y 0
    aceptados.
  - **Rendimiento:** 1,2–4,9 s por página (4 vCPU). RSS de 147 MB antes del motor, 259 MB con dos workers y pico de 1.076 MB.
  - **Tamaño de dependencia:** 47 MB más 2,1 MB de modelo.
  - **Informe:** `evals/ocr-pilot/results/report.md`, con desglose por tipo de documento.
- **Fase 4 · decisión: INVESTIGAR MÁS.**
  - El OCR deja de ser el cuello de botella en estos fixtures.
  - Los fallos restantes son de integración (enderezar antes del prefiltro) y del prefiltro (umbral de tinta frente al grano).
  - Sin corpus real ni prueba en Vercel no se puede afirmar utilidad. Un OCR correcto no prueba el contenido de la figura. No se
    autorizan recortes.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/ocr-pilot-metrics.test.ts tests/unit/boundaries.test.ts tests/unit/visual-location-prototype.test.ts tests/unit/visual-location-adversarial.test.ts`
    → **39/39 PASS**.
  - `pnpm typecheck` PASS.
  - `pnpm lint`: 0 errores; el aviso previo de `analysis-run-auth.test.ts` sigue ahí.
  - `git diff --check` PASS.
  - `pnpm eval:ocr`: 2 min 48 s.
  - No se ejecutan suite completa ni build (fuera del alcance autorizado). Tampoco modelos, OCR remoto, SQL, Stripe ni migraciones.
- **Riesgos:**
  - Los umbrales de la pasada de etiquetas y la degradación sintética se fijaron con estos fixtures.
  - La memoria y el tiempo en Vercel son desconocidos.
  - El *file tracing* del WASM y del modelo no está probado.
  - El comparador tolerante no está en producción y solo se ha probado aquí.
- **Siguiente acción:** corpus real autorizado (20–30 escaneos, fuera del repo) con `pnpm eval:ocr -- --corpus`, guardando fichas
  de reserva. Según el resultado, enderezar antes del prefiltro y probar en Vercel, o descartar.

## 2026-10-14 — Auditoría independiente de PR #31: propuesta y prototipo

- **Base/rama:** `origin/main` en `f827001`, rama de PR #31 `claude/fase-8-2b7-identificacion-figuras` en `1cee7ca` al empezar; árbol limpio. Se inspeccionaron AGENTS/CLAUDE, documentos compartidos, QA de PR #30, contrato, verificador, fixtures y arnés. La producción no se modifica.
- **Fallos reproducidos antes de corregir:** cuatro pruebas nuevas fallaron porque el verificador respondía `accepted`: núcleo borrado con etiquetas presentes, barra cuya tinta pasa de 3/8 a 5/8, figura de otra actividad tras omitir OCR de la segunda consigna, etiqueta borrada en píxeles que persiste como caja OCR. Se añaden pruebas de parte interna sin etiqueta y OCR confuso (`1/I`), duplicado y desplazado. Los originales recibían cajas derivadas del vector, no OCR real.
- **Corrección:** `candidate` expone solo el prefiltro geométrico; `crop` y `accepted` permanecen bloqueados al marcar identidad semántica, contenido completo y respuesta visual como no verificables. Se versiona el prototipo como `proto2`. Las métricas distinguen propuestas de figuras oráculo, candidatos y recortes aprobados; 0 aceptados implica cobertura 0, no precisión observada. No se cambia `src/`, análisis v3 ni la procedencia de PR #30.
- **Revisión de diseño:** propuesta y estado rebajan la independencia de análisis/OCR/píxeles, reconocen zonas amplias por anclas perdidas, OCR idealizado, SHA solo comparado en el prototipo, reintentos reales del analizador y límites léxicos de respuesta. Corrigen el denominador del experimento: ≥60 aceptados a ≥40 % exige ≥150 figuras elegibles; con 0/60 errores el límite binomial unilateral 95 % es 4,87 % solo bajo independencia. El siguiente piloto es OCR local y cajas humanas en 20–30 escaneos, sin llamadas API.
- **Verificación:** `pnpm exec vitest run tests/unit/visual-location-prototype.test.ts tests/unit/visual-location-adversarial.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts` → **39/39 PASS**; `pnpm typecheck` PASS; `pnpm lint` sin errores y con un aviso previo en `analysis-run-auth.test.ts`; `git diff --check` PASS. No se ejecutan suite completa, compilación, modelos, OCR remoto, SQL, Stripe ni migraciones.
- **Límite y recomendación:** la propuesta multimodal + OCR puede servir para localizar candidatos, pero no tiene señal suficiente para aprobar dibujos o evitar respuestas visuales. PR #31 es mergeable solo como prototipo bloqueado y documentación de un experimento; fase 8.2B.6/8.2B.7 funcionales siguen pendientes. Priorizar piloto OCR sin gasto antes de más infraestructura.

## 2026-10-14 — Fase 8.2B.7: diseño de la identificación fiable de figuras en escaneos

- **Base verificada:** `git fetch origin main` → `f827001`. El HEAD de la PR #30 (`ccfbf3e`) y sus commits de auditoría (`d9f61a0`, `6ed59e8`) son ancestros de `main`. Rama nueva: `claude/fase-8-2b7-identificacion-figuras`.
- **Examinado:**
  - `MaterialAnalysis` v3 no guarda posición;
  - el analizador ya recibe el PDF o la imagen en una llamada multimodal;
  - `auto/locate.ts` (v5) exige ancla y zona;
  - `vision.ts` / `visual_locator@v1` solo suma acuerdo;
  - los escaneos se rechazan siempre;
  - las garantías de procedencia de la #30 se conservan;
  - fixtures A–J de `docs/qa/pr30`.
- **Propuesta:** [`docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md`](proposals/LOCALIZACION_FIGURAS_ESCANEOS.md). Recomienda:
  - la propuesta de ubicación en el análisis inicial (A);
  - OCR local como capa de texto independiente en los escaneos;
  - un verificador por reglas.

  Se descartan la visión bajo demanda como vía principal (B: coste y latencia en cada adaptación), el detector sin modelo (C: falsos positivos de #30) y el modelo que verifica su propia propuesta (D: no es independiente). Las decisiones pendientes quedan enumeradas, sin ADR.
- **Prototipo aislado** (`evals/visual-location/`: `contract.ts`, `verify.ts`, `fixtures.ts`, `harness.ts`):
  - 11 hojas sintéticas, rasterizadas como un escaneo con grano, sombra y una con rotación de 1,5°;
  - capa de texto como OCR perfecto, o con pérdidas;
  - propuestas guionizadas;
  - no lo importa ningún módulo de `src/`.
- **Pruebas:**
  - `pnpm exec vitest run tests/unit/visual-location-prototype.test.ts` → **15/15 PASS**:
    - OCR perfecto: 42 propuestas, 0 falsos positivos, 0 falsos negativos, cobertura 6/6;
    - OCR con 50 % de pérdida de cajas cortas: 0 falsos positivos, 5 falsos negativos.
  - `boundaries`, `visual-boundaries` y `automatic-visuals` → 40/40 PASS.
  - `pnpm typecheck` PASS; `pnpm lint` 0 errores (el aviso previo).
  - Advertencia: el verificador se ajustó con esos mismos fixtures (caja de verdad, fuga en rótulos adyacentes, líneas de respuesta torcidas), así que son pruebas de regresión del contrato, no una precisión.
- **Límites:**
  - sin modelos reales, OCR real, migraciones, cambios de producción, UI, Stripe ni planes;
  - todos los costes y latencias son estimaciones; el único medido es el coste del análisis existente, en `COSTS.md`.
- **Siguiente acción:** decidir si se autoriza el experimento mínimo (sección 9 de la propuesta) y medir candidatos de OCR local en Vercel.

## 2026-10-14 — Cierre de alcance de PR #30: seguridad y procedencia

- **Base/rama verificadas:** `main` permanece en `1929849`; rama local, remota y referencia de #30 en `d9f61a0` al comenzar. Misma rama `claude/fase-8-2b6-escaneos`, sin otra PR ni merge. Entorno ya disponible; no cambia configuración, instalación ni dependencias.
- **Clasificación del diff completo frente a main:** SHA precargado incorrecto y aceptación por visión sin ancla son defectos anteriores a #30. Ambos se reprodujeron fallando contra `1929849` con las nuevas expectativas y pasan tras corregir. La aceptación geométrica de escaneos y sus activos/evidencia scan pertenecen exclusivamente al experimento de #30. No se ha comprobado la existencia de activos inseguros en producción.
- **Cierre de procedencia:** `visuals/service.ts` valida localizador completo, geometría, versión, método y evidencia positiva. Humano admite null explícito; automático requiere PDF, motor conocido, ancla/zona, señales completas y ausencia de scan. Activo y pin se vinculan a id/localizador/identidad/receta/ruta/hash; rutas pre-017 conservadas. `server.ts` consulta el padre completo bajo RLS. Los 24 casos iniciales de metadatos defectuosos dieron 20 fallos sobre d9; ampliados a 26, todos pasan. Son pruebas de respuestas defectuosas de persistencia: no se afirma que un usuario normal pueda insertar esas filas.
- **Identidad y simplificación:** `auto/locate.ts` exige ancla/zona incluso si existe acuerdo de visión; `auto/service.ts` usa v5 para invalidar decisiones anteriores. Se retiran `auto/scan.ts`, sus tipos/señales/dispatch y dos suites redundantes. `scan-case.ts` baja de 114 a 21 líneas. Se agrupan las integraciones en `scan-visuals.test.ts` y se elimina `scan-audit.test.ts`; los fixtures heredados ya no desactivan triggers. Se conservan A–J como evidencia histórica, C/I en integración y rechazo sin acceso a píxeles en el localizador real. No hay OCR, modelo nuevo ni pipeline alternativo.
- **Verificación del cierre (local, proveedores simulados):**
  - `pnpm exec vitest run tests/unit/visual-provenance.test.ts tests/unit/automatic-visuals.test.ts tests/unit/visual-raster.test.ts tests/unit/visual-boundaries.test.ts tests/unit/boundaries.test.ts tests/db/scan-visuals.test.ts tests/db/automatic-visuals.test.ts tests/db/visual-instances.test.ts tests/db/visual-locators.test.ts tests/db/pdf-export.test.ts tests/db/magic-visual-policy.test.ts` → **149 PASS, 11 archivos**.
  - `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/scan-visuals.test.ts tests/pdf/automatic-visuals.test.ts tests/pdf/table-choice-substitution.test.ts` → **3 PDF PASS**. Célula con selección manual, fracciones automáticas y selección tabular; sin cambiar renderer.
  - `pnpm typecheck` PASS; `pnpm lint` 0 errores, aviso previo `_id` en `analysis-run-auth.test.ts`; `git diff --check` limpio.
  - Los dos fallos esperados contra main, las 20 aserciones iniciales contra d9 y las repeticiones no se suman al total final. Una regresión anterior esperaba producir un localizador con evidencia incompleta; se conserva el caso y ahora se comprueba el rechazo correcto antes de continuar su reconstrucción corroborada.
  - Sin suite completa, build, llamadas pagadas, SQL remoto, migraciones, Stripe ni cambios comerciales.
- **Documentos:** actualizados `PROJECT_STATUS.md`, `ROADMAP.md`, `ARCHITECTURE.md` (ADR-026 reducido a antecedente retirado; ADR-027 vigente), `VISUAL_RESOURCES.md` e [informe](qa/pr30/README.md). Los resultados históricos antes/después en `results.json` siguen referidos a ccfbf3e/d9, no al nuevo motor.
- **PR y bloqueo externo:** título y descripción exactos en [PR_DESCRIPTION.md](qa/pr30/PR_DESCRIPTION.md). Tanto lectura GraphQL como actualización REST `PATCH /repos/TinyChat-up/ADAPTAULA/pulls/30` devuelven `Forbidden`; no se pudieron cambiar los metadatos remotos. Git HTTPS permite publicar en la misma rama. No se afirma que el título/descripcion actuales de GitHub reflejen este cierre.
- **Recomendación:** **MERGE técnico exclusivamente como endurecimiento de seguridad/procedencia**, una vez aplicado/verificado el título y descripción. Todas las correcciones restantes aportan valor frente a main. **8.2B.6 permanece pendiente**. Los controles son de aplicación: no revocan el acceso legítimo del propietario a objetos históricos de Storage ni recuperan descargas/cachés previas. Falta validar producción, documentos reales y carga máxima en Vercel.
- **Siguiente acción concreta:** publicar este cierre en #30; aplicar/verificar los metadatos preparados desde un entorno con acceso a la API/UI de GitHub y revisar para integración humana con ese alcance. No desarrollar otra fase en este bloque.

## 2026-10-14 — Auditoría independiente y correcciones de PR #30

- **Base y alcance:** `main` en `1929849`; rama `claude/fase-8-2b6-escaneos`, HEAD auditado `ccfbf3e`, coincidente con remoto y `refs/pull/30/head`. Se corrige esa misma PR, sin fase nueva, otra PR ni merge. Entorno ya preparado; no se repite la suite completa.
- **Fallos reproducidos antes de corregir:** diez fixtures adversariales aceptados a 0,75 sin ancla independiente (A–I solicitados y J, pérdida de etiquetas). Nueve muestran selección equivocada, contaminación o pérdida; H muestra el límite de evidencia en un escaneo plausible. Fallan las diez aserciones de rechazo contra el código original. Otras tres pruebas PGlite demuestran entrega de decoración, reutilización de activos scan antiguos y aceptación de una fuente precargada con SHA distinto del localizador efectivo.
- **Correcciones de producción:** `auto/scan.ts` rechaza la localización sin evidencia independiente; `auto/locate.ts` y `auto/service.ts` cierran entradas alternativas por visión y corroboración de forma en páginas sin texto. Motor `auto_visuals@v4` invalida el resultado cacheado anterior. `visuals/service.ts` y `server.ts` consultan evidencia bajo RLS, bloquean activos automáticos scan antiguos en resolución, producción y pins y comprueban el SHA de la fuente precargada. Se conservan filas/bytes históricos y selección humana. Se elimina el recorrido de componentes del escaneo y se libera la caché de alta resolución entre páginas.
- **Pruebas añadidas o ajustadas:** `scan-adversarial`, `scan-location`, `scan-audit`, `scan-visuals`, harness PGlite, integración `magic-visual-policy` y PDF de célula con selección manual explícita. La integración demuestra parada sin entrega/descarga cuando falta la figura, ausencia de llamada a visión y cuota no consumida. El fixture de procedencia antigua modifica evidencia únicamente en PGlite; no se altera la inmutabilidad de producción.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/scan-adversarial.test.ts tests/unit/scan-location.test.ts tests/db/scan-audit.test.ts tests/db/scan-visuals.test.ts tests/db/magic-visual-policy.test.ts`: **57 PASS**.
  - `pnpm exec vitest run tests/unit/automatic-visuals.test.ts tests/unit/visual-raster.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts tests/db/automatic-visuals.test.ts tests/db/visual-locators.test.ts tests/db/visual-instances.test.ts tests/db/pdf-export.test.ts`: **97 PASS**.
  - `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/scan-visuals.test.ts tests/pdf/automatic-visuals.test.ts tests/pdf/table-choice-substitution.test.ts tests/pdf/illustrations.test.ts`: **4 PDF PASS**. Inspección visual de célula: esquema y etiquetas completos junto a la actividad correcta; renderer sin cambios.
  - **154 pruebas focalizadas únicas en 13 archivos**, más los 4 PDF; la repetición de `scan-audit` tras ampliar comprobaciones de lectura rápida, bytes y corrección manual no suma casos nuevos.
  - Typecheck PASS; lint sin errores, un aviso previo en `analysis-run-auth.test.ts`; `git diff --check` limpio.
  - Sin suite completa, build, llamadas pagadas, SQL remoto, migraciones, Stripe ni cambios comerciales.
- **Evidencia y documentación:** [informe reproducible con fixtures y resultados antes/después](qa/pr30/README.md), `PROJECT_STATUS.md`, `VISUAL_RESOURCES.md`, ADR-027 en `ARCHITECTURE.md` y `ROADMAP.md`. La entrada original que sigue es histórica y sus afirmaciones de aceptación automática quedan sustituidas por esta auditoría.
- **Límites:** se rechazan automáticamente todos los escaneos sin texto, incluso la célula correcta. Se mantienen selección humana y localización anterior con capa de texto. No se certifican selecciones humanas arbitrarias, páginas híbridas/OCR falso, escaneos reales ni consumo máximo en Vercel. No se consultó producción ni se recuperan documentos ya descargados.
- **Decisión y siguiente acción:** **NO MERGE como Fase 8.2B.6 terminada**. Publicar las correcciones en la misma rama de #30; revisar la PR como restricción de alcance y protección contra entregas incorrectas. Antes de retomar la localización automática, definir una fuente independiente de identidad/asociación e integridad; esa implementación queda fuera de esta auditoría.

## 2026-10-14 — Fase 8.2B.6: localización conservadora de figuras en escaneos (histórico; aceptación retirada por la auditoría anterior)

- **Base verificada:** `git fetch origin main` → `1929849`. #27 (`bb38cd0`), #28 (`70fb9ea`) y #29 (`1929849`) están integradas. Rama nueva: `claude/fase-8-2b6-escaneos`. La rama y el trabajo de la PR #29 no se tocan.
- **Investigación:** `locate.ts` puntúa:
  - firma 0,30 (una figura genérica, 0);
  - zona de su actividad 0,25, que exige un ancla de la capa de texto del PDF;
  - unicidad 0,20;
  - limpieza 0,15;
  - visión 0,20.

  En un escaneo, `pageText` devuelve 0 cajas: no hay anclas y la «limpieza» no ve el texto escaneado. Una figura genérica nunca pasa de 0,35 sin visión, y una barra de 0,65. `MaterialAnalysis` v3 no guarda la posición de los visuales. Ya resuelto: figuras con anclas impresas (barra o recta con firma) y cualquier figura con acuerdo de visión. Fallaba: cualquier figura de una página sin capa de texto sin visión configurada.
- **Fallo reproducido antes de cambiar producción:** `tests/support/scan-case.ts` construye «La célula animal» escaneada: 150 ppp, una imagen por página, papel, grano, motas y la sombra del escáner. `locateVisuals` daba `vis_1` no aceptado, confianza 0,15, `low_confidence`, sin ancla → D y parada.
- **Implementación:**
  - `src/lib/materials/visuals/auto/scan.ts` (`locateOnScan`):
    - componentes conectados a resolución completa;
    - descarte de motas, tinta en el borde, marcos (cuatro lados y poco interior), manchas claras y filas de letras grandes;
    - unión de los trazos de un dibujo;
    - etiquetas cercanas al recorte;
    - holgura de 2,5 mm frente al texto;
    - límite de texto y de tamaño;
    - firma de barra cuando el análisis dice barra.
  - Exige además que el análisis liste un único visual en la página y que sea `required`.
  - `service.ts` (motor `auto_visuals@v3`) lo usa solo en páginas sin capa de texto, después del localizador con anclas. La visión no lo sobrescribe.
  - Las señales `scan` se guardan en la evidencia del localizador, sin texto del material.
  - Sin migraciones: el esquema ya admite `evidence` JSON.
- **Evidencia para aceptar:** análisis (único visual, imprescindible) + único dibujo de tamaño de figura y tinta oscura + recorte limpio. Confianza exactamente 0,75; ninguna señal parcial basta.
- **Pruebas:**
  - `tests/unit/scan-location.test.ts` (20):
    - el fallo anterior;
    - acierto en PDF y PNG, con IoU > 0,8 respecto al esquema;
    - recorte sin enunciado ni líneas de respuesta, a 200 ppp con margen;
    - adorno pequeño;
    - titular enorme y párrafo enmarcado junto a la figura;
    - figura en el borde;
    - negativos: dos figuras, adorno grande, sin figura, solo texto, texto pegado, varios visuales en el análisis, no `required`, barra que no lo es, recta numérica, página con capa de texto;
    - coordenadas válidas;
    - política: `exact_original_visual` en `act_1`, o parada `unresolved_visual`.
  - `tests/db/scan-visuals.test.ts` (5, PGlite con migraciones reales):
    - localizador `auto` con página, coordenadas, `page_box`, sha, motor y señales;
    - recorte en Storage y lectura con RLS;
    - imagen PNG;
    - ambigüedad → D sin filas;
    - nueva versión del original → D sin heredar;
    - recorte automático anterior equivocado → `auto_not_revalidated`.
  - `tests/pdf/scan-visuals.test.ts` (Chromium): el recorte fijado por sha es la figura de la actividad 1, antes de la actividad 2, sin peticiones ni scripts. PDF inspeccionado: una página con el esquema y sus números 1, 2 y 3.
- **Resultados:**
  - `pnpm exec vitest run` de las unitarias `scan-location`, `automatic-visuals`, `magic-visual-policy`, `visual-raster`, `visual-boundaries` y `boundaries`, y de db `scan-visuals`, `automatic-visuals`, `magic-visual-policy` y `visual-locators`: **144/144 PASS en 10 archivos**.
  - `vitest.pdf.config.mts`: `scan-visuals`, `automatic-visuals` e `illustrations` **3/3 PASS**.
  - `pnpm typecheck` PASS; `pnpm lint` 0 errores (el aviso previo en `analysis-run-auth.test.ts`).
  - No se ejecutó la suite completa.
- **Casos todavía ambiguos o fuera de alcance:**
  - varias figuras por página;
  - un adorno grande, o una mancha;
  - texto a menos de 2,5 mm;
  - rectas numéricas escaneadas;
  - páginas con varios visuales en el análisis.

  Riesgo residual documentado: una única letra enorme aislada, o texto que toca el dibujo, cuando el análisis afirma un solo visual. Sin OCR ni modelos de imagen; sin llamadas de pago, SQL remoto, Stripe ni cambios de planes. Validado solo con escaneos sintéticos.
- **Publicación:** implementación `71b6080` en `claude/fase-8-2b6-escaneos`, publicada en la [PR #30](https://github.com/TinyChat-up/ADAPTAULA/pull/30) hacia `main`, sin merge.
- **Siguiente acción:** revisar la PR; medir la cobertura con escaneos reales autorizados antes de ampliar el caso; no presentarlo como localización universal.

## 2026-10-14 — PR #29: redirección editorial como estudio pedagógico digital

- **Continuidad verificada antes de editar:** rama única `claude/variables-expuestas-repo-f2o2et`, actualizada y limpia en `6fa99fc25fa9a152febf882c0a0fbacfd0b84ae7`; la rama remota y `refs/pull/29/head` coinciden. Publicación comprobada con `git push --dry-run`. Se leen AGENTS, CLAUDE y el contexto compartido y se inspecciona el diff de Claude respecto a `main` (`70fb9ea`). PR #29 abierta y sin merge según el usuario; no se reinicia ni sustituye su rama.
- **Método:** capturas de diez pantallas × escritorio/móvil antes de modificar producto, decisión de sistema visual y rediseño sobre las primitivas existentes. Capturas finales comparadas visualmente; [galería versionada y método](qa/pr29/README.md), con copia ZIP entregada al usuario. Solo datos sintéticos y workspace local de prueba; no sesiones ni credenciales en los artefactos publicados.
- **Decisión ADR-025:** papel cálido, tinta y azul editorial; Inter en UI y Georgia del sistema en titulares públicos; filetes, numeración y jerarquía. Sin nuevos paquetes/fuentes, gradientes, halos, tarjetas flotantes ni animaciones ornamentales. Bordes de controles separados de los filetes decorativos. Contrastes sobre papel/blanco: tinta ≥12,96:1, texto secundario ≥5,73:1, enlaces ≥6,45:1 y borde de campo ≥3,31:1.
- **Portada:** dos hojas A4 legibles, con la misma tabla de animales, pregunta y opciones, sin marcar solución; demostración estática explícita. Copy de pasos y acceso conforme a Hacer magia o Revisar antes de crear, con descarga cuando la ficha esté lista. Tipografía, secciones públicas, navegación, acceso y CTA coherentes con el sistema.
- **Aplicación:** Inicio coloca atención y trabajos por delante de materiales/fichas, con una acción principal; cuotas y plan secundarios. Materiales, perfiles y adaptaciones pasan a filas. Subida, selección de perfil/modo y pantalla de adaptación enfatizan contenido y estado. Móvil conserva acciones visibles y diálogo nativo. Se corrige el reflujo con texto ampliado en cabecera, barra y acciones de filas.
- **Funciones de Claude conservadas:** rutas y redirecciones, retirada de «Próximamente», filtros, Plan y cuenta, estados, errores, cuotas y permisos. Sin cambios en `src/lib`, esquemas, SQL, Stripe, IA, pipeline, `components/material`, renderer ni PDF. Las clases de demo son exclusivamente web. Los grupos de rutas y límites de loading de ADR-024 conservan su protección del 404.
- **Archivos:** `globals.css`, primitivas UI, shell/navegación, Inicio/listas/Adaptar/uso, presentación de adaptación, componentes públicos y acceso. Nuevo `tests/e2e/editorial-interface.spec.ts`. Contexto actualizado en UX, PROJECT_STATUS, ARCHITECTURE y este registro; AGENTS/CLAUDE ya enlazan esos documentos.
- **Verificación final local:**
  - `pnpm typecheck` PASS. Al iniciar había tipos ignorados obsoletos de `.next/dev/types` de rutas retiradas por Claude; se regeneraron sin cambiar configuración ni producto.
  - `pnpm lint`: 0 errores, 1 aviso previo (`_id` en `tests/unit/analysis-run-auth.test.ts`).
  - **62/62 pruebas focalizadas, 8 archivos PASS**: boundaries, adaptation-web-boundaries, visual-boundaries, immediate-dispatch, next-tracing, pdf-single-renderer, pricing-truth y print-html. No se ejecutó toda la suite.
  - **4/4 Playwright PASS**, dos recorridos en escritorio 1440 y móvil 390: demo fiel/A4, movimiento reducido, salto al contenido y navegación pública; registro/perfil/subida válida e inválida/análisis simulado, revisión, estados de Inicio, filtros, menú con Escape/retorno de foco y resultado con fixture imprimible. Axe sin infracciones detectadas en las pantallas auditadas. Biblioteca a 320 px con texto al 200 % sin desbordamiento.
  - Sin desbordamiento horizontal en las diez pantallas capturadas a 1440/390; comprobación adicional de portada, Inicio, materiales, perfiles y Adaptar a 320/768/1280.
  - `pnpm build` PASS en el estado final: Google Fonts no bloquea esta sesión. No se cambia la carga de fuentes ni la red para conseguirlo. `git diff --check` PASS.

  Comandos portables (Chrome instalado para la configuración E2E por defecto):

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm exec vitest run tests/unit/boundaries.test.ts tests/unit/adaptation-web-boundaries.test.ts tests/unit/visual-boundaries.test.ts tests/unit/immediate-dispatch.test.ts tests/unit/next-tracing.test.ts tests/unit/pdf-single-renderer.test.ts tests/unit/pricing-truth.test.ts tests/unit/print-html.test.ts
  pnpm exec playwright test tests/e2e/editorial-interface.spec.ts
  pnpm build
  ```

  En este cloud, Playwright utilizó configuración temporal equivalente con Chromium de `@sparticuz/chromium`, sin `--disable-web-security`, contra `next dev` y `fake-supabase.mjs` (PGlite). La configuración temporal solo cambia el binario disponible, escritorio a 1440, reportes y servidor ya iniciado. Los E2E generales desactualizados registrados por Claude no se reejecutan ni se corrigen aquí.
- **Límites:** QA local con proveedores simulados; no llamadas pagadas ni Supabase remoto. No se certifica Preview de Vercel, IA real ni accesibilidad con lector de pantalla. La ficha de resultado es un fixture sembrado, no una salida obtenida del modelo. El método de capturas explica la densidad reducida de la portada móvil larga para evitar un artefacto de teselas de Chromium.
- **Publicación autorizada:** commit sobre la misma rama y push para actualizar [PR #29](https://github.com/TinyChat-up/ADAPTAULA/pull/29), sin crear otra PR ni hacer merge.
- **Siguiente acción:** revisar galería y Preview de esa PR. Cualquier integración requiere una tarea posterior; después retomar el bloque de tests generales o la variante tabular del roadmap, por separado.

## 2026-10-13 — UI/UX: navegación sin pantallas vacías, «Plan y cuenta», «Adaptaciones» con filtros y movimiento

- **Base verificada:** `git fetch origin main` → `70fb9ea` (merge de PR #28; #25–#27 también integradas). La PR #25, de la rama `claude/variables-expuestas-repo-f2o2et`, ya estaba integrada (`6c91552`; en esta sesión la API de GitHub sí responde). Por eso la rama se reinicia desde `main` y este bloque va como cambio nuevo, sin apilarlo sobre historia ya integrada.
- **Petición:** mejorar la UI/UX sin romper nada, eliminar pantallas innecesarias y dar más dinamismo. Es solo presentación: sin migraciones ni cambios en datos, permisos, RLS, planes, cuotas, precios, IA, pipeline, renderer o PDF.
- **Pantallas retiradas:**
  - `/app/plantillas`, `/app/ayuda`, `/app/clases` y `/app/configuracion` eran pantallas «Próximamente» sin contenido; se elimina también `coming-soon.tsx`.
  - Redirigen (307, `next.config.ts`) a `/app`, `/como-funciona`, `/app/alumnos` y `/app/uso`. Comprobado con `curl`, también `/app/configuracion/facturacion` y `/app/clases/<id>`.
  - Configuración se funde en **«Plan y cuenta»** (`/app/uso`): uso del periodo, datos de la cuenta y ayuda.
  - Historial pasa a ser **«Adaptaciones»**, en la misma ruta y con filtros por estado (`?estado=`, recuento por filtro y `aria-current`).
- **Navegación:**
  - Escritorio: 5 entradas principales más «Plan y cuenta» (antes 8 + 2, tres de ellas vacías). La entrada activa lleva barra, fondo y `aria-current`.
  - Móvil: cabecera fija con el plan (enlaza a Plan y cuenta) y barra inferior con botón central y hoja «Más» animada.
- **Inicio:**
  - Cabecera con saludo y una línea que cambia según el estado.
  - Tarjetas con icono y barra, listas con icono y flecha, y la tarjeta entera de cada material como enlace.
  - Estado vacío con los tres pasos.
  - En el móvil, «Ver todas las adaptaciones» se lee «Ver todas» y conserva el nombre completo para lectores de pantalla.
- **Movimiento (`globals.css`, sin dependencias):**
  - Entrada de página (`app/app/(shell)/template.tsx`), `stagger`, `pop-in` y `meter-fill`.
  - `lift` al pasar el ratón y con el foco del teclado; botones con pulsación.
  - Esqueletos con brillo y `loading.tsx` en Inicio, Materiales, Perfiles, Adaptaciones y Plan y cuenta.
  - `reveal` en la web pública.
  - Regla: el texto solo se desplaza (`transform`), nunca cambia de opacidad. `prefers-reduced-motion` lo para todo. Ningún `loading.tsx` envuelve las rutas que deben responder 404 (ADR-024).
- **Web pública y acceso:** hero con vista previa del producto, cabecera fija, pasos con icono, tarjetas con icono, privacidad, CTA final, y login/registro/bienvenida a dos columnas. Copy, precios y promesas sin cambios (`pricing-truth` PASS).
- **Archivos:** `src/app/globals.css`, `src/components/ui/{button,feedback,layout}.tsx`, `src/components/app/*` (shell, navegación, barra móvil, pie, `page-skeleton.tsx`), `src/app/app/(shell)/{(inicio),materiales/(lista),historial,uso,alumnos,adaptar}/*`, `template.tsx`, `src/components/adaptation/adaptation-list.tsx`, `src/components/materials/uploader.tsx`, `src/components/marketing/*`, `src/app/(auth)/layout.tsx`, `src/app/app/bienvenida/page.tsx`, `next.config.ts`; documentación en `docs/UX.md`, `BILLING.md`, `ROADMAP.md`, `ARCHITECTURE.md` (ADR-024), `PROJECT_STATUS.md` y este registro.
- **Pruebas (locales, con PGlite y proveedores simulados; sin servicios remotos ni llamadas de pago):**
  - `pnpm typecheck` PASS.
  - `pnpm lint`: 0 errores y 1 aviso previo en `tests/unit/analysis-run-auth.test.ts`.
  - Unitarias de los 8 archivos afectados: 62/62 PASS (`boundaries`, `adaptation-web-boundaries`, `visual-boundaries`, `immediate-dispatch`, `next-tracing`, `pdf-single-renderer`, `pricing-truth`, `print-html`). No se ejecutó la suite completa.
  - **E2E Playwright** (escritorio 1280 y móvil 390, con axe y desbordamiento), servidor `next dev` con PGlite y Chromium 141 de `/opt/pw-browsers`:
    1. Primera pasada, sobre `1e94a8d` + UI: 46 PASS, 10 fallos (las mismas 5 pruebas en los dos tamaños) y 20 sin ejecutar, saltadas en serie tras esos fallos.
    2. Las 5 sobre `main` limpio (`70fb9ea`, sin la UI y con el servidor reiniciado desde cero): fallan igual, con el mismo error y en la misma línea.
    3. Pasada final sobre `main` + UI, excluyendo solo esas 5: 51 PASS y 5 fallos, también ajenos a la UI (explicados abajo). Las 10 pruebas saltadas en serie se ejecutaron aparte: 8 PASS, entre ellas `adaptation:77` (404 de otra cuenta) y `materials:267` (axe y desbordamiento) en móvil, más `magic-flow:140` con su fallo previo en los dos tamaños.
    4. Repeticiones: `adaptation:60` y `materials:145` en móvil, 3/3 PASS cada una; `free-plan:9` en escritorio, 1/2 PASS con la UI y 1/3 en `main` limpio.
  - `pnpm build` PASS: compila en 62 s y la lista de rutas ya no incluye `/app/plantillas`, `/app/ayuda`, `/app/clases` ni `/app/configuracion`.
  - Capturas antes/después de 13 pantallas, en escritorio y móvil.
- **Fallos E2E previos, ajenos a este bloque.** Todos se reproducen en `main` limpio, con el servidor reiniciado desde cero. Los tests son del 8-oct y la lógica cambió después.
  - Deterministas:
    - `adaptation-states:15`: el *seed* «lista con observaciones» ya no es imprimible con `render/readiness` (Hotfix 8.2A.1). La pantalla dice «La ficha no se puede mostrar completa todavía».
    - `magic-flow:50`, `:98` y `:140`: esperan la copy y el recorrido antiguos. Las fases eran «Revisando el resultado… Lista» y ahora (`bd83d80`) son «Organizando las actividades… Comprobando el resultado… Ficha lista». El aviso esperado era «La ficha necesita una revisión antes de estar lista» y ahora es «No hemos podido completar automáticamente esta ficha». Además, tras «Hacer magia» la prueba ya no llega a `/vista` con el doble simulado.
    - `render:39`: la app nombra bien el PDF («Descarga iniciada: Población y movilidad en Valdeloma.pdf»). Es el Chromium 141 *headless* del entorno el que da `download` como nombre sugerido de una descarga desde un `blob:`.
    - `visual-locator:47`: aparecen 3 enlaces «Localizar en el original» (vis_1–vis_3) donde el test espera uno, en modo estricto.
  - Intermitentes:
    - `materials:109`: carrera del test. Tras «Volver a analizar», `waitForAnalysis` encuentra el encabezado del análisis anterior y lee la cuota antes de que la acción reserve la unidad (9 en lugar de 10).
    - `free-plan:9`: a veces una adaptación de «Hacer magia» termina `blocked` (CTA «Revisar»), y el test solo acepta «Ver ficha|Ver progreso|Revisar adaptación».
    - `adaptation:60` y `materials:145`: carrera del helper `signUpAndOnboard`, que no espera a que termine el onboarding. La traza muestra el `goto` 22 ms después del POST: `/app/adaptar` → 307 `/app/bienvenida` → 307 `/app`. Arreglo de una línea: esperar `not.toHaveURL(/\/app\/bienvenida/)` tras «Entrar en Adaptaula».
  - Este bloque no modifica ningún test: todos los selectores de la E2E siguen valiendo.
- **Riesgos:**
  - La revisión manual con teclado y lector de pantalla sigue pendiente (Fase 7). axe solo cubre lo automatizable.
  - Las redirecciones son temporales (307) y se retiran cuando cada pantalla tenga contenido.
  - Cualquier `loading.tsx` nuevo debe respetar ADR-024 para no convertir 404 en 200.
- **Publicación:** la implementación (`5bb9cc1`) y este registro están en `claude/variables-expuestas-repo-f2o2et`, subidos por Git como *fast-forward* desde `1e94a8d`, que ya estaba en `main` a través de #25. A petición del usuario se abrió la [PR #29](https://github.com/TinyChat-up/ADAPTAULA/pull/29) hacia `main`. Sin merge.
- **Siguiente acción:**
  1. Revisar la PR #29 y, si se aprueba, integrarla. La integración la hace una persona.
  2. En un bloque propio, poner al día los E2E anteriores: la copy y el recorrido actuales de Hacer magia; un *seed* imprimible; esperar el estado «analizando» antes de leer la cuota; el nombre de descarga, comprobado en `Content-Disposition` o con el navegador fijado; localizar un visual concreto; aceptar «Revisar» en `free-plan`; y la espera tras el onboarding en `signUpAndOnboard`.
  3. Después, retomar la prioridad de Hacer magia del ROADMAP.

## 2026-10-13 — Fase 8.2B.5: selección única basada en tablas

- **Base verificada:** `git fetch origin main`, merge `bb38cd0` de **PR #27** y ascendencia de `4007e19`/`26904dc`. Rama nueva desde main actualizado: `phase8/seleccion-unica-tablas`. #27 ya está integrada; se corrige su estado en los documentos de continuidad. La consulta de PR abiertas por API sigue bloqueada (`Forbidden`), sin inferir su estado.
- **Fallo reproducido antes de producción:** fixture de animales/alimentación con tabla representada como imagen perdida terminaba sin sustitución; una tabla nativa no generaba necesidad visual y evitaba la corroboración. Dos pruebas fallaron antes del cambio (`/tmp/adaptaula-table-before.log`).
- **Implementación:** `adaptation/table-choice.ts` separa la relación entre celdas de la comprobación de fracciones, compartiendo controles literales en `single-choice.ts`. `materials/visuals/auto/table.ts` corrobora hash, página, cuadrícula, segmentos de bordes y texto de todas las celdas contra el PDF. La política exige evidencia también para tablas nativas y recortes listos; añade resultado tabular/evidencia al contrato visual, conserva tabla/opciones/consigna/ids/enlaces/clave y se detiene si falla. Prompt nuevo inmutable `visual-substitute/v4.ts`, salida estricta y códigos seguros; hasta dos intentos por actividad/ejecución, sin recibir clave ni aprobación intermedia. Las fracciones conservan v3; otros formatos v2.
- **Decisión/alcance (ADR-023):** solo consulta literal reconocida `Según la tabla, ¿qué {columna} corresponde a «{fila}»? Elige una opción.`, primera columna identifica filas, 2–6 columnas, 1–12 filas, sin celdas vacías, encabezados/filas ambiguos ni unidad separada, opciones textuales del vocabulario de la columna y una sola coincidente con clave `source`. Se rechazan inferencias, alternativas numéricas o ajenas a la columna, sinónimos/equivalencias, claves inferidas y modificaciones incompatibles. La tabla permanece necesaria para resolver la actividad.
- **Pruebas:** fixtures sintéticos y mocks en `tests/support/table-choice-case.ts`, unitarias/contrato de proveedor en `table-choice.test.ts` y `table-choice-prompt.test.ts`, orquestador real con PGlite local y fuente PDF en `tests/db/magic-visual-policy.test.ts`. Cubren dato correcto y otra fila/columna, celdas alteradas/ausentes/combinadas, encabezados ambiguos, dos o cero respuestas, clave contradictoria, filtración de solución, fuente inventada/no corroborada/hash cambiado, corrección válida en segundo intento y dos fallos con parada honesta. La integración verifica `ready` e imprimible o `blocked` sin entrega/consumo; registra versión 4 e intentos. Sin Supabase remoto.
- **Resultados:** **133 pruebas focalizadas en 10 archivos PASS** (132 juntas y revalidación del área al añadir un caso y endurecer bordes; no suite completa); **3 PDF Chromium PASS** (tabla, selección de fracciones y regresión de ficha de fracciones); `pnpm typecheck` PASS; `pnpm lint` sin errores, un aviso previo en `tests/unit/analysis-run-auth.test.ts`; `git diff --check` PASS. Comandos reproducibles:

  ```bash
  pnpm exec vitest run tests/unit/table-choice.test.ts tests/unit/table-choice-prompt.test.ts tests/unit/single-choice-substitution.test.ts tests/unit/single-choice-prompt.test.ts tests/unit/visual-substitution.test.ts tests/unit/pedagogical-equivalence.test.ts tests/unit/magic-visual-policy.test.ts tests/db/magic-visual-policy.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts
  pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/table-choice-substitution.test.ts tests/pdf/single-choice-substitution.test.ts tests/pdf/automatic-visuals.test.ts
  pnpm typecheck
  pnpm lint
  ```

- **PDF inspeccionado:** `.pdf-smoke/table-choice-substitution/sheet.pdf`, una página con encabezados contrastados, filas alineadas, tabla/pregunta/opciones juntas, tres círculos vacíos, clave y notas docentes ausentes. No se modifica CLARO ni la tipografía. Se reutiliza la normalización del glifo de paréntesis de Inter únicamente en la extracción del test, no en producto.
- **Markdown actualizados:** PROJECT_STATUS, DEVELOPMENT_LOG, ROADMAP, ARCHITECTURE (ADR-023), VISUAL_RESOURCES y PROMPTS. AGENTS/CLAUDE siguen coherentes con sus enlaces al contexto compartido, sin duplicar el estado.
- **Riesgos y pendiente real:** la evidencia compara estructura y capa de texto del PDF con posición/tinta, **no OCR independiente de los glifos**; no certifica capas de texto falsas ni corrobora aquí la transcripción de pregunta/clave. Escaneos, tablas sin cuadrícula, celdas multilínea, tablas duplicadas y paráfrasis desconocidas se detienen. Cobertura conservadora, aún pendiente IA real y runtime Vercel. Sin migraciones, SQL remoto, llamadas de pago, cambios de Stripe/Max/planes/precios/cuotas ni auditoría económica. La compilación bloqueada por Google Fonts no se repite ni se cambia el producto para sortearla.
- **Publicación:** implementación `1cc8833`, rama `phase8/seleccion-unica-tablas` subida por Git HTTPS. `gh pr create --base main --head phase8/seleccion-unica-tablas` falla con `Post https://api.github.com/graphql: Forbidden`; **PR no creada desde este entorno**. [Abrir formulario de PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/seleccion-unica-tablas). Título preparado: «Fase 8.2B.5: selección única de tablas corroboradas»; descripción local en `/tmp/adaptaula-table-pr.md`. Sin merge.
- **Siguiente acción:** revisar esta rama/PR y el PDF; después ampliar solo una variante verificable de consulta con sus fixtures/evidencia. Validar IA real/Vercel en una tarea posterior autorizada, sin presentar mocks como validación remota.

## 2026-10-13 — Fase 8.2B.4: selección única en la sustitución visual

**Estado actualizado en 8.2B.5:** PR #27 integrada en `bb38cd0`, verificado por Git. Los detalles de publicación siguientes reflejan el bloqueo original de esa sesión.

- **Precondición verificada:** PR #26 integrada en `main` / `d665d5b`, comprobada con `git fetch origin main`, mensaje de merge y ascendencia de `65515a8`. La consulta por API sigue devolviendo `Forbidden`; no se infiere el estado de otras PR. Rama nueva: `phase8/seleccion-unica-automatica`.
- **Problema reproducido antes de modificar producción:** dos pruebas fallaban. Una imagen perdida con opciones A/B/C y clave `B` no permite al generador existente deducir su fracción; la sustitución rechazaba `select_option` con `no_equivalent_activity`. No era la parada `needs_decision` del planificador.
- **Contrato descubierto:** análisis sin campo estructurado de opciones, alternativas en texto y clave en `expected_answer`; documento con `choice`, `multiple`, ids y `answer_key`; renderer CLARO ya compatible. No hay migración ni versión nueva de esos contratos.
- **Implementación:** `src/lib/adaptation/single-choice.ts` extrae listas explícitas y valida coherencia matemática; `prompts/visual-substitute/v3.ts` propone geometría y conserva opciones, sin recibir clave. Integrado en `auto/assistants.ts`, `auto/policy.ts`, `pedagogical-equivalence.ts`, `substitution-feedback.ts` y `visual-policy.ts`. Se mantiene v2 para otros formatos y el máximo de dos intentos. La aplicación conserva claves, ids, enlaces y procedencia, con opciones en el contrato existente de respuesta.
- **Alcance deliberado (ADR-022):** lectura de fracción coloreada en barras/círculos, consigna reconocida, 2–8 alternativas fraccionarias en listas consecutivas A)…H), clave inequívoca. Se mantienen etiquetas/textos/orden, número de partes y una sola respuesta correcta. Se rechazan cambios de opciones/solución, pistas, complementos, claves ambiguas y transformaciones previas incompatibles. No implementa conversiones de preguntas abiertas, selección múltiple ni otros formatos.
- **Pruebas nuevas:** fixture y PDF sintéticos en `tests/support/single-choice-case.ts`; unitarias en `single-choice-substitution.test.ts` y `single-choice-prompt.test.ts`; integración con orquestador y migraciones reales sobre **PGlite local del entorno cloud**, sin Supabase remoto; PDF con Chromium en `tests/pdf/single-choice-substitution.test.ts`. Asistentes simulados en todos los casos.
- **Resultados:** `pnpm typecheck` PASS; ESLint focalizado en los 12 archivos TypeScript afectados PASS; 103 pruebas/8 archivos PASS; 2 PDF/2 archivos PASS; `git diff --check` PASS. Regresión existente de fracciones incluida. Comandos reproducibles:

  ```bash
  pnpm exec vitest run tests/unit/single-choice-substitution.test.ts tests/unit/single-choice-prompt.test.ts tests/unit/pedagogical-equivalence.test.ts tests/unit/magic-visual-policy.test.ts tests/unit/visual-substitution.test.ts tests/db/magic-visual-policy.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts
  pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/single-choice-substitution.test.ts tests/pdf/automatic-visuals.test.ts
  ```

- **PDF inspeccionado:** una página, pregunta/barra/opciones juntas, círculos sin marcar, sin clave ni notas docentes. El extractor pdf.js representa el paréntesis alternativo de Inter como U+E082; el test normaliza ese glifo solo al comprobar texto extraído y verifica además el HTML literal. El paréntesis se ve correctamente en la página renderizada. No se cambia la tipografía del producto.
- **Documentación compartida actualizada:** PROJECT_STATUS, ROADMAP, ARCHITECTURE (ADR-022), VISUAL_RESOURCES, PROMPTS y este registro. AGENTS/CLAUDE ya enlazan estos documentos y conservan el protocolo común, sin duplicarlo.
- **Pendiente real:** eficacia del prompt con proveedores reales, calidad del análisis de nuevas fuentes y runtime en Vercel. La comprobación matemática prueba coherencia con análisis/clave, no que un original ilegible se haya transcrito correctamente. No se ejecutaron llamadas pagadas, SQL remoto, migraciones, Stripe ni cambios comerciales. No se repitió toda la suite ni la compilación bloqueada por Google Fonts.
- **Publicación:** implementación subida en `26904dc`, rama `phase8/seleccion-unica-automatica`. `gh pr create` falló con `Post https://api.github.com/graphql: Forbidden`: **PR no creada desde este entorno**. [Abrir el formulario de PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/seleccion-unica-automatica). Título preparado: «Fase 8.2B.4: selección única verificable en Hacer magia»; alcance y validación constan en esta entrada. Sin merge automático.
- **Siguiente acción:** revisar esta rama/PR; después diseñar un fixture y verificador para una segunda clase de selección única (lectura de un dato de tabla), preservando opciones, clave y trazabilidad. No habilitar selección genérica solo por la declaración de un modelo.

## 2026-10-13 — Sustitución pedagógica con corrección acotada

- **Base:** `main` / `6c91552`; inspeccionadas las integraciones #24 (equivalencia) y #25 (ilustraciones, contratos y costes). `origin/main` actualizado antes de crear la rama `phase8/sustitucion-pedagogica-acotada`.
- **Problema reproducido:** la sustitución podía convertir formatos cerrados en escritura, añadir una operación o perder restricciones; el segundo intento repetía la misma petición sin indicar el fallo. Ocho casos nuevos fallaban antes del cambio.
- **Implementación:** controles en `pedagogical-equivalence.ts`; códigos de rechazo permitidos en `substitution-feedback.ts`; prompt inmutable nuevo `visual-substitute/v2.ts`; conexión y corrección en `auto/assistants.ts` y `auto/policy.ts`. Máximo existente de dos intentos, sin reintentar una negativa explícita o error permanente como corrección pedagógica. Los errores transitorios mantienen el mecanismo de reintento del job.
- **Pruebas:** equivalencia y política visual unitarias, frontera del prompt/proveedor y orquestación sobre PGlite. Asistentes simulados; sin Anthropic/OpenAI reales. La integración comprueba rechazo → corrección → ficha imprimible y registros de ambos intentos.
- **Documentación:** nuevos `PROJECT_STATUS.md` y este registro; prioridades en `ROADMAP.md`, decisión ADR-021 en `ARCHITECTURE.md`, contrato en `VISUAL_RESOURCES.md` y `PROMPTS.md`; enlaces de continuidad en `AGENTS.md` y `CLAUDE.md`. Se reutilizan los documentos existentes en lugar de duplicar decisiones o próximos pasos.
- **Validación real pendiente:** rendimiento pedagógico del prompt v2 con modelos reales, imágenes generadas y Vercel. No se ejecutó SQL remoto, no hay migración nueva ni cambios de facturación.
- **Cierre de calidad:** por petición expresa del usuario se limita la verificación al área modificada, typecheck, lint y una regresión PDF; no se vuelve a ejecutar `pnpm check` completo. El bloqueo de red de Google Fonts sigue documentado, sin modificar fuentes del producto.
- **Resultados:** `pnpm typecheck` PASS; ESLint sobre los nueve archivos TypeScript afectados PASS; `pnpm exec vitest run tests/unit/pedagogical-equivalence.test.ts tests/unit/magic-visual-policy.test.ts tests/unit/visual-substitution.test.ts tests/db/magic-visual-policy.test.ts` **60/60 PASS**; `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/automatic-visuals.test.ts` **1/1 PASS** (PDF real de dos páginas, geometría y espacios vacíos conservados). `git diff --check` PASS. Estos resultados no certifican llamadas reales ni el despliegue.
- **Riesgos:** controles lexicales conservadores (pueden rechazar paráfrasis válidas), no una demostración completa de equivalencia; los formatos cerrados sin representación compatible terminan honestamente. El límite de dos intentos es por actividad/ejecución; los reintentos técnicos del job siguen su presupuesto existente.
- **Publicación:** rama subida a GitHub; implementación y pruebas en `8ad483e`. `gh pr create --base main --head phase8/sustitucion-pedagogica-acotada` falló con `Post https://api.github.com/graphql: Forbidden` (también se bloquean consultas REST). **PR no creada**; [abrir el formulario de PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/sustitucion-pedagogica-acotada). No se ha realizado merge. El bloqueo es acceso a la API desde el entorno, no una prueba de credenciales inválidas.
- **Siguiente acción exacta:** abrir/revisar la PR de esta rama cuando esté disponible GitHub, leer estado y roadmap y comprobar main/PR abiertas. Después, reproducir con fixture una selección única que hoy requiere decisión y diseñar su ejecutor conservando opciones y clave; implementar solo ese formato.
