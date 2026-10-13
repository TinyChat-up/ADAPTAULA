# Estado compartido de Adaptaula

Actualizado: 2026-10-13. Base revisada: `main` en `6c91552` (PR #25 integrada; PR #24 integrada en `2a6da53`).
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
| Sustitución pedagógica | PR #24: equivalencia antes de aceptar; esta rama añade preservación de respuesta, acciones y restricciones, y corrección informada acotada | Validación semántica heurística; no admite sustituir formatos cerrados por líneas; eficacia de `visual_substitute@v2` con modelos reales pendiente |
| Presentación y PDF | CLARO, apoyos junto a actividades, render compartido, validación y descarga PDF | Calidad de cada imagen real y runtime PDF en Vercel pendientes de comprobación; no se promete soporte universal |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- El bloqueo conocido de compilación es la descarga de Google Fonts por la red del entorno. No se modifica el producto para sortearlo ni se repite la compilación en esta fase.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer el repositorio. El estado de PR abiertas requiere comprobarse cuando se recupere el acceso a la API.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama: `phase8/sustitucion-pedagogica-acotada`, creada desde `main`. Bloque: completar los controles y la corrección automática de sustituciones, con hasta dos intentos por actividad en cada ejecución de la política. Sin cambios de interfaz, renderer, suscripciones ni cuotas comerciales.

Implementación publicada en la rama (`8ad483e`); PR aún no creada porque `gh pr create` recibe `Forbidden` de la API. [Formulario para abrir la PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/sustitucion-pedagogica-acotada). Primero revisar este cambio; no hay merge automático.

Siguiente bloque recomendado: un ejecutor acotado para selección única que preserve opciones, respuesta correcta y trazabilidad, empezando por reproducir la parada actual. Alcance y aceptación en el roadmap; no iniciar varias familias de ejercicio a la vez.
