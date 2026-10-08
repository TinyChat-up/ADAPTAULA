# Adaptaula · Sistema CLARO — pilotos para revisión humana

> **Estado: identidad aprobada** (revisión humana de los pilotos). Las cinco fichas completas con CLARO están en
> [`../claro/`](../claro/README.md). Estos dos pilotos son **extractos editoriales**, no fichas completas: el de Bachillerato lleva
> «(extracto)» en el título y no representa el comentario completo (que está en `../claro/D-bachillerato`).

### Correcciones tras la revisión

- **Primaria:** la instrucción ya no pide «después de cada parte, piensa…», que la composición no permitía seguir: ahora dice
  «Lee las tres partes del texto» y «Responde a cada pregunta: te dice dónde buscar», y cada pregunta indica en qué parte buscar.
  Una página A4.
- **Bachillerato:** el organizador queda dentro de la actividad 02 que prepara: enunciado y requisitos → organizador → redacción
  (regla del renderer, no del piloto). La extensión vuelve a 80-100 palabras con 10 líneas; el piloto pasa a dos páginas en lugar
  de recortar la redacción.

## Objetivo

Una identidad propia para los materiales de Adaptaula: **cada cosa en su lugar**. El alumno distingue de un vistazo:

1. **Qué necesito saber**: orientación y lectura (superficie azul niebla, etiqueta «Lee», «Observa»).
2. **Qué tengo que hacer**: la actividad, con su número en la **columna guía** (01, 02…).
3. **Dónde respondo**: blanco con líneas finas, alineado con el enunciado.

Las ayudas (pista, recuerda, ejemplo, vocabulario, organiza tu respuesta) llevan un filo **verde petróleo** y su etiqueta, sin
fondo, para no confundirse con lo que hay que responder. La elegancia sale de la tipografía, las proporciones y la jerarquía, no
de cajas, iconos ni sombras.

## Paleta

| Token | Color | Uso |
| --- | --- | --- |
| `--ms-accent` · Azul Adaptaula | `#23426B` | Materia y curso, título, números de la columna guía, títulos de sección |
| `--ms-petrol` · Verde petróleo | `#227E81` | Solo el filo y la etiqueta de las ayudas |
| `--ms-fog` · Azul niebla | `#EFF3F7` | Superficie de orientación y cabeceras de tabla |
| Blanco | `#FFFFFF` | Superficie de lectura y escritura |
| Texto | `#1A1A1A` | Texto principal |

Nada se entiende solo por el color: en escala de grises el azul se imprime como gris muy oscuro, el petróleo como gris medio y la
niebla como un tono casi blanco (ver `*-grises.png`). Con `contrast: high` todo pasa a blanco y negro.

## Tipografía

Inter local (400/600/700), sin dependencias nuevas.

| Etapa | Cuerpo | Título | Número de actividad |
| --- | --- | --- | --- |
| Primaria | 12,5 pt | 1,75 em, 700 | 1,3 em, 700 |
| ESO | 11,75 pt | 1,7 em, 700 | 1,05 em, 700 |
| Bachillerato | 11,25 pt | 1,5 em, 700 | 0,95 em, 600 |

Todo se multiplica por el `font_scale` del perfil funcional: la etapa marca el tono; el perfil, la legibilidad que haga falta (un
alumno de Bachillerato con letra más grande sigue recibiendo una ficha de Bachillerato).

- Metadatos (materia · curso): versalitas espaciadas, azul. Marca: «ADAPTAULA», gris, muy pequeña, a la derecha.
- Título: azul, ancho completo. Secciones: azul, 1,05 em.
- Enunciado: seminegrita en Primaria y ESO; regular en Bachillerato.
- Etiquetas (LEE, IDEA CLAVE, ORGANIZA…): 0,72 em, versalitas espaciadas.
- Pie: número de página físico, gris.

## Jerarquía y columna guía

Todo el contenido comparte una columna; a su izquierda, una columna guía estrecha (13 mm Primaria, 11 mm ESO, 10 mm Bachillerato)
lleva solo el número de cada actividad, alineado con la primera línea del enunciado, y un filo gris muy fino recorre la actividad.
Es un único sistema con variaciones controladas por etapa.

## Componentes

- **A · Cabecera editorial**: materia y curso, marca discreta, Nombre y Fecha. Sin banner ni datos del perfil.
- **B · Orientación**: azul niebla, sin marco; «Lee» / «Observa» como etiqueta cuando hay lectura o imagen.
- **C · Actividad guiada**: número + enunciado + pasos + requisitos + zona de respuesta, juntos; el enunciado nunca se separa de
  su primera zona de respuesta.
- **D · Ayuda contextual**: filo verde petróleo y etiqueta; el organizador de respuesta pone en la misma fila la etiqueta y la
  línea de los apartados de una sola línea.
- **E · Espacio de trabajo**: el de v3 (líneas, casillas para escribir, relacionar con letras, cuadrícula…). CLARO no lo cambia todavía.

## Ficheros

| Fichero | Qué es |
| --- | --- |
| `piloto-primaria.pdf` / `.png` / `-grises.png` | Piloto A (de «El ciclo del agua»): orientación, lectura por partes, idea clave, 2 actividades |
| `piloto-bachillerato.pdf` / `.png` / `-grises.png` (+ `-2`) | Piloto B (de Rousseau, extracto): lectura, análisis, organizador dentro de la actividad, antes de la redacción |
| `*-anterior.pdf` / `*-anterior*.png` | El mismo contenido con el diseño actual (`material_renderer@v3`), para comparar |

Abrir: los PDF directamente (en GitHub, «View raw»); los PNG se ven en la PR. Cambios del extracto respecto a las fichas de QA:
Primaria sin la actividad de relacionar; Bachillerato con dos párrafos del fragmento y dos actividades.

## Regenerar

Linux, sin IA, unos segundos: `pnpm vitest run --config vitest.visual-qa.config.mts tests/visual-qa/pilots.qa.test.ts`
(escribe aquí los PDF y PNG de cada página).
