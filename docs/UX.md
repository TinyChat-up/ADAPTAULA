# UX, arquitectura de información y sistema de diseño

## Personalidad

Profesional · educativa · accesible · moderna · tranquila · fiable. **No** guardería, videojuego, plataforma infantil ni producto médico.

## Mapa de rutas

### Públicas — `(marketing)`
| Ruta | Contenido |
|---|---|
| `/` | Hero ("Adapta un mismo material para cada alumno.") · demo original → adaptación · cómo funciona · casos de uso · ejemplos · privacidad · ventajas · precios · FAQ · CTA final |
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
| `/app` | Dashboard |
| `/app/adaptar` | Wizard de adaptación (admite `?material=` y `?clase=`) |
| `/app/adaptaciones/[id]` | Resultado + editor |
| `/app/adaptaciones/[id]/comparar` | Comparador original/adaptado |
| `/app/materiales` · `/app/materiales/[id]` | Biblioteca con filtros (etapa, asignatura, estado), reintentar y eliminar · detalle: progreso real, «Adaptaula ha identificado», actividades, elementos a conservar, elementos visuales, puntos a revisar, original y corrección del contexto |
| `/app/alumnos` · `/app/alumnos/nuevo` · `/app/alumnos/[id]` | Perfiles de alumnado · editor de perfil |
| `/app/clases` · `/app/clases/[id]` | Clases (Fase 2) |
| `/app/plantillas` | Plantillas visuales |
| `/app/historial` | Historial de adaptaciones |
| `/app/uso` | Uso del plan |
| `/app/ayuda` | Ayuda y contacto |
| `/app/configuracion` | Tabs: Cuenta · Workspace · Facturación · Privacidad · Datos · Notificaciones (`/app/configuracion/<tab>`) |

### Admin — `/admin` (solo `system_admin`, 404 para el resto)
`/admin` (KPIs) · `/admin/jobs` · `/admin/ia` · `/admin/prompts` · `/admin/usuarios`.

### API
`/api/uploads` · `/api/uploads/[id]/complete` · `/api/jobs` · `/api/jobs/[id]` · `/api/adaptations/[id]/export` · `/api/stripe/create-checkout` · `/api/stripe/portal` · `/api/stripe/webhook` · `/api/cron/jobs` · `/api/cron/retention`.

## Navegación de la app

**Escritorio — sidebar izquierda**: logo · Inicio · Adaptar material · Materiales · Alumnos · Clases · Plantillas · Historial · Uso — separador — Ayuda · Configuración — abajo: plan actual, barra de uso (%), avatar y menú de usuario. "Adaptar material" lleva un estilo primario.

**Móvil — barra inferior**: Inicio · Adaptar (botón central) · Materiales · Alumnos · Más (menú con el resto).

Las secciones que dependen de un flag o un plan (p. ej. Clases en Free) se muestran con su estado bloqueado y una explicación, no se ocultan sin más.

## Flujos clave

**Onboarding (máx. 3 pasos):** ¿Qué enseñas? (Primaria / ESO / Bachillerato / varias) → ¿Cómo quieres empezar? (Adaptar una ficha ahora / Crear primero un perfil / Ver ejemplo) → Privacidad ("Puedes utilizar alias en lugar del nombre real de tus alumnos.") → **Entrar en Adaptaula**.

**Dashboard:** "Buenos días, [nombre]" (saludo según la hora en Europe/Madrid) · CTA grande **+ Adaptar material** · tarjetas (adaptaciones este mes, perfiles, plan, uso) · *(Fase 6)* **Necesitan tu atención** (pendientes de empezar, esperando revisión, listas para crear la ficha, con error o que necesitan revisión), **En curso** y **Fichas preparadas** (con «Ver todas las adaptaciones» → historial); si hay materiales analizados y ninguna adaptación, «Siguiente paso: adapta un material» · Tus materiales (últimos 4) · Tus clases. Estado vacío: *"Empieza subiendo una ficha que ya utilizas."*

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

**Editor de perfil `/app/alumnos/[id]`:** información básica (alias con aviso de privacidad, etapa y curso; no se piden notas) → configuración orientativa opcional (preset) → 11 áreas seleccionables, y solo las elegidas muestran sus controles (Sin adaptación / Algo / Bastante / Mucho) → ajustes avanzados plegados → panel derecho fijo **"Así se aplicará"** con un resumen en lenguaje natural (p. ej. "Instrucciones breves · Máximo 3 tareas visibles · Ejemplo antes de ejercicios nuevos · Carga visual baja"). Los presets se aplican desde un selector y todo sigue siendo editable. Nunca se muestra JSON.

## Sistema de diseño

### Tokens de color (WCAG AA verificado sobre `surface`)

| Token | Valor | Uso | Contraste sobre #FFF |
|---|---|---|---|
| `background` | `#F7F8FA` | fondo de la app | — |
| `surface` | `#FFFFFF` | tarjetas, paneles | — |
| `border` | `#E2E6EC` | bordes | — |
| `foreground` | `#172033` | texto principal | 16,3:1 |
| `muted-foreground` | `#556070` | texto secundario | 6,4:1 |
| `primary` | `#2453C2` | acción principal, enlaces, foco | 6,8:1 |
| `primary-foreground` | `#FFFFFF` | texto sobre primario | — |
| `accent` | `#0F766E` | acentos (verde azulado) | 5,5:1 |
| `accent-soft` | `#E6F4F2` | fondos suaves | — |
| `success` | `#15803D` | | 5,0:1 |
| `success-strong` | `#14532D` | texto sobre fondos teñidos de success (insignias) | 7,9:1 sobre `success/10` |
| `warning` | `#B45309` | | 5,0:1 |
| `danger` | `#B91C1C` | | 6,5:1 |

Los estados nunca dependen solo del color: siempre llevan un icono y/o texto. Los tokens se definen como variables CSS en `globals.css` (`@theme` de Tailwind 4) y los consumen las primitivas de `components/ui`. El modo oscuro de la app queda preparado en los tokens, pero no está en el alcance del MVP.

### Tipografía
- **UI:** Inter (variable, `next/font`). Escala: 14 / 16 (base) / 18 / 20 / 24 / 30 / 36; interlineado 1,5 en texto y 1,2 en títulos.
- **Material (fichas):** por defecto Atkinson Hyperlegible Next, con alternativas Source Sans 3 y Lexend, configurables en la plantilla. Ninguna se presenta como "fuente para dislexia" ni como solución; se ofrecen como preferencias de presentación (tamaño, interlineado, espaciado entre letras y palabras, ancho de línea).

### Forma y espacio
Radio 10 px (tarjetas) / 8 px (controles); sombras discretas (`0 1px 2px rgb(16 24 40 / .06)`); escala de espaciado de 4 px; mucho aire. Iconos Lucide de 1,75 px de trazo, siempre con etiqueta visible o `aria-label`.

### Componentes
Primitivas propias en `components/ui` (Button, campos, Alert, Card, Badge, UsageMeter, Skeleton, EmptyState, PageHeader, ChoiceCards, ConfirmDialog con `<dialog>` nativo); shadcn/Radix se incorporará si hace falta un componente complejo. Componentes de producto: `PageHeader`, `EmptyState`, `ErrorState`, `LimitReachedCard`, `UsageMeter`, `StepProgress`, `FileDropzone`, `ProfileSummary`, `ChangeSummary`, `MaterialRenderer`.

## Análisis del material (fase 3)

Tras «Analizar material» el docente va a `/app/materiales/[id]`. Mientras el job corre se muestra **«Estamos preparando tu material»** con pasos que reflejan lo que el servidor hace de verdad (sin cronómetros ni estimaciones): *Archivo recibido → Leyendo el contenido e identificando las actividades → Revisando la estructura → Preparando el material*. Si el job está en cola lo dice. Se puede salir de la página («Puedes seguir usando Adaptaula mientras terminamos»): el job continúa en el servidor y la pantalla recupera el estado al volver.

Resultado: cabecera con título y etiquetas (etapa, curso, asignatura) solo cuando hay datos fiables; tarjeta «Adaptaula ha identificado» (tema, nº de actividades, dificultad aproximada, propósito y objetivos); aviso «Conviene que revises estos puntos» si hay incertidumbres; lista de actividades (con «Conviene revisarla» si la confianza es baja); «Lo que conviene conservar»; elementos visuales distinguiendo lo que aporta información de lo decorativo; el original; y el formulario «Datos del material» donde cada campo indica si está **Detectado automáticamente** o **Confirmado por ti** (lo confirmado prevalece, también al volver a analizar). El botón «Adaptar este material» está desactivado con una explicación honesta hasta la fase 4.

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
4. **Adaptar material** crea la adaptación (un doble clic crea una) y lleva a su página, donde **nada empieza hasta que el docente pulsa «Preparar propuesta de adaptación»**.
5. Propuesta → **revisión del docente** («Guardar revisión») → **«Crear material adaptado»**: cada paso es una decisión explícita; recargar no la toma por el docente.
6. **Ficha preparada**: «Ver la ficha» y **«Descargar PDF»** en la misma tarjeta; en la vista, «Vista del alumno» y «Descargar PDF».

**Entradas naturales, un solo flujo.** Desde el material (tarjeta), desde un perfil (`/app/alumnos/[id]` → «Adaptar un material con este perfil» → material con `?perfil=`), desde `/app/adaptar` («¿Ya lo has subido?» → material) y desde el inicio. Todas terminan en la misma tarjeta y la misma acción de servidor; no hay otra forma de crear una adaptación.

**Estados en listas** (`src/lib/adaptation/presentation/list.ts`; inicio, historial, material y perfil): Pendiente de empezar · Preparando propuesta · Esperando tu revisión · Lista para crear la ficha · Preparando ficha · Revisando calidad · Ficha preparada · Necesita tu revisión · No se pudo completar · Cancelada. Una adaptación que espera la decisión del docente nunca aparece «en curso». Cada fila lleva la siguiente acción como enlace (Empezar, Revisar propuesta, Crear ficha, Ver progreso, Ver ficha…), con texto e icono, nunca solo color.

**Solo lectura** (rol `viewer`): ve materiales, adaptaciones, estados, la ficha y su PDF; no ve comandos («Adaptar material», «Preparar propuesta», revisión, «Crear material adaptado», reintentar, cancelar) y su pantalla de adaptación no pide ejecutar nada.

**Historial** (`/app/historial`): todas las adaptaciones, de la actividad más reciente a la más antigua; vacío → «Adaptar material».

## Pantalla de adaptación (`/app/adaptaciones/[id]`)

Una URL para todo el ciclo: «Preparar propuesta» → trabajo (fases con texto: Preparando propuesta · Esperando tu revisión · Preparando material · Revisando calidad · Listo, sin porcentajes ni promesas de tiempo) → revisión del plan → «Crear material adaptado» → resultado temporal. Estados cubiertos: loading/working (`role="status"`, `aria-live="polite"`), sin conexión («Seguimos intentándolo…»), error con reintento, intento ambiguo con confirmación, límite alcanzado (copy exacto de cuota), sin permisos/otra cuenta (404), cancelada. Accesibilidad: una `fieldset` + `legend` por decisión, grupo de radios nativo con foco visible y objetivos ≥ 44 px, errores enlazados con `aria-describedby`, contador vivo de cambios pendientes, diálogos nativos (`<dialog>`), el estado nunca se comunica solo con color (icono + texto), `motion-safe` en los giros. Detalle y límites en `docs/ADAPTATION.md § UI del pipeline`.

## Estados obligatorios en cada pantalla

loading (skeletons con la forma real) · empty (explica y ofrece la siguiente acción) · success · partial (p. ej. 3 de 4 perfiles generados) · error (qué ha pasado + qué hacer + reintentar) · offline/retry · sin permisos · límite alcanzado (`LimitReachedCard`, copy en `docs/BILLING.md`). Los errores importantes se muestran en la página, no solo en un toast.

## Accesibilidad de la aplicación (WCAG 2.2 AA)

Navegación completa por teclado y orden lógico · foco visible (anillo de 2 px `primary` + offset) · enlace "Saltar al contenido" · labels en todos los controles · errores con `aria-describedby` + `aria-invalid` y un resumen al enviar · diálogos con foco atrapado y Escape · objetivos táctiles ≥ 24×24 px (44 px en móvil) · `prefers-reduced-motion` · responsive y zoom al 200 % sin scroll horizontal · `lang="es"` · tests automáticos con axe en E2E.

El material generado también es accesible: encabezados semánticos, orden de lectura correcto, texto alternativo, nada solo por color y tablas con cabeceras.
