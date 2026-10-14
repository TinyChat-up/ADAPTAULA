# Estado compartido de Adaptaula

Actualizado: 2026-10-14. Base revisada: `main` en `37c381b` (**PR #32 integrada**, piloto OCR experimental; #27–#31 también), comprobada por Git.
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

Rama: `codex/corregir-anclas-etiquetas-ocr`, creada desde `main` / `37c381b`. PR #32 integrada, verificado por Git.

**Bloque: reparación focalizada del evaluador de anclas y etiquetas inventadas**, sin cambiar OCR ni geometría.
- Dos defectos reproducidos antes de corregir: cajas de ancla con/sin numeración comparadas por centro; regex que extrae «es» de «están».
- El evaluador diferencia hallazgo, asociación correcta/incorrecta, sin verificar y ausencia. Comprueba soporte del mismo texto y
  referencias coherentes sin ampliar tolerancia; falla de forma cerrada ante mezcla de actividades o evidencia insuficiente.
- `instructionLabels()` exige listas explícitas completas; cambio solo en prototipo. Versiones `ocr_pilot@audit3` y `figure_proposal_verifier@proto3`.
- Misma ejecución sobre diez fichas **sintéticas adjuntas**, conservadas fuera de Git y con referencias originales intactas:
  exacto 16/20 encontradas, 15 asociadas, 1 sin verificar, 4 omitidas; tolerante 17 encontradas, 16 asociadas, 1 sin verificar, 3 omitidas.
- OCR idéntico por ficha: 36/44 etiquetas, WER 11,6 %, CER 3,8 %, confianza y llamadas sin cambios. Geometría: 1/10 candidatas, 0 aprobaciones.
- [Reproducción y tabla antes/después](qa/ocr-anclas-etiquetas/README.md). El corpus y sus documentos no se publican; el reporte audit2 de once bases queda histórico.

**Pendiente real:** letras C/etiquetas, columnas y firmas geométricas; ninguna de esas variables se modifica aquí. Identidad,
integridad pedagógica y respuesta visual siguen no verificables. No afirmar validación con escaneos físicos ni Vercel.

**Siguiente acción:** revisar la reparación y su PR antes de modificar otra variable del OCR o del localizador. No hay merge automático,
llamadas pagadas, producción, Hacer magia, UI, SQL, Stripe, Supabase ni migraciones.
