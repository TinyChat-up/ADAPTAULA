# Estado compartido de Adaptaula

Actualizado: 2026-10-15. Base revisada: `main` en `1d4d07c` (**PR #33 integrada**, corrección del evaluador OCR; #27–#32 también), comprobada por Git.
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

Rama: `claude/politicas-legales-corpus`, desde `main` en `1d4d07c` (se comprobó con `git merge-base --is-ancestor` que la PR #33
está integrada).

**Bloque: políticas legales y corpus de mejora autorizado** (ADR-028). No cambia el comportamiento de producción.

- **Implementado:**
  - **Auditoría de datos:** [AUDITORIA_DATOS.md](legal/AUDITORIA_DATOS.md), con lo implementado, lo documentado y lo pendiente.
  - **Finalidades y mecanismo:** [FINALIDADES_Y_CORPUS.md](legal/FINALIDADES_Y_CORPUS.md) separa A (servicio), B (evaluación
    interna) y C (entrenamiento) y diseña la autorización opcional, la protección del alumnado, el estado de los proveedores y el
    registro del corpus. Incluye el esquema y la RLS propuestos, sin aplicar.
  - **Lista para el especialista:** [REVISION_ESPECIALISTA.md](legal/REVISION_ESPECIALISTA.md).
  - **Contrato y reglas:** `src/lib/schemas/improvement-corpus.ts` y `src/lib/corpus/admission.ts`, sin llamadores en producción.
    La política vigente rechaza cualquier contribución: mecanismo, aviso y plazo están `null` y `trainingEnabled` es `false`.
  - **Registro de ejemplo:** `evals/corpus/`, con 4 fichas sintéticas propias y una contribución hipotética rechazada.
  - **Borradores legales:** `/privacidad` y `/terminos` con huecos «Pendiente», sin casillas ni formularios.
  - **Documentación corregida:** `PRIVACY.md` y `AI_PIPELINE.md` ya no presentan como hechas las retenciones, la exportación, el
    borrado de cuenta ni las garantías de los proveedores.
- **Probado:**
  - `improvement-corpus` (17), `legal-pages` (3) y `boundaries`;
  - typecheck;
  - lint (0 errores).
- **Pendiente:**
  - identidad del responsable, contacto, plazos, bases jurídicas y aviso definitivo;
  - contratos y configuración verificados de los proveedores;
  - migración y RPC de autorizaciones;
  - limpieza de metadatos;
  - borrado de cuenta y retenciones.
- **No se hizo:** SQL, migraciones, llamadas de pago, entrenamiento, materiales de usuarios, Stripe ni cambios en Hacer magia o en
  la UI general.

**Siguiente acción:**
1. Llevar la [lista](legal/REVISION_ESPECIALISTA.md) a asesoría especializada y aportar los datos PENDIENTES.
2. Mientras tanto, Fase I del ROADMAP (§9): corregir OCR y geometría sobre las diez fichas sintéticas, solo con fichas propias.
   No activar la recolección de fichas de usuarios.
