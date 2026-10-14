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
- En la sesión anterior de PR #29, `pnpm build` PASS sin modificar fuentes, configuración de red ni dependencias. Este cierre no repite el build.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #27 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama única `claude/fase-8-2b6-escaneos`, PR #30, base `1929849`, referencia `d9f61a0`. **Alcance final: endurecimiento de procedencia y rechazo de recortes de escaneo no verificados. La fase 8.2B.6 permanece pendiente.**

- **Demostrado en main:** fuente precargada aceptada con SHA distinto de la revisión efectiva; acuerdo de visión aceptado sin ancla de actividad. Dos regresiones fallan contra `1929849` y pasan con la corrección.
- **Solo experimento de #30:** falsos positivos del criterio de figura única, motor v3 y evidencia scan. Se retira el módulo completo y se bloquean preventivamente esos activos. **No se ha comprobado su existencia en producción.**
- **Cierre defensivo:** metadatos completos, evidencia positiva, relación activo/localizador, receta, identidad y ruta privada; pins con localizador completo/RLS. Algunas pruebas simulan respuestas de persistencia defectuosas, no fallos explotables por usuarios. Humano admite evidencia null; ausencia no autoriza.
- **Contrato vigente:** `auto_visuals@v5`, ancla/zona obligatorias; sin texto no hay recorte automático, visión ni corroboración de forma. Selección humana y localización anclada conservadas. Sin migraciones, SQL remoto, OCR, modelos nuevos o cambios comerciales.
- **Simplificación:** eliminado `auto/scan.ts`, dos suites redundantes y variantes del generador de escaneos; integraciones agrupadas sin desactivar triggers. Fixtures adversariales y resultados históricos conservados para auditoría.
- **Verificación actual:** 149 pruebas focalizadas en 11 archivos, 3 PDF Chromium y typecheck PASS; lint sin errores, un aviso previo. Sin suite completa ni build. La célula del PDF usa selección manual.

**Recomendación: MERGE técnico únicamente como endurecimiento**, con el título/alcance corregidos. [Informe y delimitación frente a main](qa/pr30/README.md). La API GitHub devuelve `Forbidden`: título y descripción preparados en [PR_DESCRIPTION.md](qa/pr30/PR_DESCRIPTION.md); no se afirma su actualización remota. Los commits se publican en la misma rama; sin nueva PR ni merge. Antes de integrar, aplicar/verificar esos metadatos. La siguiente fase necesitará evidencia independiente; no está implementada. Sin validación de producción, escaneos reales o carga máxima en Vercel.
