# QA — Fase B: identidad editorial y espacios de resolución

Fecha: 2026-10-22 · Rama `claude/fase-b-editorial` desde `main` con la #55 integrada (`9af6c6c`) · `answer_space@v1` · ADR-040 · [Estándar](../../EDITORIAL.md).

Sin IA de pago ni migraciones remotas, y sin tocar producción ni Stripe. CLARO sigue siendo el único renderer, sin una segunda estética.

## Galería: ocho fichas, una identidad

Son fichas **sintéticas propias** (`tests/support/editorial-gallery.ts`), ensambladas por el producto sin ningún modelo: es lo que imprime CLARO antes de cualquier apoyo generado. Las figuras salen recortadas de nuestras láminas sintéticas con la receta de una persona. Las medidas están tomadas en el *layout* de impresión de Chromium (A4, 174 mm de ancho útil) y en el PDF rasterizado (`tests/pdf/editorial-gallery.test.ts`).

| Ficha | Perfil funcional | Hojas | Cuadrículas (filas × columnas, casilla) | Renglón | Campos |
|---|---|---|---|---|---|
| [Matemáticas 3.º · operaciones](galeria/1-mat3-operaciones.png) | ninguna necesidad | 1 | 5×23, 5×23 y 9×23, de 7 mm | 10 mm | — |
| [Matemáticas 4.º · problemas de varios pasos](galeria/2-mat4-problemas.png) ([grises](galeria/2-mat4-problemas-grises.png)) | planificación y pasos (medio) | 2 | 11×23, 7×23 y 7×23, de 7 mm | 10 mm | Datos y razonamiento · Operaciones · Respuesta (+ hueco para la unidad) |
| [Matemáticas 5.º · geometría](galeria/3-mat5-geometria.png) | pocas tareas por página (alto) | 3 | 5×23, 12×23 y 5×23, de 7 mm | 10 mm | Operaciones · Respuesta (+ unidad); la comparación ve la figura otra vez |
| [Lengua 3.º · comprensión lectora](galeria/4-len3-comprension.png) | decodificación y letra (medio) | 2 | — | 11,5 mm | casilla por elemento al ordenar |
| [Lengua 5.º · gramática](galeria/5-len5-gramatica.png) | ninguna necesidad | 2 | — | 10 mm | 1. Sujeto · 1. Predicado · 2. Sujeto · 2. Predicado; tabla para clasificar; redacción de 8 líneas (60-80 palabras) |
| [Ciencias Naturales 3.º · esquema etiquetado](galeria/6-cn3-esquema.png) ([grises](galeria/6-cn3-esquema-grises.png)) | motricidad fina (medio) → `roomy` | 2 | — | 12 mm | A · B · C · D junto al dibujo; recuadro grande para dibujar |
| [Ciencias Sociales 4.º · tablas y explicaciones](galeria/7-cs4-tablas.png) | menos densidad (medio) | 1 | — | 10 mm | tabla con celdas de un renglón; 2 líneas para «dos servicios» |
| [Matemáticas 6.º · operaciones y problemas](galeria/8-mat6-operaciones-problemas.png) | memoria de trabajo (alto) y pasos (medio) | 2 | 9×23, 7×23, 7×23 y 12×23, de 7 mm | 10 mm | Datos y razonamiento · Operaciones · Respuesta (+ unidad) |

Comprobado en cada una:
- **Identidad:** cabecera con la materia por su nombre y el curso, la marca ADAPTAULA y la familia Adaptaula Inter.
- **Cuadrículas:** solo casillas enteras, de 5 mm o más, con 4 filas o más y 15 columnas o más.
- **Renglones:** de 8 mm o más.
- **Páginas:** ningún desborde lateral, ninguna hoja que sea solo cabecera y, salvo en la última, tinta hasta al menos un tercio de la página.
- **Escala de grises:** las líneas de la cuadrícula siguen visibles en el PDF rasterizado (más de 5.000 píxeles de línea tenue).
- **Sin respuestas:** ni solución ni clave en la ficha del alumno.

## Antes y después con las fichas reales 03, 06 y 07 (local, fuera de Git)

Entrada: el **análisis real** de la Fase A, sin tocar, y los recortes reales, con un perfil sin necesidades, de modo que solo cambia el código.
- **Antes:** el código de `main` (`9af6c6c`) en un *worktree*.
- **Después:** esta rama, con las mismas entradas.

Los originales, los análisis, los recortes y las imágenes comparativas se quedan en el *scratchpad* de la sesión.

| Ficha | Antes (`main`) | Después (Fase B) |
|---|---|---|
| 03 · geometría | 2 hojas. Las actividades 1 a 4 (perímetros y áreas) tienen 2 líneas cada una, sin cuadrícula. «Muestra cómo has dividido la figura» no tiene sitio. La 05 compara A y B sin verlas. | 4 hojas, con un relleno del 73 al 82 %. Cuadrícula en las cinco: 5 a 12 filas de 7 mm, 23 columnas. «Respuesta» con hueco para la unidad donde el análisis protege las unidades. A y B junto a sus consignas, y otra vez junto a la 05. |
| 06 · planta | 3 hojas, y la primera solo con la cabecera. «A:, B:, C:, D:» impreso como texto, más un recuadro vacío. Explicaciones de 2 líneas. | 2 hojas. Cuatro campos A, B, C y D junto al dibujo, sin repetir la cadena. Explicaciones de 4 líneas. |
| 07 · ciclo del agua | 2 hojas. «Flecha 1, Flecha 2, …» como texto y **una** línea para cuatro procesos (`line` con 4). | 2 hojas. Cuatro campos Flecha 1 a Flecha 4 junto al diagrama. Explicaciones de 2 y 4 líneas. El diagrama grande no se repite (solo se repiten figuras pequeñas o comparadas). |

En ninguna ficha se dan pistas sobre el nombre de los procesos ni se escribe la unidad: solo hay huecos.

## Pruebas

- **`tests/unit/answer-space.test.ts`** (17):
  - campos en línea, positivos y negativos;
  - cuándo hay cuadrícula y cuándo no, y sus filas;
  - partes del problema y unidad sin escribir;
  - líneas por resultado pedido, por explicación y por extensión indicada;
  - Sujeto/Predicado por oración;
  - formatos cerrados y decisiones que se conservan;
  - `roomy` y huellas históricas;
  - compatibilidad del contrato, borrador de modelo sin cambios y materia por nombre.
- **`tests/pdf/editorial-gallery.test.ts`** (9): medidas físicas, grises, páginas, desbordes e identidad de las 8 fichas.
- **Pruebas ajustadas** a la mejora, sin rebajar ninguna comprobación:
  - matriz v3: 02 con cuadrícula y unidad, 05 con campos por oración;
  - generador y revisión: el área es la que decide el motor;
  - render: el renderer sigue ampliando un área guardada más corta que su extensión;
  - diseño: CLARO por defecto y `standard` explícito;
  - exportación PDF: dos recortes fijados, aunque uno se repita;
  - fracciones y célula: número de hojas, porque el problema tiene ahora su cuadrícula;
  - *smoke*: línea base de tinta regenerada para CLARO tras revisarla a ojo.
- **Resultados:**
  - unidad y BD: 1910 correctas y 13 omitidas;
  - PDF: 64/64;
  - typecheck correcto; lint con un aviso previo ajeno;
  - E2E relevantes en escritorio y móvil: ver el registro.

## Límites conocidos

- **Estimaciones.** La de hoja física sirve para repetir figuras y la de filas por operación deriva de palabras y datos; ambas son aproximadas. Un recuento erróneo cuesta unas filas, nunca el formato.
- **Clasificaciones.** Una clasificación sin tabla en el original sigue con el área del original: no se inventan columnas.
- **Redacciones muy largas.** Pueden seguir en la hoja siguiente; sus dos primeras líneas se quedan con la consigna.
- **Límite de tareas del perfil.** Puede dejar una primera hoja corta (03 y fracciones). Es una necesidad del perfil y no se elimina.
- **Validación docente.** Falta en aula: estas medidas prueban que el espacio existe, no su adecuación a cada alumno.
