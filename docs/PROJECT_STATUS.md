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

**Bloque: auditoría independiente de PR #32, piloto OCR local** ([README](../evals/ocr-pilot/README.md)).
Producción intacta; rama remota inicial en `53ee15b`.

- **Fallos demostrados:** una detección recuperaba varias etiquetas verdaderas, errores cercanos desaparecían y duplicados se
  contaban repetidamente. Anclas puntuadas solo por altura aceptaban la otra columna. El manifest admitía escapes de ruta/cajas
  fuera de página. Ruido estructurado generaba más de mil grupos OCR sin presupuesto.
- **Corregido:** asociación geométrica uno a uno; precisión con denominador de detecciones; CER Unicode; anclas en dos dimensiones,
  y ancla humana explícita en corpus real. Carga acotada fuera de Git, symlinks/rutas validados, informes sin transcripción ni
  caracteres de etiquetas, estado de ejecución y fallo sin reportes parciales. Presupuestos de glifos/componentes/llamadas/tiempo.
- **Medido sobre los mismos 11 documentos sintéticos ×5 condiciones (no independientes):**
  - Etiquetas: 135 correctas/135 detecciones/135 referencias; la cifra concreta no estaba inflada, aunque el algoritmo sí era defectuoso.
  - Anclas: 108/115 exactas dentro de tolerancia (antes 109); tolerantes 111/115 (antes 113). Las cajas parciales/desplazadas también penalizan.
  - Candidatos: 19/30, referencia 23/30, 0 erróneos en ensayos guionizados y 0 recortes aprobados.
  - WER/CER global con etiquetas: 4,0 % /1,7 %. Pico RSS muestreado 1.089 MB; máximo 2.759 ms/página; 171 llamadas de etiquetas,
    máximo 18 por página. Ejecución completa con red bloqueada. Sin comparación de velocidad entre contenedores.
- **Límites:** los umbrales se ajustaron con estos mismos dibujos; no hay corpus real ni prueba Vercel/bundle tracing. Glifos unidos
  a líneas o fuera de tamaño pueden perderse. PDF comprimido y código nativo requieren límites de proceso; los presupuestos internos
  no son una garantía absoluta de memoria. Identidad, integridad y respuesta visual siguen sin comprobarse.
- **Recomendación:** MERGE solo como piloto experimental; fases funcionales 8.2B.6/8.2B.7 pendientes.

**Siguiente acción:** 20–30 fichas autorizadas sin datos personales, preferentemente imágenes saneadas, fuera de Git. Dos personas
anotan `texts` en orden de lectura, `anchorTextIndex` e `instructionTextIndices`; apartar documentos de reserva por origen y ejecutar en un proceso local
con límites de memoria/tiempo. Medir OCR y candidatos antes de invertir en integración o propuestas pagadas.
