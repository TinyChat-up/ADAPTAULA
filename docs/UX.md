# UX, arquitectura de información y sistema de diseño

> **Impresión definitiva (2026-10-20):** en ficha entregada y editor guardado, «Vista previa de impresión» abre el PDF binario real y muestra sus hojas físicas. La descarga del diálogo reutiliza ese archivo; cambios pendientes requieren guardar primero. La vista CLARO sigue siendo lógica, distinta del PDF físico. [Uso, capturas y límites del visor](qa/vista-previa-pdf/README.md).

> Etapa 4B: portada y demostración pública sintética, «Cómo funciona», acceso y primera experiencia. [Alcance y pruebas](qa/adaptaula-2-etapa-4b/README.md). #44 está fusionada; no se ha aplicado migración remota.

> **Etapa 4A (2026-10-17):** #43 integrada en `5867d30`. Nueva política persistida mediante migración 026, precios con tres planes y avisos de consumo. Pro sin contratación, Max en preparación, imágenes desactivadas. Suscripciones anteriores conservadas; no se aplica SQL remoto. [Alcance, compatibilidad y QA](qa/adaptaula-2-etapa-4a/README.md). 4B debe esperar a integrar 4A.

## Personalidad

Un **estudio pedagógico digital**: papel, tinta, materiales y composición tipográfica. Profesional, educativo y tranquilo. La identidad nace del contenido y su jerarquía, no de decoración tecnológica. Dirección editorial de la PR #29 (ADR-025), sobre las mejoras funcionales de ADR-024.

## Mapa de rutas

### Públicas — `(marketing)`
| Ruta | Contenido |
|---|---|
| `/` | Hero («Un mismo material. Más formas de aprender.») con dos páginas educativas A4: material original → adaptado, demostración explícita · cómo funciona · casos de uso · ejemplos · privacidad · ventajas · precios · FAQ · CTA final |
| `/como-funciona` | Flujo en 4 pasos |
| `/ejemplos` | Galería anonimizada preparada internamente; filtros: Primaria, Secundaria, lectura, atención, comprensión, matemáticas, lenguaje |
| `/precios` | Free · **Pro destacado** · Max (si el flag está activo), interruptor mensual/anual, comparador, FAQ de facturación |
| `/centros` | Landing B2B + formulario "Solicitar información" |
| `/privacidad` `/terminos` `/cookies` `/accesibilidad` | Legales |

### Auth — `(auth)`
`/login` · `/registro` · `/forgot-password` · `/reset-password` · `/auth/callback` (route handler).

### App — `/app` (requiere sesión)
| Ruta | Pantalla |
|---|---|
| `/app/bienvenida` | Onboarding (3 pasos, sin sidebar) |
| `/app` | Mesa de trabajo: atención → en curso → materiales recientes → fichas preparadas |
| `/app/adaptar` | Wizard de adaptación (admite `?material=` y `?clase=`) |
| `/app/adaptaciones/[id]` | Resultado + editor |
| `/app/adaptaciones/[id]/comparar` | Comparador original/adaptado |
| `/app/materiales` · `/app/materiales/[id]` | Biblioteca con filtros (etapa, asignatura, estado), reintentar y eliminar · detalle: progreso real, «Adaptaula ha identificado», actividades, elementos a conservar, elementos visuales, puntos a revisar, original y corrección del contexto |
| `/app/alumnos` · `/app/alumnos/nuevo` · `/app/alumnos/[id]` | Perfiles de alumnado · editor de perfil |
| `/app/historial` | **Adaptaciones**: todas, con filtros por estado (`?estado=`) |
| `/app/uso` | **Plan y cuenta**: uso del periodo, datos de la cuenta y ayuda (sustituye a Configuración) |

**Rutas retiradas** (eran pantallas «Próximamente» sin contenido): `/app/plantillas`, `/app/ayuda`, `/app/clases` y `/app/configuracion`. Redirigen de forma temporal (`next.config.ts`) a `/app`, `/como-funciona`, `/app/alumnos` y `/app/uso`, para que ningún enlace antiguo dé un 404. Volverán al mapa cuando tengan contenido real (Clases en la Fase 2; la facturación de Stripe vivirá en «Plan y cuenta»).

### Admin — `/admin` (solo `system_admin`, 404 para el resto)
`/admin` (KPIs) · `/admin/jobs` · `/admin/ia` · `/admin/prompts` · `/admin/usuarios`.

### API
`/api/uploads` · `/api/uploads/[id]/complete` · `/api/jobs` · `/api/jobs/[id]` · `/api/adaptations/[id]/export` · `/api/stripe/create-checkout` · `/api/stripe/portal` · `/api/stripe/webhook` · `/api/cron/jobs` · `/api/cron/retention`.

## Navegación de la app — Adaptaula 2.0, etapa 1

Escritorio: barra lateral de 240 px con las rutas existentes y sus etiquetas. «Plegar barra» la reduce a 112 px conservando iconos **y texto**; «Ampliar» recupera el ancho. La preferencia se guarda solo al pulsar, en `adaptaula_nav` (un año, `/app`, SameSite=Lax, sin identidad); el servidor la lee para evitar saltos al recargar. Cuotas e identidad se muestran en la barra ampliada y siempre están disponibles en Plan y cuenta. Cerrar sesión se mantiene también al plegar.

Una cabecera translúcida muestra la sección y el tipo de pantalla (Material, Perfil funcional, Preparar ficha, Ficha adaptada o Editar ficha). Este contexto deriva de la ruta: **no representa el título ni un estado del job**. Ambos siguen en las pantallas existentes con sus datos reales; unificar su contexto documental persistente es etapa 2.

Móvil: cabecera con logo y consumo real, ubicación y barra inferior flotante con Inicio · Materiales · Adaptar · Perfiles · Más. Márgenes seguros y espacio inferior reservado. «Más» conserva Adaptaciones, Plan y cuenta y Cerrar sesión en un diálogo nativo con Escape/retorno de foco; se cierra al navegar y al cambiar a escritorio para no dejar la pantalla inerte. Sin acciones exclusivas de hover.

No se eliminan rutas, funciones ni permisos. El acceso directo a las pantallas continúa validándose en servidor. Las redirecciones y los grupos de carga de ADR-024 permanecen; no se añade Suspense/loading por encima de los 404 privados.

## Flujos clave

**Onboarding (máx. 3 pasos):** ¿Qué enseñas? (Primaria / ESO / Bachillerato / varias) → ¿Cómo quieres empezar? (Adaptar una ficha ahora / Crear primero un perfil / Ver ejemplo) → Privacidad ("Puedes utilizar alias en lugar del nombre real de tus alumnos.") → **Entrar en Adaptaula**.

**Inicio / mesa de trabajo:** saludo según la hora en Europe/Madrid y subtítulo según el estado, con una sola acción principal **Adaptar material**. Orden: **Necesitan tu atención**, **En curso**, **Materiales recientes** (últimos cuatro), **Fichas preparadas**. Las secciones sin contenido se omiten. Materiales y adaptaciones usan filas con separadores, título, metadatos y siguiente acción; no tarjetas de estadísticas. Plan, cuota y perfiles quedan en el pie y en la navegación, con enlace a Plan y cuenta. Sin materiales: «Empieza subiendo una ficha que ya utilizas» y tres pasos numerados (subir, elegir perfil, preparar y revisar), conservando la acción de cabecera. Con materiales analizados y sin adaptaciones, aparece el siguiente paso contextual.

El siguiente wizard y el editor completo describen el alcance propuesto; el recorrido implementado está en **Flujo del docente de punta a punta** y **Pantalla de adaptación**. Las rutas de comparador, ejemplos, centros, accesibilidad y admin aún no son pantallas implementadas.

**Wizard `/app/adaptar`** (estado en la URL y en el cliente; un paso visible cada vez, con barra de progreso y atrás/siguiente):
1. **Material** *(implementado en `/app/adaptar` como pantalla propia)*: título «Adapta un material», área de arrastrar y soltar («Arrastra tu ficha aquí» / «o selecciona un archivo»), formatos y límites del plan visibles, tarjeta del archivo (nombre, tipo, tamaño, vista previa si es imagen, cambiar/quitar) y el botón «Analizar material». Aviso de privacidad **siempre visible, sin modal**: «Evita incluir información personal innecesaria del alumnado en los archivos que subas.» Todavía no pide perfil: se elige después, cuando el material está comprendido. Las páginas de un PDF se muestran tras la subida (el navegador no puede contarlas con fiabilidad).
2. **Contexto**: etapa, curso, asignatura, tema opcional. Se rellenan con lo detectado si el análisis ya terminó (el análisis arranca nada más subir) y siempre son editables.
3. **¿Para quién?**: "Adaptación rápida" o "Usar perfil guardado" (varios en Pro/Max).
4. **¿Qué quieres adaptar?**: tipo de adaptación + presets + controles funcionales rápidos; "Configuración avanzada".
5. **Resultado esperado (opcional)**: texto libre ("Conserva exactamente los ejercicios 3 y 4").
→ **Adaptar** → progreso por pasos (Analizando el material · Identificando objetivos · Preparando la adaptación · Revisando actividades · Maquetando la ficha), con consejos breves si tarda. Nunca un spinner vacío.

Optimización del camino rápido: con un perfil guardado y el contexto autodetectado, el docente puede ir de la subida a **Adaptar** en 3 clics.

**Resultado/editor `/app/adaptaciones/[id]`:** barra superior (título, badges *Primaria · Matemáticas · Perfil X*, Comparar, **Descargar PDF** *(implementado en la Fase 5.2B en la vista de la ficha `/app/adaptaciones/[id]/vista`: bajo demanda, estados «Preparando el PDF…», «Descarga iniciada» y error con reintento)*, y en Max "Crear recursos visuales"). Escritorio: miniaturas de páginas a la izquierda · vista previa en el centro · panel derecho con "¿Qué hemos adaptado?" (3-6 puntos), contexto y avisos de revisión. Editor por bloques: cada bloque se selecciona y tiene una barra contextual (editar texto, simplificar, ampliar, añadir ejemplo, cambiar respuesta, mover, duplicar, eliminar, regenerar). Autoguardado, deshacer y rehacer locales, e historial de versiones. Tras descargar: *"¿Te ha servido esta adaptación?"* 👍 / 👎 (motivos: demasiado fácil, demasiado difícil, demasiado texto, poco útil, errores, diseño, otro).

**Comparador:** Original | Adaptado en paralelo (escritorio) o en tabs (móvil), con la lista "Cambios realizados".

**Editor de perfil `/app/alumnos/[id]`:** información básica (alias con aviso de privacidad, etapa y curso; no se piden notas) → punto de partida opcional (preset: atajo con nombre funcional, p. ej. «Lectura y decodificación»; precarga dimensiones, no es ni guarda un diagnóstico) → 11 áreas seleccionables, y solo las elegidas muestran sus controles (Sin adaptación / Algo / Bastante / Mucho) → ajustes avanzados plegados → panel derecho fijo **"Así se aplicará"** con un resumen en lenguaje natural (p. ej. "Instrucciones breves · Máximo 3 tareas visibles · Ejemplo antes de ejercicios nuevos · Carga visual baja"). Los presets se aplican desde un selector y todo sigue siendo editable. Nunca se muestra JSON.

## Sistema de diseño — fundamentos 2.0

Fuente: `src/styles/tokens.css`, importada por `globals.css`; composición de la navegación en `src/styles/chrome.css`. Dirección integral y entregas pendientes: [ADAPTAULA_2.md](ADAPTAULA_2.md). Sustituye la paleta/radios de ADR-025, conservando sus filas editoriales y el aislamiento de CLARO.

| Token | Valor | Uso |
| --- | --- | --- |
| background | #F7F8FA | espacio de trabajo |
| surface | #FFFFFF | documentos, campos y paneles |
| surface-muted / surface-inset | #F0F3F6 / #E8EDF2 | navegación, capas secundarias |
| foreground / muted-foreground | #05234B (azul marino de marca) / #536379 | texto y metadatos |
| primary / primary-strong | #063F79 / #05234B | enlaces, bordes, acción principal (azul marino de marca, Fase C) |
| accent / focus | #0060EB / #0067FD | acento e información / anillo de foco (azul de marca) |
| primary-soft | #E7EDF5 | selección |
| border / control-border | #DCE2E8 / #7D8B9C | separadores / controles identificables |
| success / warning / danger | #24623E / #925015 / #B12828 | estados acompañados de texto |

Inter existente: texto 16 px, metadatos 12–14, secciones 18, títulos fluidos 26–32; los titulares usan Outfit (Fase C, [BRAND.md §4](BRAND.md)), la tipografía más cercana al logotipo. Sin nuevas fuentes ni dependencias. Base de espaciado Tailwind de 4 px; control 12, panel 24, sección 32. Radios control 12, tarjeta 20, panel 24. Sombras neutras leves para paneles, mayores solo en controles flotantes y diálogos. Capas explícitas para navegación, overlays y salto al contenido.

**Materiales de interfaz:** `surface-glass` nace sólido; solo con soporte aplica fondo 90 % opaco y blur de 12 px en cabeceras, barra móvil y `ActionBar` del editor existente. No hay cristales en filas, fichas, PDF ni tarjetas ordinarias. `ActionBar` usa un grupo etiquetado con Tab nativo, no un role toolbar sin su comportamiento de flechas.

Se reutilizan Button/LinkButton, campos, Card, PageHeader, EmptyState, Alert, Badge, UsageMeter, Skeleton, ChoiceCards y ConfirmDialog. Estados de campo/error asociados, desactivación nativa, foco con separación, botones pequeños ≥44 px en móvil y navegación ≥44 px. Confirmaciones siguen siendo diálogos nativos; errores permanecen en pantalla. Los contadores son de servidor; no se añade progreso inventado.

**Preferencias de accesibilidad:** `prefers-reduced-motion` elimina animación y casi toda transición; `prefers-reduced-transparency` y `prefers-contrast: more` usan superficies sólidas sin filtro/sombra. Alto contraste refuerza textos y bordes; forced-colors utiliza colores de sistema sin desactivar el ajuste del navegador. La hoja CLARO mantiene su blanco y contraste propio. **Modo oscuro pendiente**: esta entrega conserva modo claro deliberadamente, sin un selector que prometa una cobertura que todavía no existe en todas las pantallas.

**Responsive:** lateral desde 768 px, navegación inferior por debajo; los nombres de las funciones continúan visibles en el modo compacto. Contenido hasta 1408 px para dejar crecer el documento, con márgenes de 20 px en móvil y fluidos en escritorio. Sin animación de ancho al plegar: evita escalado/reflujo animado de la ficha. Texto al 200 %, 320 px y foco se verifican en navegador; detalle en [QA](qa/adaptaula-2-etapa-1/README.md). No equivale a certificación WCAG completa.

**Referencias externas:** consultadas con Chromium tras resolver el bloqueo inicial de red. Apple Materials/Liquid Glass: separar la capa de controles del contenido, aplicar material con moderación y sostener legibilidad. Bencho: controles y selección visibles, herramientas agrupadas, transiciones de estado y memoria de elección. Se vieron glass controls/paint, upload, comparación, toolbar y reordering; `/blocks` devuelve 404, pero el catálogo actual está en `/` y los ejemplos cargan. No se copian refracciones, rebotes ni gestos de reordenación: no aportan a esta entrega ni a sus capacidades reales. No se incorpora código ni assets de terceros nuevos. Detalle en [QA](qa/adaptaula-2-etapa-1/README.md).

## Análisis del material (fase 3)

Tras «Analizar material» el docente va a `/app/materiales/[id]`. Mientras el job corre se muestra **«Estamos preparando tu material»** con pasos que reflejan lo que el servidor hace de verdad (sin cronómetros ni estimaciones): *Archivo recibido → Leyendo el contenido e identificando las actividades → Revisando la estructura → Preparando el material*. Si el job está en cola lo dice. Se puede salir de la página («Puedes seguir usando Adaptaula mientras terminamos»): el job continúa en el servidor y la pantalla recupera el estado al volver.

Resultado: cabecera con título y etiquetas (etapa, curso, asignatura) solo cuando hay datos fiables; tarjeta «Adaptaula ha identificado» (tema, nº de actividades, dificultad aproximada, propósito y objetivos); aviso «Conviene que revises estos puntos» si hay incertidumbres; lista de actividades (con «Conviene revisarla» si la confianza es baja); «Lo que conviene conservar»; elementos visuales distinguiendo lo que aporta información de lo decorativo; el original; y el formulario «Datos del material» donde cada campo indica si está **Detectado automáticamente** o **Confirmado por ti** (lo confirmado prevalece, también al volver a analizar). El bloque «Adaptar este material» permite elegir perfil y modo cuando el análisis está listo (ver flujo actual).

Errores: «No hemos podido analizar este material» + causa humana (servicio no disponible, archivo ilegible, demasiado extenso…) + Reintentar / Eliminar. Nunca aparece un proveedor, un modelo, tokens ni trazas.

## Plantillas visuales del material

Las plantillas controlan **solo la presentación** (`visual_template`), nunca la pedagogía (`strategy`):
`estandar` · `lectura-accesible` · `baja-carga-visual` · `visual` · `ejercicios` · `ciencias` · `matematicas` · `secundaria-sobria`.

Por defecto: Primaria → `estandar`; ESO/Bachillerato → `secundaria-sobria`. Primaria admite ilustración moderada, bloques amplios y espacio para escribir. ESO/Bachillerato: jerarquía, esquemas, organizadores y sin iconografía infantil.

## Flujo del docente de punta a punta (Fase 6)

Un solo camino, sobre las pantallas existentes y sin asistente nuevo:

1. **Subir** en `/app/adaptar` → la ficha del material muestra el análisis en curso y se actualiza sola al terminar.
2. **Adaptar este material** aparece justo después de «Adaptaula ha identificado» y de los puntos a revisar, antes del detalle de actividades.
3. **¿Para quién?** Se elige un perfil. Sin perfiles: «Crear un perfil» abre `/app/alumnos/nuevo?material=<id>` y, al crearlo, se vuelve al material con ese perfil elegido (`?perfil=`). Con perfiles hay también «Crear un perfil nuevo».
4. Se elige **Hacer magia** o **Revisar antes de crear**. El clic crea e inicia la adaptación; la interfaz bloquea envíos mientras está pendiente.
5. **Hacer magia** prepara y comprueba la ficha automáticamente, o termina con una explicación y la opción de revisar/editar. **Revisar antes de crear** muestra la propuesta editable y espera a «Crear ficha». Recargar no confirma una revisión manual.
6. **Ficha preparada**: «Ver la ficha» y **«Descargar PDF»** en la misma tarjeta; en la vista, «Vista del alumno» y «Descargar PDF».

**Entradas naturales, un solo flujo.** Desde el material (tarjeta), desde un perfil (`/app/alumnos/[id]` → «Adaptar un material con este perfil» → material con `?perfil=`), desde `/app/adaptar` («¿Ya lo has subido?» → material) y desde el inicio. Todas terminan en la misma tarjeta y la misma acción de servidor; no hay otra forma de crear una adaptación.

**Estados en listas** (`src/lib/adaptation/presentation/list.ts`; inicio, historial, material y perfil): Pendiente de empezar · Preparando propuesta · Esperando tu revisión · Lista para crear la ficha · Preparando ficha · Revisando calidad · Ficha preparada · Necesita tu revisión · No se pudo completar · Cancelada. Una adaptación que espera la decisión del docente nunca aparece «en curso». Cada fila lleva la siguiente acción como enlace (Empezar, Revisar propuesta, Crear ficha, Ver progreso, Ver ficha…), con texto e icono, nunca solo color.

**Solo lectura** (rol `viewer`): ve materiales, adaptaciones, estados, la ficha y su PDF; no ve comandos («Adaptar material», «Preparar propuesta», revisión, «Crear material adaptado», reintentar, cancelar) y su pantalla de adaptación no pide ejecutar nada.

**Adaptaciones** (`/app/historial`, antes «Historial»): todas las adaptaciones, de la actividad más reciente a la más antigua, con filtros por estado (Todas · Necesitan tu atención · En curso · Preparadas · Canceladas; `?estado=`, con el recuento en cada filtro y `aria-current` en el elegido). Solo se ofrecen los filtros con resultados; vacío → «Adaptar material»; un filtro sin resultados → «Ver todas».

## Pantalla de adaptación (`/app/adaptaciones/[id]`)

Se entra desde el material (con el perfil preseleccionado si se conoce): «¿Cómo quieres preparar esta ficha?» con **«Hacer magia»** (principal, recomendada: «Adaptaula usará el perfil del alumno para preparar y revisar la ficha automáticamente.») y **«Revisar antes de crear»** (secundaria: «Revisa cómo se adaptará el material y cambia lo que necesites antes de crear la ficha.»). El clic crea y empieza la adaptación. Una URL para todo el ciclo: trabajo (fases con texto: Analizando el material · Preparando la adaptación · [Tu revisión, solo al revisar] · Creando la ficha · Revisando el resultado · Lista, sin porcentajes ni promesas de tiempo) → con «Hacer magia», la ficha final (`/vista`); con «Revisar antes de crear», «Así prepararemos esta ficha» (las decisiones reales del plan con la recomendación ya elegida, «Cambiar», «Restaurar recomendación», «Crear ficha») → resultado. Si la revisión de calidad bloquea: con «Revisar antes de crear», «La ficha necesita una revisión antes de estar lista» → «Revisar adaptación»; con «Hacer magia», nunca: o se corrige sola, o «No hemos podido completar automáticamente esta ficha» con el motivo y «Revisar y editar» solo como opción. Si falta una imagen imprescindible, el motivo dice cuál es la causa real: «Adaptaula todavía no crea ilustraciones nuevas» (función desactivada o no ofrecida por ningún plan: nunca se propone cambiar de plan), «tu plan no incluye ilustraciones», «ya has usado las ilustraciones de este mes» o, si no se pudo construir una alternativa válida, el mensaje genérico (`AUTOMATIC_STOP_COPY` en `src/lib/adaptation/presentation/copy.ts`). Estados cubiertos: loading/working (`role="status"`, `aria-live="polite"`), sin conexión («Seguimos intentándolo…»), error con reintento, intento ambiguo con confirmación, límite alcanzado (copy exacto de cuota), sin permisos/otra cuenta (404), cancelada. Accesibilidad: una `fieldset` + `legend` por decisión, grupo de radios nativo con foco visible y objetivos ≥ 44 px, errores enlazados con `aria-describedby`, contador vivo de cambios pendientes, diálogos nativos (`<dialog>`), el estado nunca se comunica solo con color (icono + texto), `motion-safe` en los giros. Detalle y límites en `docs/ADAPTATION.md § UI del pipeline`.

## Estados obligatorios en cada pantalla

loading (skeletons con la forma real) · empty (explica y ofrece la siguiente acción) · success · partial (p. ej. 3 de 4 perfiles generados) · error (qué ha pasado + qué hacer + reintentar) · offline/retry · sin permisos · límite alcanzado (`LimitReachedCard`, copy en `docs/BILLING.md`). Los errores importantes se muestran en la página, no solo en un toast.

## Accesibilidad de la aplicación (WCAG 2.2 AA)

Navegación completa por teclado y orden lógico · foco visible (anillo de 2 px `focus`, azul de marca, + offset) · enlace "Saltar al contenido" · labels en todos los controles · errores con `aria-describedby` + `aria-invalid` y un resumen al enviar · diálogos con foco atrapado y Escape · objetivos táctiles ≥ 24×24 px (44 px en móvil) · `prefers-reduced-motion` · responsive y zoom al 200 % sin scroll horizontal · `lang="es"` · tests automáticos con axe en E2E.

El material generado también es accesible: encabezados semánticos, orden de lectura correcto, texto alternativo, nada solo por color y tablas con cabeceras.


## Editar una ficha entregada — primera entrega

Acceso desde «Ver la ficha» → «Editar ficha». Barra simple con Deshacer, Rehacer y Guardar borrador; estado de cambios visible. A4 ajustada al ancho y opción de tamaño real; controles de presentación y selector de actividad con enunciado y espacio de respuesta. En móvil los controles se apilan y la hoja puede ampliarse/desplazarse, sin toolbar de escritorio comprimida.

Cambiar un enunciado muestra el aviso pedagógico y exige reconocer que se comprobará antes de usarlo; nunca muestra una aprobación automática. Guardar conserva la ficha generada y crea una revisión del borrador. Un conflicto entre pestañas no sobrescribe: informa y permite recargar. Los errores de conexión conservan la edición local. Recuperar último guardado restaura ese borrador y se puede deshacer. La descarga se habilita tras guardar y siempre es del alumno. V1 no ofrece edición de tablas/figuras, claves, estructura ni autosave.

## Workspace del documento — etapa 2A (2026-10-16)

Sustituye la composición de la pantalla de material descrita arriba, conservando sus operaciones. `/app/adaptar` permite arrastrar o seleccionar, cambiar/quitar y analizar un archivo. Presenta nombre, formato, tamaño, límites reales y las fases de preparación, transferencia y comprobación. Ningún porcentaje de progreso. Después abre el material automáticamente.

`/app/materiales/[id]`: título y contexto del material; original como superficie central y panel con análisis, avisos y perfil. «Elegir apoyos» abre y enfoca el paso correspondiente, también en móvil. «Ocultar panel» amplía el original; al mostrarlo se mantienen selección y formularios. Las actividades/elementos a conservar, datos y otras acciones usan desplegables nativos. El resumen de necesidades se obtiene con `summarizeProfile`, sin inferencias nuevas ni envío del alias a proveedores. Los avisos del análisis permanecen visibles.

El visor reemplaza la miniatura/iframe anterior. Muestra una sola página por la ruta privada existente `/api/materials/[id]/pages/[page]`; controles de página, zoom relativo al ancho (50–200 %) y ajuste al ancho. Es una vista raster del original, de proporciones auténticas y con enlace al archivo para texto seleccionable/lectura más detallada. No reconstruye documentos ni fuerza su forma. Controles fuera del papel y errores con reintento/apertura del archivo. Reserva espacio durante la carga y reconoce imágenes cargadas antes de hidratar React. No precarga todas las páginas.

`/app/adaptaciones/[id]` mantiene el mismo original junto a los paneles reales del proceso: revisión, trabajo, bloqueo, error, cancelación o resultado. Las decisiones del servidor, el polling, la confirmación manual y la redirección automática a la ficha entregada se conservan. El original se identifica «Original · Sin modificar»: nunca se presenta como una adaptación generada. Los porcentajes del visor son zoom, no progreso del trabajo.

Escritorio utiliza dos columnas cuando hay ancho suficiente; móvil y ventanas estrechas apilan sin superposición. El panel puede ocultarse, pero no se desmonta ni se interrumpe el seguimiento. Solo lectura observa estados y archivos privados, sin comandos de modificación. Los errores siguen en la página, con foco y texto ampliable. **2B:** comparación y edición contextual descritas a continuación. La edición, guardado, recuperación y descarga existentes de CLARO permanecen disponibles en sus rutas.


## Comparar y editar — etapa 2B (2026-10-16)

Desde la ficha entregada se accede a «Comparar con original», con ruta directa `/app/adaptaciones/[id]/comparar`. Original a la izquierda y adaptación a la derecha; con poco ancho se alterna mediante dos botones etiquetados. Ambos visores conservan página y zoom al alternar. Controles independientes, sin correspondencia supuesta. El original procede del visor privado real; la adaptación del mismo CLARO que exporta PDF.

El selector distingue «Generada · versión N» de «Borrador guardado · revisión N». Solo ofrece el último borrador válido de la base actual. Cada descarga nombra su versión; una revisión inválida no se sustituye silenciosamente. No existe historial visual completo ni comparación con cambios sin guardar. Las páginas de CLARO son lógicas: la impresión puede introducir saltos adicionales, indicados en la interfaz.

En el editor, seleccionar una actividad en el papel (clic, Enter o Espacio) abre y enfoca sus ajustes. El selector del panel también navega a su página; el cambio de página elige su primera actividad si existe. El panel se puede plegar. En móvil los ajustes aparecen debajo del papel y reciben el foco, sin superposición. Deshacer, Rehacer, Guardar y feedback están junto a los controles. «Presentación de toda la ficha» se despliega aparte y expresa su alcance global. No se ofrecen herramientas de figura, tabla, opciones o estructura.

Todo cambio de enunciado exige reconocer la comprobación pedagógica pendiente. Recuperar último guardado restaura la copia cargada/guardada en esta sesión y puede deshacerse. Ante conflicto de otra pestaña, «Recargar borrador guardado» recarga realmente la última revisión del servidor, con confirmación nativa si hay cambios pendientes. El PDF del editor permanece deshabilitado hasta guardar; original y generada siguen intactos. No hay autosave ni aprobación pedagógica automática. [Evidencias](qa/adaptaula-2-etapa-2b/README.md).


## Mesa, biblioteca e historial — etapa 3A (2026-10-16)

La mesa ordena por acción: fichas que necesitan atención, nuevo material, fichas en proceso, preparadas y materiales recientes. Los renglones usan estados derivados del servidor y llevan a la siguiente acción; el consumo real permanece discreto. Sin indicadores estadísticos inventados.

La biblioteca mantiene una sola lista legible en móvil: búsqueda siempre visible y etapa, curso, asignatura, estado y orden en un desplegable nativo con contador de filtros activos. Busca por título en el workspace, filtra los campos disponibles y ordena por fecha o título. Los filtros se aplican antes de devolver hasta 200 resultados; la interfaz declara ese límite cuando se alcanza. Cada fila abre el original o lleva a sus adaptaciones. Búsqueda sin resultados ofrece limpiar los filtros.

El historial muestra hasta 100 adaptaciones recientes y lo dice expresamente. Mantiene filtros por estado real; desde una ficha preparada se puede abrir original, comparador, editor con rol de escritura y descargar el PDF generado. El comparador existente distingue generada y último borrador guardado. El historial no presenta cambios sin guardar como documentos.


## Etapa 3B — perfiles y cuenta

Perfiles: capacidad actual del servidor y enlaces por alias. Buscar y filtrar por curso opera sobre los perfiles autorizados ya cargados, sin enviar alias en URL, logs o IA. Sin resultados: limpiar filtros. Duplicar reutiliza la acción existente y respeta el límite; al agotarlo se explica y desactiva el control, sin impedir editar o eliminar. El formulario mantiene alias/etapa/curso y puntos de partida, con selección de áreas, intensidades y ajustes avanzados desplegables. «Así se aplicará» sigue siendo el resumen determinista de las dimensiones existentes. Un lector solo ve resumen e historial; sin formulario ni acciones mutantes. Se conserva la entrada a materiales analizados con el perfil preseleccionado.

Plan y cuenta: plan y periodo de `workspace_usage`, adaptaciones y análisis separados, perfiles actuales y plazas restantes. No hay nuevos límites en cliente ni precios cambiados. El nombre visible del docente se valida (1–120 caracteres) y guarda en `profiles` solo para el usuario autenticado; feedback de cambios pendientes/guardado/error y saludo actualizado. Correo y espacio son consulta. «Cambiar contraseña» abre `/reset-password`, que exige sesión y usa el flujo existente de Supabase Auth; `/forgot-password` redirige al inicio cuando ya existe sesión y no sirve como destino de este enlace. Se incluye cierre de sesión, privacidad y ayuda. Sin acciones de facturación, borrado ni exportación inventadas.
