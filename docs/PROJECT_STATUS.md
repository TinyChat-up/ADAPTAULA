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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: solo el caso de un único visual y un único dibujo por página (ADR-026); cobertura con escaneos reales sin medir; ampliar materiales de evaluación |
| Hacer magia | Plan automático, ensamblado, revisión y autocorrección, entrega o parada explicada | Algunos formatos cerrados, simplificación y reorganización aún carecen de ejecutores automáticos; no añadir aprobación intermedia como solución |
| Visuales originales | Recortes, localización automática acotada, reconstrucción determinista de figuras compatibles y, en escaneos sin texto, la figura única de la página (8.2B.6) | No hay edición general de imágenes originales ni un localizador universal para escaneos: varias figuras por página, rectas numéricas escaneadas y adornos grandes paran |
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

Rama: `claude/fase-8-2b6-escaneos`, creada desde `main` actualizado en `1929849`. La PR #29 (interfaz) no se toca.

**Bloque: Fase 8.2B.6 · localización conservadora de figuras en escaneos (ADR-026).**
- Fallo reproducido: el esquema imprescindible de la ficha de la célula escaneada (sin capa de texto) quedaba en confianza 0,15, opción D y parada.
- Ahora `auto/scan.ts` (motor `auto_visuals@v3`) lo localiza solo si se dan dos condiciones:
  - el análisis lista un único visual en la página, y es el `required`;
  - los píxeles muestran un único dibujo, sin marcos, manchas, bordes, letras grandes ni texto que toque el recorte.
- Reutiliza el localizador `auto`, el recorte, Storage, la política, el renderer y el PDF.
- Sin OCR, sin modelos de imagen, sin migraciones y sin cambios pedagógicos.

**Probado (local, escaneos sintéticos, PGlite y Chromium; sin llamadas de pago ni servicios remotos):**
- 20 unitarias nuevas, 5 de integración y 1 PDF.
- Regresión focalizada: 144 pruebas en 10 archivos PASS, y 3 PDF (escaneo, fracciones e ilustración) PASS.
- typecheck PASS; lint sin errores (el aviso previo).
- Detalle en el registro.

**Pendiente de validar:** cobertura con escaneos reales autorizados; comportamiento en Vercel; varias figuras por página y rectas numéricas escaneadas (hoy paran).

**Publicación:** implementación `71b6080` en `claude/fase-8-2b6-escaneos`, publicada en la [PR #30](https://github.com/TinyChat-up/ADAPTAULA/pull/30) hacia `main`, sin merge.

**Siguiente acción:**
1. Revisar la PR de esta fase. La integración la hace una persona.
2. Medir con escaneos reales autorizados cuántas paradas visuales resuelve, y cuáles siguen siendo ambiguas, antes de ampliar el caso.
3. En un bloque aparte, actualizar los E2E generales documentados (empezando por la espera tras el onboarding).
