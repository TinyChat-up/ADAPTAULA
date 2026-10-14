# Registro de desarrollo

Registro compartido entre Codex y Claude Code. Añadir una entrada por bloque: base, rama/PR, cambios, verificaciones, límites y siguiente acción. Nunca incluir secretos, materiales privados o datos del alumnado.

## 2026-10-14 — Auditoría independiente y correcciones de PR #30

- **Base y alcance:** `main` en `1929849`; rama `claude/fase-8-2b6-escaneos`, HEAD auditado `ccfbf3e`, coincidente con remoto y `refs/pull/30/head`. Se corrige esa misma PR, sin fase nueva, otra PR ni merge. Entorno ya preparado; no se repite la suite completa.
- **Fallos reproducidos antes de corregir:** diez fixtures adversariales aceptados a 0,75 sin ancla independiente (A–I solicitados y J, pérdida de etiquetas). Nueve muestran selección equivocada, contaminación o pérdida; H muestra el límite de evidencia en un escaneo plausible. Fallan las diez aserciones de rechazo contra el código original. Otras tres pruebas PGlite demuestran entrega de decoración, reutilización de activos scan antiguos y aceptación de una fuente precargada con SHA distinto del localizador efectivo.
- **Correcciones de producción:** `auto/scan.ts` rechaza la localización sin evidencia independiente; `auto/locate.ts` y `auto/service.ts` cierran entradas alternativas por visión y corroboración de forma en páginas sin texto. Motor `auto_visuals@v4` invalida el resultado cacheado anterior. `visuals/service.ts` y `server.ts` consultan evidencia bajo RLS, bloquean activos automáticos scan antiguos en resolución, producción y pins y comprueban el SHA de la fuente precargada. Se conservan filas/bytes históricos y selección humana. Se elimina el recorrido de componentes del escaneo y se libera la caché de alta resolución entre páginas.
- **Pruebas añadidas o ajustadas:** `scan-adversarial`, `scan-location`, `scan-audit`, `scan-visuals`, harness PGlite, integración `magic-visual-policy` y PDF de célula con selección manual explícita. La integración demuestra parada sin entrega/descarga cuando falta la figura, ausencia de llamada a visión y cuota no consumida. El fixture de procedencia antigua modifica evidencia únicamente en PGlite; no se altera la inmutabilidad de producción.
- **Verificación:**
  - `pnpm exec vitest run tests/unit/scan-adversarial.test.ts tests/unit/scan-location.test.ts tests/db/scan-audit.test.ts tests/db/scan-visuals.test.ts tests/db/magic-visual-policy.test.ts`: **57 PASS**.
  - `pnpm exec vitest run tests/unit/automatic-visuals.test.ts tests/unit/visual-raster.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts tests/db/automatic-visuals.test.ts tests/db/visual-locators.test.ts tests/db/visual-instances.test.ts tests/db/pdf-export.test.ts`: **97 PASS**.
  - `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/scan-visuals.test.ts tests/pdf/automatic-visuals.test.ts tests/pdf/table-choice-substitution.test.ts tests/pdf/illustrations.test.ts`: **4 PDF PASS**. Inspección visual de célula: esquema y etiquetas completos junto a la actividad correcta; renderer sin cambios.
  - **154 pruebas focalizadas únicas en 13 archivos**, más los 4 PDF; la repetición de `scan-audit` tras ampliar comprobaciones de lectura rápida, bytes y corrección manual no suma casos nuevos.
  - Typecheck PASS; lint sin errores, un aviso previo en `analysis-run-auth.test.ts`; `git diff --check` limpio.
  - Sin suite completa, build, llamadas pagadas, SQL remoto, migraciones, Stripe ni cambios comerciales.
- **Evidencia y documentación:** [informe reproducible con fixtures y resultados antes/después](qa/pr30/README.md), `PROJECT_STATUS.md`, `VISUAL_RESOURCES.md`, ADR-027 en `ARCHITECTURE.md` y `ROADMAP.md`. La entrada original que sigue es histórica y sus afirmaciones de aceptación automática quedan sustituidas por esta auditoría.
- **Límites:** se rechazan automáticamente todos los escaneos sin texto, incluso la célula correcta. Se mantienen selección humana y localización anterior con capa de texto. No se certifican selecciones humanas arbitrarias, páginas híbridas/OCR falso, escaneos reales ni consumo máximo en Vercel. No se consultó producción ni se recuperan documentos ya descargados.
- **Decisión y siguiente acción:** **NO MERGE como Fase 8.2B.6 terminada**. Publicar las correcciones en la misma rama de #30; revisar la PR como restricción de alcance y protección contra entregas incorrectas. Antes de retomar la localización automática, definir una fuente independiente de identidad/asociación e integridad; esa implementación queda fuera de esta auditoría.

## 2026-10-14 — Fase 8.2B.6: localización conservadora de figuras en escaneos (histórico; aceptación retirada por la auditoría anterior)

- **Base verificada:** `git fetch origin main` → `1929849`. #27 (`bb38cd0`), #28 (`70fb9ea`) y #29 (`1929849`) están integradas. Rama nueva: `claude/fase-8-2b6-escaneos`. La rama y el trabajo de la PR #29 no se tocan.
- **Investigación:** `locate.ts` puntúa:
  - firma 0,30 (una figura genérica, 0);
  - zona de su actividad 0,25, que exige un ancla de la capa de texto del PDF;
  - unicidad 0,20;
  - limpieza 0,15;
  - visión 0,20.

  En un escaneo, `pageText` devuelve 0 cajas: no hay anclas y la «limpieza» no ve el texto escaneado. Una figura genérica nunca pasa de 0,35 sin visión, y una barra de 0,65. `MaterialAnalysis` v3 no guarda la posición de los visuales. Ya resuelto: figuras con anclas impresas (barra o recta con firma) y cualquier figura con acuerdo de visión. Fallaba: cualquier figura de una página sin capa de texto sin visión configurada.
- **Fallo reproducido antes de cambiar producción:** `tests/support/scan-case.ts` construye «La célula animal» escaneada: 150 ppp, una imagen por página, papel, grano, motas y la sombra del escáner. `locateVisuals` daba `vis_1` no aceptado, confianza 0,15, `low_confidence`, sin ancla → D y parada.
- **Implementación:**
  - `src/lib/materials/visuals/auto/scan.ts` (`locateOnScan`):
    - componentes conectados a resolución completa;
    - descarte de motas, tinta en el borde, marcos (cuatro lados y poco interior), manchas claras y filas de letras grandes;
    - unión de los trazos de un dibujo;
    - etiquetas cercanas al recorte;
    - holgura de 2,5 mm frente al texto;
    - límite de texto y de tamaño;
    - firma de barra cuando el análisis dice barra.
  - Exige además que el análisis liste un único visual en la página y que sea `required`.
  - `service.ts` (motor `auto_visuals@v3`) lo usa solo en páginas sin capa de texto, después del localizador con anclas. La visión no lo sobrescribe.
  - Las señales `scan` se guardan en la evidencia del localizador, sin texto del material.
  - Sin migraciones: el esquema ya admite `evidence` JSON.
- **Evidencia para aceptar:** análisis (único visual, imprescindible) + único dibujo de tamaño de figura y tinta oscura + recorte limpio. Confianza exactamente 0,75; ninguna señal parcial basta.
- **Pruebas:**
  - `tests/unit/scan-location.test.ts` (20):
    - el fallo anterior;
    - acierto en PDF y PNG, con IoU > 0,8 respecto al esquema;
    - recorte sin enunciado ni líneas de respuesta, a 200 ppp con margen;
    - adorno pequeño;
    - titular enorme y párrafo enmarcado junto a la figura;
    - figura en el borde;
    - negativos: dos figuras, adorno grande, sin figura, solo texto, texto pegado, varios visuales en el análisis, no `required`, barra que no lo es, recta numérica, página con capa de texto;
    - coordenadas válidas;
    - política: `exact_original_visual` en `act_1`, o parada `unresolved_visual`.
  - `tests/db/scan-visuals.test.ts` (5, PGlite con migraciones reales):
    - localizador `auto` con página, coordenadas, `page_box`, sha, motor y señales;
    - recorte en Storage y lectura con RLS;
    - imagen PNG;
    - ambigüedad → D sin filas;
    - nueva versión del original → D sin heredar;
    - recorte automático anterior equivocado → `auto_not_revalidated`.
  - `tests/pdf/scan-visuals.test.ts` (Chromium): el recorte fijado por sha es la figura de la actividad 1, antes de la actividad 2, sin peticiones ni scripts. PDF inspeccionado: una página con el esquema y sus números 1, 2 y 3.
- **Resultados:**
  - `pnpm exec vitest run` de las unitarias `scan-location`, `automatic-visuals`, `magic-visual-policy`, `visual-raster`, `visual-boundaries` y `boundaries`, y de db `scan-visuals`, `automatic-visuals`, `magic-visual-policy` y `visual-locators`: **144/144 PASS en 10 archivos**.
  - `vitest.pdf.config.mts`: `scan-visuals`, `automatic-visuals` e `illustrations` **3/3 PASS**.
  - `pnpm typecheck` PASS; `pnpm lint` 0 errores (el aviso previo en `analysis-run-auth.test.ts`).
  - No se ejecutó la suite completa.
- **Casos todavía ambiguos o fuera de alcance:**
  - varias figuras por página;
  - un adorno grande, o una mancha;
  - texto a menos de 2,5 mm;
  - rectas numéricas escaneadas;
  - páginas con varios visuales en el análisis.

  Riesgo residual documentado: una única letra enorme aislada, o texto que toca el dibujo, cuando el análisis afirma un solo visual. Sin OCR ni modelos de imagen; sin llamadas de pago, SQL remoto, Stripe ni cambios de planes. Validado solo con escaneos sintéticos.
- **Publicación:** implementación `71b6080` en `claude/fase-8-2b6-escaneos`, publicada en la [PR #30](https://github.com/TinyChat-up/ADAPTAULA/pull/30) hacia `main`, sin merge.
- **Siguiente acción:** revisar la PR; medir la cobertura con escaneos reales autorizados antes de ampliar el caso; no presentarlo como localización universal.

## 2026-10-14 — PR #29: redirección editorial como estudio pedagógico digital

- **Continuidad verificada antes de editar:** rama única `claude/variables-expuestas-repo-f2o2et`, actualizada y limpia en `6fa99fc25fa9a152febf882c0a0fbacfd0b84ae7`; la rama remota y `refs/pull/29/head` coinciden. Publicación comprobada con `git push --dry-run`. Se leen AGENTS, CLAUDE y el contexto compartido y se inspecciona el diff de Claude respecto a `main` (`70fb9ea`). PR #29 abierta y sin merge según el usuario; no se reinicia ni sustituye su rama.
- **Método:** capturas de diez pantallas × escritorio/móvil antes de modificar producto, decisión de sistema visual y rediseño sobre las primitivas existentes. Capturas finales comparadas visualmente; [galería versionada y método](qa/pr29/README.md), con copia ZIP entregada al usuario. Solo datos sintéticos y workspace local de prueba; no sesiones ni credenciales en los artefactos publicados.
- **Decisión ADR-025:** papel cálido, tinta y azul editorial; Inter en UI y Georgia del sistema en titulares públicos; filetes, numeración y jerarquía. Sin nuevos paquetes/fuentes, gradientes, halos, tarjetas flotantes ni animaciones ornamentales. Bordes de controles separados de los filetes decorativos. Contrastes sobre papel/blanco: tinta ≥12,96:1, texto secundario ≥5,73:1, enlaces ≥6,45:1 y borde de campo ≥3,31:1.
- **Portada:** dos hojas A4 legibles, con la misma tabla de animales, pregunta y opciones, sin marcar solución; demostración estática explícita. Copy de pasos y acceso conforme a Hacer magia o Revisar antes de crear, con descarga cuando la ficha esté lista. Tipografía, secciones públicas, navegación, acceso y CTA coherentes con el sistema.
- **Aplicación:** Inicio coloca atención y trabajos por delante de materiales/fichas, con una acción principal; cuotas y plan secundarios. Materiales, perfiles y adaptaciones pasan a filas. Subida, selección de perfil/modo y pantalla de adaptación enfatizan contenido y estado. Móvil conserva acciones visibles y diálogo nativo. Se corrige el reflujo con texto ampliado en cabecera, barra y acciones de filas.
- **Funciones de Claude conservadas:** rutas y redirecciones, retirada de «Próximamente», filtros, Plan y cuenta, estados, errores, cuotas y permisos. Sin cambios en `src/lib`, esquemas, SQL, Stripe, IA, pipeline, `components/material`, renderer ni PDF. Las clases de demo son exclusivamente web. Los grupos de rutas y límites de loading de ADR-024 conservan su protección del 404.
- **Archivos:** `globals.css`, primitivas UI, shell/navegación, Inicio/listas/Adaptar/uso, presentación de adaptación, componentes públicos y acceso. Nuevo `tests/e2e/editorial-interface.spec.ts`. Contexto actualizado en UX, PROJECT_STATUS, ARCHITECTURE y este registro; AGENTS/CLAUDE ya enlazan esos documentos.
- **Verificación final local:**
  - `pnpm typecheck` PASS. Al iniciar había tipos ignorados obsoletos de `.next/dev/types` de rutas retiradas por Claude; se regeneraron sin cambiar configuración ni producto.
  - `pnpm lint`: 0 errores, 1 aviso previo (`_id` en `tests/unit/analysis-run-auth.test.ts`).
  - **62/62 pruebas focalizadas, 8 archivos PASS**: boundaries, adaptation-web-boundaries, visual-boundaries, immediate-dispatch, next-tracing, pdf-single-renderer, pricing-truth y print-html. No se ejecutó toda la suite.
  - **4/4 Playwright PASS**, dos recorridos en escritorio 1440 y móvil 390: demo fiel/A4, movimiento reducido, salto al contenido y navegación pública; registro/perfil/subida válida e inválida/análisis simulado, revisión, estados de Inicio, filtros, menú con Escape/retorno de foco y resultado con fixture imprimible. Axe sin infracciones detectadas en las pantallas auditadas. Biblioteca a 320 px con texto al 200 % sin desbordamiento.
  - Sin desbordamiento horizontal en las diez pantallas capturadas a 1440/390; comprobación adicional de portada, Inicio, materiales, perfiles y Adaptar a 320/768/1280.
  - `pnpm build` PASS en el estado final: Google Fonts no bloquea esta sesión. No se cambia la carga de fuentes ni la red para conseguirlo. `git diff --check` PASS.

  Comandos portables (Chrome instalado para la configuración E2E por defecto):

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm exec vitest run tests/unit/boundaries.test.ts tests/unit/adaptation-web-boundaries.test.ts tests/unit/visual-boundaries.test.ts tests/unit/immediate-dispatch.test.ts tests/unit/next-tracing.test.ts tests/unit/pdf-single-renderer.test.ts tests/unit/pricing-truth.test.ts tests/unit/print-html.test.ts
  pnpm exec playwright test tests/e2e/editorial-interface.spec.ts
  pnpm build
  ```

  En este cloud, Playwright utilizó configuración temporal equivalente con Chromium de `@sparticuz/chromium`, sin `--disable-web-security`, contra `next dev` y `fake-supabase.mjs` (PGlite). La configuración temporal solo cambia el binario disponible, escritorio a 1440, reportes y servidor ya iniciado. Los E2E generales desactualizados registrados por Claude no se reejecutan ni se corrigen aquí.
- **Límites:** QA local con proveedores simulados; no llamadas pagadas ni Supabase remoto. No se certifica Preview de Vercel, IA real ni accesibilidad con lector de pantalla. La ficha de resultado es un fixture sembrado, no una salida obtenida del modelo. El método de capturas explica la densidad reducida de la portada móvil larga para evitar un artefacto de teselas de Chromium.
- **Publicación autorizada:** commit sobre la misma rama y push para actualizar [PR #29](https://github.com/TinyChat-up/ADAPTAULA/pull/29), sin crear otra PR ni hacer merge.
- **Siguiente acción:** revisar galería y Preview de esa PR. Cualquier integración requiere una tarea posterior; después retomar el bloque de tests generales o la variante tabular del roadmap, por separado.

## 2026-10-13 — UI/UX: navegación sin pantallas vacías, «Plan y cuenta», «Adaptaciones» con filtros y movimiento

- **Base verificada:** `git fetch origin main` → `70fb9ea` (merge de PR #28; #25–#27 también integradas). La PR #25, de la rama `claude/variables-expuestas-repo-f2o2et`, ya estaba integrada (`6c91552`; en esta sesión la API de GitHub sí responde). Por eso la rama se reinicia desde `main` y este bloque va como cambio nuevo, sin apilarlo sobre historia ya integrada.
- **Petición:** mejorar la UI/UX sin romper nada, eliminar pantallas innecesarias y dar más dinamismo. Es solo presentación: sin migraciones ni cambios en datos, permisos, RLS, planes, cuotas, precios, IA, pipeline, renderer o PDF.
- **Pantallas retiradas:**
  - `/app/plantillas`, `/app/ayuda`, `/app/clases` y `/app/configuracion` eran pantallas «Próximamente» sin contenido; se elimina también `coming-soon.tsx`.
  - Redirigen (307, `next.config.ts`) a `/app`, `/como-funciona`, `/app/alumnos` y `/app/uso`. Comprobado con `curl`, también `/app/configuracion/facturacion` y `/app/clases/<id>`.
  - Configuración se funde en **«Plan y cuenta»** (`/app/uso`): uso del periodo, datos de la cuenta y ayuda.
  - Historial pasa a ser **«Adaptaciones»**, en la misma ruta y con filtros por estado (`?estado=`, recuento por filtro y `aria-current`).
- **Navegación:**
  - Escritorio: 5 entradas principales más «Plan y cuenta» (antes 8 + 2, tres de ellas vacías). La entrada activa lleva barra, fondo y `aria-current`.
  - Móvil: cabecera fija con el plan (enlaza a Plan y cuenta) y barra inferior con botón central y hoja «Más» animada.
- **Inicio:**
  - Cabecera con saludo y una línea que cambia según el estado.
  - Tarjetas con icono y barra, listas con icono y flecha, y la tarjeta entera de cada material como enlace.
  - Estado vacío con los tres pasos.
  - En el móvil, «Ver todas las adaptaciones» se lee «Ver todas» y conserva el nombre completo para lectores de pantalla.
- **Movimiento (`globals.css`, sin dependencias):**
  - Entrada de página (`app/app/(shell)/template.tsx`), `stagger`, `pop-in` y `meter-fill`.
  - `lift` al pasar el ratón y con el foco del teclado; botones con pulsación.
  - Esqueletos con brillo y `loading.tsx` en Inicio, Materiales, Perfiles, Adaptaciones y Plan y cuenta.
  - `reveal` en la web pública.
  - Regla: el texto solo se desplaza (`transform`), nunca cambia de opacidad. `prefers-reduced-motion` lo para todo. Ningún `loading.tsx` envuelve las rutas que deben responder 404 (ADR-024).
- **Web pública y acceso:** hero con vista previa del producto, cabecera fija, pasos con icono, tarjetas con icono, privacidad, CTA final, y login/registro/bienvenida a dos columnas. Copy, precios y promesas sin cambios (`pricing-truth` PASS).
- **Archivos:** `src/app/globals.css`, `src/components/ui/{button,feedback,layout}.tsx`, `src/components/app/*` (shell, navegación, barra móvil, pie, `page-skeleton.tsx`), `src/app/app/(shell)/{(inicio),materiales/(lista),historial,uso,alumnos,adaptar}/*`, `template.tsx`, `src/components/adaptation/adaptation-list.tsx`, `src/components/materials/uploader.tsx`, `src/components/marketing/*`, `src/app/(auth)/layout.tsx`, `src/app/app/bienvenida/page.tsx`, `next.config.ts`; documentación en `docs/UX.md`, `BILLING.md`, `ROADMAP.md`, `ARCHITECTURE.md` (ADR-024), `PROJECT_STATUS.md` y este registro.
- **Pruebas (locales, con PGlite y proveedores simulados; sin servicios remotos ni llamadas de pago):**
  - `pnpm typecheck` PASS.
  - `pnpm lint`: 0 errores y 1 aviso previo en `tests/unit/analysis-run-auth.test.ts`.
  - Unitarias de los 8 archivos afectados: 62/62 PASS (`boundaries`, `adaptation-web-boundaries`, `visual-boundaries`, `immediate-dispatch`, `next-tracing`, `pdf-single-renderer`, `pricing-truth`, `print-html`). No se ejecutó la suite completa.
  - **E2E Playwright** (escritorio 1280 y móvil 390, con axe y desbordamiento), servidor `next dev` con PGlite y Chromium 141 de `/opt/pw-browsers`:
    1. Primera pasada, sobre `1e94a8d` + UI: 46 PASS, 10 fallos (las mismas 5 pruebas en los dos tamaños) y 20 sin ejecutar, saltadas en serie tras esos fallos.
    2. Las 5 sobre `main` limpio (`70fb9ea`, sin la UI y con el servidor reiniciado desde cero): fallan igual, con el mismo error y en la misma línea.
    3. Pasada final sobre `main` + UI, excluyendo solo esas 5: 51 PASS y 5 fallos, también ajenos a la UI (explicados abajo). Las 10 pruebas saltadas en serie se ejecutaron aparte: 8 PASS, entre ellas `adaptation:77` (404 de otra cuenta) y `materials:267` (axe y desbordamiento) en móvil, más `magic-flow:140` con su fallo previo en los dos tamaños.
    4. Repeticiones: `adaptation:60` y `materials:145` en móvil, 3/3 PASS cada una; `free-plan:9` en escritorio, 1/2 PASS con la UI y 1/3 en `main` limpio.
  - `pnpm build` PASS: compila en 62 s y la lista de rutas ya no incluye `/app/plantillas`, `/app/ayuda`, `/app/clases` ni `/app/configuracion`.
  - Capturas antes/después de 13 pantallas, en escritorio y móvil.
- **Fallos E2E previos, ajenos a este bloque.** Todos se reproducen en `main` limpio, con el servidor reiniciado desde cero. Los tests son del 8-oct y la lógica cambió después.
  - Deterministas:
    - `adaptation-states:15`: el *seed* «lista con observaciones» ya no es imprimible con `render/readiness` (Hotfix 8.2A.1). La pantalla dice «La ficha no se puede mostrar completa todavía».
    - `magic-flow:50`, `:98` y `:140`: esperan la copy y el recorrido antiguos. Las fases eran «Revisando el resultado… Lista» y ahora (`bd83d80`) son «Organizando las actividades… Comprobando el resultado… Ficha lista». El aviso esperado era «La ficha necesita una revisión antes de estar lista» y ahora es «No hemos podido completar automáticamente esta ficha». Además, tras «Hacer magia» la prueba ya no llega a `/vista` con el doble simulado.
    - `render:39`: la app nombra bien el PDF («Descarga iniciada: Población y movilidad en Valdeloma.pdf»). Es el Chromium 141 *headless* del entorno el que da `download` como nombre sugerido de una descarga desde un `blob:`.
    - `visual-locator:47`: aparecen 3 enlaces «Localizar en el original» (vis_1–vis_3) donde el test espera uno, en modo estricto.
  - Intermitentes:
    - `materials:109`: carrera del test. Tras «Volver a analizar», `waitForAnalysis` encuentra el encabezado del análisis anterior y lee la cuota antes de que la acción reserve la unidad (9 en lugar de 10).
    - `free-plan:9`: a veces una adaptación de «Hacer magia» termina `blocked` (CTA «Revisar»), y el test solo acepta «Ver ficha|Ver progreso|Revisar adaptación».
    - `adaptation:60` y `materials:145`: carrera del helper `signUpAndOnboard`, que no espera a que termine el onboarding. La traza muestra el `goto` 22 ms después del POST: `/app/adaptar` → 307 `/app/bienvenida` → 307 `/app`. Arreglo de una línea: esperar `not.toHaveURL(/\/app\/bienvenida/)` tras «Entrar en Adaptaula».
  - Este bloque no modifica ningún test: todos los selectores de la E2E siguen valiendo.
- **Riesgos:**
  - La revisión manual con teclado y lector de pantalla sigue pendiente (Fase 7). axe solo cubre lo automatizable.
  - Las redirecciones son temporales (307) y se retiran cuando cada pantalla tenga contenido.
  - Cualquier `loading.tsx` nuevo debe respetar ADR-024 para no convertir 404 en 200.
- **Publicación:** la implementación (`5bb9cc1`) y este registro están en `claude/variables-expuestas-repo-f2o2et`, subidos por Git como *fast-forward* desde `1e94a8d`, que ya estaba en `main` a través de #25. A petición del usuario se abrió la [PR #29](https://github.com/TinyChat-up/ADAPTAULA/pull/29) hacia `main`. Sin merge.
- **Siguiente acción:**
  1. Revisar la PR #29 y, si se aprueba, integrarla. La integración la hace una persona.
  2. En un bloque propio, poner al día los E2E anteriores: la copy y el recorrido actuales de Hacer magia; un *seed* imprimible; esperar el estado «analizando» antes de leer la cuota; el nombre de descarga, comprobado en `Content-Disposition` o con el navegador fijado; localizar un visual concreto; aceptar «Revisar» en `free-plan`; y la espera tras el onboarding en `signUpAndOnboard`.
  3. Después, retomar la prioridad de Hacer magia del ROADMAP.

## 2026-10-13 — Fase 8.2B.5: selección única basada en tablas

- **Base verificada:** `git fetch origin main`, merge `bb38cd0` de **PR #27** y ascendencia de `4007e19`/`26904dc`. Rama nueva desde main actualizado: `phase8/seleccion-unica-tablas`. #27 ya está integrada; se corrige su estado en los documentos de continuidad. La consulta de PR abiertas por API sigue bloqueada (`Forbidden`), sin inferir su estado.
- **Fallo reproducido antes de producción:** fixture de animales/alimentación con tabla representada como imagen perdida terminaba sin sustitución; una tabla nativa no generaba necesidad visual y evitaba la corroboración. Dos pruebas fallaron antes del cambio (`/tmp/adaptaula-table-before.log`).
- **Implementación:** `adaptation/table-choice.ts` separa la relación entre celdas de la comprobación de fracciones, compartiendo controles literales en `single-choice.ts`. `materials/visuals/auto/table.ts` corrobora hash, página, cuadrícula, segmentos de bordes y texto de todas las celdas contra el PDF. La política exige evidencia también para tablas nativas y recortes listos; añade resultado tabular/evidencia al contrato visual, conserva tabla/opciones/consigna/ids/enlaces/clave y se detiene si falla. Prompt nuevo inmutable `visual-substitute/v4.ts`, salida estricta y códigos seguros; hasta dos intentos por actividad/ejecución, sin recibir clave ni aprobación intermedia. Las fracciones conservan v3; otros formatos v2.
- **Decisión/alcance (ADR-023):** solo consulta literal reconocida `Según la tabla, ¿qué {columna} corresponde a «{fila}»? Elige una opción.`, primera columna identifica filas, 2–6 columnas, 1–12 filas, sin celdas vacías, encabezados/filas ambiguos ni unidad separada, opciones textuales del vocabulario de la columna y una sola coincidente con clave `source`. Se rechazan inferencias, alternativas numéricas o ajenas a la columna, sinónimos/equivalencias, claves inferidas y modificaciones incompatibles. La tabla permanece necesaria para resolver la actividad.
- **Pruebas:** fixtures sintéticos y mocks en `tests/support/table-choice-case.ts`, unitarias/contrato de proveedor en `table-choice.test.ts` y `table-choice-prompt.test.ts`, orquestador real con PGlite local y fuente PDF en `tests/db/magic-visual-policy.test.ts`. Cubren dato correcto y otra fila/columna, celdas alteradas/ausentes/combinadas, encabezados ambiguos, dos o cero respuestas, clave contradictoria, filtración de solución, fuente inventada/no corroborada/hash cambiado, corrección válida en segundo intento y dos fallos con parada honesta. La integración verifica `ready` e imprimible o `blocked` sin entrega/consumo; registra versión 4 e intentos. Sin Supabase remoto.
- **Resultados:** **133 pruebas focalizadas en 10 archivos PASS** (132 juntas y revalidación del área al añadir un caso y endurecer bordes; no suite completa); **3 PDF Chromium PASS** (tabla, selección de fracciones y regresión de ficha de fracciones); `pnpm typecheck` PASS; `pnpm lint` sin errores, un aviso previo en `tests/unit/analysis-run-auth.test.ts`; `git diff --check` PASS. Comandos reproducibles:

  ```bash
  pnpm exec vitest run tests/unit/table-choice.test.ts tests/unit/table-choice-prompt.test.ts tests/unit/single-choice-substitution.test.ts tests/unit/single-choice-prompt.test.ts tests/unit/visual-substitution.test.ts tests/unit/pedagogical-equivalence.test.ts tests/unit/magic-visual-policy.test.ts tests/db/magic-visual-policy.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts
  pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/table-choice-substitution.test.ts tests/pdf/single-choice-substitution.test.ts tests/pdf/automatic-visuals.test.ts
  pnpm typecheck
  pnpm lint
  ```

- **PDF inspeccionado:** `.pdf-smoke/table-choice-substitution/sheet.pdf`, una página con encabezados contrastados, filas alineadas, tabla/pregunta/opciones juntas, tres círculos vacíos, clave y notas docentes ausentes. No se modifica CLARO ni la tipografía. Se reutiliza la normalización del glifo de paréntesis de Inter únicamente en la extracción del test, no en producto.
- **Markdown actualizados:** PROJECT_STATUS, DEVELOPMENT_LOG, ROADMAP, ARCHITECTURE (ADR-023), VISUAL_RESOURCES y PROMPTS. AGENTS/CLAUDE siguen coherentes con sus enlaces al contexto compartido, sin duplicar el estado.
- **Riesgos y pendiente real:** la evidencia compara estructura y capa de texto del PDF con posición/tinta, **no OCR independiente de los glifos**; no certifica capas de texto falsas ni corrobora aquí la transcripción de pregunta/clave. Escaneos, tablas sin cuadrícula, celdas multilínea, tablas duplicadas y paráfrasis desconocidas se detienen. Cobertura conservadora, aún pendiente IA real y runtime Vercel. Sin migraciones, SQL remoto, llamadas de pago, cambios de Stripe/Max/planes/precios/cuotas ni auditoría económica. La compilación bloqueada por Google Fonts no se repite ni se cambia el producto para sortearla.
- **Publicación:** implementación `1cc8833`, rama `phase8/seleccion-unica-tablas` subida por Git HTTPS. `gh pr create --base main --head phase8/seleccion-unica-tablas` falla con `Post https://api.github.com/graphql: Forbidden`; **PR no creada desde este entorno**. [Abrir formulario de PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/seleccion-unica-tablas). Título preparado: «Fase 8.2B.5: selección única de tablas corroboradas»; descripción local en `/tmp/adaptaula-table-pr.md`. Sin merge.
- **Siguiente acción:** revisar esta rama/PR y el PDF; después ampliar solo una variante verificable de consulta con sus fixtures/evidencia. Validar IA real/Vercel en una tarea posterior autorizada, sin presentar mocks como validación remota.

## 2026-10-13 — Fase 8.2B.4: selección única en la sustitución visual

**Estado actualizado en 8.2B.5:** PR #27 integrada en `bb38cd0`, verificado por Git. Los detalles de publicación siguientes reflejan el bloqueo original de esa sesión.

- **Precondición verificada:** PR #26 integrada en `main` / `d665d5b`, comprobada con `git fetch origin main`, mensaje de merge y ascendencia de `65515a8`. La consulta por API sigue devolviendo `Forbidden`; no se infiere el estado de otras PR. Rama nueva: `phase8/seleccion-unica-automatica`.
- **Problema reproducido antes de modificar producción:** dos pruebas fallaban. Una imagen perdida con opciones A/B/C y clave `B` no permite al generador existente deducir su fracción; la sustitución rechazaba `select_option` con `no_equivalent_activity`. No era la parada `needs_decision` del planificador.
- **Contrato descubierto:** análisis sin campo estructurado de opciones, alternativas en texto y clave en `expected_answer`; documento con `choice`, `multiple`, ids y `answer_key`; renderer CLARO ya compatible. No hay migración ni versión nueva de esos contratos.
- **Implementación:** `src/lib/adaptation/single-choice.ts` extrae listas explícitas y valida coherencia matemática; `prompts/visual-substitute/v3.ts` propone geometría y conserva opciones, sin recibir clave. Integrado en `auto/assistants.ts`, `auto/policy.ts`, `pedagogical-equivalence.ts`, `substitution-feedback.ts` y `visual-policy.ts`. Se mantiene v2 para otros formatos y el máximo de dos intentos. La aplicación conserva claves, ids, enlaces y procedencia, con opciones en el contrato existente de respuesta.
- **Alcance deliberado (ADR-022):** lectura de fracción coloreada en barras/círculos, consigna reconocida, 2–8 alternativas fraccionarias en listas consecutivas A)…H), clave inequívoca. Se mantienen etiquetas/textos/orden, número de partes y una sola respuesta correcta. Se rechazan cambios de opciones/solución, pistas, complementos, claves ambiguas y transformaciones previas incompatibles. No implementa conversiones de preguntas abiertas, selección múltiple ni otros formatos.
- **Pruebas nuevas:** fixture y PDF sintéticos en `tests/support/single-choice-case.ts`; unitarias en `single-choice-substitution.test.ts` y `single-choice-prompt.test.ts`; integración con orquestador y migraciones reales sobre **PGlite local del entorno cloud**, sin Supabase remoto; PDF con Chromium en `tests/pdf/single-choice-substitution.test.ts`. Asistentes simulados en todos los casos.
- **Resultados:** `pnpm typecheck` PASS; ESLint focalizado en los 12 archivos TypeScript afectados PASS; 103 pruebas/8 archivos PASS; 2 PDF/2 archivos PASS; `git diff --check` PASS. Regresión existente de fracciones incluida. Comandos reproducibles:

  ```bash
  pnpm exec vitest run tests/unit/single-choice-substitution.test.ts tests/unit/single-choice-prompt.test.ts tests/unit/pedagogical-equivalence.test.ts tests/unit/magic-visual-policy.test.ts tests/unit/visual-substitution.test.ts tests/db/magic-visual-policy.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts
  pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/single-choice-substitution.test.ts tests/pdf/automatic-visuals.test.ts
  ```

- **PDF inspeccionado:** una página, pregunta/barra/opciones juntas, círculos sin marcar, sin clave ni notas docentes. El extractor pdf.js representa el paréntesis alternativo de Inter como U+E082; el test normaliza ese glifo solo al comprobar texto extraído y verifica además el HTML literal. El paréntesis se ve correctamente en la página renderizada. No se cambia la tipografía del producto.
- **Documentación compartida actualizada:** PROJECT_STATUS, ROADMAP, ARCHITECTURE (ADR-022), VISUAL_RESOURCES, PROMPTS y este registro. AGENTS/CLAUDE ya enlazan estos documentos y conservan el protocolo común, sin duplicarlo.
- **Pendiente real:** eficacia del prompt con proveedores reales, calidad del análisis de nuevas fuentes y runtime en Vercel. La comprobación matemática prueba coherencia con análisis/clave, no que un original ilegible se haya transcrito correctamente. No se ejecutaron llamadas pagadas, SQL remoto, migraciones, Stripe ni cambios comerciales. No se repitió toda la suite ni la compilación bloqueada por Google Fonts.
- **Publicación:** implementación subida en `26904dc`, rama `phase8/seleccion-unica-automatica`. `gh pr create` falló con `Post https://api.github.com/graphql: Forbidden`: **PR no creada desde este entorno**. [Abrir el formulario de PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/seleccion-unica-automatica). Título preparado: «Fase 8.2B.4: selección única verificable en Hacer magia»; alcance y validación constan en esta entrada. Sin merge automático.
- **Siguiente acción:** revisar esta rama/PR; después diseñar un fixture y verificador para una segunda clase de selección única (lectura de un dato de tabla), preservando opciones, clave y trazabilidad. No habilitar selección genérica solo por la declaración de un modelo.

## 2026-10-13 — Sustitución pedagógica con corrección acotada

- **Base:** `main` / `6c91552`; inspeccionadas las integraciones #24 (equivalencia) y #25 (ilustraciones, contratos y costes). `origin/main` actualizado antes de crear la rama `phase8/sustitucion-pedagogica-acotada`.
- **Problema reproducido:** la sustitución podía convertir formatos cerrados en escritura, añadir una operación o perder restricciones; el segundo intento repetía la misma petición sin indicar el fallo. Ocho casos nuevos fallaban antes del cambio.
- **Implementación:** controles en `pedagogical-equivalence.ts`; códigos de rechazo permitidos en `substitution-feedback.ts`; prompt inmutable nuevo `visual-substitute/v2.ts`; conexión y corrección en `auto/assistants.ts` y `auto/policy.ts`. Máximo existente de dos intentos, sin reintentar una negativa explícita o error permanente como corrección pedagógica. Los errores transitorios mantienen el mecanismo de reintento del job.
- **Pruebas:** equivalencia y política visual unitarias, frontera del prompt/proveedor y orquestación sobre PGlite. Asistentes simulados; sin Anthropic/OpenAI reales. La integración comprueba rechazo → corrección → ficha imprimible y registros de ambos intentos.
- **Documentación:** nuevos `PROJECT_STATUS.md` y este registro; prioridades en `ROADMAP.md`, decisión ADR-021 en `ARCHITECTURE.md`, contrato en `VISUAL_RESOURCES.md` y `PROMPTS.md`; enlaces de continuidad en `AGENTS.md` y `CLAUDE.md`. Se reutilizan los documentos existentes en lugar de duplicar decisiones o próximos pasos.
- **Validación real pendiente:** rendimiento pedagógico del prompt v2 con modelos reales, imágenes generadas y Vercel. No se ejecutó SQL remoto, no hay migración nueva ni cambios de facturación.
- **Cierre de calidad:** por petición expresa del usuario se limita la verificación al área modificada, typecheck, lint y una regresión PDF; no se vuelve a ejecutar `pnpm check` completo. El bloqueo de red de Google Fonts sigue documentado, sin modificar fuentes del producto.
- **Resultados:** `pnpm typecheck` PASS; ESLint sobre los nueve archivos TypeScript afectados PASS; `pnpm exec vitest run tests/unit/pedagogical-equivalence.test.ts tests/unit/magic-visual-policy.test.ts tests/unit/visual-substitution.test.ts tests/db/magic-visual-policy.test.ts` **60/60 PASS**; `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/automatic-visuals.test.ts` **1/1 PASS** (PDF real de dos páginas, geometría y espacios vacíos conservados). `git diff --check` PASS. Estos resultados no certifican llamadas reales ni el despliegue.
- **Riesgos:** controles lexicales conservadores (pueden rechazar paráfrasis válidas), no una demostración completa de equivalencia; los formatos cerrados sin representación compatible terminan honestamente. El límite de dos intentos es por actividad/ejecución; los reintentos técnicos del job siguen su presupuesto existente.
- **Publicación:** rama subida a GitHub; implementación y pruebas en `8ad483e`. `gh pr create --base main --head phase8/sustitucion-pedagogica-acotada` falló con `Post https://api.github.com/graphql: Forbidden` (también se bloquean consultas REST). **PR no creada**; [abrir el formulario de PR](https://github.com/TinyChat-up/ADAPTAULA/pull/new/phase8/sustitucion-pedagogica-acotada). No se ha realizado merge. El bloqueo es acceso a la API desde el entorno, no una prueba de credenciales inválidas.
- **Siguiente acción exacta:** abrir/revisar la PR de esta rama cuando esté disponible GitHub, leer estado y roadmap y comprobar main/PR abiertas. Después, reproducir con fixture una selección única que hoy requiere decisión y diseñar su ejecutor conservando opciones y clave; implementar solo ese formato.
