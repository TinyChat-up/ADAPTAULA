# QA — Fase B: identidad editorial y espacios de resolución

Fecha: 2026-10-22 · Rama `claude/fase-b-editorial` desde `main` con la #55 integrada (`9af6c6c`) · `answer_space@v1` · `material_renderer@v6` · ADR-040 · [Estándar](../../EDITORIAL.md).

Sin IA de pago ni migraciones remotas, y sin tocar producción ni Stripe. CLARO sigue siendo el único renderer, sin una segunda estética.

## Galería: ocho fichas, una identidad

Son fichas **sintéticas propias** (`tests/support/editorial-gallery.ts`), ensambladas por el producto sin ningún modelo: es lo que imprime CLARO antes de cualquier apoyo generado. Las figuras salen recortadas de nuestras láminas sintéticas con la receta de una persona. Las medidas están tomadas en el *layout* de impresión de Chromium (A4, 174 mm de ancho útil) y en el PDF rasterizado (`tests/pdf/editorial-gallery.test.ts`).

| Ficha | Perfil funcional | Hojas | Cuadrículas (filas × columnas, casilla) | Renglón | Campos |
|---|---|---|---|---|---|
| [Matemáticas 3.º · operaciones](galeria/1-mat3-operaciones.png) | ninguna necesidad | 2 | 10×23, 10×23 y 9×23, de 7 mm (las dos primeras conservan los 66 mm de su cuadrícula original) | 10 mm | — |
| [Matemáticas 4.º · problemas de varios pasos](galeria/2-mat4-problemas.png) ([grises](galeria/2-mat4-problemas-grises.png)) | planificación y pasos (medio) | 2 | 11×23, 7×23 y 8×23, de 7 mm | 10 mm | Datos y razonamiento · Operaciones · Respuesta (+ hueco para la unidad) |
| [Matemáticas 5.º · geometría](galeria/3-mat5-geometria.png) | pocas tareas por página (alto) | 4 | 5×23; Dibujo 10×23 y Operaciones 17×23 (zonas 9 + 8); 5×23, de 7 mm | 10 mm | Dibujo · Operaciones · Respuesta (+ unidad); la actividad que pasa de hoja y la comparación ven la figura otra vez |
| [Lengua 3.º · comprensión lectora](galeria/4-len3-comprension.png) | decodificación y letra (medio) | 2 | — | 11,5 mm | casilla por elemento al ordenar |
| [Lengua 5.º · gramática](galeria/5-len5-gramatica.png) | ninguna necesidad | 2 | — | 10 mm | 1. Sujeto · 1. Predicado · 2. Sujeto · 2. Predicado; tabla para clasificar; redacción de 8 líneas (60-80 palabras) |
| [Ciencias Naturales 3.º · esquema etiquetado](galeria/6-cn3-esquema.png) ([grises](galeria/6-cn3-esquema-grises.png)) | motricidad fina (medio) → `roomy` | 2 | — | 12 mm | A · B · C · D junto al dibujo; recuadro grande para dibujar |
| [Ciencias Sociales 4.º · tablas y explicaciones](galeria/7-cs4-tablas.png) | menos densidad (medio) | 1 | — | 10 mm | tabla con celdas de un renglón; 2 líneas para «dos servicios» |
| [Matemáticas 6.º · operaciones y problemas](galeria/8-mat6-operaciones-problemas.png) | memoria de trabajo (alto) y pasos (medio) | 2 | 10×23, 7×23, 7×23 y 15×23 (zonas 8 + 7), de 7 mm | 10 mm | Datos y razonamiento · Operaciones · Respuesta (+ unidad) |

Comprobado en cada una:
- **Identidad:** cabecera con la materia por su nombre y el curso, la marca ADAPTAULA y la familia Adaptaula Inter.
- **Cuadrículas:** solo casillas enteras, de 5 mm o más, con 4 filas o más y 15 columnas o más.
- **Renglones:** de 8 mm o más.
- **Páginas:** ningún desborde lateral, ninguna hoja que sea solo cabecera y, salvo en la última, tinta hasta al menos un tercio de la página.
- **Escala de grises:** las líneas de la cuadrícula siguen visibles en el PDF rasterizado (más de 5.000 píxeles de línea tenue).
- **Sin respuestas:** ni solución ni clave en la ficha del alumno.

### Casos límite (cierre de calidad)

Tres fichas sintéticas más (`LIMIT_CASES`), medidas igual en el *layout* y en el PDF:

| Caso | Qué se comprueba | Medida |
|---|---|---|
| Ocho operaciones y una división larga | 33 filas sin tope, en zonas enteras que siguen en la hoja siguiente; la consigna empieza junto a sus casillas | zonas 11 + 11 + 11; la división, 10 filas (los 66 mm de su cuadrícula original, más que sus 7 de demanda); filas de cuadrícula impresas en el PDF ≥ 36 |
| Originales amplios, motricidad fina (`roomy`) | 12 y 20 líneas intactas; un recuadro grande que pasa a cuadrícula no pierde altura; la geometría que pide dibujar tiene «Dibujo» | renglón ≥ 11,9 mm; cuadrícula del recuadro ≥ 143,5 mm (12 renglones de 12 mm); campos Dibujo, Operaciones y Respuesta; sin desbordes |
| Dibujo y unidad tras una figura (la forma de 03) | la actividad que pasa de hoja lleva su figura; la «Respuesta» no se separa de su unidad | en el PDF, la página con «Muestra cómo has dividido la figura» contiene «Figura A», y cada página tiene tantas «Respuesta:» como «Unidad:» |

El tercer caso **falla sin el arreglo** (comprobado: con la figura contada dos veces, la actividad empieza en la hoja 2 sin la figura).

## Antes y después con las fichas reales 03, 06 y 07 (local, fuera de Git)

Entrada: el **análisis real** de la Fase A, sin tocar, y los recortes reales, con un perfil sin necesidades, de modo que solo cambia el código.
- **Antes:** el código de `main` (`9af6c6c`) en un *worktree*.
- **Después:** esta rama, con las mismas entradas.

Los originales, los análisis, los recortes y las imágenes comparativas se quedan en el *scratchpad* de la sesión.

| Ficha | Antes (`main`) | Después (Fase B) |
|---|---|---|
| 03 · geometría | 2 hojas. Las actividades 1 a 4 (perímetros y áreas) tienen 2 líneas cada una, sin cuadrícula. «Muestra cómo has dividido la figura» no tiene sitio. La 05 compara A y B sin verlas. | 5 hojas, cada una con más de media página de trabajo. Cuadrícula en las cinco, de 7 mm y 23 columnas: 7, 17 (zonas 9 + 8), 7, 7 y 11 filas. La 02 tiene además «Dibujo» (10 filas, 70 mm) y ve la figura A en su hoja. «Respuesta» con su unidad, sin partirse. A y B junto a sus consignas; B otra vez junto a la 04, y A y B junto a la 05. |
| 06 · planta | 3 hojas, y la primera solo con la cabecera. «A:, B:, C:, D:» impreso como texto, más un recuadro vacío. Explicaciones de 2 líneas. | 2 hojas. Cuatro campos A, B, C y D junto al dibujo, sin repetir la cadena. Explicaciones de 4 líneas. |
| 07 · ciclo del agua | 2 hojas. «Flecha 1, Flecha 2, …» como texto y **una** línea para cuatro procesos (`line` con 4). | 2 hojas. Cuatro campos Flecha 1 a Flecha 4 junto al diagrama. Explicaciones de 2 y 4 líneas. El diagrama grande no se repite (solo se repiten figuras pequeñas o comparadas). |

En ninguna ficha se dan pistas sobre el nombre de los procesos ni se escribe la unidad: solo hay huecos. (La lista «evaporación, condensación, precipitación, escorrentía» de la 07 es la consigna del original, que se conserva literal.)

**Revisión final** (código definitivo, mismo análisis real, sin IA):
- **03:** cada cálculo tiene una cuadrícula de 7 filas o más, «Muestra cómo has dividido la figura» tiene su superficie de dibujo, y A y B están disponibles para comparar.
- **06:** cuatro campos A–D independientes.
- **07:** cuatro campos Flecha 1–4.
- **En las tres:** ninguna actividad baja del espacio original (2 o 3 líneas, es decir, 20 a 30 mm), no hay hojas vacías ni figuras huérfanas, y ninguna respuesta queda separada de su consigna.

La primera versión de esta revisión encontró dos defectos, ya corregidos:
1. La 02 empezaba en la hoja 2 sin la figura A. La figura se contaba dos veces en la estimación.
2. Su «Respuesta» se partía: la etiqueta al pie de la hoja 2 y las líneas y la unidad en la 3. El campo de cuadrícula en zonas prohibía el corte entre zonas.

## Pruebas

- **`tests/unit/answer-space.test.ts`** (26):
  - garantía física: cuadrícula heredada ≥ 66 mm, 12 y 20 líneas intactas, recuadro grande → 18 filas, `roomy`, `atLeastOriginal`;
  - cuadrículas por demanda: 1, 3 y 8 operaciones (5, 13 y 33 filas), división, problema de varios pasos, geometría con «Dibujo», cálculo con «Explicación»; mostrar la división de la figura cuenta una vez;
  - campos en línea, positivos y negativos;
  - cuándo hay cuadrícula y cuándo no, y sus filas;
  - partes del problema y unidad sin escribir;
  - líneas por resultado pedido, por explicación y por extensión indicada;
  - Sujeto/Predicado por oración;
  - formatos cerrados y decisiones que se conservan;
  - `roomy` y huellas históricas;
  - compatibilidad del contrato, borrador de modelo sin cambios y materia por nombre.
- **`tests/pdf/editorial-gallery.test.ts`** (12): medidas físicas, grises, páginas, desbordes e identidad de las 8 fichas, y los tres casos límite.
- **Pruebas ajustadas** a la mejora, sin rebajar ninguna comprobación:
  - matriz v3: 02 con cuadrícula y unidad, 05 con campos por oración;
  - generador y revisión: el área es la que decide el motor;
  - render: el renderer sigue ampliando un área guardada más corta que su extensión;
  - versión del renderer: `material_renderer@v6` en `print-html`, `visual-resources` y el E2E de render;
  - diseño: CLARO por defecto y `standard` explícito;
  - exportación PDF: dos recortes fijados, aunque uno se repita;
  - fracciones y célula: número de hojas, porque el problema tiene ahora su cuadrícula;
  - *smoke*: línea base de tinta regenerada para CLARO tras revisarla a ojo.
- **Resultados:**
  - unidad y BD: 1919 correctas y 13 omitidas;
  - PDF: 64/64 (la línea base de tinta del *smoke* no cambia con v6);
  - typecheck correcto; lint con un aviso previo ajeno;
  - E2E completa, escritorio y móvil, en entorno limpio: 124/124 (62 en móvil).

## Límites conocidos

- **Estimaciones.** La de hoja física sirve para repetir figuras y la de filas por operación deriva de palabras y datos; ambas son aproximadas. Un recuento erróneo cuesta unas filas, nunca el formato.
- **Clasificaciones.** Una clasificación sin tabla en el original sigue con el área del original: no se inventan columnas.
- **Redacciones muy largas.** Pueden seguir en la hoja siguiente; sus dos primeras líneas se quedan con la consigna.
- **Límite de tareas del perfil.** Puede dejar una primera hoja corta (03 y fracciones). Es una necesidad del perfil y no se elimina.
- **Validación docente.** Falta en aula: estas medidas prueban que el espacio existe, no su adecuación a cada alumno.
