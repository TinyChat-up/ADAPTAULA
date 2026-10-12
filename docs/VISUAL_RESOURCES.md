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

**Regla de producto.** En «Hacer magia» el docente no localiza imágenes, no sube recursos y no decide omisiones: ve el progreso,
la ficha terminada y «Descargar PDF». La ficha solo es «lista» cuando no le falta ningún visual imprescindible. Si nada sirve, la
adaptación se detiene honestamente. La intervención manual queda para «Revisar antes de crear» y para quien elige «Editar».

**Escalera** (`src/lib/adaptation/visual-policy.ts` y `src/lib/materials/visuals/auto/policy.ts`). Se aplica a cada necesidad
visual de la ficha ensamblada, antes de las revisiones (así se revisa la ficha que se entrega):

| # | Categoría | Qué se hace | Se valida con |
| --- | --- | --- | --- |
| 1 | `exact_original_visual` | Localizar el visual en el original: el recorte del docente o el automático (encuadre ajustado al tamaño físico) | Confianza ≥ 0,75 de la geometría o de la visión; el recorte de una persona nunca se sustituye; uno automático solo cuenta si lo aceptó el motor ACTUAL y sus píxeles no contradicen el análisis |
| 2 | `reconstructable_structured_visual` | Reconstruirlo desde los píxeles del original: barra y recta numérica; tablas y gráficos ya se rehacían con sus datos | La descripción completa del análisis es una hipótesis que selecciona el dibujo; exactamente un dibujo de la página debe leerse, con sus propios píxeles, como esa misma figura; se dibuja lo que leen los píxeles; y encaja con la actividad |
| 3 | `generatable_support_visual` | Generar un apoyo nuevo que pidió una decisión: secuencia de pasos o tarjetas de vocabulario, dibujados por nuestros componentes en CLARO (`visual_support@v1`) | Longitudes, sin marcas, sin copiar la consigna, sin la respuesta |
| 4 | `rewritable_without_visual` | Un original que solo aportaba un dato a una actividad: reescribirla sin él (`visual_rewriter@v1`). Un visual que nada usa, o un apoyo opcional que no se pudo generar: se deja fuera | **Equivalencia pedagógica** (abajo); además mantiene todos los datos de la tarea y los números del visual, no menciona ninguna imagen y no da la respuesta |
| 5 | `unresolved_visual` | Parada honesta: estado `blocked`, motivo `visual`, sin PDF, sin unidad consumida, sin revisión por IA | — |

### Equivalencia pedagógica (`src/lib/adaptation/pedagogical-equivalence.ts`)

Una actividad que evalúa interpretar o actuar sobre una representación no se convierte en otra actividad textual porque conserve
los números. Que el modelo diga «se puede» (`feasible: true`) es solo una condición previa, nunca la prueba. Reglas deterministas
por tipo de tarea, comprobadas ANTES de llamar a ningún modelo y otra vez sobre su propuesta:

| Se compara | Regla |
| --- | --- |
| Operación cognitiva | Actuar sobre la figura (marcar, colorear, situar, dibujar, unir) o interpretarla (observa, según, qué fracción representa) → la representación es necesaria: **no se reescribe** |
| Representación necesaria | También lo es si el visual es una recta numérica, figura geométrica, diagrama, gráfico o mapa, si el objetivo de la actividad trata de la representación (representar, situar, interpretar, medir, escala…) o si el análisis la protege como `necessary_visual` esencial de esa actividad |
| Tipo de respuesta | Marcar, dibujar, elegir, unir, ordenar o completar huecos no pasan a líneas de escritura |
| Objetivo y acción | Los mismos verbos de acción (calcula sigue siendo calcula; explicar no pasa a calcular ni al revés) |
| Nivel de exigencia | Sin datos nuevos; sin pasos que resuelvan la tarea salvo que el perfil pida secuenciación (instrucciones por pasos, memoria de trabajo, planificación, pasos de las operaciones, listas), y entonces como mucho 4; no se acorta por debajo del 60 % |
| Necesidades funcionales | La carga de lectura no crece más allá del original y lo que decía su figura |

Solo una figura que es mera fuente de datos (una etiqueta con «3/4 de litro» para una tarea de calcular) se puede reescribir.

Casos de la ficha de fracciones, todos rechazados: actividad 1 (barra de 8 partes con 3 sombreadas) ≠ «Escribe la fracción tres
octavos», ni siquiera describiendo la barra en palabras; actividad 4 («Marca 3/4 en la recta») ≠ «¿Qué fracción es mayor, 3/4 o
1/2?», «¿Cuánto le falta a 3/4 para 1?» o «Escribe dónde iría 3/4»; actividad 2: perder una de las dos comparaciones o pedir
«calcula» en lugar de «compara y escribe el signo» deja de ser equivalente. Si la figura no se encuentra ni se reconstruye con
evidencia, la adaptación se detiene honestamente.

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
- **Pictogramas e imágenes generadas por difusión.** No hay catálogo con licencia ni modelo de imagen; los contratos están
  reservados (`src/lib/visuals/contracts.ts`).

**Interfaz:**
- **En «Hacer magia»** no aparecen «Localizar en el original», «No está en el original · Añadir imagen», «Continuar sin esta imagen»
  ni «Buscar en el original».
- **Fichas entregadas antes de esta política** a las que aún les falta un visual: se dice que no se pudo completar
  automáticamente, sin PDF, y se ofrece «Editar la ficha» (`/vista?editar=1`), que muestra los controles manuales.
