# Estado compartido de Adaptaula

Actualizado: 2026-10-14. Base revisada: `main` en `70fb9ea` (**PR #28 integrada**, contiene `1cc8833` y `3965092`), comprobada por Git. Las PR #24–27 también están integradas.
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

Rama única: `claude/variables-expuestas-repo-f2o2et`. **[PR #29](https://github.com/TinyChat-up/ADAPTAULA/pull/29) abierta, sin merge**, según el usuario; cabeza remota y referencia `refs/pull/29/head` comprobadas iguales a `6fa99fc` antes de modificar archivos. Se continúa directamente sobre el trabajo de Claude, sin reiniciar la rama ni abrir otra PR.

**Bloque actual: redirección editorial (ADR-025).**
- Papel cálido, tinta, azul editorial, titulares serif y UI Inter. Sin degradados, halos, flotación, sombras teñidas ni métricas dominantes.
- Hero con original → adaptado en hojas A4 de demostración, tabla y alternativas reales sin solución señalada. Copy compatible con Hacer magia y revisión manual.
- Inicio: Adaptar material → atención → en curso → materiales recientes → fichas preparadas; plan y cuotas secundarios. Filas para materiales/perfiles/adaptaciones; subida y formularios con controles claros.
- Mejoras funcionales de Claude conservadas: navegación, redirecciones, filtros, cuenta, estados, errores, carga, responsive y reduced motion. Sin tocar lógica de negocio, SQL, Stripe, IA, pipeline ni renderer/PDF.

**Probado en esta redirección (local, PGlite y proveedores simulados):**
- typecheck y build PASS; lint sin errores, un aviso previo.
- 62 pruebas focalizadas en 8 archivos PASS; no suite completa.
- **4/4 Playwright** editoriales en escritorio y móvil: portada y flujo de trabajo. Axe sin infracciones detectadas, salto al contenido, Escape/retorno de foco, subida válida/inválida, filtros y resultado con fixture. Biblioteca sin desbordamiento a 320 px con texto al 200 %.
- Capturas antes/después: portada, inicio, materiales, perfiles, adaptar, adaptaciones, material, revisión, resultado y cuenta, en ambos tamaños. [Galería y capturas versionadas](qa/pr29/README.md); no contienen datos reales.

**Antecedentes, no revalidados aquí:** los E2E generales desactualizados/intermitentes identificados por Claude siguen pendientes en un bloque separado; ver la entrada anterior de DEVELOPMENT_LOG. Esta sesión añade `editorial-interface.spec.ts`, no corrige aquellos tests ni afirma que toda la suite pase.

**Publicación:** los cambios se publican en la misma rama para actualizar #29; nunca se crea otra PR ni se hace merge desde esta tarea.

**Siguiente acción:**
1. Revisar la comparativa visual y la PR #29, y comprobar su Preview de Vercel. Validación remota y revisión manual con lector de pantalla pendientes. No integrar automáticamente.
2. En un bloque aparte, actualizar los E2E generales documentados por Claude, empezando por esperar la navegación del onboarding.
3. Después, retomar la variante verificable de selección tabular del ROADMAP, sin mezclarla con este encargo visual.
