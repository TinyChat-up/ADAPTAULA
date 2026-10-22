# Recursos visuales (Phase 8.2A)

Cómo llega una imagen, un gráfico o un apoyo visual desde el material original, o desde el plan de adaptación, hasta la ficha
impresa. También qué hace el docente cuando falta algo. Ningún modelo dibuja ni inventa imágenes; en esta fase no hay generación
de imágenes por IA.

## Qué bloqueaba «Hacer magia»

**Causa (reproducida en `tests/db/visual-resources.test.ts` antes de corregirla).** Cuando el material necesitaba un apoyo visual,
el planificador proponía una decisión de tipo `visual_support`, normalmente `add_support` con el apoyo `visual_cue` o una petición
`visual`, de cualquiera de estas formas:

- `reuse_original`;
- `transform_original`;
- `new_representation`;
- `optional_support`.

El *preflight* de ejecución (`src/lib/adaptation/execution.ts`) no encontraba ejecutor para ninguna de ellas:

- el generador v2 no produce imágenes (`visual_cue` no autoriza nada);
- `add_support` no es una acción de maquetación.

La decisión quedaba `unsupported`. Lo que pasaba después:

1. La revisión automática de «Hacer magia» no era ejecutable y la adaptación se paraba en «Así prepararemos esta ficha».
2. La recomendación por defecto incluía esa decisión, así que «Crear ficha» volvía a fallar con «Hay un cambio que todavía necesita
   ajustarse».
3. No había ninguna acción clara para el docente.

Esto ocurría también cuando la decisión solo pedía conservar una imagen que ya estaba en el original.

**Segundo hueco.** Una ficha entregada con una imagen imprescindible del original sin localizar se marcaba «La ficha está lista» y
ofrecía «Descargar PDF», que respondía 409. La acción para localizarla solo estaba en el panel docente, al final de la vista.

## Los cinco casos

| Caso | Qué es | Quién lo resuelve | ¿Bloquea el PDF? |
| --- | --- | --- | --- |
| 1 · Visual del original, localizado | `image` de origen `original` con recorte `visual_crop@v1` | Infraestructura existente (localizador + recorte) | No |
| 2 · Visual del original sin localizar | Igual, sin recorte todavía | El docente: «Seleccionar imagen» (localizador humano). Nunca se puede omitir si es necesario | Sí, si es necesario |
| 3 · Gráfico o tabla con datos estructurados | `chart` / `table` reconstruido con los datos verificados del análisis | El renderer; no hace falta imagen | No |
| 4 · Visual imprescindible que no está en el original | `image` de origen `requested` con `essential: true` | El docente: «Añadir recurso» (su imagen). Nunca se omite | Sí, hasta que se aporte |
| 5 · Apoyo visual opcional | `image` de origen `requested` sin `essential` | Nadie obligatoriamente; el docente puede añadirlo | No |

`visualTreatment` (`src/lib/adaptation/visual-needs.ts`) clasifica cada decisión:

- **`reuse_original` y `transform_original`** de un visual existente se tratan como **original**. El ensamblador lo conserva y lo
  enlaza a su actividad. Una transformación que el renderer no sabe hacer no se finge: se conserva el original y el informe de
  ejecución lo dice.
- **`new_representation`** se trata como **pedido** (*requested*): imprescindible solo si el planificador lo marcó `essential`.
- **`optional_support`** y un **`visual_cue` sin petición** se tratan como **pedido opcional**.

Estas decisiones van por la ruta `deterministic`. El generador nunca las recibe y la auditoría de generación acepta el hueco
reservado (`image` *requested* de esa decisión) como composición, no como bloque generado. Una decisión que además reescribe la
actividad (`rephrase`, etc.) sigue necesitando su ejecutor: no hay ejecución parcial silenciosa.

## Cuándo se puede omitir una imagen (garantía pedagógica)

Aceptar la omisión en nombre del docente no basta: la ficha tiene que seguir siendo resoluble. Las reglas son deterministas y no
llaman a ningún modelo:

- **Imagen imprescindible del original** (por ejemplo, la figura o el gráfico que una pregunta pide interpretar): **nunca** se
  omite. No hay ningún camino para hacerlo, ni en la interfaz ni en el servidor. El PDF no se genera hasta que se selecciona.
- **Apoyo opcional**: se puede omitir.
- **Recurso imprescindible que no está en el original**: **debe proporcionarse**. El servidor rechaza la omisión con
  `needs_resource` y la interfaz no ofrece «Continuar sin esta imagen».
- **Texto asociado:** un texto escrito para la misma decisión (pasos, idea clave…) **no** demuestra equivalencia funcional. Un
  pictograma que da acceso a una instrucción no se sustituye por palabras. Admitir alternativas multimodales equivalentes exigirá
  un mecanismo explícito y validado; no está implementado.
- **Omisión registrada sin derecho a ella** (una fila antigua, una carrera o una llamada directa): el renderer **la ignora**. El
  recurso sigue pendiente, la ficha no se puede imprimir y el PDF sigue bloqueado. Lo comprueba un test.

## Qué ve y qué hace el docente

**Vista de la ficha** (`/app/adaptaciones/[id]/vista`). El primer bloque es «Imágenes y recursos visuales» (fuera de la hoja,
oculto al imprimir). Cada recurso indica a qué actividad pertenece y lleva un mensaje sencillo:

- «Esta actividad necesita una imagen del documento original.» → **Seleccionar imagen**
- «Esta actividad necesita un recurso visual que no está en el documento original.» → **Añadir recurso** · **Continuar sin esta
  imagen**
- «Apoyo visual opcional: la ficha se puede imprimir sin él.» → **Añadir recurso**

Nunca se muestran estados técnicos (`missing_locator`, `asset_missing`, `visual_crop…`); lo comprueban los tests. Los miembros de
solo lectura ven el estado, sin acciones.

**Pantalla de la adaptación.** Si a una ficha entregada le falta algo imprescindible, el aviso dice «La ficha está casi lista» y
ofrece «Completar la ficha». No ofrece descargar el PDF hasta que esté completa.

**Reanudación.** Seleccionar una imagen, añadir un recurso o continuar sin él actúa sobre **la misma adaptación** y su versión
entregada. No hay adaptación nueva, regeneración, job ni consumo de cuota. La unidad se consumió una sola vez, al entregar.

## Recursos aportados por el docente (migración 020)

**Tabla `adaptation_visual_resources`.** Contiene una respuesta por decisión de una adaptación:

- `provided`: un PNG en el bucket privado `generated-assets`;
- `omitted`: la decisión explícita, con autor y fecha.

Propiedades de la tabla:

- Las filas son inmutables; corregir crea una fila nueva y sustituye la anterior (una activa por decisión).
- RLS: lectura para los miembros del workspace; sin escritura desde el navegador.
- `set_adaptation_visual_resource` es exclusiva de `service_role`, con candado, e idempotente: los mismos bytes o la misma
  omisión devuelven la fila activa.

**Ruta `POST /api/adaptations/[id]/resources/[decisionId]`.** Solo para quien edita, con comprobación de mismo origen.

- El servidor resuelve la adaptación con el cliente del usuario (RLS) y su versión entregada actual.
- Comprueba que esa decisión tiene un hueco reservado en el documento.
- Exige la declaración «Puedo usar esta imagen en mi clase».

Validación de la imagen (`resources/image.ts`):

- se valida **sobre los bytes**: firma PNG/JPEG/WebP y como máximo 8 MB; el nombre del archivo no se usa;
- se decodifica y se vuelve a dibujar como **PNG**, de modo que no sobrevive ningún metadato (EXIF, ubicación, autor);
- se conservan las proporciones y el lado mayor queda en 2400 px como máximo;
- la transparencia se aplana sobre blanco.

**Ruta `GET`.** Sirve los bytes solo si su sha-256 coincide con la fila. No hay URLs firmadas ni públicas.

**PDF.** Las imágenes aportadas se fijan como los recortes del original (`asset:<id>@<sha256>`, bytes verificados e incrustados).
No se descarga nada externo al imprimir.

**Privacidad.** Las rutas son `<workspace>/<adaptación>/resources/<sha256>.png`: otra cuenta no ve ni la fila ni el objeto (test).
Los logs solo llevan ids opacos. La interfaz recuerda «No subas fotos ni datos del alumnado». Al borrar la adaptación, las filas se
borran en cascada. Los objetos de Storage siguen la misma política que el resto del bucket (sin recolector todavía).

## Renderer y PDF

Una sola cadena: el mismo renderer y el mismo Sistema CLARO, sin segundo renderer. La imagen `requested` tiene cuatro estados:

- `available`: el recurso del docente, con nombre accesible neutro;
- `pending`: si es imprescindible, `not_renderable` con «Falta un recurso visual imprescindible…»; si es opcional, aviso;
- `omitted`: no deja rastro en la hoja;
- nunca una imagen sustituta.

Los gráficos con datos se reconstruyen con sus categorías, valores, ejes y unidad. Los visuales siguen asociados a su actividad
(`resource_block_ids`), con su proporción y con la anchura y altura máximas ya existentes del renderer.

## Preparado para pictogramas y catálogos (sin implementar)

El contrato ya distingue de dónde viene cada recurso:

| Recurso | Dónde vive hoy | Ampliación prevista |
| --- | --- | --- |
| Imagen del documento original | `image` `original` + localizador (humano o `auto`, 8.2B.1) + `visual_crop@v1` | — |
| Figura matemática simple del original | `material_visual_specs` (VisualSpec v1) dibujada por el renderer propio (8.2B.1) | Más tipos de figura, con otra versión del extractor |
| Gráfico o tabla estructurados | `chart` / `table` con datos verificados | — |
| Imagen del docente | `adaptation_visual_resources` `source = 'teacher_upload'` | — |
| Pictogramas de acciones e instrucciones, secuencias visuales | `image` `requested` con `style: "icon"` | `source = 'catalog'` + `license` + `attribution` (columnas ya previstas, otra migración para el valor) |
| Esquemas pedagógicos, ilustraciones educativas autorizadas | `image` `requested` con `style: "diagram"` / `"illustration"` | Igual: catálogo con procedencia y licencia por elemento |

**Iconos de interfaz frente a pictogramas.** Los iconos de la aplicación (Lucide, licencia ISC) son de interfaz y **nunca** se usan
como pictogramas de comunicación en la ficha del alumno.

### Licencias revisadas (octubre de 2026; verificar de nuevo antes de integrar nada)

| Catálogo | Licencia | ¿Uso en un SaaS comercial? |
| --- | --- | --- |
| ARASAAC (Gobierno de Aragón) | CC BY-NC-SA | **No** sin autorización expresa: el uso comercial está excluido. No se incorpora |
| Sclera | CC BY-NC (su página indica 2.0; Global Symbols lista 4.0) | **No** sin un acuerdo escrito con Sclera |
| Mulberry Symbols | CC BY-SA (Global Symbols lista 4.0) | Sí, con atribución y *share-alike* para las obras derivadas; revisión legal antes |
| OpenMoji | CC BY-SA 4.0 (gráficos; el código es LGPL-3.0) | Sí, con atribución y *share-alike*; son emojis, no un sistema de comunicación aumentativa |
| Global Symbols | Agregador: la licencia es la de cada conjunto | Según el conjunto |

Para cualquier catálogo futuro hay que guardar, por cada elemento: procedencia, licencia, atribución exigida y si permite uso
comercial. Además, las obras derivadas *share-alike* necesitan revisión legal antes de mezclarse con la ficha. Fuentes:
[ARASAAC](https://aulaabierta.arasaac.org/en/terms-of-use), [Sclera](https://www.sclera.be/en/picto/copyright),
[Mulberry en OpenSymbols](https://www.opensymbols.org/repositories/mulberry), [OpenMoji](https://openmoji.org/faq),
[Global Symbols](https://globalsymbols.com/about/terms-and-conditions?locale=en).

## Deuda

- **Rate limit:** la subida no tiene un *rate limit* propio; solo la limitan el rol de quien edita, el tamaño y el número de huecos
  por ficha.
- **Objetos huérfanos:** no hay recolector para los objetos sustituidos de Storage (igual que para los recortes).
- **Plantilla de Geografía:** la plantilla de Geografía de los evals no se entrega con el generador simulado aunque no tenga
  decisiones visuales (limitación previa del mock).
- **Adaptación parada antes de 8.2A:** una adaptación que se quedó en la revisión del plan por una decisión visual se recupera con
  «Crear ficha» desde esa revisión: el *preflight* se vuelve a ejecutar con estas reglas. No se migra nada.

## Hotfix 8.2A.1 · estado de entrega coherente

**Un solo cálculo.** `readinessOf` (`src/lib/render/readiness.ts`) decide si una ficha entregada se puede imprimir, con la misma
regla que la vista del alumno y el PDF. Lo usan la pantalla de la adaptación, la vista de la ficha, las listas (inicio, historial,
material y perfil) y la exportación.

**Mientras falte un visual imprescindible:**
- la pantalla dice «La ficha está casi lista · Falta completar un recurso» y la acción principal es «Completar ficha», sin «Descargar
  PDF»;
- las listas muestran «Casi lista · falta un recurso»;
- el PDF responde **409 `resource_pending`** con «Falta completar un recurso de la ficha…»; nunca el 503 técnico «inténtalo en unos
  minutos». El bloqueo se mantiene aunque alguien llame directamente al endpoint.

Las listas leen las filas sin descargar cada objeto (`verify: false`). La ficha, las rutas de imagen y el PDF siempre verifican el
sha-256.

**Imagen que el análisis atribuye al original (migración 021).** El servidor no puede comprobar si la imagen está realmente en el
PDF. Por eso el docente ve dos acciones:
- «Localizar en el original»;
- «No está en el original · Añadir imagen»: su imagen sustituye a esa, solo en esta adaptación, y se fija en el PDF por id +
  sha-256.

Nunca se localiza una zona arbitraria ni se inventa la imagen. Un visual del original nunca se omite: lo impiden el servidor y una
restricción de la base de datos.

**Decisiones de presentación.** El *preflight* solo deja para el renderer un `segment`/`reorganize` sin apoyo cuando el destino es una
actividad o el documento (lo único que el renderer sabe separar visualmente). Sobre un texto, un visual o una sección es
`unsupported`. La recomendación automática solo la deja fuera si sus necesidades ya las cubren otras decisiones o la presentación, y
registra el motivo. En caso contrario, «Hacer magia» se detiene en la revisión y decide el docente: no se entrega una ficha que ignora
la decisión.

## «Hacer magia» y los visuales (2026-10-10) · límite para Phase 8.2B

Qué hace «Hacer magia» sola con los visuales:
- **Reutiliza** un visual del original **ya localizado**: su recorte fijado por hash.
- **Reconstruye** tablas y gráficos con datos verificables del análisis: no necesitan imagen.
- **No confunde** un visual decorativo (`role: decorative`) con uno necesario.
- **Incluye apoyos visuales opcionales** solo cuando el plan los justifica, y nunca bloquean la ficha.

**Auditoría: ¿puede localizar sola un recurso original que ya está en el PDF? Hoy no.** El análisis (`MaterialAnalysis v3`) guarda de cada visual la página, el tipo, el papel y su descripción, pero **no su posición**. Los localizadores (`visual_locators`) los crea siempre una persona («Localizar en el original»). Recortar una zona sin saber cuál sería inventar, y por eso no se hace. Tampoco se generan imágenes ni hay biblioteca de pictogramas.

**Comportamiento honesto.** Cuando un visual imprescindible no se puede obtener automáticamente (un original sin localizar o un recurso nuevo esencial), la ficha se entrega en «No hemos podido completar automáticamente esta ficha porque necesita un recurso visual»:
- «Completar ficha» lleva a la misma adaptación, sin consumir otra unidad;
- no hay PDF hasta completarla (409 `resource_pending`);
- nunca se presenta como terminada;
- no se abre la edición del plan.

**Para Phase 8.2B** (la localización automática ya está hecha en 8.2B.1, ver la sección siguiente):
- ~~localización automática de visuales originales~~ (8.2B.1);
- biblioteca de pictogramas con licencia compatible;
- generación de imágenes, si se decide.

Con esas piezas, las paradas por recurso visual de «Hacer magia» se reducirán sin cambiar la regla: un visual imprescindible nunca se omite.

## Visuales automáticos y reconstrucción matemática (Phase 8.2B.1, migración 022)

«Hacer magia» localiza por sí misma los visuales que el análisis identificó, los recorta y reconstruye las figuras matemáticas
simples. El docente no marca regiones. Es la misma arquitectura de 8.2A: mismo localizador (`material_visual_locators`), misma
receta de recorte (`visual_crop@v1`), mismo renderer, misma ficha y mismo PDF. No hay un segundo pipeline.

### Por qué había que seleccionar a mano

`MaterialAnalysis v3` guarda de cada visual la página, el tipo, el papel y la descripción, pero no su posición. Hasta ahora el único
método de localización era `human`, que exigía la migración 016. Además el documento colocaba todos los visuales de una sección
antes de sus actividades. El orden entre tipos no está en el análisis, así que la figura acababa arriba, lejos de su enunciado.

### Cómo se localiza (`src/lib/materials/visuals/auto/`)

1. **Geometría de la página.** Se renderiza la página tal como se ve, con el mismo rasterizador que los recortes (100 ppp para
   localizar). Se lee la capa de texto del PDF con pdf.js sobre la misma superficie: CropBox y `/Rotate`. Una figura es la tinta
   que queda al quitar el texto. Se descartan las reglas y líneas de respuesta, los marcos de página, las motas y las cajas vacías.
2. **Anclas de actividad.** Se busca la línea impresa donde empieza cada instrucción del análisis. La zona de una actividad va desde
   su ancla hasta la siguiente.
3. **Firma del tipo.** Una recta numérica es un trazo horizontal largo cruzado por al menos tres trazos cortos. Una barra es un
   rectángulo cerrado con divisiones verticales. Una figura genérica es cualquier otra tinta que no es texto. El tipo se deduce de
   `kind` y de las palabras del propio análisis; nunca de la tarea.
4. **Confianza explícita** (`locate.ts`):

   | Señal | Peso |
   | --- | --- |
   | Firma del tipo (figura genérica: **0**; desde `auto_visuals@v2`) | 0,30 |
   | En la zona de su actividad | 0,25 |
   | Única en esa zona o al menos 0,15 por delante de la siguiente | 0,20 |
   | Recorte limpio: hay tinta, no ocupa media página y no corta texto corrido ajeno. **Obligatorio** | 0,15 |
   | Acuerdo con la hipótesis de visión (IoU ≥ 0,5 y confianza del modelo ≥ 0,7) | 0,20 |

   Se acepta con **≥ 0,75**. Las etiquetas impresas junto a la figura entran en el recorte, incluidas las fracciones apiladas. El
   texto corrido nunca entra. Una figura genérica (cualquier tinta que no es texto) no aporta firma: tener líneas o tinta no es
   prueba de que sea ESE visual, así que sin el acuerdo de la visión se queda en 0,60 y no se acepta.
5. **Visión solo si hace falta.** Si algo queda sin resolver y hay proveedor configurado, se hace **una** llamada por página con
   `visual_locator@v1` y el alias `STANDARD`, a través de `src/lib/ai`. Hay como máximo 3 páginas por versión del material. La
   respuesta es una **hipótesis**: solo suma si cae sobre una región que la geometría ya encontró. Un rectángulo sin figura queda
   en un máximo de 0,60 y se rechaza.
6. **Guardado.** Se crea un localizador `auto` con su `confidence` y su `evidence`: señales, zona, coordenadas en PDF y ppp, nunca
   texto del material. Nunca sustituye a un localizador activo. El recorte sale de `produceVisualAsset`: privado, inmutable y con
   sha-256.

Coordenadas: el localizador sigue usando la superficie normalizada de 016. Para auditar, `toPdfRect` las devuelve al espacio de
usuario del PDF deshaciendo `/Rotate`. Se ha comprobado contra `convertToPdfPoint` de pdf.js, también con una página guardada de
lado.

### VisualSpec v1 (`src/lib/visuals/spec.ts`) y renderer SVG propio

| `kind` | Datos | Verificación |
| --- | --- | --- |
| `fraction_bar` | `parts`, `shaded` (índices) | Partes iguales (±4 %). Cada parte, claramente sombreada o claramente blanca. Sin texto dentro |
| `number_line` | `start`, `end`, `divisions`, `labels` (las del original, por marca) | Marcas equidistantes (±4 %). Extremos rotulados. Cada etiqueta vale exactamente lo que su marca (aritmética racional). Sin tinta ajena sobre la recta: un punto o una X impiden reconstruir |
| `part_whole` | `shape`, `parts`, `shaded` | Como la barra. Hoy solo se dibuja; no se extrae |
| `comparison` | `items` (pares de fracciones) | Se lee del enunciado impreso solo si pide «<, > o =», cada fracción pertenece a un par y ningún par muestra ya la relación |

Ningún tipo tiene un campo para una marca, un punto, un signo o una solución, así que el contrato no puede llevar la respuesta. El
renderer (`src/components/material/visual-spec.tsx`) dibuja con elementos SVG de React a partir de números validados. No usa
cadenas de marcado, enlaces, scripts, recursos externos, `style` ni `foreignObject`. Mide en milímetros y el sombreado es gris
#767676 (contraste > 4,5:1, legible en blanco y negro). Si un spec no se verifica, se usa el recorte del original.

Ejemplo verificado (fixture sintética «Fracciones en situaciones cotidianas»): barra `{parts: 8, shaded: [0,1,2]}`, recta
`{start: 0, end: 1, divisions: 4, labels: 0, 1/4, 1/2, 3/4, 1}` y comparación `2/3 ☐ 3/5 · 4/8 ☐ 1/2` (dos casillas vacías).

### Elección automática y auditable

| | Cuándo | Qué se imprime |
| --- | --- | --- |
| **A** | Un docente localizó la figura | Su recorte, tal cual |
| **B** | Localizada automáticamente | El recorte original: píxeles del original, recorte ajustado y tamaño físico |
| **C** | Localizada automáticamente y con VisualSpec verificado | La reconstrucción |
| **D** | No localizada o recorte fallido | Nada. Si es imprescindible, la parada honesta de siempre (409 `resource_pending`) |

`resolveVisuals` lo decide a partir del estado guardado. Un spec solo cuenta si coincide con su sha-256. La ejecución de cada
versión del material (`material_visual_autolocations.result`) registra, por visual, la elección, la confianza, el motivo y las
señales. Solo se buscan los visuales `required` e `informative` que se dibujan como imagen: nunca uno decorativo ni ilustrativo
presentado como apoyo, y nunca una tabla o un gráfico, que se reconstruyen con sus datos.

### Cada figura con su actividad (sin posición vertical)

- **Documento** (`anchorResources`): una figura o un texto de tipo `example`/`formula`/`definition`/`note` se coloca justo antes de
  la primera actividad que lo usa (`resource_ids`) en su página. Al partir por `max_tasks_per_page` viaja con ella (`takeLeads`).
- **Modelo de render:** la actividad lleva `leads` (su ejemplo, antes del enunciado) y `figures` (sus figuras, justo después). En
  CSS, enunciado, figura y ejemplo nunca se separan (`break-after: avoid`, `break-inside: avoid`).
- **Respuestas deterministas:** la comparación da `response: comparison`, con una casilla vacía por par y sin la caja enorme. Marcar
  o colorear la propia figura (`mark`/`draw` sin área) da `response: none`: la figura es el espacio de respuesta. El control
  `instructions_complete` lo acepta.
- El recorte se imprime a su **tamaño físico** (`widthMm`), nunca estirado al 92 % de la columna.

### Modos

- **«Hacer magia»:** antes de entregar la ficha, el orquestador llama a `visuals.prepare`, sin aprobación del plan, sin selector y
  sin edición forzada. Un fallo aquí nunca hace fallar la generación. Lo que no se resuelve es la parada honesta de la misma
  adaptación.
- **«Revisar antes de crear»:** no se localiza nada por sí solo. El docente puede pedirlo con «Buscar en el original»
  (`POST /api/adaptations/[id]/visuals/auto`), que usa el mismo motor y las mismas reglas. Su localización manual siempre manda y
  sustituye a la automática. Una reconstrucción solo se aplica a un localizador `auto`; lo garantiza un trigger.

### Seguridad, privacidad y coste

- Objetos privados en `generated-assets`, sin URL pública ni firmada.
- RLS de lectura para los miembros y escritura solo del servidor. Las RPC, solo para `service_role`.
- Las tablas nuevas son inmutables o acotadas: `material_visual_specs` es inmutable; en `material_visual_autolocations` solo cambia
  el estado de la ejecución.
- En los logs solo hay recuentos y códigos.
- A la IA solo llegan la imagen de la página y las descripciones del análisis, nunca datos del alumnado. Todo va entre
  `<untrusted_material>` y queda en `ai_runs` (`purpose = 'locate_visual'`) sin contenido.
- **Idempotencia:** una sola ejecución por material, análisis, original y versión del motor. La reserva es atómica
  (`claim_visual_autolocation`); una ejecución simultánea no hace nada y una repetida responde con lo registrado. Descargar el PDF
  nunca vuelve a analizar.
- No consume unidad de adaptación ni toca `usage_events`.
- **Coste estimado:** 0 si basta la geometría (la ficha de fracciones). Si no, unos 0,005–0,01 USD por página con imagen A4 a
  100 ppp (unos 1.300 tokens de imagen, más el prompt y unos 200 de salida), con un máximo de 3 páginas por versión del material.

### Migración 022 y despliegue

022 hace cuatro cambios:
- añade `method 'auto'`, con `confidence`/`evidence` y la restricción ≥ 0,75;
- rehace `create_visual_locator`: un automático nunca sustituye a un localizador activo;
- crea `material_visual_specs` y `material_visual_autolocations`, con RLS, triggers y `claim_visual_autolocation`;
- añade `ai_runs.purpose 'locate_visual'`.

Se aplica antes de desplegar el código. Es compatible hacia atrás: las filas humanas no cambian. Sin claves de IA, la visión queda
desactivada y solo actúa la geometría.

### Límites (para 8.2B.2 y después)

- **Imágenes sin capa de texto** (fotos o escaneos): no hay anclas y una figura genérica no llega a 0,75 sin visión. Se queda en D y
  la localiza el docente.
- **Maquetación a dos columnas:** las zonas se calculan por altura. Con dos columnas baja la confianza: hace falta visión o el
  docente.
- **Tipos reconstruibles:** solo la barra y la recta. `part_whole` se dibuja pero aún no se extrae. Los círculos, las rectas con
  puntos dados y las comparaciones que no son de fracciones mantienen el recorte.
- `src/lib/visuals/contracts.ts` reserva las procedencias `catalog` (8.2B.3) y `generated` (8.2B.2) y el contrato de petición de
  generación. Una figura que un VisualSpec puede dibujar nunca se genera. Nada de esto está conectado.

## Política visual de «Hacer magia» (migración 023)

**Regla de producto.** En «Hacer magia» el docente no localiza imágenes, no sube recursos, no decide omisiones y no revisa el
plan: ve el progreso, la ficha terminada y «Descargar PDF». Si un recurso visual no se puede usar tal cual, el sistema busca él
solo otra forma pedagógicamente válida de completar la ficha. Solo se detiene cuando no puede construir nada válido (por ejemplo,
sin servicio de IA disponible y sin datos en el material para dibujar la figura): nunca entrega una ficha «lista» con un hueco.
La intervención manual queda para «Revisar antes de crear» y para quien elige «Editar».

**Escalera** (`src/lib/adaptation/visual-policy.ts` y `src/lib/materials/visuals/auto/policy.ts`). Se aplica a cada necesidad
visual de la ficha ensamblada, antes de las revisiones (así se revisa la ficha que se entrega):

| # | Categoría | Qué se hace | Se valida con |
| --- | --- | --- | --- |
| 1 | `exact_original_visual` | Usar el visual del original: el recorte del docente o el automático (encuadre ajustado al tamaño físico) | Confianza ≥ 0,75; el recorte de una persona nunca se sustituye; uno automático solo cuenta si lo aceptó el motor ACTUAL y sus píxeles no contradicen el análisis |
| 2 | `reconstructable_structured_visual` | Redibujarlo desde los píxeles del original (barra, recta numérica); tablas y gráficos se rehacen con sus datos | Exactamente un dibujo de la página se lee como la figura descrita; se dibuja lo que leen los píxeles |
| 3 | `generatable_support_visual` | **Dibujar una figura NUEVA del mismo tipo** (barra, círculo, cuadrícula, recta) con los datos del propio material (`src/lib/visuals/from-task.ts`), sin IA; o un apoyo nuevo que pidió una decisión (`visual_support@v1`) | La figura sale de la descripción completa del análisis, de la respuesta esperada de la actividad (manda si no coinciden: figura y clave dicen lo mismo) o de las fracciones que nombra la actividad; una recta generada solo rotula los enteros (nunca la fracción que hay que situar) |
| 4 | `rewritable_without_visual` | Reescribir la actividad sin el visual cuando este solo aportaba un dato (`visual_rewriter@v1`); un visual que nada usa se deja fuera | Equivalencia pedagógica (abajo); mantiene los datos; no menciona la imagen; no da la respuesta |
| 5 | `substituted_activity` | **Sustituir la actividad por otra equivalente** (`visual_substitute@v2`, hasta 2 intentos por actividad/ejecución, con códigos de rechazo en el segundo): con su propia figura (como datos que dibujamos nosotros) si la competencia es trabajar con una representación dibujable; si no, una actividad guiada por escrito sobre el mismo contenido | `substitutionEquivalence`: misma operación (leer una barra sigue siendo leer una barra; marcar en la recta sigue siendo marcar, sin líneas de escritura), mismas acciones, sin datos inventados más allá de su figura, misma exigencia y carga de lectura, mismo contenido; sin la respuesta (tampoco la fracción sombreada de su figura) |
| 6 | `unresolved_visual` | Parada solo si nada de lo anterior produjo algo válido: `blocked`, motivo `visual`, sin PDF, sin unidad consumida, sin revisión por IA | Motivo registrado: `no_model_available` o `no_equivalent_activity` |

**Desde la migración 024 (política v2)** hay un peldaño más entre el 3 y el 4, una ilustración generada y revisada para las imágenes
sin datos exactos, y la parada tiene más motivos: ver § Ilustraciones generadas y revisadas.

En el caso de fracciones: si la recta de la actividad 4 no está en el PDF, se dibuja una recta nueva de 0 a 1 en cuartos y la
actividad sigue siendo «marca 3/4»; si la barra de la actividad 1 no se puede usar, se dibuja una barra de 8 partes con 3
sombreadas (la respuesta esperada es 3/8). En ningún caso se pide nada al docente.

### Corrección de sustituciones (prompt v2)

El segundo intento recibe el formato de respuesta original y códigos de validación permitidos, sin copiar la propuesta rechazada ni sus respuestas. Se rechazan acciones añadidas, restricciones críticas perdidas (solo elementos protegidos de esa actividad corroborados en la consigna, más sus cuantificadores) y formatos cerrados convertidos en escritura. La validación conserva los controles de figura, exigencia, carga de lectura y filtrado de respuestas existentes.

Una negativa del proveedor, error permanente o `feasible=false` termina la sustitución; un error transitorio conserva el reintento técnico del job. Dos propuestas inválidas llevan a la parada explicada existente, sin aprobación manual. Los controles son heurísticos: pueden rechazar paráfrasis válidas y no garantizan equivalencia semántica universal. La revisión posterior sigue obligatoria. Ver ADR-021 y las pruebas en `tests/unit/visual-substitution.test.ts`, `tests/unit/pedagogical-equivalence.test.ts` y `tests/db/magic-visual-policy.test.ts`.

### Selección única verificable — Fase 8.2B.4

El peldaño de sustitución admite `select_option` de fracciones mediante `visual_substitute@v3` (excepción a la versión v2 de la tabla anterior); los demás formatos conservan v2. No se altera el orden de recuperación, reconstrucción, figura determinista, ilustración y sustitución. El caso reproducido tiene una imagen perdida, opciones `A) 1/4`, `B) 3/8`, `C) 1/2` y clave original `B`: el generador previo de figuras no deduce una fracción de una letra, y antes la sustitución rechazaba el formato cerrado.

`src/lib/adaptation/single-choice.ts` extrae listas consecutivas completas A)…H) al final de `instruction`/`context`. Solo admite preguntas reconocidas sobre la fracción coloreada de una barra/círculo y alternativas fraccionarias. La consigna, etiquetas, orden y alternativas son literales. El servidor calcula qué opciones corresponden al sombreado del `VisualSpec`, exige exactamente una y comprueba que sea la indicada por la fuente; mantiene el número de partes para no alterar la dificultad. No se aceptan complementos, tareas distintas, cambio de opciones o claves ambiguas. No se usa una declaración de corrección del modelo.

La clave original permanece en `answer_key`; una inferida se usa solo para comprobar y no se escribe en la ficha. `ActivityRewrite.response` transporta opciones verificadas y `multiple=false`; la aplicación del plan conserva los ids de bloque y añade la referencia visual a la traza. La figura determinista sigue junto a la pregunta. CLARO ya imprime círculos vacíos, alternativas separadas y agrupación de actividad: no se modifica el renderer. Dos intentos por actividad/ejecución, feedback seguro y parada honesta igual que #26.

Pruebas: `tests/unit/single-choice-substitution.test.ts`, `tests/unit/single-choice-prompt.test.ts`, integración PGlite en `tests/db/magic-visual-policy.test.ts` y PDF real en `tests/pdf/single-choice-substitution.test.ts`. Sin IA real. Límite: coherencia verificable con el análisis disponible, no certificación de lectura del original; no es soporte universal de selección única ni habilita conversiones de formato del planificador. Ver ADR-022.

### Equivalencia pedagógica (`src/lib/adaptation/pedagogical-equivalence.ts`)

Una actividad que evalúa interpretar o actuar sobre una representación no se convierte en otra actividad textual porque conserve
los números: se le dibuja una figura nueva del mismo tipo (peldaño 3) o se sustituye por otra actividad con su propia figura
(peldaño 5). Que el modelo diga «se puede» (`feasible: true`) es solo una condición previa, nunca la prueba. Reglas deterministas
por tipo de tarea, comprobadas ANTES de llamar a ningún modelo y otra vez sobre su propuesta:

| Se compara | Regla |
| --- | --- |
| Operación cognitiva | Actuar sobre la figura (marcar, colorear, situar, dibujar, unir) o interpretarla (observa, según, qué fracción representa) → la representación es necesaria: **no se reescribe** |
| Representación necesaria | También lo es si el visual es una recta numérica, figura geométrica, diagrama, gráfico o mapa, si el objetivo de la actividad trata de la representación (representar, situar, interpretar, medir, escala…) o si el análisis la protege como `necessary_visual` esencial de esa actividad |
| Tipo de respuesta | Marcar, dibujar, elegir, unir, ordenar o completar huecos no pasan a líneas de escritura |
| Objetivo y acción | Los mismos verbos de acción (calcula sigue siendo calcula; explicar no pasa a calcular ni al revés) |
| Nivel de exigencia | Sin datos nuevos; sin pasos que resuelvan la tarea salvo que el perfil pida secuenciación (instrucciones por pasos, memoria de trabajo, planificación, pasos de las operaciones, listas), y entonces como mucho 4; no se acorta por debajo del 60 % |
| Necesidades funcionales | La carga de lectura no crece más allá del original y lo que decía su figura |

Solo una figura que es mera fuente de datos (una etiqueta con «3/4 de litro» para una tarea de calcular) se puede reescribir en
palabras. Una representación **necesaria** que no sabemos dibujar (el esquema de una célula) nunca pasa a palabras
(`representation_not_drawable`): se ilustra, si la adaptación puede y la revisión lo aprueba, o la ficha se detiene. Solo una
imagen que la tarea no necesita puede dar paso, en la sustitución, a una actividad guiada por escrito sobre el mismo contenido.
No se generan imágenes libres ni pictogramas.

Casos de la ficha de fracciones, todos rechazados: actividad 1 (barra de 8 partes con 3 sombreadas) ≠ «Escribe la fracción tres
octavos», ni siquiera describiendo la barra en palabras; actividad 4 («Marca 3/4 en la recta») ≠ «¿Qué fracción es mayor, 3/4 o
1/2?», «¿Cuánto le falta a 3/4 para 1?» o «Escribe dónde iría 3/4»; actividad 2: perder una de las dos comparaciones o pedir
«calcula» en lugar de «compara y escribe el signo» deja de ser equivalente. Si la figura no se encuentra ni se reconstruye con
evidencia, se dibuja una figura nueva o se sustituye la actividad; la adaptación solo se detiene si nada de eso es válido.

### Evidencia exigida para reconstruir

- La descripción del análisis debe ser **completa** (partes y partes sombreadas; intervalo y divisiones), sin puntos ni marcas, o
  no hay hipótesis. Una descripción completa **no** es evidencia de que refleje el original.
- Exactamente **un** dibujo de la página del original debe leerse, con el extractor de píxeles, como esa figura (mismo tipo, mismos
  números). Lo dibujado sale de los píxeles: qué partes están sombreadas y qué marcas llevan etiqueta.
- La figura debe encajar con la actividad: una fracción que la actividad pide situar debe caer en una marca de la recta.
- Un recorte cuyos píxeles leen otra figura que la descrita (8/3 frente a 6/2) es el recorte equivocado: se rechaza
  (`contradicts_analysis`).
- Un localizador automático de una versión anterior del motor se vuelve a validar: si el motor actual no encuentra la misma región,
  no se usa (`auto_not_revalidated`). Una selección humana sigue mandando siempre.
- Cuadrículas y círculos no tienen lector de píxeles: nunca se reconstruyen a partir de palabras.

- La decisión de cada ficha se guarda en el artefacto `visual_resolution`, una vez por entrada de generación: un trabajo reanudado
  la reutiliza y no repite el coste. Registra la categoría, la acción y los peldaños probados.
- Una actividad reescrita por la política lleva la traza del visual al que sustituye (`traceability_complete` lo admite).
- La auditoría del generador sigue juzgando lo que escribió el generador, es decir, la ficha antes de la política.

**No implementado (y por qué no bloquea):**
- **Limpieza de píxeles de un recorte sucio.** Un recorte que no supera la confianza pasa al peldaño siguiente.
- **Pictogramas.** No hay catálogo con licencia comercial compatible; los contratos están reservados
  (`src/lib/visuals/contracts.ts`). Las imágenes generadas sí existen desde la migración 024 (§ siguiente).

**Interfaz:**
- **En «Hacer magia»** no aparecen «Localizar en el original», «No está en el original · Añadir imagen», «Continuar sin esta imagen»
  ni «Buscar en el original».
- **Fichas entregadas antes de esta política** a las que aún les falta un visual: se dice que no se pudo completar
  automáticamente, sin PDF, y se ofrece «Editar la ficha» (`/vista?editar=1`), que muestra los controles manuales.

## Ilustraciones generadas y revisadas (migración 024)

**Cuándo.** Una actividad necesita una imagen que la ficha no tiene y que el original no puede dar:
- el esquema de «Observa el esquema de la célula y escribe el nombre de las partes 1, 2 y 3» no está en el PDF, o está en un escaneo
  sin capa de texto que el localizador no puede anclar;
- una actividad remite a «el esquema» o «la imagen» y la ficha no tiene ninguno;
- o el plan pide un apoyo en forma de ilustración.

Si esa imagen **no** depende de datos exactos, «Hacer magia» genera una ilustración educativa nueva, la revisa y solo la usa si la
revisión la aprueba.

**Lo que nunca va a un modelo de imagen.**
- Nada que dependa de datos exactos: barras, círculos, cuadrículas, rectas numéricas, tablas, gráficos, figuras geométricas o mapas.
  Tampoco una imagen descrita con medidas, unidades o escala. Esas figuras las dibuja nuestro renderer (VisualSpec) a partir del
  original o de los datos de la actividad, que es exacto, verificable y gratis.
- Tampoco pictogramas de comunicación aumentativa, fotografías de personas o lugares reales ni decoración.

**Escalera v2** (`policy_version: 2`, `src/lib/materials/visuals/auto/policy.ts`):

| # | Peldaño | Para qué necesidades |
| --- | --- | --- |
| 1 | El visual del original, localizado y verificado | Visuales del original |
| 2 | Reconstrucción desde los píxeles del original | Barras y rectas numéricas |
| 3 | Figura nueva del mismo tipo con los datos de la actividad (VisualSpec, sin IA) | Representaciones dibujables; también una actividad que remite a una figura que sus datos permiten dibujar |
| 4 | **Ilustración generada y revisada** | Imagen, esquema u «otro» no decorativo y sin datos exactos; una actividad que remite a una imagen que la ficha no tiene; un apoyo pedido como ilustración (o esencial y sin otra forma) |
| 5 | Reescritura sin el visual | Solo si el visual era fuente de un dato |
| 6 | Sustitución por una actividad equivalente | Con su propia figura si la representación es necesaria y dibujable; guiada por escrito solo si la tarea no necesita la imagen |
| 7 | Parada honesta | Nada válido. Motivos en la tabla de abajo |

| Motivo de parada | Cuándo |
| --- | --- |
| `no_model_available` | No hay IA disponible |
| `representation_not_buildable` | La representación es necesaria, no se puede dibujar y no se pudo ilustrar |
| `no_equivalent_activity` | Ninguna sustitución fue equivalente |
| `exact_visual_unavailable` | Falta un visual exacto que no se puede rehacer |
| `referenced_picture_unavailable` | La actividad remite a una imagen y las ilustraciones no están disponibles |
| `referenced_picture_not_built` | La actividad remite a una imagen y la ilustración no se pudo hacer |
| `support_unavailable` | No se pudo construir un apoyo esencial |

Cada peldaño probado queda en `attempts`: `illustrate`, o `illustrate:<motivo>` (`brief_rejected`, `quota_exhausted`,
`image_failed`, `review_rejected`).

**Proceso** (`src/lib/materials/visuals/illustrate/service.ts`, solo servidor):
1. **Reutilización.** Si la necesidad ya tiene una ilustración aprobada en esta adaptación (un trabajo reanudado o un ciclo de
   corrección), se usa esa: ni brief, ni imagen, ni unidad.
2. **Brief pedagógico** (`image_brief@v1`, alias STANDARD).
   - Contiene: concepto, elementos imprescindibles (con un marcador numérico o una etiqueta), elementos prohibidos, restricciones
     conceptuales, composición, nivel de detalle y texto alternativo.
   - Recibe: la actividad, su objetivo, la descripción del visual que falta, etapa, curso y asignatura, y los **nombres** de los
     apoyos funcionales de la ficha. Nunca datos del alumno.
   - Se valida con reglas deterministas (`src/lib/visuals/illustration.ts`):
     - los marcadores son exactamente los que nombra la actividad, consecutivos y sin nombre escrito;
     - ninguna etiqueta da la respuesta y nada lleva datos exactos;
     - hay como mucho 8 etiquetas;
     - si la ficha atiende la reducción de distracciones visuales o de densidad visual, el detalle baja a «simple».
3. **Cuota.** Se reserva una unidad `image`, con una clave idempotente por adaptación, necesidad y brief.
4. **Imagen** (alias `IMAGE_QUALITY`, calidad media, PNG opaco de 1536×1024 o 1024×1024).
   - El prompt lo construye nuestra plantilla versionada `image_render@v1` a partir del brief validado. Lleva fijos el estilo de
     ficha impresa CLARO y la edad de la etapa; los marcadores van sin nombres, se pide «ningún texto» si no hay etiquetas y se
     listan los elementos prohibidos.
   - El modelo de imagen nunca recibe el material ni el PDF.
5. **Bytes.** Debe ser un PNG real (firma e IHDR), de 256 a 4096 px por lado y como mucho 10 MiB.
6. **Revisión por visión** (`image_review@v1`, alias STANDARD) contra el brief.
   - Comprueba que cada elemento está, cada marcador en su sitio y cada etiqueta exacta.
   - Comprueba también que no hay nada prohibido, ni errores conceptuales, ni texto añadido, ni la respuesta. La imagen debe ser
     adecuada a la edad, imprimible en blanco y negro y útil para la actividad.
   - Decide el servidor (`acceptReview`): el «aprobada» del modelo no basta si falla un solo punto.
7. **Resultado.**
   - Aprobada: se guarda en el bucket privado `generated-assets` (`<workspace>/<adaptación>/illustrations/<sha256>.png`), con una
     fila en `generated_assets` que incluye la revisión.
   - Rechazada: hay **un** segundo intento, al que se le dice qué corregir.
   - Sin aprobación: se devuelve la unidad y la política sigue con el peldaño siguiente.

**Límites** (`ILLUSTRATION_LIMITS`, `ILLUSTRATION_TIMING`):
- 3 ilustraciones por adaptación y 2 imágenes por ilustración.
- Cada ilustración termina dentro del tiempo de su etapa: el lease, menos lo que sigue a la política visual. No se empieza ni se
  hace el segundo intento si no cabe, y cada llamada recibe lo que queda, contando los reintentos de su SDK.
- Las imágenes no se reintentan en el SDK, porque una petición caducada puede facturarse.
- Un fallo transitorio del proveedor (red, timeout, sobrecarga, rate limit) o la falta de tiempo no son una respuesta. La unidad se
  devuelve y la etapa se reintenta más tarde (`provider_transient`, dentro de los intentos del trabajo), sin bajar de peldaño. Lo
  mismo vale para los asistentes visuales de texto (apoyo, reescritura y sustitución). Así una avería momentánea no acaba en una
  parada que culpe al material.

**Techo de gasto por adaptación.**
- Es `ILLUSTRATION_BUDGET.perAdaptationUsd` (0,50 USD), o `plans.features.illustration_budget_usd` si el plan lo fija.
- Se comprueba en el servidor antes de cada llamada, con lo ya gastado por las ilustraciones de esa adaptación según `ai_runs`.
  Una llamada sin precio cuenta como su peor caso.
- Si no cabe un primer intento completo, no se llama a nada (`budget_exhausted`). Si no cabe el segundo intento, se devuelve la
  unidad.
- La alerta de presupuesto del proveedor no es un límite: el límite es este.

El plan también puede fijar menos ilustraciones por adaptación (`features.illustrations_per_adaptation`), nunca más de 3.

**Parada que nombra el plan.** Si la única forma de resolver una imagen imprescindible era una ilustración, y el plan no las
incluye o ya no le quedan este mes, la ficha se detiene con el motivo `visual_plan`: «Esta ficha necesita una ilustración nueva…
tu plan no incluye ilustraciones». Los motivos registrados son `illustration_not_in_plan` e `illustration_quota_exhausted`. Nunca se
entrega la actividad sin su imagen. Si el problema es del servicio (flag, claves) o del techo de gasto, la parada es la genérica,
porque no es culpa del plan del docente.

**Disponibilidad** (`docs/BILLING.md`, `image.generate`). Deben cumplirse las cuatro condiciones:
- el flag `FLAG_AI_IMAGES_ENABLED`;
- un plan con `features.image_generation` y `monthly_images` > 0 (hoy solo Max, con 50 al mes; Free y Pro tienen 0, y los planes
  no cambian);
- un modelo de imagen con sus credenciales (`OPENAI_API_KEY`);
- un modelo de texto real para el brief y la revisión.

Si falta alguna, el peldaño 4 no existe para esa adaptación y la ficha del caso B se detiene con honestidad. Nunca se entrega
«Observa el esquema» sin el esquema, ni una actividad de texto en su lugar.

**En la ficha y en el PDF.**
- El bloque `image` lleva la fuente `generated` (id del activo, sha-256, ancho y alto). Solo la crea el servidor.
- Se muestra desde los bytes privados verificados (`/api/adaptations/[id]/generated/[assetId]`, con RLS y comprobación del
  sha-256), y el PDF fija esa instancia exacta (`gen:<id>`).
- Ancho impreso: 120 mm si es apaisada, 80 mm si es vertical y 100 mm si es cuadrada. Así se lee sin dejar media página vacía.
- Va justo antes de su actividad y enlazada a ella. El texto alternativo sale del brief.
- El docente la ve en el panel como recurso resuelto, sin acciones: «Ilustración nueva, creada y revisada automáticamente porque la
  imagen del original no se podía usar.»

**Referencias colgantes.** Una actividad que habla de «el esquema», «la imagen» o «la figura de la derecha» sin ninguna imagen
enlazada ni en su zona:
- en «Hacer magia» es una necesidad visual (`act_N`, origen `referenced`): se resuelve con una figura de sus datos o con una
  ilustración, o la ficha se detiene;
- en la revisión determinista es un FAIL nuevo (`visual_references_resolved`);
- «Dibuja un esquema» (lo hace el alumno) no cuenta.

## Contrato de recursos visuales

Cada necesidad del plan visual (artefacto `visual_resolution`) lleva su contrato, calculado por `contractOf` en
`src/lib/adaptation/visual-policy.ts`.

| Campo | Valores |
| --- | --- |
| `class` | `original_essential` (el original, localizado) · `original_improvable` (reservado: mejorar la legibilidad de un recorte) · `structured_reconstructable` (figura exacta que dibujamos nosotros) · `new_support_illustration` (apoyo nuevo que pidió el plan) · `must_generate_or_edit` (imagen sin datos exactos que hay que generar) · `optional` (ninguna actividad la usa) · `unresolvable` (nada válido: parada) |
| `provenance` | `original_crop` · `pixel_reconstruction` · `generated_spec` · `ai_illustration` · `rewritten_activity` · `substituted_activity` · `omitted` · `none` |
| `reason` | `activity_uses_original_visual` · `activity_refers_to_picture` · `plan_support` · `not_used_by_any_activity` |
| `validation` | `located_verified` · `pixels_verified` · `spec_verified` · `ai_reviewed` · `equivalence_verified` · `not_required` · `failed` |
| `asset` | El recurso privado que usa la ficha: un recorte (por su visual), una figura (por el sha-256 de su spec) o una ilustración (por su id y sha-256) |

Garantía: una ficha terminada no tiene ningún recurso esencial sin resolver. Una necesidad `unresolved` produce una parada, sin PDF
y sin consumir unidad.

### Privacidad, licencias y coste

- **Qué sale hacia los proveedores.**
  - Al modelo de texto: la actividad, su objetivo, la descripción del visual y los nombres de los apoyos. Como en el resto del
    pipeline, el material va entre `<untrusted_material>`, como JSON con `<` y `>` escapados.
  - Al modelo de imagen: solo el prompt construido desde el brief validado.
  - Nunca: el PDF, el nombre del fichero, el alias del alumno ni nada del perfil salvo los nombres de las dimensiones.
- **Dónde queda.**
  - En el bucket privado, sin URLs públicas.
  - Solo la leen los miembros del workspace (RLS en la fila y política del bucket), por la ruta autorizada que verifica el sha-256.
  - La fila es inmutable (trigger) y única por adaptación, necesidad y brief.
  - `ai_runs` registra `image_brief`, `image` e `image_review` sin contenido. Los logs llevan solo ids y códigos.
- **Licencia.**
  - Las imágenes las genera el proveedor por encargo del cliente. Según el Services Agreement de OpenAI revisado en octubre de 2026,
    el cliente es titular de las salidas.
  - No se usa ningún catálogo de terceros.
  - Antes del lanzamiento comercial hay que revisar de nuevo los términos vigentes, con asesoría legal.
- **Coste estimado** (precios verificados el 12-10-2026 en `src/lib/ai/costs.ts`; el real queda en `ai_runs` con el uso que
  devuelve el proveedor):

  | Concepto | Coste aproximado |
  | --- | --- |
  | Una imagen de calidad media de 1536×1024 (unos 1.600 tokens de salida a 30 USD/M, si este modelo usa los de la generación anterior) | 0,05 USD |
  | Brief y revisión juntos | 0,01–0,03 USD |
  | Ilustración aprobada al primer intento | 0,07 USD |
  | Ilustración aprobada al segundo intento | 0,13 USD |
  | Peor caso por adaptación (3 ilustraciones) | 0,40 USD |
  | Figura exacta (VisualSpec) | 0 USD |

- **Aplazamientos y coste.** Las ilustraciones aprobadas se reutilizan en los reintentos; las no aprobadas de una ejecución
  aplazada se pierden. El número de ejecuciones lo acotan los intentos del trabajo (3), así que el gasto máximo de imágenes de una
  adaptación también está acotado, aunque un aplazamiento lo pueda repetir.
- **Prueba con modelos reales.** `pnpm eval:illustrations -- --yes` (opt-in; tope `--budget`, por defecto 0,50 USD, aplicado con
  el mismo techo del servidor; **una sola ejecución autorizada**: después, `REAL_RUN_DONE.json` la bloquea salvo `--again`) ejecuta el caso
  B con los modelos configurados y deja la imagen, el brief, la revisión, el coste y un `report.html` con la lista de comprobación científica en `evals/results/illustrations/`. Una persona
  debe mirar la imagen: la revisión automática es una evidencia, no la última palabra. `pnpm eval:illustrations:mock` prueba el
  mismo arnés gratis. Nunca forma parte de `pnpm check`.

### Pendiente

- **Editar una imagen del original** (mejorar la legibilidad de un recorte, limpiar un escaneo). El transporte ya admite la edición
  (`images` en `ImageRequest`), pero no hay pipeline ni revisión para ello. La clase `original_improvable` está reservada.
- **Localizar figuras genéricas en escaneos sin texto.** Sin anclas de texto, el localizador no las encuentra. Hoy se ilustran, si
  la adaptación puede, o la ficha se detiene.
- **Pictogramas de comunicación aumentativa.** Hace falta un catálogo con licencia comercial.

### Selección única de tablas — Fase 8.2B.5

Antes de los peldaños genéricos se comprueban las tablas de las que depende una selección única, incluso cuando el ensamblado ya las representó como `table` y no como imagen. El caso reproducido de imagen perdida paraba sin sustitución; el caso nativo podía evitar toda corroboración. Ahora ambos exigen la fuente: cuadrícula y texto de cada celda del PDF en su posición, identidad por hash y una sola tabla coincidente en la página. Sin evidencia, `table_uncorroborated` → parada visual; no hay solicitud al docente ni ilustración sustitutiva de datos exactos.

La vía usa `visual_substitute@v4`, el contrato tabular existente y un verificador de consulta literal separado del de fracciones. Toda la tabla y las opciones quedan intactas. Se calcula la celda de la fila/columna explícitas, se exige una sola opción coincidente y se contrasta la clave original `source`. No se envía la clave al asistente. Hasta dos propuestas por actividad, con códigos seguros de rechazo. Se mantienen ids, enlaces y `answer_key`; la resolución registra tabla y evidencia `pdf_grid_text_v1`, con validación `source_table_verified`, sin activo de imagen.

Alcance exacto en ADR-023: tablas rectangulares pequeñas con capa de texto, valores literales del vocabulario de la columna, sin alternativas numéricas, celdas vacías/ambiguas, unidades separadas ni inferencias. No cubre escaneos ni certifica los glifos por OCR. La comparación contra el texto extraíble del PDF no equivale a verificar la transcripción del enunciado o clave. Pruebas en `table-choice.test.ts`, `table-choice-prompt.test.ts`, integración PGlite y `tests/pdf/table-choice-substitution.test.ts`. El PDF usa CLARO sin cambios globales: tabla/pregunta/opciones juntas, encabezados distinguidos y círculos vacíos. IA real y Vercel pendientes.

### Procedencia y escaneos no verificados — cierre de PR #30 (`auto_visuals@v5`)

**La fase 8.2B.6 permanece pendiente.** Se elimina `auto/scan.ts`: el criterio experimental de «único dibujo» aceptaba texto, decoración, regiones ajenas y recortes incompletos. Ese algoritmo no estaba en main (`1929849`). Fixtures y delimitación en [informe](qa/pr30/README.md); no se ha comprobado si existen activos inseguros en producción.

**Defectos reproducidos en main:** el productor aceptaba originales precargados cuyo SHA no coincidía con la revisión devuelta por la RPC; el localizador podía aceptar acuerdo de visión sin ancla de actividad. Ahora se contrasta el SHA antes de reutilizar/producir y se exige asociación con la zona de la actividad. La puntuación 0,75 sigue siendo una señal heurística, no una garantía semántica.

**Rechazo por defecto:** lectores, pins y productor validan metadatos completos, geometría y método. Un humano tiene evidencia explícitamente null; un automático requiere PDF, evidencia completa/versionada, ancla, zona y ausencia de propiedad scan. Evidencia ausente/vacía, referencias incompletas, receta desconocida o identidad/ruta distintas impiden leer bytes. Los pins verifican id y SHA exactos y cargan su localizador bajo RLS. Se conserva compatibilidad con rutas pre-017 y revisiones históricas válidas.

**Vías conservadas:** selección humana en PDF/imagen y localización anclada con texto. Una página sin texto se rechaza directamente, también para visión/corroboración matemática. Un documento con texto pero sin ancla tampoco se acepta por visión sola. `auto_visuals@v5` evita cachés anteriores; no reemplaza los controles en lectura. Una corrección humana crea una nueva revisión y no rehabilita el pin inseguro anterior.

**Entrega:** una figura imprescindible sin resolver bloquea Hacer magia y la descarga, sin consumir la cuota reservada. El PDF de célula verifica selección manual; no demuestra localización automática. La RLS de Storage continúa limitando por workspace; estos controles de calidad pertenecen a los servicios de la aplicación, no revocan acceso autorizado a objetos históricos.

**Pruebas del cierre:** 149 focalizadas, 3 PDF, typecheck y lint sin errores. Se conservan adversarios como evidencia histórica, dos integraciones reales de decoración/actividad ajena y regresiones de SHA, referencias, RLS, caché, corrección humana y exportación. No suite completa ni servicios de pago/remotos. Fase funcional, escaneos reales y Vercel siguen sin validar.

## Coherencia estructural y límites semánticos (2026-10-20)

CLARO v5 comprueba la especificación resuelta antes de dibujarla, rechaza denominadores cero en etiquetas y mantiene figuras exclusivas junto a la consigna por sus enlaces explícitos dentro de la página lógica. Las rectas densas conservan todos sus valores y separan rótulos sin reducir letra. Barras, círculos y cuadrículas se reutilizan. [PDFs y adversarios](qa/claro-calidad/README.md).

`visual_semantics_unverified` avisa en la vista docente cuando se imprimen píxeles. Un brief, alt o revisión simulada no demuestra etiquetas, exactitud científica ni correspondencia de una imagen. Se conserva la célula mock sin números como caso negativo: su test de impresión no es aprobación pedagógica. Los criterios actuales de aceptación de ilustraciones no cambian; la generación sigue sin activarse. Los contrastes con referencias manuales del corpus no autorizan imágenes de usuarios ni ocultan propiedades sin verificar.

## Figuras con marcas — recuperación fiel del original (`auto_visuals@v6`, 2026-10-22)

**Problema.** En la prueba real v3, las fichas 03 (polígono con medidas), 06 (esquema A–D) y 07 (flechas 1–4) se bloqueaban sin recuperar su figura. Hay dos causas:
- **Peso de firma nulo.** Una figura genérica tenía peso de firma 0. Sin la confirmación de un modelo de visión no podía pasar de 0,60 (el umbral es 0,75).
- **Lectura del motor.** Las medidas («8 cm»), los «?» y el texto de las cajas de un diagrama dejaban el recorte «sucio». Las zonas de actividad no distinguían columnas, y la figura impresa encima de su consigna quedaba fuera de su zona.

**Firma por marcas.** Las marcas esperadas (`src/lib/materials/visuals/auto/marks.ts`) salen **solo** de las palabras del análisis sobre el visual y de las actividades que lo usan:
- «letras A, B, C y D», o los campos «A:» … «D:»;
- «flechas numeradas del 1 al 4», o los campos «Flecha 1:» …;
- «medidas», «cm».

Nunca salen de un modelo ni de OCR. La figura tiene firma (0,30, el mismo peso que una recta o una barra) solo si **todas** esas marcas están impresas en el dibujo según la capa de texto del PDF, cada una **una sola vez**, y son legibles: altura ≥ 1,8 mm y figura de al menos 20 mm. Los umbrales de aceptación no cambian.

**Región exacta.**
- **Crecimiento del recorte.** Desde el componente de tinta del dibujo, que incluye sus líneas indicadoras y flechas conectadas, el recorte crece con las marcas a su alcance: etiquetas y «?» a 4 mm, medidas a 6 mm.
- **Limpieza.** El recorte es limpio si no contiene ninguna línea del enunciado de una actividad (su ancla o una continuación), ninguna solución impresa («Solución», «clave»…) ni texto corrido fuera de las cajas de la propia figura.
- **Cajas propias.** Una caja propia se reconoce por cuatro bordes rectos y finos que encierran el texto (también en gris claro). El recuadro no puede pasar de la mitad del recorte, así que no valen el marco exterior ni una tarjeta de actividades.
- **Columnas y zona previa.** Para estas figuras la página se lee por columnas (segmentos de texto), y la figura puede ir **encima** de la primera consigna de su columna.
- **Marcos y contornos.** Entre una figura y su marco con las mismas marcas se elige la región más interior. Un contorno vacío (el rectángulo B) solo es candidato si lleva sus marcas.

**Lo incierto sigue siendo incierto.** No se aceptan, y la causa queda registrada:
- **dos figuras parecidas** en la misma zona;
- una **figura atribuida a la actividad siguiente**;
- una **etiqueta fuera de alcance** o **ausente** (`marks_incomplete`);
- una **solución dentro del dibujo**;
- una **figura ilegible** (`illegible`);
- la **página equivocada**;
- un **PDF sin capa de texto** (`scan_identity_unverified`);
- una figura genérica **sin marcas nombradas**, que sigue igual que antes.

**Identidad, fidelidad y validez pedagógica** (`FigureVerification`, en el resultado de cada ejecución):
1. **Identidad:** el recorte procede del original por su SHA-256 y de la misma caja de página. Se verifica técnicamente.
2. **Fidelidad:** el recorte son los píxeles del original en esa región, con receta fija y guardados con su propio SHA-256. Las pruebas PDF comprueban la igualdad byte a byte con la página renderizada y que Chromium incrusta la imagen con las mismas dimensiones, sin reescalarla. Se verifica técnicamente.
3. **Validez pedagógica:** **nunca** se declara automáticamente. Ni un texto alternativo, ni un prompt, ni una confianza son evidencia. El docente ve el aviso `visual_semantics_unverified`.

**Persistencia.** La evidencia del localizador añade `marks: { expected, found, measures, legible: true }`. El validador acepta `auto_visuals@v6` y rechaza un localizador guardado cuyas marcas no sean legibles. No hay migración: la columna es JSON y la restricción de confianza (≥ 0,75) no cambia.

**«Hacer magia».** Un recurso recuperado así (elección B) se usa como figura original (`exact_original_visual`), sin llamar al generador de imágenes. Si no se localiza, se mantiene la parada visual con su causa precisa. Nunca se entrega la página entera como sustituto.
