# Estado compartido de Adaptaula

Actualizado: 2026-10-14. Base revisada: `main` en `1929849` (**PR #29 integrada**; #27 y #28 también, en `bb38cd0` y `70fb9ea`), comprobada por Git.
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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: aceptación automática retirada tras falsos positivos (ADR-027); falta evidencia independiente de identidad/asociación; ampliar evaluaciones |
| Hacer magia | Plan automático, ensamblado, revisión y autocorrección, entrega o parada explicada | Algunos formatos cerrados, simplificación y reorganización aún carecen de ejecutores automáticos; no añadir aprobación intermedia como solución |
| Visuales originales | Recortes, localización automática acotada, reconstrucción determinista de figuras compatibles y selección humana sobre escaneos; bloqueo de recortes scan inseguros heredados | La fase 8.2B.6 NO está completada: páginas sin texto se rechazan automáticamente; no ampliar cobertura sin contrato de evidencia |
| Ilustraciones IA | PR #25: brief, generación, revisión, activo privado, contrato visual, gate y presupuesto | Generación real de imágenes aún sin validar; pruebas existentes usan proveedores simulados |
| Sustitución pedagógica | PR #26: equivalencia y corrección acotada. PR #27: selección única de fracciones. PR #28: consulta literal de celdas de tablas corroboradas contra PDF | Alcance acotado por ADR-023: cuadrícula, texto verificable y consigna explícita. Sin escaneos, inferencias, equivalencias numéricas ni unidades separadas. Calidad de prompts v2/v3/v4 con modelos reales pendiente |
| Presentación y PDF | CLARO, apoyos junto a actividades, render compartido, validación y descarga PDF | Calidad de cada imagen real y runtime PDF en Vercel pendientes de comprobación; no se promete soporte universal |
| Interfaz y navegación | ADR-024 + ADR-025: navegación simplificada, redirecciones, filtros y cuenta conservados; identidad editorial, demo A4 rotulada y mesa de trabajo con cuotas secundarias; filas, controles contrastados y movimiento funcional con `prefers-reduced-motion` | Revisión manual con teclado y lector de pantalla (Fase 7). Cinco E2E anteriores a este bloque están desactualizados (ver registro) |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- El bloqueo anterior de Google Fonts no se reproduce en esta sesión de la PR #29: `pnpm build` PASS sin modificar fuentes, configuración de red ni dependencias.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #27 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama única: `claude/fase-8-2b6-escaneos`, PR #30, base `1929849`; cabeza auditada `ccfbf3e`, verificada contra remoto y referencia de PR. El bloque es una **auditoría y corrección**, no una fase nueva.

**Hallazgos demostrados:** aceptación a 0,75 de regiones equivocadas/contaminadas o sin etiquetas; los activos scan antiguos podían entregarse sin nueva revalidación; bytes precargados se recortaban sin cotejar el hash del localizador efectivo. Informe y fixtures en [docs/qa/pr30](qa/pr30/README.md).

**Corregido (ADR-027, sustituye ADR-026):**
- `scan_identity_gate@v2` rechaza páginas sin capa de texto; `auto_visuals@v4` evita el caché v3. No hay evasión por visión o corroboración de forma.
- Se excluyen activos automáticos con evidencia scan de vistas, bytes, pins, listado y reintento, preservando trazabilidad y corrección manual.
- Hash de fuente precargada verificado; modelos de 200 ppp liberados por página; eliminada la heurística de componentes que no podía probar identidad.
- Se conserva la selección humana y el localizador con capa de texto. Sin migraciones, SQL remoto, modelos nuevos, cambios comerciales o de PDF.

**Probado localmente:** 154 pruebas focalizadas en 13 archivos y 4 PDF Chromium PASS; typecheck PASS; lint sin errores, un aviso previo. Fixture completo de Hacer magia: figura de otra actividad → bloqueo visual, sin entrega/descarga y cuota sin consumir. No suite completa ni llamadas pagadas.

**Estado de producto:** la localización automática de escaneos permanece **no resuelta**. No se garantiza identidad, pertenencia, etiquetas o completitud con tamaño/tinta/unicidad. La aceptación del fixture correcto anterior se retira deliberadamente; el PDF de célula ahora verifica selección manual.

**Publicación:** correcciones en la misma [PR #30](https://github.com/TinyChat-up/ADAPTAULA/pull/30), sin otra PR ni merge.

**Recomendación y siguiente acción:** **NO MERGE como fase terminada de localización automática.** Revisar #30 con el alcance corregido de endurecimiento y restricción, antes de integrar. No presentar 8.2B.6 como validada. El siguiente trabajo requerirá definir evidencia independiente; no ampliar el algoritmo en esta auditoría. Vercel, escaneos reales y auditoría general de páginas híbridas siguen sin validar.
