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

## Problemas pedagógicos pendientes (revisión humana)

Siguen abiertos en las cinco fichas de QA; no son de identidad visual y el diseño no los oculta:

- **E · Visual**: el climograma no identifica los meses (sin etiquetas en el eje).
- **D · Bachillerato**: el organizador de Rousseau va después de la redacción (corregido solo en el piloto CLARO).
- **C · ESO**: la instrucción de la tabla de células va después de la tabla.
- **B · Primaria estructurada**: lectura y preguntas demasiado separadas (corregido solo en el piloto CLARO).
- **A · Primaria**: una cuadrícula genérica no es el espacio adecuado para trabajar fracciones.
- **B y D**: espacios y saltos de página desaprovechados.

Propuesta de dirección editorial (Sistema CLARO, pendiente de aprobación): [`claro-pilots/`](claro-pilots/README.md).
