# Estado compartido de Adaptaula

Actualizado: 2026-10-14. Base revisada: `main` en `bafae45` (**PR #31 integrada**, propuesta y prototipo bloqueado de 8.2B.7; #27–#30 también), comprobada por Git.
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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: aceptación automática retirada tras falsos positivos (ADR-027). La auditoría de 8.2B.7 muestra que propuesta + OCR + geometría solo generan candidatos, sin demostrar identidad. Piloto OCR local (`evals/ocr-pilot`) medido solo con fixtures sintéticos: INVESTIGAR MÁS; falta corpus real autorizado |
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

Rama: `claude/piloto-ocr-local`, creada desde `main` en `bafae45`. Se comprobó con `git merge-base --is-ancestor` que la PR #31 está integrada.

**Bloque: piloto OCR local sin API de pago** ([`evals/ocr-pilot`](../evals/ocr-pilot/README.md)). No cambia el comportamiento de
producción.

- **Implementado:**
  - **Motor:** tesseract.js 7.0.0 (Tesseract 5 en WASM, Apache-2.0), como devDependency exacta con `postinstall` bloqueado.
  - **Modelo `spa`:** se descarga una vez a `.cache/` (ignorada por Git) con el sha-256 fijado.
  - **Pasadas de lectura:** una de página con enderezado automático y otra para etiquetas sueltas, ambas sobre los píxeles del escaneo.
  - **Métricas y runner:** métricas puras y un runner con tiempo, memoria y tamaño de dependencia.
  - **Corpus real:** cargador para un corpus autorizado guardado fuera del repo.
  - **Prueba de fronteras:** comprueba que ningún módulo de `src/` importa el piloto ni `tesseract.js`.
- **Probado** (`pnpm eval:ocr`, 55 páginas: 11 fixtures **sintéticos** × 5 condiciones):
  - Etiquetas: 135/135, sin confusiones ni espurias. Solo con la pasada de página se pierden todas.
  - Anclas: 109/115 exactas, 0 mal asignadas.
  - Candidatos con caja humana: 19/30, frente a 23/30 con la capa de referencia. 0 candidatos erróneos y 0 aceptados.
  - Rendimiento: 1,2–4,9 s por página en 4 vCPU; pico de proceso ~1,1 GB.
- **Límites encontrados:**
  - En páginas giradas, el prefiltro agrupa líneas sin enderezar (integración).
  - Con grano fuerte, el umbral de tinta del prefiltro falla incluso con la capa de referencia.
- **Pendiente de validar:**
  - escaneos reales (no hay corpus autorizado);
  - Vercel (tamaño, memoria y tiempo);
  - tipografías y tamaños de etiqueta distintos de Helvetica a 11 pt (los umbrales se fijaron con estos fixtures).
- **No hay** llamadas a modelos, OCR remoto, SQL, migraciones, Stripe ni cambios de UI. No se tocan Hacer magia,
  `MaterialAnalysis` ni los PDF. No se autorizan recortes.

**Siguiente acción:**
1. Reunir 20–30 escaneos reales con permiso de uso y sin datos del alumnado, y anotarlos con `corpus.template.json` fuera del repo.
   Ejecutar `pnpm eval:ocr -- --corpus <dir>`, apartando fichas de reserva que no se usen para ajustar umbrales.
2. Si las etiquetas y las consignas aguantan: enderezar la página antes del prefiltro y hacer robusto su umbral de tinta. Después,
   un despliegue de prueba en Vercel. Si no aguantan, descartar el OCR local para escaneos.
