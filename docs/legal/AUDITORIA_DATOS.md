# Auditoría de datos y contenidos: implementado, documentado y pendiente

- **Fecha:** 2026-10-15.
- **Base:** `main` en `1d4d07c` (PR #33 integrada).
- **Alcance:**
  - código de `src/`, migraciones de `supabase/migrations/`, `vercel.json` y `evals/`;
  - `PRIVACY.md`, `SECURITY.md`, `AI_PIPELINE.md` y `ARCHITECTURE.md`.
- **Fuera de alcance:**
  - el proyecto Supabase remoto, la cuenta de Vercel y las consolas de Anthropic y OpenAI;
  - los contratos firmados.

  Lo que dependa de ellos queda como **no comprobado**.

Estados usados en esta auditoría:

- **Implementado:** el código o SQL del repositorio lo hace.
- **Documentado:** lo afirma un documento, pero no hay código que lo haga.
- **Pendiente:** no existe en ninguno de los dos.

Las rutas de código son del repositorio a esta fecha.

## 1. Subida y almacenamiento de materiales

| Aspecto | Estado | Evidencia |
| --- | --- | --- |
| Subida en dos pasos con token firmado de un solo uso | Implementado | `src/app/api/uploads/route.ts`, `src/lib/materials/service.ts` (`initUpload`) |
| Validación de los bytes: firma de PDF/JPEG/PNG/WEBP, tamaño real y páginas del PDF; si falla, se borran el objeto y las filas | Implementado | `src/lib/materials/file-validation.ts`; `service.ts` (`completeUpload`, `discardUpload`) |
| Nombre original guardado como metadato saneado (`material_files.original_name`) y usado como título inicial del material | Implementado | `service.ts`, `materials/config.ts` (`sanitizeOriginalName`) |
| SHA-256 de los bytes (`materials.content_hash`); el análisis solo se reutiliza dentro del mismo workspace | Implementado | `service.ts`, `src/lib/materials/hash.ts` |
| Buckets privados (`source-materials`, `generated-assets`, `exports`) con lectura limitada a miembros del workspace por la primera carpeta de la ruta; escritura solo con URL firmada o service role | Implementado (SQL del repo; **no comprobado en el proyecto remoto**) | `supabase/migrations/20261001000600_storage.sql` |
| URLs de lectura firmadas de 60 s | Implementado | `src/lib/materials/storage.ts` |
| **Eliminación de metadatos (EXIF, autor, GPS) del fichero subido** | **Pendiente** | El original se guarda tal cual. Solo se re-codifican a PNG las imágenes de recursos que añade el docente (`src/lib/adaptation/resources/image.ts`). Un PDF o una foto pueden llevar autor, dispositivo o geolocalización |
| Escaneo de malware | Pendiente; riesgo aceptado del MVP según la documentación | `AI_PIPELINE.md` |

## 2. Usuarios, workspaces y aceptación de condiciones

| Aspecto | Estado | Evidencia |
| --- | --- | --- |
| `profiles`, `workspaces` (propietario `ON DELETE RESTRICT`), `workspace_members` (owner, admin, teacher, viewer) | Implementado | `20261001000100_base_identity_workspaces.sql` |
| Perfiles de alumnado con alias, etapa, curso y perfil funcional; `notes` y `contextual_tags` eliminados | Implementado | migraciones `000300`, `000800` y `011` |
| **Registro de aceptación de términos o de la versión de la política leída** | **Pendiente** | No hay tabla, columna ni pantalla |
| **Autorizaciones opcionales** (evaluación interna o entrenamiento) | **Pendiente**; en esta PR solo existe el contrato tipado | `src/lib/schemas/improvement-corpus.ts` (sin uso en producción) |

## 3. Conservación y borrado

| Aspecto | Estado | Evidencia |
| --- | --- | --- |
| Cron diario que borra las subidas abandonadas (más de 60 min en `uploading`): objeto y filas | Implementado | `src/app/api/cron/materials/route.ts` |
| Borrar un material: borra el original y la fila; se niega si existen adaptaciones (FK `RESTRICT`) | Implementado | `materiales/actions.ts` → `service.ts` (`deleteMaterial`) |
| Cascadas de base de datos: el workspace arrastra todos sus datos y la adaptación arrastra versiones, recursos, exportaciones y comentarios | Implementado (SQL) | `000400`, `001600`, `002200`, `002400` |
| Borrado de los **objetos** de Storage de `generated-assets` al borrar una adaptación | **Pendiente**: en `src/` solo se eliminan objetos de `source-materials` | Las filas caen en cascada, pero los ficheros pueden quedar huérfanos en el bucket |
| Borrado de una adaptación, de una cuenta o de un workspace desde la aplicación | **Pendiente**: se puede solicitar la baja, no ejecutarla | `account_deletion_requests` (027), RPC restringida por 028, `/api/account/deletion-request` |
| Exportar mis datos personales (JSON) | Implementado para espacio personal de miembro único, con límite de 500 filas por entidad, 2 MB de originales incrustados y 4 MB de respuesta; compartidos excluidos | `/api/account/export`, `src/lib/privacy/export.ts` |
| Opción «Eliminar originales automáticamente» a los 7, 30 o 90 días | **Documentado**, no implementado | — |
| Retención de 13 meses de `ai_runs` y `product_events` y de 24 meses de `audit_logs` | **Documentado**, no implementado | No existe ningún job de purga. `ai_runs` pasa a `SET NULL` al borrar workspace o material y se conserva indefinidamente (solo identificadores y métricas, sin contenido) |
| `history_days` del plan Free | **Documentado** en `plans.features`; no hay código que lo aplique | `supabase/seed.sql` |

## 4. Envío a proveedores de IA

| Aspecto | Estado | Evidencia |
| --- | --- | --- |
| **Análisis:** el PDF o la imagen originales completos (base64), con número de páginas y contexto confirmado por el docente; ningún dato del alumnado | Implementado | `src/lib/materials/analysis-job.ts`, `src/lib/ai/pipeline/analyze.ts`, `src/lib/ai/providers/anthropic.ts` |
| **Localización visual automática:** un PNG de la página renderizada | Implementado | `src/lib/materials/visuals/auto/vision.ts` |
| **Planificador, generador y revisor:** texto derivado del análisis más el contexto de adaptación (perfil funcional, etapa, curso, asignatura, tipo y petición del docente); nunca alias ni ids | Implementado | `src/lib/adaptation/context.ts`, `planner.ts`, `generator.ts`, `reviewer.ts` |
| **Ilustraciones (OpenAI Images):** solo el prompt construido desde el brief | Implementado | `src/lib/ai/providers/openai-images.ts`, `visuals/illustrate/server.ts` |
| Ruta `images.edit`, que subiría imágenes de origen | Existe en el proveedor, sin llamador | `openai-images.ts` |
| `ai_runs`: solo ids, modelo, versión de prompt, tokens, coste, latencia y estado; sin contenido | Implementado | `src/lib/ai/run-record.ts` |
| «Configuraciones sin entrenamiento, retención mínima o nula, procesamiento en la UE cuando exista» | **Documentado** (`PRIVACY.md`, `AI_PIPELINE.md`), **no implementado en código y no comprobado en las cuentas** | Las llamadas no envían `inference_geo`, `store`, `metadata` ni ningún parámetro de retención. El resultado depende del contrato y la configuración de cada organización (ver [FINALIDADES_Y_CORPUS.md §6](FINALIDADES_Y_CORPUS.md#6-estado-real-de-los-proveedores)) |

## 5. Analítica y registros

| Aspecto | Estado | Evidencia |
| --- | --- | --- |
| Logger JSON que descarta claves sensibles (`name`, `email`, `content`, `text`, `prompt`, `answer`…) y oculta secretos | Implementado | `src/lib/logger.ts` |
| SDK de analítica o de errores (Sentry, PostHog, Vercel Analytics) | No existe | `package.json` |
| Tabla `product_events` | Existe en SQL; no se encontró código que escriba en ella | `000500_operations.sql` |
| «Vercel Web Analytics sin cookies» | **Documentado**, no instalado | `PRIVACY.md` |

## 6. Páginas legales

| Página | Estado |
| --- | --- |
| `/privacidad` | Antes de esta PR era un resumen de minimización con «Proveedores: pendiente», sin responsable, base jurídica, plazos ni derechos. **En esta PR se sustituye por un borrador estructurado** con los huecos marcados como pendientes |
| `/terminos` | Antes eran principios del producto con «pendiente de redactar». **En esta PR, borrador estructurado** |
| `/cookies` | Solo cookies necesarias. No se modifica |

Todas muestran el aviso «Borrador pendiente de revisión jurídica» (`src/components/marketing/legal.tsx`).

## 7. Evals y piloto OCR

| Área | Datos | Estado |
| --- | --- | --- |
| `evals/material-analysis` | Fichas reales solo en `private/` (ignorada por Git); el README pide fichas anonimizadas y autorizadas | No hay fichas reales en Git; no hay registro de autorizaciones |
| `evals/adaptation`, `evals/illustrations`, `evals/visual-location` | Sintéticos o simulados | Implementado |
| `evals/ocr-pilot` | 11 fixtures sintéticos en Git y 10 fichas **sintéticas** externas fuera de Git ([QA](../qa/ocr-anclas-etiquetas/README.md)) | Ver abajo |
| `evals/corpus` (esta PR) | 4 fichas sintéticas escritas para el registro de ejemplo | Implementado |

**Piloto OCR sobre las 10 fichas sintéticas externas** (PR #33, `ocr_pilot@audit3`):
- **Etiquetas:** 36/44 leídas; 7 perdidas, 1 confundida y 7 espurias.
- **Texto:** WER 11,6 %, CER 3,8 %.
- **Anclas (comparador exacto):** 16/20 encontradas, 15 asociadas correctamente, 1 sin verificar por columnas y 4 omitidas.
- **Geometría:** 1/10 candidatas y 0 aprobaciones.

Son fichas sintéticas con efectos de escaneo simulados: no validan escaneos reales y no se ha probado en Vercel.

## 8. Resumen de discrepancias que corregir

1. `PRIVACY.md` describía retenciones, exportación, borrado de cuenta, borrado automático de originales y analítica de Vercel como si existieran. **En esta PR se reetiquetan** como objetivos no implementados.
2. Las garantías de los proveedores (sin entrenamiento, retención, región) estaban escritas como configuración propia. Son condiciones contractuales sin verificar y ningún parámetro las impone en el código.
3. No hay metadatos eliminados de los originales, registro de aceptación de condiciones, borrado de cuenta ni purga de registros. Son requisitos previos para un lanzamiento comercial, no para esta PR.
