# Estado compartido de Adaptaula

Actualizado: 2026-10-16. Base de la entrega actual: `origin/main` en `330cb4f`, **PR #40 integrada**, confirmado por API e historial Git. Rama nueva `codex/adaptaula-2-comparacion-editor`. No se ha hecho merge en esta sesión.
Los estados siguientes describen código inspeccionado; no implican validación de servicios externos.

## Lectura para continuar

- Prioridades y criterios de aceptación: [ROADMAP.md](ROADMAP.md). Es el equivalente a `NEXT_STEPS.md`.
- Decisiones: ADR de [ARCHITECTURE.md](ARCHITECTURE.md). Es el equivalente a `DECISIONS.md`.
- Trabajo y verificaciones de cada sesión: [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).
- Reglas para agentes: [AGENTS.md](../AGENTS.md) y [CLAUDE.md](../CLAUDE.md).

## Estado por módulo

| Módulo | Implementado | Pendiente o límite |
| --- | --- | --- |
| Auth, workspace y perfiles | Supabase, workspace personal, permisos y perfiles funcionales | Revalidar integraciones contra el entorno real; las pruebas locales no certifican la configuración remota |
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: aceptación automática retirada tras falsos positivos (ADR-027). La auditoría de 8.2B.7 muestra que propuesta + OCR + geometría solo generan candidatos, sin demostrar identidad. Piloto OCR local (`evals/ocr-pilot`), Fase I sobre diez fichas sintéticas: etiquetas 43/44 sin espurias y consignas 19/20 sin asociaciones incorrectas; Fase II de geometría (prototipo): 9/10 candidatas correctas en desarrollo y 2/6 en la reserva independiente; ningún recorte aprobado; falta corpus real autorizado |
| Hacer magia | Plan automático, ensamblado, revisión y autocorrección, entrega o parada explicada | Algunos formatos cerrados, simplificación y reorganización aún carecen de ejecutores automáticos; no añadir aprobación intermedia como solución |
| Visuales originales | Recortes, localización automática acotada, reconstrucción determinista de figuras compatibles y selección humana sobre escaneos; bloqueo de recortes scan inseguros heredados | La fase 8.2B.6 NO está completada: páginas sin texto se rechazan automáticamente; no ampliar cobertura sin contrato de evidencia |
| Ilustraciones IA | PR #25: brief, generación, revisión, activo privado, contrato visual, gate y presupuesto | Generación real de imágenes aún sin validar; pruebas existentes usan proveedores simulados |
| Sustitución pedagógica | PR #26: equivalencia y corrección acotada. PR #27: selección única de fracciones. PR #28: consulta literal de celdas de tablas corroboradas contra PDF | Alcance acotado por ADR-023: cuadrícula, texto verificable y consigna explícita. Sin escaneos, inferencias, equivalencias numéricas ni unidades separadas. Calidad de prompts v2/v3/v4 con modelos reales pendiente |
| Presentación y PDF | CLARO, apoyos junto a actividades, render compartido, validación y descarga PDF | Calidad de cada imagen real y runtime PDF en Vercel pendientes de comprobación; no se promete soporte universal |
| Interfaz y navegación | ADR-030: fundamentos Adaptaula 2.0. ADR-031: workspace original (2A). ADR-032: comparación privada y edición contextual CLARO (2B), borrador guardado distinguido de generada | 2B pendiente de revisión; rediseño específico de pantallas y modo oscuro en siguientes entregas. Pruebas automáticas no equivalen a auditoría WCAG completa |
| Datos, legal y corpus | Buckets privados con RLS por workspace, validación de bytes, logger sin contenido, `ai_runs` sin contenido. Contrato y reglas de admisión al corpus de mejora (ADR-028), registro sintético y borradores de `/privacidad` y `/terminos` | Sin registro de aceptación ni autorizaciones, sin limpieza de metadatos de originales, sin borrado de cuenta, exportación ni job de retenciones, y garantías de proveedores sin verificar ([auditoría](legal/AUDITORIA_DATOS.md)). Revisión jurídica pendiente ([lista](legal/REVISION_ESPECIALISTA.md)) |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- Verificación de 2B y capturas en [QA](qa/adaptaula-2-etapa-2b/README.md); las pruebas anteriores de 2A se conservan como antecedentes. Se mantiene Google Fonts sin cambios; no se valida el runtime de Vercel.
- Git y la API de GitHub están disponibles. #40 confirmada MERGED; esta entrega no modifica otras PR.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

**Adaptaula 2.0, etapa 2A: workspace documental**, rama `codex/adaptaula-2-workspace`, desde `a6474a7`. [PR #40](https://github.com/TinyChat-up/ADAPTAULA/pull/40) abierta, sin merge.

- Original central en las rutas de material y preparación de adaptación, sin duplicar operaciones ni estados. Visor con una página privada cada vez, zoom, ajustar al ancho, descarga/apertura del original y recuperación ante error.
- Panel opcional que conserva formularios y seguimiento al ocultarse; acceso directo a apoyos/estado, adaptación al ancho disponible y controles táctiles.
- Subida renovada por arrastre/explorador, nombre/peso, validación existente y fases reales. Resumen de apoyos procedente del perfil funcional guardado. Datos, actividades y opciones secundarias desplegables.
- Mismos permisos de servidor. La UI de solo lectura no ofrece edición de contexto/reintentos/borrado ni despacha análisis en cola; sí observa su estado. CLARO y su PDF no cambian.

[Dirección integral](ADAPTAULA_2.md) · [QA, capturas y límites de 2A](qa/adaptaula-2-etapa-2a/README.md). Verificación local: 146 pruebas focalizadas, nueve PDF y 40 escenarios E2E distintos PASS; typecheck, lint y build PASS (un aviso previo de lint). No validación de servicios remotos ni del generador real. No APIs pagadas, prompts/modelos, migraciones, cuotas, Stripe ni recopilación.

**Siguiente:** revisar e integrar 2A antes de empezar 2B (editor contextual y comparador). No construir una rama incompatible ni hacer merge automático. Los nuevos precios y el modo oscuro siguen en sus etapas posteriores.

## Antecedente — entrega del editor de #38 (ya integrada)

Rama: `codex/editor-docente-claro`, nueva desde `origin/main` / `b192735`. El usuario indicó #37 abierta, pero el remoto ya contiene su merge; esta sesión no la modifica ni la fusiona.

**Bloque: editor docente mínimo operativo**, sin otra fase experimental ni llamadas de pago.

- Desde la ficha entregada: «Editar ficha». Enunciados de actividades, letra, separación, contraste y líneas/tamaño de caja de respuesta.
- Vista A4 en directo con CLARO, ajustable al ancho o a tamaño real. Misma proyección pura `sheetModel`, mismos componentes y CSS para vista y PDF.
- Deshacer/rehacer (50 cambios), guardar borrador, recuperar el último guardado y descargar exactamente esa revisión. Se bloquea la descarga de cambios sin guardar.
- Los borradores son revisiones inmutables separadas, compartidas dentro del espacio autorizado. Nunca sustituyen `adaptation_versions`, el documento generado, su revisión ni el PDF original.
- Todo cambio de enunciado se trata como contenido pedagógico: aviso y reconocimiento explícito de que debe comprobarse. No equivale a revisión/validación docente ni automática. Tablas, imágenes, opciones, claves, pasos, requisitos y vínculos quedan fuera de la edición.
- Migración **025** incluida, probada solo en PGlite local; no aplicada en Supabase remoto. RLS, escritura mediante RPC de sesión con rol de escritura, revisión/base optimistas y trazabilidad por autor/fecha. Sin clientes admin nuevos.
- Pruebas con documentos sintéticos: persistencia, conflictos, RLS, undo/redo, integridad, PDF Chromium y flujo de navegador en ordenador/móvil; detalle y capturas en [editor docente](qa/editor-docente/README.md).

**Límites:** sin autosave, edición de pasos/tablas/figuras, reordenación ni publicación del borrador como nueva versión generada. Se recupera el último guardado; la exploración de todo el historial queda pendiente. La vista muestra páginas lógicas A4; el PDF determina la paginación física final. Se mantiene el mínimo de espacio exigido por una consigna de escritura. No se garantiza detectar respuestas o cambios semánticos introducidos manualmente: el docente debe comprobarlos.

**Siguiente acción:** revisar esta primera entrega y, tras integrarla y aplicar 025 por el procedimiento habitual, probar el editor con docentes antes de ampliar los campos editables. Las pruebas pagadas y los experimentos de evaluación quedan pospuestos. Sin cambios en prompts/modelos, Stripe, producción desplegada, Supabase remoto ni recopilación de correcciones.

**Publicación:** implementación `458d79e` subida a `codex/editor-docente-claro`. Crear la PR devolvió `Forbidden` tanto con GraphQL (`gh pr create`) como con REST POST `/pulls`. No hay PR nueva confirmada ni merge. [Abrir PR con esta rama](https://github.com/TinyChat-up/ADAPTAULA/pull/new/codex/editor-docente-claro); descripción lista en `/workspace/artifacts/editor-docente/DESCRIPCION_PR.md` y capturas en la documentación de la entrega.
