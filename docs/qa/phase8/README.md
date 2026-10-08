# Phase 8 · QA visual de la ficha del alumno

Cinco fichas sintéticas y deterministas (`tests/visual-qa/fixtures.ts`: sin IA, sin datos reales) renderizadas exactamente como
el producto: `MaterialDocument` → `buildRenderModel` → `renderPrintHtml` → motor PDF de producción (Chromium) → PDF.

| Carpeta | Caso |
| --- | --- |
| `A-primaria` | Primaria (5.º Matemáticas): instrucciones, preguntas cortas y todos los tipos de respuesta habituales |
| `B-primaria-estructurada` | Primaria (4.º Ciencias) con más estructura: instrucción por pasos, texto por partes, 3 tareas por página, más espacio, decoración reducida |
| `C-eso` | ESO (1.º Biología): texto, vocabulario, tabla que se rellena, selección múltiple, inicios de frase |
| `D-bachillerato` | Bachillerato (2.º Filosofía): comentario de texto denso, requisitos de extensión, planificador |
| `E-visual` | ESO (1.º Geografía): recorte del original (climograma) del que dependen las preguntas, gráfico con su tabla |

## Qué hay en cada carpeta

- `ficha.pdf` — el PDF final (A4), el mismo que descarga el docente.
- `pagina-N.png` — cada página del PDF rasterizada a 100 ppp.
- `pagina-N-grises.png` — la misma página en escala de grises (como una fotocopiadora del centro).
- `pantalla.png` — el mismo HTML visto en pantalla, dentro del marco gris del visor. En pantalla la hoja muestra la página
  lógica completa; la paginación física A4 solo existe al imprimir (mismo marcado y mismo CSS, ver «Pantalla y PDF»).

`before/` es el renderer anterior (`material_renderer@v2`) con las mismas fichas; `after/` es el actual (`@v3`). Compararlas
lado a lado es la forma más rápida de revisar el cambio.

## Cómo revisarlo

- En la PR de GitHub: «Files changed» → `docs/qa/phase8/after/<caso>/pagina-1.png` (GitHub muestra las imágenes y, con «rich diff»,
  el antes/después de cada página). Los PDF se abren con «View raw».
- En local: `docs/qa/phase8/after/<caso>/ficha.pdf`.
- Regenerarlo (sin IA, unos segundos): `QA_OUT=docs/qa/phase8/after pnpm qa:visual` (Linux; usa el Chromium del motor PDF).

## Ver una página

| | Antes (`@v2`) | Después (`@v3`) |
| --- | --- | --- |
| Primaria | ![](before/A-primaria/pagina-1.png) | ![](after/A-primaria/pagina-1.png) |
| ESO | ![](before/C-eso/pagina-1.png) | ![](after/C-eso/pagina-1.png) |
| Bachillerato | ![](before/D-bachillerato/pagina-1.png) | ![](after/D-bachillerato/pagina-1.png) |

## Problemas pedagógicos detectados en la revisión humana

Corregidos en el **contenido** de las fichas (`tests/visual-qa/fixtures.ts`) o con **reglas del renderer** reutilizables; nada con
CSS específico de una ficha:

| Problema | Clase | Corrección |
| --- | --- | --- |
| E · el climograma no identificaba los meses | contenido (fuente) | La imagen de la ficha de prueba lleva meses, ejes y unidades (mm, °C); el gráfico por estaciones se calcula con los mismos datos mensuales. En un material real subido por un docente **no se inventan datos**: ver «generator/reviewer». |
| E · «Todas las respuestas están en la imagen» | contenido | La instrucción separa lo observable (actividades 01-03) de lo que aporta el alumno (04: lo estudiado sobre climas). |
| D · organizador después de la redacción | renderer | Regla: un organizador o unos inicios de frase colocados justo después de una actividad de escritura se muestran **dentro** de ella, entre enunciado/requisitos y espacio de respuesta. |
| C · instrucción de la tabla después de la tabla | contenido + renderer | La actividad va antes de su tabla; regla: una actividad que se responde en una tabla de la ficha no se separa de ella al paginar. |
| C · «Puedes empezar así» desligado; «frases completas» para marcar casillas | contenido + renderer | Los inicios de frase siguen a la actividad 04 (regla anterior: van dentro de ella); «frases completas» solo como requisito de las respuestas escritas. |
| B · lectura y preguntas separadas; términos evaluados sin presentarse | contenido | Cada parte de la lectura va seguida de su pregunta; evaporación, condensación y precipitación se nombran en el texto antes de evaluarse. |
| B · recuadro de dibujo vacío | contenido | Antes del dibujo, un esquema parcialmente estructurado (Mar → __ → nubes → __ → gotas → __ → ríos y mar) con las palabras disponibles; no da la respuesta. |
| A · cuadrícula genérica para fracciones | contenido + renderer | Tabla de operaciones (multiplico por · numerador · denominador · fracción); un ejemplo análogo con fracciones apiladas (regla: `\frac{a}{b}` sencillo se compone apilado, sin motor matemático). |
| B, D · páginas desaprovechadas | renderer | Regla: al cerrar página por «máximo de tareas por página», el título, la orientación o la ayuda que introducen la siguiente actividad viajan con ella; una redacción con organizador puede continuar en la página siguiente en vez de empujar toda la actividad (el enunciado, el organizador y sus dos primeras líneas no se separan). |

Las cinco fichas con Sistema CLARO y su evaluación: [`claro/`](claro/README.md). Pilotos: [`claro-pilots/`](claro-pilots/README.md).

## Problemas que corresponden al generator / reviewer (no resolubles honestamente en el renderer)

- **Asociación explícita de apoyos.** La regla del renderer se basa en la adyacencia (el organizador justo después de su actividad
  de escritura). El generador debe colocar así los apoyos, o el contrato debería enlazarlos por id (`resource_block_ids` ya existe
  para recursos); propuesta para una fase posterior, sin cambiar el esquema ahora.
- **Instrucciones generales contradictorias** con el tipo de respuesta (p. ej. «responde con frases completas» en una ficha con
  casillas): comprobación para el revisor.
- **Información ausente en un visual** (un gráfico sin meses, sin unidades): el análisis debe marcarlo y el revisor bloquear la
  pregunta que dependa de ello; nunca completar datos inventados sobre una imagen real.
- **Observación frente a conocimiento previo:** el generador no debe afirmar que «todas las respuestas están en la imagen» si una
  actividad exige conocimientos; el revisor puede comprobarlo.
- **Lectura y preguntas intercaladas** para perfiles con apoyo en memoria de trabajo: estrategia del planificador.
- **Espacio de trabajo adecuado** (tabla de operaciones frente a cuadrícula genérica; esquema antes del dibujo): elección del tipo de
  respuesta en la generación.
- **Instrucciones que la composición no permite seguir** («después de cada parte…» con la lectura entera arriba): comprobación del
  revisor.
