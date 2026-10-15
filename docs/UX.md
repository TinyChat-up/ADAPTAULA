# UX, arquitectura de información y sistema de diseño

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

## Navegación de la app

**Escritorio — sidebar izquierda**: logo · Inicio · Adaptar material · Materiales · Perfiles · Adaptaciones — abajo: Plan y cuenta, resumen discreto del plan con barra de uso (enlaza a Plan y cuenta), identidad y cerrar sesión. «Adaptar material» lleva el color primario. La entrada activa lleva fondo, barra lateral y `aria-current` (nunca solo color); «Adaptaciones» también queda activa dentro de `/app/adaptaciones/[id]`.

**Móvil — cabecera fija** con el logo y el plan (`Plan Free · 1/5`, enlaza a Plan y cuenta) **y barra inferior**: Inicio · Materiales · Adaptar (botón central plano, con texto visible) · Perfiles · Más (hoja inferior con Adaptaciones, Plan y cuenta y Cerrar sesión).

En la navegación solo hay pantallas con contenido real: nada de entradas «Próximamente». Cuando una sección exista y dependa de un flag o un plan (p. ej. Clases en Free), se mostrará con su estado bloqueado y una explicación, no se ocultará sin más.

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

## Sistema de diseño

### Paleta y contraste

| Token | Valor | Uso |
|---|---|---|
| `background` | `#F5F3EE` | papel cálido, fondo general |
| `surface` | `#FFFFFF` | hojas y paneles de trabajo |
| `foreground` | `#192B40` | tinta, texto, acción principal |
| `muted-foreground` | `#526171` | metadatos y explicación secundaria |
| `primary` / `accent` | `#315A86` | enlaces, foco, selección y progreso |
| `primary-soft` / `accent-soft` | `#E7EEF4` | selección y apoyos suaves |
| selección de texto | `#C9D8E7` | selección nativa con texto tinta |
| `border` | `#D5D7D5` | separadores de contenido |
| `control-border` | `#7C8790` | perímetro identificable de controles |
| `success` / `success-strong` | `#24623E` / `#1C5132` | éxito y texto de insignias |
| `warning` / `danger` | `#925015` / `#B12828` | advertencia y error |

Color siempre funcional; estados con texto y, cuando ayuda, icono. Texto principal, secundario y enlaces superan 4,5:1 tanto sobre blanco como sobre papel; el borde de controles supera 3:1 en ambos fondos. Los separadores decorativos no se usan para identificar campos. Tokens en `globals.css` (`@theme` de Tailwind 4), compartidos por las primitivas. Sin degradados, halos, cuadrículas de fondo ni sombras teñidas. No se implementa modo oscuro.

### Tipografía

- **UI:** Inter existente mediante `next/font`, base 16 px / 1,5. Metadatos 12–14, subtítulos 18–20, títulos de app 30/36. No se añade descarga de fuentes.
- **Titulares públicos:** Georgia del sistema, 44 px móvil y 60–68 px escritorio, interlineado 1,06–1,2. Contraste serif/sans para distinguir discurso editorial de controles. Antetítulos 11 px, mayúsculas espaciadas, solo información secundaria.
- **Fichas del alumnado:** conservan íntegros CLARO, sus estilos, fuentes, geometría y renderer. El sistema web no se traslada al PDF. Las muestras de portada tienen clases `sample-*` propias; son HTML ilustrativo, no una captura ni una ejecución del renderer.

### Espacio, composición y contenedores

Base de 4 px: 8/12 para relaciones cercanas, 16/20/24 para controles y filas, 32/40 entre grupos, 48/64/80 entre secciones públicas. Portada hasta 1280 px, app hasta 1152 px, adaptación/subida hasta 768 px. Márgenes móviles de 20 px, mayores en escritorio. Sidebar de 224 px, cabeceras con filete y sin icono ornamental. Radios de 4 px; `shadow-card: none`.

Listas de materiales, perfiles y adaptaciones: filas sobre papel, separadores, títulos legibles y metadatos en texto; estado y siguiente acción se distinguen de la identidad del material. En móvil pasan a bloques verticales sin esconder la acción. Se reservan superficies blancas para documentos, subida, formularios y decisiones acotadas. Una tarjeta no es el contenedor por defecto de una sección.

### Controles y componentes

Acción principal: botón sólido tinta, azul al interactuar. Secundario: fondo blanco y borde visible. Enlaces editoriales subrayados; acciones táctiles principales ≥44 px; foco de 2 px con separación de 3 px. No hay escalado ni elevación al pulsar. Inputs con label, borde de control, error asociado y estados desactivados existentes.

Se reutilizan Button, campos, Alert, Card, Badge, UsageMeter, Skeleton, EmptyState, PageHeader, ChoiceCards y ConfirmDialog nativo. Se retira `IconBadge`; cabeceras y vacíos se reconocen por su texto. `Card interactive` responde con borde/fondo, sin desplazarse. Cuotas en barras finas de un solo color. `PageSkeleton` conserva la estructura de carga por sección.

### Portada: original → adaptado

El hero combina la propuesta y dos páginas de proporción A4 con **contenido real de demostración**: tabla de animales, alimentación y hábitat, pregunta de consulta literal y tres alternativas. Ambas conservan tabla, consigna y opciones; la adaptada separa las respuestas con círculos vacíos y amplía el espaciado. Ninguna señala la solución. Rótulo explícito: «Demostración preparada por nosotros», no una generación en directo ni una garantía sobre cualquier archivo. La propuesta coincide con selección única tabular de ADR-023; no promete simplificación arbitraria.

Hacer magia prepara y comprueba automáticamente; Revisar antes de crear permite ajustar primero la propuesta. Se invita a revisar el resultado y descargar cuando esté listo, y se explica que puede no completarse. Los precios y límites siguen viniendo del sistema existente.

### Movimiento y responsive

Solo movimiento que comunica interacción, carga o estado: colores 150–160 ms, progreso 200 ms, entrada de hoja modal 180 ms y pulso de carga. Se retiran entradas de página, escalonados, animaciones por scroll, flotación y llenado inicial de cuotas. `prefers-reduced-motion` reduce animaciones y transiciones a prácticamente cero.

- Sidebar desde 768 px; por debajo, cabecera y barra inferior con etiquetas. «Más» conserva `<dialog>`, Escape y retorno de foco. Cabecera y acciones se redistribuyen al ampliar texto.
- Hero en dos columnas desde 1280 px; antes, texto seguido de las hojas. Hojas en pareja desde 640 px y apiladas en móvil. `aspect-ratio` A4 permite crecer si el texto ampliado lo necesita, sin recortar contenido.
- Formularios y filtros pasan a una columna cuando hace falta; las filas envuelven acciones y metadatos. Verificado a 390 px y con texto al 200 % a 320 px en la biblioteca; no equivale a una auditoría manual completa.
- Ningún `loading.tsx` envuelve `/app/adaptaciones/[id]` ni `/vista`: se preservan los grupos `(inicio)` y `(lista)` de ADR-024 para no convertir 404 de otra cuenta en 200.

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

Se entra desde el material (con el perfil preseleccionado si se conoce): «¿Cómo quieres preparar esta ficha?» con **«Hacer magia»** (principal, recomendada: «Adaptaula usará el perfil del alumno para preparar y revisar la ficha automáticamente.») y **«Revisar antes de crear»** (secundaria: «Revisa cómo se adaptará el material y cambia lo que necesites antes de crear la ficha.»). El clic crea y empieza la adaptación. Una URL para todo el ciclo: trabajo (fases con texto: Analizando el material · Preparando la adaptación · [Tu revisión, solo al revisar] · Creando la ficha · Revisando el resultado · Lista, sin porcentajes ni promesas de tiempo) → con «Hacer magia», la ficha final (`/vista`); con «Revisar antes de crear», «Así prepararemos esta ficha» (las decisiones reales del plan con la recomendación ya elegida, «Cambiar», «Restaurar recomendación», «Crear ficha») → resultado. Si la revisión de calidad bloquea: con «Revisar antes de crear», «La ficha necesita una revisión antes de estar lista» → «Revisar adaptación»; con «Hacer magia», nunca: o se corrige sola, o «No hemos podido completar automáticamente esta ficha» con el motivo y «Revisar y editar» solo como opción. Estados cubiertos: loading/working (`role="status"`, `aria-live="polite"`), sin conexión («Seguimos intentándolo…»), error con reintento, intento ambiguo con confirmación, límite alcanzado (copy exacto de cuota), sin permisos/otra cuenta (404), cancelada. Accesibilidad: una `fieldset` + `legend` por decisión, grupo de radios nativo con foco visible y objetivos ≥ 44 px, errores enlazados con `aria-describedby`, contador vivo de cambios pendientes, diálogos nativos (`<dialog>`), el estado nunca se comunica solo con color (icono + texto), `motion-safe` en los giros. Detalle y límites en `docs/ADAPTATION.md § UI del pipeline`.

## Estados obligatorios en cada pantalla

loading (skeletons con la forma real) · empty (explica y ofrece la siguiente acción) · success · partial (p. ej. 3 de 4 perfiles generados) · error (qué ha pasado + qué hacer + reintentar) · offline/retry · sin permisos · límite alcanzado (`LimitReachedCard`, copy en `docs/BILLING.md`). Los errores importantes se muestran en la página, no solo en un toast.

## Accesibilidad de la aplicación (WCAG 2.2 AA)

Navegación completa por teclado y orden lógico · foco visible (anillo de 2 px `primary` + offset) · enlace "Saltar al contenido" · labels en todos los controles · errores con `aria-describedby` + `aria-invalid` y un resumen al enviar · diálogos con foco atrapado y Escape · objetivos táctiles ≥ 24×24 px (44 px en móvil) · `prefers-reduced-motion` · responsive y zoom al 200 % sin scroll horizontal · `lang="es"` · tests automáticos con axe en E2E.

El material generado también es accesible: encabezados semánticos, orden de lectura correcto, texto alternativo, nada solo por color y tablas con cabeceras.


## Editar una ficha entregada — primera entrega

Acceso desde «Ver la ficha» → «Editar ficha». Barra simple con Deshacer, Rehacer y Guardar borrador; estado de cambios visible. A4 ajustada al ancho y opción de tamaño real; controles de presentación y selector de actividad con enunciado y espacio de respuesta. En móvil los controles se apilan y la hoja puede ampliarse/desplazarse, sin toolbar de escritorio comprimida.

Cambiar un enunciado muestra el aviso pedagógico y exige reconocer que se comprobará antes de usarlo; nunca muestra una aprobación automática. Guardar conserva la ficha generada y crea una revisión del borrador. Un conflicto entre pestañas no sobrescribe: informa y permite recargar. Los errores de conexión conservan la edición local. Recuperar último guardado restaura ese borrador y se puede deshacer. La descarga se habilita tras guardar y siempre es del alumno. V1 no ofrece edición de tablas/figuras, claves, estructura ni autosave.
