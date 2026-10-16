# Estado compartido de Adaptaula

Actualizado: 2026-10-15. Base de la entrega actual: `origin/main` en `7e5ef52`, **PR #38 integrada** (editor CLARO); #37 también está integrada por historial Git. Sin merge realizado en esta sesión. Consulta final por API disponible: #38 MERGED, #20 es la única PR abierta antes de publicar esta entrega; no se modifica.
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
| Interfaz y navegación | ADR-030: fundamentos Adaptaula 2.0, tokens, navegación plegable/móvil, contexto por ruta y preferencias de accesibilidad; conserva filas, filtros, cuenta y CLARO | Workspace documental unificado, comparación real, rediseño específico de pantallas y modo oscuro en siguientes entregas. Pruebas automáticas no equivalen a auditoría WCAG completa |
| Datos, legal y corpus | Buckets privados con RLS por workspace, validación de bytes, logger sin contenido, `ai_runs` sin contenido. Contrato y reglas de admisión al corpus de mejora (ADR-028), registro sintético y borradores de `/privacidad` y `/terminos` | Sin registro de aceptación ni autorizaciones, sin limpieza de metadatos de originales, sin borrado de cuenta, exportación ni job de retenciones, y garantías de proveedores sin verificar ([auditoría](legal/AUDITORIA_DATOS.md)). Revisión jurídica pendiente ([lista](legal/REVISION_ESPECIALISTA.md)) |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- En la sesión anterior de PR #29, `pnpm build` PASS sin modificar fuentes, configuración de red ni dependencias. Este cierre no repite el build.
- La API de GitHub estuvo bloqueada inicialmente, pero en la etapa 1 de Adaptaula 2.0 responde tras actualizar la red. #38 confirmada MERGED; #20 era la única PR abierta antes de publicar esta entrega. Git HTTPS también disponible.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

**Adaptaula 2.0, etapa 1**, [PR #39](https://github.com/TinyChat-up/ADAPTAULA/pull/39) abierta, sin merge. Rama nueva `codex/adaptaula-2-fundamentos`, desde `7e5ef52`. Se reutiliza el editor de #38. Tokens semánticos, componentes base, superficies sólidas/translúcidas acotadas, navegación lateral plegable con etiquetas, preferencia conservada entre recargas, ubicación por sección, barra móvil y diálogo accesible. La barra de acciones del editor y la cabecera pública adoptan las primitivas. [Dirección integral, etapas y política comercial pendiente](ADAPTAULA_2.md); [alcance, pruebas y capturas](qa/adaptaula-2-etapa-1/README.md).

No se implementa todavía el workspace/comparador completo, rediseño específico de cada pantalla, modo oscuro ni nueva migración comercial. Planes/cuotas efectivos permanecen en BD. No APIs pagadas, cambios remotos, Stripe, prompts/modelos ni segundo renderer. Próximo paso: revisar esta base y continuar etapa 2 sobre main actualizado cuando se integre.

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
