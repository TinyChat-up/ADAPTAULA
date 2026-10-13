# Estado compartido de Adaptaula

Actualizado: 2026-10-13. Base revisada: `main` en `bb38cd0` (**PR #27 integrada**, contiene `26904dc` y `4007e19`), comprobada por Git. Las PR #24–26 también están integradas.
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
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- El bloqueo conocido de compilación es la descarga de Google Fonts por la red del entorno. No se modifica el producto para sortearlo ni se repite la compilación en esta fase.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #27 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama: `phase8/seleccion-unica-tablas`, creada desde `main` actualizado en `bb38cd0`. Bloque: selección única que exige consultar una tabla. La tabla se corrobora contra la cuadrícula, el texto y la posición de todas las celdas del PDF; después se verifica una consulta literal de fila/columna y una sola opción coincidente con la clave original `source`. Se conservan tabla completa, consigna, opciones/orden, ids, enlaces y clave docente. Sin migraciones ni cambios de renderer, precios o cuotas.

**Probado con mocks:** 133 pruebas focalizadas/10 archivos, tres PDF reales con Chromium (tabla, selección de fracciones y ficha de fracciones), typecheck y lint. Lint sin errores; aviso previo ajeno al cambio en `analysis-run-auth.test.ts`. PDF de tabla inspeccionado: una página, tabla y pregunta/opciones juntas, círculos vacíos, sin clave. Sin llamadas pagadas ni servicios remotos. **Pendiente:** IA real y Vercel; la corroboración usa la capa de texto del PDF, no OCR independiente de los glifos (ADR-023).

**Publicación:** rama subida, implementación `1cc8833`. `gh pr create` devuelve `Post https://api.github.com/graphql: Forbidden`; **PR no creada desde este entorno**. [Abrir la PR en GitHub](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/seleccion-unica-tablas). Sin merge. Detalle en [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md). PR #27 ya integrada: no sigue pendiente.

**Siguiente acción:** revisar esta rama/PR y su alcance; después ampliar una sola variante de consulta literal con fixtures y evidencia de fuente, sin habilitar selección genérica. Las pruebas con IA real o Vercel requieren una tarea posterior autorizada.
