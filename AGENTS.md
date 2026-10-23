<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Continuidad compartida entre agentes

Al iniciar: leer [estado](docs/PROJECT_STATUS.md), [roadmap y aceptación](docs/ROADMAP.md) y la última entrada del [registro](docs/DEVELOPMENT_LOG.md); comprobar `main` y PR abiertas; elegir un único bloque. Si una consulta externa está bloqueada, registrarlo sin inferir su resultado.

Seguir las convenciones de [CLAUDE.md](CLAUDE.md) y las decisiones de [ARCHITECTURE.md](docs/ARCHITECTURE.md). Estos documentos son comunes a Codex y Claude Code; no duplicar su contenido.

Pruebas por cambio: las focalizadas del área tocada (unidad, PDF y la E2E de esa pantalla), más typecheck y lint. La suite E2E completa (unos 30 min) se pasa una sola vez, al cerrar una fase o antes de fusionar, no en cada iteración.

Al terminar: actualizar los Markdown afectados y registrar cambios, archivos, pruebas, riesgos, decisión, PR (o bloqueo verificable) y siguiente acción precisa. Distinguir implementado, simulado, probado y pendiente de validar en producción. Nunca guardar claves, tokens o datos de alumnos. Respetar el alcance de pruebas y servicios externos autorizado para la sesión.
