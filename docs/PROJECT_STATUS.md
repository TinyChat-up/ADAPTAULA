# Estado compartido de Adaptaula

Actualizado: 2026-10-15. Base revisada: `main` en `153721a` (**PR #34 integrada**, preparación legal; #27–#33 también), comprobada por Git.
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
| Materiales y análisis | Subida privada, análisis versionado, jobs y corrección de contexto | Escaneos: aceptación automática retirada tras falsos positivos (ADR-027). La auditoría de 8.2B.7 muestra que propuesta + OCR + geometría solo generan candidatos, sin demostrar identidad. Piloto OCR local (`evals/ocr-pilot`), Fase I sobre diez fichas sintéticas: etiquetas 43/44 sin espurias y consignas 19/20 sin asociaciones incorrectas; geometría 1/10 y ningún recorte aprobado; falta corpus real autorizado |
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

Rama: `claude/fase-1-reconocimiento-ocr`, desde `main` en `153721a` (PR #34 integrada; verificado con `git merge-base`).

**Bloque: Fase I · mejora real del reconocimiento en el piloto OCR.** Solo `evals/ocr-pilot`, sus pruebas y la documentación.
Detalle y tablas en [docs/qa/ocr-fase1](qa/ocr-fase1/README.md).

- **Implementado** (`evals/ocr-pilot/recognition.ts` y `engine.ts`), mismo motor (tesseract.js 7):
  - **Etiquetas:**
    - un componente equivale a un carácter, con respaldo PSM 10;
    - la caja de c/o/s… se decide por la altura;
    - O/0, B/8, S/5 y Z/2 se resuelven por la fila;
    - las marcas que tocan un glifo se separan y los trazos rectos se rechazan;
    - las texturas repetidas se descartan;
    - las letras sueltas de la pasada de página se releen;
    - el glifo se muestra con borde antialiasado y escalado suave.
  - **Consignas:**
    - líneas de la estructura propia de Tesseract, con las columnas separadas y orden por filas;
    - palabras de baja confianza conservadas solo con contexto confiado en su línea.
  - **Adversariales:** conjuntos de desarrollo (8) y reserva (7) independientes en `adversarial.ts`.
- **Probado:**
  - corpus de diez fichas sintéticas, en copias externas y con los originales verificados por SHA:
    - etiquetas 36/44 → 43/44, con precisión 81,8 → 100 % y espurias 7 → 0;
    - consignas bien asociadas 15/20 → 19/20, con 0 incorrectas y 0 sin verificar;
    - WER 11,6 → 9,4 % y CER 3,8 → 2,6 %;
    - llamadas OCR 82 → 59;
  - reserva adversarial: etiquetas 17/24 → 22/24 y espurias 7 → 1;
  - 55 fixtures históricos sin regresiones;
  - pruebas focalizadas, typecheck y lint.
- **Descartado:** releer líneas con PSM 7. No mejoraba nada.
- **Pendiente:**
  - B cruzada por una línea diagonal (09);
  - «Mirael» con el matcher exacto (10);
  - 0/O sin contexto;
  - consignas con la primera línea corta;
  - geometría (1/10 candidatas);
  - escaneos físicos reales y prueba en Vercel.
- **No se hizo:** OCR en Hacer magia, recortes aprobados, SQL, Supabase, Stripe, UI, entrenamiento, llamadas de pago ni subida del
  corpus a Git.

**Siguiente acción:** Fase II de reconocimiento geométrico (ROADMAP §10), sobre fichas propias y con la misma separación entre
desarrollo y reserva.
