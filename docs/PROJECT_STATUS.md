# Estado compartido de Adaptaula

Actualizado: 2026-10-14. Base revisada: `main` en `f827001` (**PR #30 integrada**, endurecimiento de procedencia; #27–#29 también), comprobada por Git.
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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: aceptación automática retirada tras falsos positivos (ADR-027). Diseño 8.2B.7 en [propuesta](proposals/LOCALIZACION_FIGURAS_ESCANEOS.md): propuesta en el análisis + OCR local + contrato de verificación; pendiente del experimento real |
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

Rama: `claude/fase-8-2b7-identificacion-figuras`, desde `main` en `f827001`. PR #30 integrada (verificado con `git merge-base --is-ancestor`).

**Bloque: Fase 8.2B.7 · diseño de la identificación fiable de figuras en escaneos.** No cambia el comportamiento de producción.
- [Propuesta técnica](proposals/LOCALIZACION_FIGURAS_ESCANEOS.md): compara cuatro enfoques (A, B, C y D) y define el contrato de aceptación (11 comprobaciones), qué es verificable y qué sigue siendo hipótesis, riesgos, medición, experimento mínimo y costes estimados.
- **Recomendación:** el análisis inicial propone la ubicación (enfoque A), un OCR local da las anclas en escaneos y un verificador determinista acepta o bloquea, sin puntuación. Sin ADR hasta que haya resultados del experimento.
- **Prototipo aislado** (`evals/visual-location/`): contrato tipado, verificador, 11 fixtures sintéticos y arnés. No lo importa `src/`. 15 pruebas PASS.
  - Con OCR perfecto: 0 falsos positivos y 0 falsos negativos en 42 propuestas guionizadas.
  - Con OCR degradado: 0 falsos positivos y 5 falsos negativos.
  - El verificador se ajustó con esos mismos fixtures: no es una medida de precisión real.
- Sin llamadas a modelos, OCR real, migraciones, cambios de UI, Stripe ni planes.

**Siguiente acción:**
1. Revisar la propuesta.
2. Autorizar o no el experimento mínimo: 30 escaneos reales sin datos del alumnado; primero la fase sin modelo, después una ejecución de pago con tope.
3. Elegir el motor de OCR local tras medir su tamaño y su latencia en Vercel.
