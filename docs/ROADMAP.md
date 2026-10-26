# Roadmap de implementación

> **Perfiles docentes, fortalezas y barreras (2026-10-26):** #75 integrada; primera entrega de perfiles en `codex/perfiles-fortalezas-barreras`. [Implementación, compatibilidad V1/V2 y capturas](qa/perfiles-dua/README.md). Once propuestas combinables, observaciones independientes, resumen y conflictos protegidos. Revisar la PR y autorizar 032 antes de desplegar escrituras V2; después comprobar el uso con docentes y tecnologías de apoyo. No implementa todavía competencia por contenido ni el motor curricular de #63, no modifica el motor de imágenes y no acredita calidad pedagógica de un modelo real. Sin migraciones remotas ni merge automático.

> **Corrección del recorrido de imágenes (2026-10-26):** #74 integrada; recuperación conservadora de marcas y coordenadas del original, validación de letras en briefs y diagnóstico de rechazos. [Pruebas, PDF y limitaciones](qa/imagenes-recuperacion-original/README.md). La próxima comprobación será un ensayo manual autorizado tras integrar y desplegar el arreglo. No se considera validada la generación real ni se reabre automáticamente la adaptación bloqueada. Sin otra fase experimental ni E2E de ordenador/móvil en esta entrega, por petición del fundador.

> **CLARO: primera mejora pedagógica/visual verificable (2026-10-20):** #49–#51 integradas. [PR #52](https://github.com/TinyChat-up/ADAPTAULA/pull/52), abierta sin merge: implementación acotada y ocho fichas de evaluación en [QA](qa/claro-calidad/README.md): legibilidad de rectas, agrupación de figuras y defensa estructural. Las referencias manuales del corpus no se presentan como evidencia de materiales reales. Siguiente: revisión docente de las fichas y diseño de referencias verificadas por versión antes de ampliar automatismos. No activar imágenes ni OCR; staging sigue pendiente de autorización.

> **PDF definitivo (2026-10-20):** vista previa implementada sobre la exportación CLARO existente: hojas físicas, PDF completo, revisión guardada y descarga binaria idéntica. [Alcance y QA](qa/vista-previa-pdf/README.md). Revisar [PR #51](https://github.com/TinyChat-up/ADAPTAULA/pull/51) y después validar Chromium/PDF en staging expresamente autorizado. Esta fase no certifica calidad pedagógica ni producción; no activar OCR ni imágenes IA.

> **Auditoría 2026-10-20, base #48 integrada:** [hallazgos y limpieza](qa/auditoria-2026-10-20/README.md). A1 corregido e integrado en #50 con migración 029 y limpieza recuperable; aplicación remota pendiente. La vista previa física se implementa en la entrega actual. Los recursos didácticos deterministas requieren un encargo posterior. No crear otro renderer ni interpretar pruebas de mocks como validación semántica. Staging y revisión jurídica siguen pendientes.

> **Etapa 5A, primera entrega (2026-10-17):** exportación personal y solicitud de eliminación comprobables. Para cerrar la fase falta un procesador duradero de baja que bloquee jobs, limpie todos los buckets, borre Auth y respete obligaciones de conservación definidas jurídicamente. [Detalle](qa/adaptaula-2-etapa-5a/README.md). No activar borrado automático mientras falte esa infraestructura.

> **Etapa 5B:** #46 integrada en `e37951a`. Fase A: preparar y probar localmente inspección SQL, permisos reales y sonda PDF autenticada; [procedimiento](qa/adaptaula-2-etapa-5b/README.md). Fase B pendiente de autorización expresa: validar en staging 025–028, Auth/correo, PDF Chromium en Vercel, Storage privado, cuotas Free y fallos seguros. No aplicar migraciones ni cambiar secretos ahora. La eliminación física es una entrega separada con conservación definida y limpieza recuperable.

> Etapa 4B: portada y demostración pública sintética, «Cómo funciona», acceso y primera experiencia. [Alcance y pruebas](qa/adaptaula-2-etapa-4b/README.md). #44 está fusionada; no se ha aplicado migración remota.

> **Etapa 4A (2026-10-17):** #43 integrada en `5867d30`. Nueva política persistida mediante migración 026, precios con tres planes y avisos de consumo. Pro sin contratación, Max en preparación, imágenes desactivadas. Suscripciones anteriores conservadas; no se aplica SQL remoto. [Alcance, compatibilidad y QA](qa/adaptaula-2-etapa-4a/README.md). 4B debe esperar a integrar 4A.

Regla: **una fase no termina hasta que `pnpm check` (typecheck + lint + unit + build) y los tests de la fase pasan.** No se construye sobre código roto. Cada fase se cierra con un resumen de decisiones y pendientes.

**Corrección focalizada A1 (2026-10-20):** [integridad de originales](qa/integridad-originales/README.md), migración 029 local. Cierra la carrera de cron/finalización con decisión atómica y limpieza recuperable; no se activa con una simple publicación de código. PR #50 integrada. Pendiente ejecutar el procedimiento autorizado de staging: pausa de cron antiguo, copia de seguridad, esquema, despliegue compatible y validación con identidades ficticias. No se cambia el siguiente roadmap pedagógico.

## Continuidad 2026-10-17 — etapa 3B

PR #42 (3A) integrada en `9f064ef`, comprobada en GitHub junto con #41. Entrega 3B en `codex/adaptaula-2-perfiles-cuenta`: directorio y edición progresiva de perfiles, vista de lectura, cuenta editable y consumo separado. Revisar [PR #43](https://github.com/TinyChat-up/ADAPTAULA/pull/43), abierta sin merge, antes de la etapa 4. No activar todavía nuevos precios/límites: la política objetivo está en [ADAPTAULA_2.md](ADAPTAULA_2.md) y requiere su propia migración segura. No APIs pagadas, Supabase remoto ni Stripe.


## Antecedente — Adaptaula 2.0, etapa 3A (2026-10-16)

PR #41 integrada en `740e2db`. Esta entrega reorganiza mesa, biblioteca e historial con datos y operaciones existentes. [Dirección](ADAPTAULA_2.md), [estado](PROJECT_STATUS.md), [QA](qa/adaptaula-2-etapa-3a/README.md). Revisar 3A antes de 3B (perfiles y cuenta). No adelantar precios ni límites: la etapa 4 requiere migraciones y pruebas comerciales específicas. Sin merge automático.

## Antecedente — editor docente de fichas adaptadas (2026-10-15)

Primera entrega operativa en `codex/editor-docente-claro`: enunciados, presentación, espacio de respuesta, vista A4, deshacer/rehacer, borradores separados y PDF de revisión concreta. [Alcance y pruebas](qa/editor-docente/README.md). Reutiliza CLARO; migración 025 solo probada localmente.

El usuario pospone las pruebas con APIs de pago y nuevas fases experimentales. Priorizar la revisión de este editor y su uso por docentes. No activar entrenamiento ni recogida de correcciones. #37 ya aparece integrada en `origin/main` al iniciar; no se ha fusionado en esta sesión.

## Antecedentes — continuidad de Hacer magia (2026-10-13)

Estado vivo: [PROJECT_STATUS.md](PROJECT_STATUS.md). Evidencias y excepciones autorizadas de verificación: [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md). Las secciones históricas de abajo mezclan hitos y propuestas; un título de fase no certifica despliegue.

1. **Integrado en #26:** sustitución pedagógica con corrección informada, hasta dos intentos por actividad/ejecución y rechazo de cambios incompatibles de formato, operaciones o restricciones.
2. **Fase 8.2B.4 integrada en PR #27 (`bb38cd0`):** selección única de una fracción coloreada en barra/círculo tras perder su figura. El fallo reproducido es `no_equivalent_activity` en la política visual, no el `needs_decision` del planificador. Conserva consigna, alternativas consecutivas A)…H), orden, clave, tipo de figura, partición y trazabilidad. Aceptación comprobada con mocks: una única alternativa numéricamente correcta; rechazo de opciones perdidas/duplicadas, clave contradictoria, pistas y cambios de objetivo/dificultad; segundo intento informado y parada tras dos fallos; ficha imprimible sin clave visible. Usa el renderer de selección existente. Fuera de alcance: conversión de preguntas abiertas, formatos cerrados generales, selección múltiple y cambiar opciones/solución.
3. **Fase 8.2B.5 integrada en PR #28 (`70fb9ea`):** consulta de una celda por fila/columna en tablas con cuadrícula y capa de texto corroboradas contra el PDF original. Alcance y límites en ADR-023.
4. **Fase 8.2B.6 pendiente; PR #30 cerrada en alcance como endurecimiento (ADR-027):** eliminar el localizador scan experimental, verificar SHA/procedencia y rechazar metadatos incompletos o falta de ancla. Selección manual y localización anclada con texto conservadas. Recomendación MERGE técnico exclusivamente con ese alcance; no se ha comprobado la existencia de activos inseguros en producción. Ver [auditoría](qa/pr30/README.md).
5. **PR #30 integrada en `f827001`** como endurecimiento de procedencia (ADR-027).
6. **Fase 8.2B.7 en diseño:** OCR + propuesta multimodal solo producen candidatos geométricos; identidad e integridad pedagógica siguen sin verificarse. [Propuesta auditada](proposals/LOCALIZACION_FIGURAS_ESCANEOS.md) y prototipo aislado (`evals/visual-location/`); **no activado** en Hacer magia. Próximo paso: piloto local sin gasto API.
   - El contrato de #31 distingue once filtros de candidato de tres propiedades semánticas no verificables: toda aprobación sigue bloqueada.
   - El siguiente experimento es local y sin gasto API; una prueba pagada exige autorización posterior y una fuente suficiente de identidad/integridad.
7. **Piloto OCR local hecho (2026-10-14, [`evals/ocr-pilot`](../evals/ocr-pilot/README.md)); veredicto INVESTIGAR MÁS.**
   - Qué es: tesseract.js 7 (Tesseract 5 en WASM) como devDependency aislada, sin API ni OCR remoto, aplicado a los píxeles de los
     fixtures **sintéticos**. No es una validación real.
   - Qué recupera: la pasada de página pierde todas las etiquetas sueltas; una pasada por glifo recupera 135/135.
   - Auditoría #32: asociación de etiquetas uno a uno; 135/135 se conserva en estos sintéticos, sin inferencia a fichas reales. Anclas exactas dentro de tolerancia geométrica: 108/115, frente a 109/115 con criterio solo vertical.
   - Candidatos con caja humana: 19/30, frente a 23/30 con la capa de referencia.
   - Dónde se rompe:
     - en páginas giradas, por la integración (hay que enderezar antes del prefiltro);
     - en fotocopias degradadas, por el umbral de tinta del prefiltro.
   - Siguiente, en orden:
     1. Ejecutar `pnpm eval:ocr -- --corpus` con 20–30 escaneos reales autorizados (fuera del repo).
     2. Enderezar antes del prefiltro.
     3. Hacer robusto el umbral de tinta.
     4. Medir un despliegue experimental si el corpus aporta valor; memoria, tracing y tiempos Vercel siguen sin probarse.
   - Límites: corpus fuera de Git, anotación humana de orden/anclas, rutas y recursos acotados, informes sin transcripciones. Son 11 documentos ×5 condiciones dependientes; no autoriza recortes automáticos ni se integra en producción.

8. **Corrección focalizada tras diez fichas sintéticas, desde PR #32 integrada (`37c381b`):** evaluador de anclas y parser de etiquetas
   reparados; exacto 16 encontradas /15 asociadas /1 sin verificar /4 omitidas de 20. OCR 36/44, WER/CER y geometría sin cambios.
   [Comparación](qa/ocr-anclas-etiquetas/README.md). Revisar esta reparación antes de optimizar C, columnas o firmas. Sin producción ni aprobación automática.

9. **Preparación legal y corpus de mejora (2026-10-15, ADR-028; [propuesta](legal/FINALIDADES_Y_CORPUS.md)).**
   - **Finalidades:**
     - A (servicio);
     - B (evaluación interna, autorización opcional por material, aún inexistente);
     - C (entrenamiento, desactivado).
   - **Implementado en esta PR:**
     - contrato `improvement-corpus`;
     - reglas `corpus/admission`;
     - pruebas;
     - registro sintético `evals/corpus`;
     - borradores de `/privacidad` y `/terminos`;
     - auditoría y lista para el especialista.
   - **Sin hacer:** SQL, migración, casilla ni recolección.
   - **Antes de recoger una sola ficha de usuario:**
     1. Revisión jurídica de [REVISION_ESPECIALISTA.md](legal/REVISION_ESPECIALISTA.md).
     2. Responsable, plazos y aviso definidos.
     3. Migración y RPC de autorizaciones con pruebas RLS.
     4. Limpieza de metadatos y procedimiento de revisión de privacidad.
     5. Contratos y configuración de proveedores verificados.

**Fases técnicas siguientes, sobre fichas propias.** Ninguna aprueba recortes visuales cuya identidad o integridad pedagógica no
pueda verificarse.

- **Fase I · corregir OCR y geometría observados en las diez fichas sintéticas** ([QA](qa/ocr-anclas-etiquetas/README.md)):
  - **Errores a corregir:**
    - letras C perdidas o confundidas, y etiquetas espurias (36/44);
    - consignas omitidas (4/20) y la mezcla de columnas;
    - etiquetas fuera del recorte y firmas de barra o recta que no se reconocen.
  - **Método:** reproducir cada fallo con una prueba que falle antes de corregirlo, y medir sobre `development` sin tocar
    `evaluation` ni `holdout`.
  - **Criterio:** mejora de etiquetas y anclas en `evaluation` sin perder la regresión sintética. Las aprobaciones de recorte
    siguen en 0.
- **Fase II · ampliar el corpus original de evaluación:**
  - **Contenido:**
    - otras materias (Lengua, Ciencias, Sociales, Inglés);
    - otros formatos (tablas, columnas, textos largos, mapas, gráficas, escaneos físicos de fichas propias impresas);
    - otras etapas.
  - **Registro y particiones:** cada ficha se registra con `CorpusEntrySchema`, y las familias quedan separadas por partición.
    Una reserva fija no se mira al ajustar.
- **Fase III · comparar adaptaciones con referencias pedagógicas validadas por un docente:**
  - **Referencias:** el docente valida, para fichas propias, la adaptación esperada por perfil funcional (`expectedResult.validatedBy:
    "docente"`).
  - **Rúbrica:** fidelidad, resolubilidad, lectura, respeto a la edad y ausencia de respuestas filtradas.
  - **Pagos:** las ejecuciones de pago requieren autorización expresa por tanda.
- **Fase IV · optimizar el pipeline:**
  - **Primero:** prompts, reglas y modelos por alias.
  - **Después, y solo con evidencia suficiente** (mejora estable en `evaluation` y `holdout`, con datos con licencia y sin datos
    personales), valorar el ajuste fino: con base jurídica, licencia y acuerdo específicos para C, EIPD y el límite de
    desaprendizaje documentado.
  - **Restricciones:** nunca con corpus privados cedidos a terceros, ni con preferencias de docentes recogidas automáticamente.

10. **Fase I de reconocimiento hecha (2026-10-15, [QA](qa/ocr-fase1/README.md)), solo en el piloto.**
    - **Corpus de diez fichas sintéticas:**
      - etiquetas 36/44 → 43/44, con precisión 100 % y 0 espurias;
      - consignas bien asociadas 15/20 → 19/20, con 0 incorrectas;
      - WER 11,6 → 9,4 % y CER 3,8 → 2,6 %.
    - **Reserva adversarial independiente:** etiquetas 17/24 → 22/24.
    - **Fixtures históricos:** sin regresiones.
    - **Siguiente, Fase II · reconocimiento geométrico,** sobre fichas propias, con desarrollo y reserva, y sin aprobar recortes:
      1. Enderezar la página antes del prefiltro, para que zonas y candidatos trabajen en el mismo marco que el OCR.
      2. Zonas de actividad por columna, a partir de los segmentos de línea del OCR. Hoy cada zona ocupa todo el ancho de la página
         y en 05 bloquea por `uniqueness` / `activity_anchor`.
      3. Asociar etiquetas a su figura mediante las líneas guía y ampliar el recorte para incluirlas. Es el bloqueo `labels` de 01,
         04 y 09; hoy el recorte se calcula sin las etiquetas que detecta la segunda pasada.
      4. Firmas de barra, recta numérica y reloj más robustas al grosor y al giro (`identity_evidence` en 02, 03 y 08).
      5. Umbral de tinta adaptativo para fondos grises y fotocopias degradadas.
      6. Separación de líneas guía diagonales que cruzan una etiqueta (B de 09).
      7. Ampliar la reserva con columnas cuya primera línea supere la evidencia del matcher.
    - **Criterio de Fase II:** más candidatas correctas en desarrollo y en reserva, 0 candidatos erróneos y 0 recortes aprobados.
      Identidad, contenido completo y respuesta visual siguen sin verificarse.

11. **Fase II de geometría hecha (2026-10-15, [QA](qa/geometria-fase2/README.md)), solo en el prototipo.**
    - `figure_geometry@v2` localiza sin caja.
    - Candidatas correctas: 1/10 → 9/10 en desarrollo y 0/6 → 2/6 en la reserva independiente.
    - Una candidata en una negativa (respuesta dibujada); 0 recortes aprobados.
    - **Siguiente, fase de calidad pedagógica:**
      1. **Revisión humana asistida de candidatas.** El docente ve la región propuesta y confirma o corrige. Es el único camino
         seguro de entrega mientras la verificación semántica no exista.
      2. **Referencias pedagógicas validadas por un docente.** Para cada ficha propia: figura imprescindible, partes, etiquetas y
         respuestas que no deben verse. Con ellas se miden integridad y fuga de respuesta, no solo IoU.
      3. **Detector de respuesta visual.** Texto o marcas junto a la figura que coinciden con la respuesta esperada, como la fracción
         escrita junto a la barra. Es el caso que la reserva demuestra que la geometría no ve.
      4. **Robustez:** grano (umbral local y apertura morfológica), ejes partidos y contornos vacíos, medidos en una reserva nueva.
    - **Criterio:** ningún recorte se entrega sin revisión humana mientras `semantic_identity`, `complete_content` y
      `visual_answer_safety` no tengan una fuente de evidencia independiente.

12. **Fase III de calidad pedagógica hecha (2026-10-15, [QA](qa/calidad-pedagogica-fase3/README.md)), solo experimental.**
    - Referencias por ficha, evaluador A–E sin PASS global, adaptador controlado, 16 tipos de error y contrato de revisión humana
      de figuras.
    - Errores verificables detectados: 52/52 en desarrollo y 28/29 en la reserva. Falsos bloqueos: 0/15 y 0/9.
    - Errores no verificables: ninguno detectado, todos pendientes para el docente.
    - **Ninguna referencia está validada por un docente.**
    - **Siguiente:**
      1. **Revisión docente.** Aplicar el paquete de revisión entregado y registrar `revisada_docente` o `aprobada_docente`, con
         el sha-256 de la referencia, solo en las fichas que el docente marque.
      2. **Generador real contra referencias.** Primero mock y después, con autorización, modelo real. Medir las mismas métricas
         sin ajustar con la reserva.
      3. **Criterios falsos en apoyos.** Lista de concepciones erróneas por tema, revisada por el docente («mismo número de
         partes», «quedaron = restar»…), como comprobación C/E.
      4. **Revisión humana de figuras en producto.** Solo después de un diseño de UX aprobado y sin conectarla a Hacer magia hasta
         entonces.
    - **Criterio:** ninguna adaptación ni referencia cuenta como validada sin el registro de revisión del docente.

Max temporal, SQL de siete días, Stripe de prueba, pricing y pruebas pagadas quedan aparcados por instrucción del usuario; no bloquean estos bloques. Esta sesión usa verificaciones focalizadas autorizadas, sin repetir toda la batería ni el build, innecesario para este cierre focalizado.

## Fase 0 — Cimientos y documentación ✅
- Proyecto Next.js 16 + TS estricto + Tailwind 4 + pnpm + Vitest.
- `CLAUDE.md`, `docs/*`, `.env.example`.
- Contratos Zod iniciales: `MaterialDocument`, `FunctionalProfile`, `AIProvider` (tipos).
- Tests unitarios de los schemas.
- **Esquema completo de base de datos adelantado** (para instalarlo una sola vez en Supabase): migraciones 001-006 (+ 007 de aprovisionamiento en Fase 1) (todas las tablas del MVP, RLS, Storage, cuotas) + seed, con tests en `tests/db`. Las fases siguientes añaden migraciones solo si hace falta cambiar algo.

## Fase 1 — Base de la aplicación ✅
- Tokens de diseño e Inter; primitivas propias de UI (sin shadcn por ahora); layout de marketing y de la app (sidebar escritorio + barra inferior móvil).
- Landing real y `/como-funciona`, `/precios` (leen los planes de la BD), `/privacidad`, `/terminos`, `/cookies` (legales **provisionales**, marcados como pendientes de revisión jurídica). La landing lleva un distintivo «Acceso anticipado» porque el motor de adaptación aún no existe.
- Supabase: clientes `client`, `server`, `admin` (aislado) y `proxy.ts`; ENV público/servidor con Zod; feature flags.
- Auth: registro, login, magic link, olvidé/restablecer contraseña, callback (con protección frente a redirecciones abiertas), logout; Google detrás de `FLAG_GOOGLE_AUTH`. Confirmación de email: depende de la configuración del proyecto Supabase.
- `requireUser` / `requireWorkspace` / `requireWorkspaceRole`; aprovisionamiento idempotente del workspace (migración 007).
- Onboarding de 3 pasos; dashboard con datos reales (sin simular); secciones de fases posteriores con estados vacíos honestos.
- **Tests:** unit (env, rutas seguras, workspace, fronteras cliente/servidor), BD (aprovisionamiento), E2E (rutas protegidas, axe, responsive).

## Fase 2 — Perfiles de alumnado ✅
- `/app/alumnos`: listado (loading, vacío, error, límite alcanzado), creación, edición, duplicado y borrado con confirmación; `checkEntitlement('profile.create')` con límites desde `plans`.
- Divulgación progresiva: información básica → 11 áreas → solo los controles de las áreas elegidas; 11 presets orientativos que no se guardan; resumen determinista «Así se aplicará» (sin IA).
- Se añadió el grupo de dimensiones «Ampliación y reto» (necesario para altas capacidades).
- Acceso a perfiles ajenos o a ids inválidos: 404 sin pistas.
- **Tests:** unit (presets → perfil funcional, `activeSupports`, resumen, validación, entitlements); BD (RLS, límites, ya cubiertos en `tests/db`); E2E contra `fake-supabase` (registro → onboarding → crear → editar → listado, límite Free, duplicar/eliminar, acceso cruzado).
- **Pendiente antes de producción:** repetir el E2E contra un proyecto Supabase real de pruebas (el fake no aplica RLS).

## Fase 3 — Subida de materiales y análisis — PHASE 3: CLOSED (2026-10-05)
Objetivo: **comprender** el material, no adaptarlo. Termina en `MaterialAnalysis` guardado y reutilizable.
- Migraciones 008 (elimina `learner_profiles.notes`) y 009 (estados de material, `confirmed_fields`, `analysis_meta`, jobs `analyze` con máquina de estados atómica, `adaptations.material_id` en `RESTRICT`, `ai_runs` con coste nulo y `material_id`).
- Subida segura en dos pasos con URL firmada; validación en servidor sobre los bytes (firma, tamaño, páginas, cifrado); hash SHA-256; Storage privado con ruta `<workspace>/<usuario>/<material>/<uuid>`; borrado seguro y limpieza de huérfanos.
- Capa de IA: `AIProvider` como transporte, alias → router → proveedor (Anthropic y mock; OpenAI reservado), salida estructurada + Zod + normalización con ids del servidor, reparación acotada, costes centralizados y `ai_runs` por llamada.
- `MaterialAnalysis` v2 y prompt `material_analyzer@v1` con protección frente a inyección.
- Job persistente con lease, reintentos y recuperación; caché por hash dentro del workspace; el análisis no consume cuota de adaptaciones.
- UI: `/app/adaptar`, `/app/materiales` (filtros, reintentar, eliminar) y `/app/materiales/[id]` (progreso real, resultado, corrección del contexto con procedencia).
- Evals de análisis (`evals/material-analysis`, 20 casos) y `docs/SUPABASE_TESTING.md`.
- **Pendiente (requiere credenciales):** primera ejecución de los evals con el modelo real; suite `tests/rls-real` y E2E contra un proyecto Supabase real; verificación en Vercel de la vista previa de PDF y de la ejecución inmediata de jobs (ADR-004) en producción.

### Cierre de la Fase 3 — evidencias reales (STANDARD = `claude-sonnet-5-5`, effort medium)
- **Primaria** (análisis real con el prompt anterior, `material_analyzer@v1`, 2026-10-04): estructura básica, fracciones, visuales y respuestas `inferred` correctos; ≈ $0,058 por análisis.
- **Geografía y Historia, 3.º ESO, escaneada** (`material_analyzer@v3`, una llamada, válida a la primera, 0 retries, 0 repairs): 1 tabla y 2 gráficos con valores y categorías correctos, 6 actividades, restricciones y datos numéricos, condición de escenario «sin reducir el número total de desplazamientos» protegida, áreas de respuesta y campos administrativos correctos, respuestas `inferred` exactas y ninguna respuesta abierta inventada. Coste $0,054098, 3.249 tokens de salida, 16,9 s.
- **Lengua, 1.º Bachillerato** (`material_analyzer@v3`, una llamada válida): texto de lectura preservado literalmente (`reading_text`), 5 actividades, restricciones de escritura (70-90 y 150-180 palabras) protegidas, ninguna respuesta abierta inventada. Coste $0,0550.
- **Alcance:** son tres fichas; **no** se afirma que todo tipo de material esté validado. Queda **validación continua durante la beta** (más asignaturas, escaneos de peor calidad, materiales largos) y la comparación ECONOMY pendiente de aprobación.
- **Deuda aceptada (no bloquea la Fase 4):** (1) el modelo puede inventar `series[].name` en gráficos de una serie aunque el prompt pida dejarlo vacío (regla de consumo en `docs/AI_PIPELINE.md`); (2) `essential` puede superar el 75 % de los elementos protegidos cuando pedagógicamente está justificado; (3) puede aparecer algún nombre de sección descriptivo no literal; (4) `necessary_visual` no representa bien algunos recursos textuales; (5) algún elemento protegido puede ser redundante con `resource_ids`.
- **Activo por defecto:** `AI_ANALYSIS_PROMPT_VERSION=3` (v1 y v2 siguen disponibles e inmutables).
- **Pendiente fuera de la fase:** suite `tests/rls-real` y E2E contra un proyecto Supabase real de pruebas; revisión de límites de plan con costes medidos.

## Fase 3.6 — `MaterialAnalysis` v3 (contrato compacto y consistente; sin llamadas reales)
Objetivo: dejar el análisis como contrato fiable de la Fase 4 antes de volver a gastar en APIs.
- **Contrato v3** (`src/lib/schemas/material-analysis.ts`) y prompt `material_analyzer@v2`; v1/v2 siguen leyéndose (`analysis/upgrade.ts`, sin reescribir filas ni reanalizar). Sin migración de BD (`materials.analysis` es JSONB).
- Tablas y gráficos como una única entidad con datos estructurados; áreas de respuesta físicas por actividad; campos administrativos aparte; `protected_elements` tipados con importancia; recuentos e inversas calculados por el servidor; relaciones simétricas por construcción.
- Utilidad de tamaño y coste teórico (`pnpm eval:analysis:size`), `--alias` / `--prompt-version` / `--model` en los evals para el benchmark STANDARD vs ECONOMY vs otro proveedor.
- Validado después con el modelo real (prompts v2 y v3); el prompt v3 es el activo (ver «Cierre de la Fase 3»).

## Fase 4 — Pipeline de adaptación
**Base arquitectónica offline: hecha (2026-10-05).** Contratos versionados `AdaptationContext` v1, `AdaptationPlan` v1, `MaterialDocument` v1 y `PedagogicalReview` v1; taxonomía de 20 estrategias; invariantes pedagógicas y revisión deterministas; ensamblado del documento sin modelo para lo conservado; trazabilidad original → decisión → bloque; corrección docente local; instrumentación de coste por etapa; mocks, `pnpm eval:adaptation:mock` y tests. Sin llamadas reales ni migraciones. Ver `docs/ADAPTATION.md` y ADR-020.
**Planificador:** `adaptation_planner@v1` publicado y validado con un experimento real (una llamada, $0,033). **Generador:** `material_generator@v1` (congelado) y `@v2` (fuente canónica, sin redundancia estructural; no activo hasta validarse), con capa de revisión humana del plan y auditoría determinista. Política 2 del constructor de contexto (H4), respuesta inferida textual como WARN a revisar y orden fuente determinista. `adaptation_planner@v2` publicado (no activo; v1 congelado) y validado con una llamada real en Primaria ($0,0227): válido a la primera, 4 decisiones, sin fugas. PlanReview real hecho (3 decisiones efectivas) y primera llamada de generator v2 en Primaria **detenida por esquema** (checklist global de 5 elementos frente a un tope de 4). Resuelto con el enrutado de ejecución (`execution.ts`): segunda llamada válida a la primera y todas las auditorías deterministas en verde (`dec_4` diferida al renderer). `pedagogical_reviewer@v1` publicado (no activo) y validado una vez en Primaria ($0,0184; fusión en servidor con autoridad acotada). Validación adversarial real del revisor superada (fuga semántica, pista, infantilización y redundancia detectadas; control seguro limpio): candidato a pipeline experimental, no producción. Planner v2 validado dos veces con modelo real (Primaria y Bachillerato, política 2): H1 y H4 resueltas, H5 parcial; candidato a default **experimental** con PlanReview. Pipeline integrado validado sobre Bachillerato (dos llamadas, $0,039; cadena limpia $0,124): sin fugas, sin pérdida de protegidos, decisión diferida preservada. El núcleo IA de la Fase 4 queda validado con caveats (H5 parcial, apoyos de baja utilidad, R1 del revisor). Orquestación real implementada offline (`src/lib/adaptation/orchestration/`, migración 013): máquina de estados con pausa humana obligatoria, versiones fijadas, idempotencia por etapa, leases, detección de intentos ambiguos, `ai_runs` por etapa y coste por etapa; sin cuotas ni UI. Cuotas de adaptación implementadas (migración 014: reservar al crear, consumir con la entrega, liberar al cancelar; sin precios nuevos). Capa web conectada (migración 015): comandos como Server Actions, jobs durables, worker con lease/fencing, reconciliador, cron `/api/cron/adaptations`, rutas de lectura privadas y DTO de estado. **UI de adaptación implementada** (`/app/adaptaciones/[id]`: sondeo, revisión docente del plan, generación, resultado temporal, errores, cancelación y entrada desde el material; sin visor del documento). **Fase 5.1:** renderer determinista de `MaterialDocument v1` (visor HTML/CSS A4 e impresión, `material_renderer@v1`, ruta `/app/adaptaciones/[id]/vista`). Localización humana de visuales originales con recorte determinista en servidor (migración 016, `pdfjs-dist` + `@napi-rs/canvas`). **Fase 5.2A:** motor PDF en local (sin base de datos ni rutas). **Fase 5.2B:** descarga del PDF bajo demanda (`GET /api/adaptations/[id]/pdf` y botón «Descargar PDF» en la vista), validada en local. Validación en runtime de Vercel: DEFERRED.
- Prompts planner/generator/reviewer/block_reviser v1; orquestador idempotente; ejecución inmediata en la petición del docente (claim atómico) + cron diario solo de recuperación; polling del progreso.
- Wizard `/app/adaptar` completo; varios perfiles (flag `MULTI_PROFILE_GENERATION`); devolución de cuota ante fallos.
- `/evals` con 30 casos + runner; primera medición real de coste y calidad (con presupuesto aprobado).
- **Tests:** unit (comprobaciones deterministas, reglas de reintento y escalado); integración (job completo con mock: éxito, fallo con devolución, fallo parcial, reanudación tras caída); E2E (subida → adaptación con mock → resultado).

## Fase 5 — Renderer, editor y PDF
- `MaterialRenderer` (todos los tipos de bloque, plantillas `estandar` y `secundaria-sobria` como mínimo, KaTeX).
- Editor por bloques (edición, mover, duplicar, eliminar, regenerar), autoguardado, deshacer/rehacer, versiones.
- Comparador; "¿Qué hemos adaptado?".
- **Spike PDF** (ADR-007) y después la implementación: A4, saltos de página, cabeceras y números de página, exports cacheados. **5.2A (motor) hecha en local:** `material_renderer@v2`, `renderPrintHtml`, `PdfEngine` (Chromium serverless), `PdfValidation` y `pnpm smoke:pdf` (1, 3 y 10 páginas, entre otros casos). **Empaquetado en Vercel: PASS (CLI 62.1.0 + pnpm 12.8.1, *tracing* físico). Validación en runtime de Chromium/PDF en Vercel: DEFERRED** hasta configurar el proyecto y sus variables de entorno (ver `docs/ADAPTATION.md`). **5.2B hecha (bajo demanda):** ruta `GET /api/adaptations/[id]/pdf`, mismo `buildRenderModel` y mismo renderer que la vista, visuales fijados a la instancia verificada, validación `pdf-lib` en cada petición y botón «Descargar PDF». No se persisten PDFs: la tabla `exports` existe pero no está activa. **Pendiente:** validar el runtime de PDF en Vercel con el entorno definitivo; caché o histórico de exportaciones (tabla `exports`, Storage); límite de frecuencia para exportar.
- Feedback 👍/👎.
- **Tests:** unit (reducers del editor, mapeo de bloques); visual (snapshots del renderer); PDF de 1, 3 y 10 páginas (número de páginas, sin bloques cortados, texto seleccionable); E2E (editar → descargar).

## Flujo del docente de punta a punta ✅ (encargo «PHASE 6 — TEACHER WORKFLOW»; no es la Fase 6 de Stripe de abajo)

Une las piezas existentes en un solo camino, sin pipeline, renderer, motor PDF ni cuotas nuevos: material → análisis → perfil → adaptación → propuesta (revisión del docente) → ficha → vista del alumno → PDF. Inicio con «Necesitan tu atención» / «En curso» / «Fichas preparadas», historial real, «Adaptar este material» arriba en la ficha del material, perfil creado desde el material que vuelve a él, adaptar desde un perfil y desde `/app/adaptar`, solo lectura sin comandos, PDF en la pantalla de ficha preparada y la asignatura por su nombre en la cabecera de la ficha. En desarrollo y E2E el pipeline completo corre con los dobles deterministas (sin modelos) y un E2E (`tests/e2e/teacher-workflow.spec.ts`) recorre el camino en escritorio y móvil. Detalle: `docs/UX.md` § «Flujo del docente de punta a punta».

**Deuda que se mantiene:** validación del PDF en runtime de Vercel (DEFERRED); función SQL `list_adaptations_needing_job` sin uso; `POST …/analysis/run` sin efecto de un miembro de solo lectura en la pantalla de análisis; cerrar la pestaña antes del `/run` deja el job al cron de recuperación; sin plazo global por etapa; el E2E histórico de cuota (esperado 10, recibido 9); la ruta PDF pesa ≈116 MB; la ficha de diez páginas lógicas ocupa 11 físicas. *(Corrección posterior: el plan Free no tenía 0 adaptaciones; el seed ya fijaba 5 al mes y se confundieron las columnas de precio. Ver «Política de producto».)*

## Política de producto: Free útil y presets funcionales ✅ (encargo «PHASE 6.1»)

- **Free = 5 adaptaciones/mes (PROVISIONAL).** Ya era el valor del seed; se documenta como provisional (sirve para evaluar el producto y limita el coste; se revisará con el pricing definitivo) y se fija con tests sobre el seed real (5 se crean, la 6.ª se rechaza, sin doble consumo, cancelar devuelve la unidad, subir a Pro amplía el límite, la pantalla de uso lo refleja). Única fuente: la tabla `plans`. `/precios` los presenta como «precios y límites de lanzamiento». Pro/Max y los límites de análisis no cambian.
- **Presets por necesidad funcional.** Los nombres visibles describen el apoyo que configuran («Lectura y decodificación», «Atención, planificación y organización»…), no una condición. Ids y dimensiones intactos (congelados en un fixture); el preset nunca se guarda ni llega a la IA. El alias del perfil recuerda que no hace falta ningún dato médico.
- **Pendiente:** pricing definitivo y economía unitaria (Fase 6 de abajo).

## Controles de coste y telemetría ✅ (encargo «PHASE 7B»; cuotas sin cambios y provisionales)

- `/precios` muestra solo lo que existe y se aplica (adaptaciones, análisis, perfiles, páginas por material, PDF). Clases, recursos visuales y varios perfiles por ficha se declaran no disponibles; historial, prioridad, PREMIUM, plantillas y editor no se mencionan. «Cómo funciona» deja de prometer la adaptación rápida sin perfil.
- Cuota ≠ coste: `ai_spend_summary` (interno) mide el dinero gastado por workspace y periodo, fallos incluidos. Las respuestas rechazadas de planificador, generador y revisor conservan sus tokens y su coste.
- Límite de 3 generaciones de producto por adaptación y presupuesto de 40 fallos de pago cada 24 h por workspace, comprobado al admitir jobs nuevos.
- **Pendiente:** pricing definitivo con telemetría real; alertas de coste; la sección «Tipos de adaptación» de la landing anuncia tipos que la app no deja elegir (hoy solo «accesibilidad»).

## «Hacer magia» de verdad: ilustraciones revisadas y contrato visual (migración 024)
- **Hecho:**
  - **Política visual v2:** una ilustración generada y revisada para imágenes sin datos exactos, entre la figura exacta (VisualSpec)
    y la reescritura o sustitución.
  - **Referencias colgantes:** «Observa el esquema» sin esquema es una necesidad visual en magia y un FAIL en la revisión
    determinista.
  - **Contrato por recurso visual:** clase, procedencia, razón, validación y activo privado.
  - **Gate `image.generate` real:** flag, plan y cuota `image`, con idempotencia y devolución.
  - **Tiempo:** nada se empieza si no puede terminar dentro del lease.
  - **Fallos transitorios:** retry de la etapa, nunca una parada.
  - **Correcciones:** la autocorrección respeta el plan visual, y los apoyos de ficha completa ya no paran la ficha.
  - **Validación:** casos B (célula, 1.º ESO) y C (parada honesta) probados sin IA real, en PGlite y en PDF real.
  - **Eval opt-in con modelos reales:** `pnpm eval:illustrations`.
- **Pendiente:**
  - primera ejecución real del eval de ilustraciones, con credenciales de OpenAI y la organización verificada;
  - comprobar el despliegue por entorno cuando se retomen las integraciones: el usuario confirma 024 aplicada en Supabase, sin verificación remota en esta sesión;
  - edición de imágenes del original (legibilidad, escaneos);
  - localizador para figuras genéricas en escaneos sin texto;
  - ejecutores para formatos cerrados, simplificación y reorganización en magia (hoy `needs_decision`);
  - pictogramas con licencia comercial.

## «Hacer magia» 2.0 — recuperación localizada (2026-10-21, ADR-038)
- **Hecho (simulado y probado, sin llamadas de pago):**
  - diagnóstico atribuido;
  - criba, aislamiento y reparación determinista;
  - regeneración solo de las decisiones afectadas;
  - guarda sin progreso;
  - estructura del original (líneas, párrafos, campos y ordenación);
  - apoyos sin redundancia;
  - fuga de lo evaluado;
  - motivo preciso de las paradas visuales;
  - matriz de 8 fichas sintéticas;
  - kit de prueba real v4 fuera de Git.
- **Aceptación pendiente:** nueva prueba real autorizada con el kit v4 y presupuesto por ficha. El objetivo experimental es ≥ 6/8 sin defectos críticos, sin prometerlo. Con esta entrega, 03, 06 y 07 siguen bloqueadas.
- **Siguiente:**
  - especificación determinista de polígonos acotados (ficha 03);
  - decidir si se activan las ilustraciones o se crea un contrato de entrega «asistida» (06, 07);
  - revisión docente de los campos y las casillas de ordenación.

## Recuperación fiel de figuras originales (2026-10-22, ADR-039)
- **Hecho (probado localmente, sin llamadas de pago).** Las figuras genéricas se localizan por las marcas que nombra su análisis (`auto_visuals@v6`): letras, flechas numeradas y medidas.
  - Las cuatro figuras reales de 03, 06 y 07 se recortan del original con confianza 0,90 y píxeles idénticos ([QA](qa/figuras-originales/README.md)).
  - La verificación separa tres aspectos: identidad, fidelidad y pedagogía.
  - «Hacer magia» usa el original sin generar ninguna ilustración.
- **Aceptación pendiente:** prueba real autorizada con la salida real del analizador para 03, 06 y 07.
- **Siguiente:**
  - comprobar si el analizador nombra las marcas;
  - si no lo hace, valorar un prompt `v<N+1>` que pida enumerar las marcas visibles, sin inventarlas.

## Estándar editorial y espacios de resolución (Fase B, 2026-10-22, ADR-040)
- **Hecho (probado localmente, sin IA):**
  - CLARO como diseño único por defecto;
  - `answer_space@v1`: cuadrícula, problemas por partes, unidad sin escribir, líneas por demanda, Sujeto/Predicado por oración y dibujo;
  - campos en línea;
  - `roomy` por perfil;
  - paginación medida en el PDF;
  - figuras a la vista al comparar;
  - cierre de calidad: garantía física de espacio (mm), cuadrículas por demanda en zonas, «Dibujo» y «Explicación» en los cálculos que los piden y `material_renderer@v6`.
- **Pruebas:** galería de 8 fichas, tres casos límite y antes/después de 03, 06 y 07 reales ([QA](qa/fase-b-editorial/README.md)).
- **Siguiente:**
  - validación con docentes;
  - tablas de clasificación que el original no imprime;
  - alternativa oral por perfil.


## Identidad visual corporativa (Fase C, 2026-10-23, ADR-041)
- **Hecho (probado localmente, sin IA):**
  - piezas oficiales en SVG y PNG, fieles a los originales y medidas;
  - variantes en grises y en una tinta, favicon, icono de Apple y manifiesto;
  - tokens corporativos y variantes accesibles;
  - el logotipo en todos los puntos de identidad;
  - el símbolo en la ficha y en el PDF (`material_renderer@v7`);
  - la forma: los titulares en Outfit, los pasos en los colores de «aula» y «Hacer magia» en el azul de marca.
- **Pruebas:** E2E de identidad, galería antes/después y fichas en vista previa, PDF y grises ([QA](qa/fase-c-marca/README.md)).
- **Siguiente:**
  - la barra de la vista previa, con la descarga como acción principal;
  - una variante para fondo oscuro;
  - el símbolo en el pie de cada página.
## Fase 6 — Stripe, planes y cuotas
- Checkout, Portal y webhook idempotente; `subscriptions`, `billing_customers`, `stripe_events`.
- Plan efectivo, entitlements en todas las acciones, `/app/uso` («Plan y cuenta», con la facturación del Customer Portal) y `/precios` conectada.
- Copy de límite alcanzado en todos los puntos.
- **Tests:** unit (plan efectivo, periodos); integración (webhooks: firma, duplicados, orden invertido); E2E (Free genera 5 y la 6.ª se bloquea; upgrade con Stripe test + CLI; un fallo de IA no consume cuota).

## Fase 7 — Pulido, accesibilidad y seguridad (cierre del MVP)
- Auditoría WCAG 2.2 AA (axe + revisión manual con teclado y lector de pantalla).
- **Hecho (2026-10-13, ADR-024):** navegación sin pantallas «Próximamente» (Clases, Plantillas, Ayuda y Configuración retiradas con redirección), «Plan y cuenta», «Adaptaciones» con filtros, esqueletos por sección y movimiento con `prefers-reduced-motion`. Pendiente: revisión manual con teclado y lector de pantalla.
- Cabeceras de seguridad + CSP con nonce; rate limits; revisión de logs sin datos sensibles.
- Admin mínimo: KPIs, jobs, coste de IA, prompts (activar versión).
- Retención (cron), exportar mis datos, eliminar cuenta.
- Analítica de producto (`product_events`) con todos los eventos del catálogo.
- Monitorización de errores (decisión: Sentry UE o alternativa).
- **Tests:** suite completa + E2E de seguridad (A no accede a B, en todas las entidades) + Lighthouse/axe.

**= MVP comercializable** (tras la revisión legal de `docs/PRIVACY.md`).

## Fase 2 del producto (post-MVP)
Max (flag) · generación de imágenes · clases y "Adaptar para 5ºA" · adaptación múltiple ampliada · comparador avanzado · más plantillas · ampliación de evals a 100+ casos.

## Fase 3 del producto
Centros: multiusuario, roles, panel de centro, biblioteca compartida, facturación institucional, límites compartidos, políticas de retención por centro, SSO si hay demanda, analítica agregada. Lenguas cooficiales.

## Decisiones abiertas

| Tema | Cuándo | Notas |
|---|---|---|
| Validación del PDF con Chromium en Vercel | Fase 5 (spike) | **DEFERRED:** empaquetado PASS; runtime pendiente de la configuración definitiva del proyecto. Alternativa: `@react-pdf/renderer` |
| Modelos OpenAI concretos (texto alternativo) | Fase 3 / Fase 2 del producto | Verificar IDs y precios en la documentación oficial. Los de imagen ya están verificados (12-10-2026, `docs/AI_PIPELINE.md`) |
| Margen Pro/Max con costes reales | Fase 4 | Ajustar cuotas, routing o precios con datos de `ai_runs` |
| Email transaccional (proveedor SMTP) | Fase 1 | Preferiblemente UE |
| Monitorización de errores | Fase 7 | |
| Revisión legal y fiscal (RGPD, IVA/OSS) | Antes del lanzamiento | Externa |
