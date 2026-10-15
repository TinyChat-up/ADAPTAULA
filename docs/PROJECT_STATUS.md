# Estado compartido de Adaptaula

Actualizado: 2026-10-15. Base revisada: `main` en `ae603e6` (**PR #35 integrada**, Fase I de OCR; #27–#34 también), comprobada por Git.
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
| Interfaz y navegación | ADR-024 + ADR-025: navegación simplificada, redirecciones, filtros y cuenta conservados; identidad editorial, demo A4 rotulada y mesa de trabajo con cuotas secundarias; filas, controles contrastados y movimiento funcional con `prefers-reduced-motion` | Revisión manual con teclado y lector de pantalla (Fase 7). Cinco E2E anteriores a este bloque están desactualizados (ver registro) |
| Datos, legal y corpus | Buckets privados con RLS por workspace, validación de bytes, logger sin contenido, `ai_runs` sin contenido. Contrato y reglas de admisión al corpus de mejora (ADR-028), registro sintético y borradores de `/privacidad` y `/terminos` | Sin registro de aceptación ni autorizaciones, sin limpieza de metadatos de originales, sin borrado de cuenta, exportación ni job de retenciones, y garantías de proveedores sin verificar ([auditoría](legal/AUDITORIA_DATOS.md)). Revisión jurídica pendiente ([lista](legal/REVISION_ESPECIALISTA.md)) |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- En la sesión anterior de PR #29, `pnpm build` PASS sin modificar fuentes, configuración de red ni dependencias. Este cierre no repite el build.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #27 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama: `claude/fase-2-geometria-figuras`, desde `main` en `ae603e6` (PR #35 integrada; verificado con `git merge-base`).

**Bloque: Fase II · recuperación geométrica de figuras.** Solo `evals/visual-location`, sus pruebas y la documentación.
Informe en [docs/qa/geometria-fase2](qa/geometria-fase2/README.md).

- **Implementado:** `geometry.ts`, `locate-v2.ts` (`figure_geometry@v2`), `geometry-cases.ts` y `geometry-eval.ts`
  (`pnpm eval:geometry`). Es un localizador autónomo **sin región de entrada** que:
  - endereza con el giro del OCR y devuelve las regiones al original;
  - usa zonas por columna y ancla exacta o tolerante;
  - agrupa la figura con sus partes y etiquetas;
  - excluye reglas verticales y sombras de escáner;
  - aplica firmas robustas: barra (rechaza tablas), recta (rechaza barras), esfera, polígono y cuadrícula.
- **Probado:**
  - **Corpus de diez fichas sintéticas (desarrollo):** candidatas correctas 1/10 → **9/10**, con 0 erróneas y 0 incompletas; 09
    queda bloqueada por OCR.
  - **Desarrollo geométrico:** 5/6 correctas y 5/5 negativas rechazadas.
  - **Reserva geométrica**, ejecutada una vez: 0/6 → **2/6**, con 1 candidata en una negativa (respuesta dibujada).
  - **Recortes aprobados:** 0 en todas las ejecuciones.
  - **Pruebas focalizadas:** 144/144; typecheck y lint correctos.
- **Pendiente:** grano y fotocopia muy degradada, ejes partidos, contornos vacíos sin forma nombrada, figuras genéricas (semántica),
  respuestas dibujadas, escaneos físicos reales y Vercel.
- **No se hizo:** cambios en `src/`, Hacer magia, MaterialAnalysis, PDF, Supabase, Stripe, páginas legales o UI; llamadas de pago;
  entrenamiento; subida del corpus a Git.

**Siguiente acción:** fase de calidad pedagógica (ROADMAP §11). Las candidatas siguen bloqueadas: ninguna entrega automática sin
una verificación semántica independiente.
