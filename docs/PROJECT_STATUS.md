# Estado compartido de Adaptaula

Actualizado: 2026-10-13. Base revisada: `main` en `d665d5b` (PR #26 integrada; contiene `8ad483e` y `65515a8`). Las PR #24 y #25 también están integradas.
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
| Sustitución pedagógica | PR #26: equivalencia y corrección informada acotada. Fase 8.2B.4 en esta rama: selección única verificable de fracciones coloreadas, con opciones originales y figura determinista | No es un ejecutor universal de selección única. Solo barras/círculos, consignas reconocidas y alternativas fraccionarias explícitas; los demás casos paran honestamente. Calidad de prompts v2/v3 con modelos reales pendiente |
| Presentación y PDF | CLARO, apoyos junto a actividades, render compartido, validación y descarga PDF | Calidad de cada imagen real y runtime PDF en Vercel pendientes de comprobación; no se promete soporte universal |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- El bloqueo conocido de compilación es la descarga de Google Fonts por la red del entorno. No se modifica el producto para sortearlo ni se repite la compilación en esta fase.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #26 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama: `phase8/seleccion-unica-automatica`, creada desde `main` actualizado en `d665d5b`. Bloque: sustitución de una actividad `select_option` cuyo visual no se ha podido recuperar por los peldaños previos. Las opciones se extraen de listas consecutivas A)…H), se conservan literalmente y el servidor exige exactamente una fracción correcta contra la figura y la clave original. Conserva consigna, orden, partición, clave y procedencia; no transforma preguntas abiertas en selección.

**Verificado:** 103 pruebas focalizadas, 2 PDF reales con Chromium (selección única y regresión de fracciones), typecheck y lint. Revisión visual del PDF de selección: una página, figura junto a pregunta/opciones y círculos sin marcar. Asistentes simulados, sin llamadas pagadas. Sin migraciones ni cambios de renderer, precios o cuotas.

Rama publicada (`26904dc`). La creación de la PR por API volvió a fallar con `Forbidden`; [abrir la PR en GitHub](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/seleccion-unica-automatica). Detalle en [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md). No se ha hecho merge.

Siguiente bloque recomendado: ampliar selección única a una segunda clase verificable (lectura de un dato de tabla), con un verificador determinista propio antes de aceptar reformulaciones. No habilitar formatos cerrados genéricos ni convertir tareas abiertas en selección.
