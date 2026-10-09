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
| Imagen del documento original | `image` `original` + localizador + `visual_crop@v1` | Localizador automático evaluable (opción B) |
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
