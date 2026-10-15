# Estado compartido de Adaptaula

Actualizado: 2026-10-15. Base revisada: `main` en `370a9d8` (**PR #36 integrada**, Fase II de geometría; #27–#35 también), comprobada por Git.
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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: aceptación automática retirada tras falsos positivos (ADR-027). La auditoría de 8.2B.7 muestra que propuesta + OCR + geometría solo generan candidatos, sin demostrar identidad. Piloto OCR local (`evals/ocr-pilot`), Fase I sobre diez fichas sintéticas: etiquetas 43/44 sin espurias y consignas 19/20 sin asociaciones incorrectas; Fase II de geometría (prototipo): 9/10 candidatas correctas en desarrollo y 2/6 en la reserva independiente; ningún recorte aprobado; falta corpus real autorizado |
| Hacer magia | Plan automático, ensamblado, revisión y autocorrección, entrega o parada explicada | Algunos formatos cerrados, simplificación y reorganización aún carecen de ejecutores automáticos; no añadir aprobación intermedia como solución |
| Visuales originales | Recortes, localización automática acotada, reconstrucción determinista de figuras compatibles y selección humana sobre escaneos; bloqueo de recortes scan inseguros heredados | La fase 8.2B.6 NO está completada: páginas sin texto se rechazan automáticamente; no ampliar cobertura sin contrato de evidencia |
| Ilustraciones IA | PR #25: brief, generación, revisión, activo privado, contrato visual, gate y presupuesto | Generación real de imágenes aún sin validar; pruebas existentes usan proveedores simulados |
| Sustitución pedagógica | PR #26: equivalencia y corrección acotada. PR #27: selección única de fracciones. PR #28: consulta literal de celdas de tablas corroboradas contra PDF | Alcance acotado por ADR-023: cuadrícula, texto verificable y consigna explícita. Sin escaneos, inferencias, equivalencias numéricas ni unidades separadas. Calidad de prompts v2/v3/v4 con modelos reales pendiente |
| Presentación y PDF | CLARO, apoyos junto a actividades, render compartido, validación y descarga PDF | Calidad de cada imagen real y runtime PDF en Vercel pendientes de comprobación; no se promete soporte universal |
| Interfaz y navegación | ADR-024 + ADR-025: navegación simplificada, redirecciones, filtros y cuenta conservados; identidad editorial, demo A4 rotulada y mesa de trabajo con cuotas secundarias; filas, controles contrastados y movimiento funcional con `prefers-reduced-motion` | Revisión manual con teclado y lector de pantalla (Fase 7). Cinco E2E anteriores a este bloque están desactualizados (ver registro) |
| Datos, legal y corpus | Buckets privados con RLS por workspace, validación de bytes, logger sin contenido, `ai_runs` sin contenido. Contrato y reglas de admisión al corpus de mejora (ADR-028), registro sintético y borradores de `/privacidad` y `/terminos` | Sin registro de aceptación ni autorizaciones, sin limpieza de metadatos de originales, sin borrado de cuenta, exportación ni job de retenciones, y garantías de proveedores sin verificar ([auditoría](legal/AUDITORIA_DATOS.md)). Revisión jurídica pendiente ([lista](legal/REVISION_ESPECIALISTA.md)) |
| Planes y consumo | Plan efectivo y cuotas en servidor; gate de imágenes y registro de costes | Integración Stripe completa es trabajo propuesto, no completado por existir tablas; pricing y propuesta de beta no son decisiones aprobadas |

## Despliegue, pruebas y límites de esta sesión

- El usuario confirma que la migración **024 está aplicada en Supabase**. No se ha consultado el proyecto remoto ni se afirma que esté desplegada en todos los entornos. Esta fase no añade migraciones.
- Las verificaciones previas se consideran antecedentes; esta sesión usa pruebas focalizadas, PGlite local y proveedores simulados. Ver comandos y resultados en el registro.
- En la sesión anterior de PR #29, `pnpm build` PASS sin modificar fuentes, configuración de red ni dependencias. Este cierre no repite el build.
- La API de GitHub responde `Forbidden` desde este entorno; Git HTTPS permite leer y publicar ramas. El merge de #27 está verificado por historial y ascendencia Git; no se infiere el estado de otras PR abiertas.
- Sesión de Claude Code (bloque UI/UX, 2026-10-13): ese entorno sí descarga Google Fonts, y `pnpm build` se ejecutó una vez sobre el bloque (resultado en el registro). También ve la API de GitHub: allí la PR #25 figura como integrada.
- **Aparcado por el usuario:** Max temporal, SQL de siete días, Stripe de prueba y llamadas pagadas. No son requisitos para continuar el producto.

## Trabajo actual y continuidad

Rama: `claude/fase-3-calidad-pedagogica`, desde `main` en `370a9d8` (PR #36 integrada).

**Bloque: Fase III · calidad pedagógica y referencias docentes (experimental).** Solo `evals/pedagogical-quality`, sus pruebas,
una prueba de fronteras y la documentación. Informe en [docs/qa/calidad-pedagogica-fase3](qa/calidad-pedagogica-fase3/README.md).

- **Implementado:**
  - contrato de referencia pedagógica con estado de validación docente: provisional, revisada o aprobada; las dos últimas exigen
    el registro de la revisión ligado al sha-256 de la referencia;
  - evaluador A–E determinista, sin PASS global: FAIL o «pendiente de revisión docente»;
  - adaptador controlado que no ve la clave;
  - 16 tipos de error deliberado;
  - contrato de revisión humana de figuras ligado a material, página, región y recorte visto;
  - `pnpm eval:pedagogy`, con reserva protegida por hash de reglas.
- **Probado** (8 fichas originales fuera de Git, referencias **sintéticas provisionales**; ninguna validada por un docente):
  - **Desarrollo (5 fichas):** 52/52 errores verificables detectados y 0/15 falsos bloqueos, tras un único ajuste (3/15 antes).
  - **Reserva (3 fichas, una ejecución):** 28/29 detectados, 0/9 falsos bloqueos y 8/8 fugas.
  - **Errores no verificables:** 0/9 detectados; todos llegan como pendientes, nunca PASS.
  - **Fichas propias de CI:** 37/37.
  - **Pruebas focalizadas:** 96/96; typecheck y lint correctos.
- **Pendiente:**
  - revisión del docente con el paquete entregado fuera de Git: ficha de evaluación por ficha y estado de cada referencia;
  - adaptaciones de un modelo real (no probadas);
  - criterios falsos enseñados en apoyos, inferencias escritas en el texto y preguntas reescritas con las mismas palabras clave.
- **No se hizo:** cambios en `src/`, Hacer magia, bloqueos semánticos, PDF, Supabase, Stripe, páginas legales o UI; llamadas de
  pago; entrenamiento; subida de las fichas originales a Git.

**Siguiente acción:** incorporar la revisión del docente. Pasar a `revisada_docente` o `aprobada_docente` solo las referencias
que el docente marque, con el sha-256 de la versión revisada. Después, medir el generador real (mock primero) contra esas
referencias.
