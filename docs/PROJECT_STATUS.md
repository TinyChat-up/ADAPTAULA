# Estado compartido de Adaptaula

Actualizado: 2026-10-13. Base revisada: `main` en `70fb9ea` (**PR #28 integrada**, contiene `1cc8833` y `3965092`), comprobada por Git. Las PR #24–27 también están integradas.
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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Localización de figuras genéricas en escaneos sin anclas de texto; ampliar materiales de evaluación |
| Hacer magia | Plan automático, ensamblado, revisión y autocorrección, entrega o parada explicada | Algunos formatos cerrados, simplificación y reorganización aún carecen de ejecutores automáticos; no añadir aprobación intermedia como solución |
| Visuales originales | Recortes, localización automática acotada y reconstrucción determinista de figuras compatibles | No hay edición general de imágenes originales ni un localizador universal para escaneos |
| Ilustraciones IA | PR #25: brief, generación, revisión, activo privado, contrato visual, gate y presupuesto | Generación real de imágenes aún sin validar; pruebas existentes usan proveedores simulados |
| Sustitución pedagógica | PR #26: equivalencia y corrección acotada. PR #27: selección única de fracciones. Fase 8.2B.5 en esta rama: consulta literal de celdas de tablas corroboradas contra PDF | Alcance acotado por ADR-023: cuadrícula, texto verificable y consigna explícita. Sin escaneos, inferencias, equivalencias numéricas ni unidades separadas. Calidad de prompts v2/v3/v4 con modelos reales pendiente |
| Presentación y PDF | CLARO, apoyos junto a actividades, render compartido, validación y descarga PDF | Calidad de cada imagen real y runtime PDF en Vercel pendientes de comprobación; no se promete soporte universal |
| Interfaz y navegación | ADR-024: cinco entradas más «Plan y cuenta», sin pantallas «Próximamente» (retiradas con redirección); «Adaptaciones» con filtros por estado; inicio que cambia con el estado; esqueletos por sección; movimiento solo con `transform` y parado con `prefers-reduced-motion` | Revisión manual con teclado y lector de pantalla (Fase 7). Cinco E2E anteriores a este bloque están desactualizados (ver registro) |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- El bloqueo conocido de compilación es la descarga de Google Fonts por la red del entorno. No se modifica el producto para sortearlo ni se repite la compilación en esta fase.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #27 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama: `claude/variables-expuestas-repo-f2o2et`. Se reinició desde `main` en `70fb9ea` porque su PR #25 ya estaba integrada, así que no se apila nada sobre historia integrada.

**Bloque: UI/UX sin cambios de comportamiento (ADR-024).**
- Se retiran las pantallas «Próximamente» (Clases, Plantillas, Ayuda y Configuración), con redirección temporal.
- Configuración se funde en «Plan y cuenta» (`/app/uso`).
- Historial pasa a llamarse «Adaptaciones» y gana filtros.
- Se rediseñan inicio, shell, listas, web pública y acceso, con un sistema de movimiento que respeta `prefers-reduced-motion`.
- Sin migraciones ni cambios de datos, permisos, planes, cuotas, precios, IA, pipeline o PDF.

**Probado (local, con PGlite y proveedores simulados; sin servicios remotos ni llamadas de pago):**
- typecheck PASS.
- lint sin errores (un aviso previo).
- 62/62 unitarias de los 8 archivos afectados.
- E2E en escritorio y móvil, con axe y desbordamiento: 51 PASS en la pasada final. Las 10 que se saltaron en serie, ejecutadas aparte: 8 PASS.
- `pnpm build` PASS.

**Fallos E2E previos, no causados por este bloque.** Todos se reproducen en `main` limpio. Ningún test se ha modificado. Detalle y causa de cada uno en el registro.
- Deterministas: `adaptation-states:15`, `magic-flow:50`, `magic-flow:98`, `magic-flow:140`, `render:39` y `visual-locator:47`.
- Intermitentes:
  - `materials:109`;
  - `free-plan:9`;
  - la carrera del helper `signUpAndOnboard` (`adaptation:60` y `materials:145`).

**Publicación:** implementación `5bb9cc1` en `claude/variables-expuestas-repo-f2o2et`, subida por Git como *fast-forward* desde `1e94a8d`. Sin PR nueva, porque no se ha pedido, y sin merge.

**Siguiente acción:**
1. Revisar el rediseño y, si se aprueba, abrir la PR de esta rama.
2. En un bloque aparte, poner al día esos E2E, empezando por la espera de una línea tras el onboarding en `signUpAndOnboard`.
3. La prioridad de producto no cambia: en Hacer magia, ampliar una sola variante verificable de consulta literal en tablas, con fixtures y evidencia de fuente (ROADMAP).
