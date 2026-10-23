# Identidad visual de Adaptaula

Estado: **implementado** (Fase C, ADR-041). Fuente de verdad: las dos imágenes oficiales que entregó la persona responsable de la marca, el **símbolo** (figura naranja, verde y azul con un círculo azul marino) y el **logotipo** «Adaptaula» («Adapt» en azul marino y «aula» en colores intensos). Ningún otro logotipo es válido. Evidencias en [QA de la Fase C](qa/fase-c-marca/README.md).

## 1. Piezas oficiales (`public/brand/`)

| Archivo | Uso |
|---|---|
| `adaptaula-logo-horizontal.svg` | Logotipo horizontal: símbolo + logotipo. Cabeceras, pie y acceso. |
| `adaptaula-logotipo.svg` | Logotipo tipográfico multicolor solo. |
| `adaptaula-simbolo.svg` | Símbolo solo. Barra lateral plegada, fichas, icono. |
| `adaptaula-simbolo-grises.svg` | Símbolo en escala de grises (cada degradado convertido a su luminancia). Impresión en blanco y negro. |
| `adaptaula-simbolo-mono.svg` · `adaptaula-logotipo-mono.svg` · `adaptaula-logo-horizontal-mono.svg` | Una sola tinta: el símbolo en grises planos y el logotipo en negro. Sellos, fotocopias y fondos que no admiten color. |
| `adaptaula-simbolo-512.png` · `-1024.png` · `adaptaula-logotipo-1600.png` · `adaptaula-logo-horizontal-1600.png` | Rasterizados de alta resolución con fondo transparente, para documentos y servicios que no aceptan SVG. |
| `adaptaula-icono-192.png` · `-512.png` | Iconos del manifiesto web (`src/app/manifest.ts`). |
| `src/app/favicon.ico` (16, 32 y 48 px) · `src/app/icon.svg` · `src/app/apple-icon.png` (180 px, fondo blanco) | Favicons y dispositivos. |
| `src/lib/brand/symbol.ts` | El símbolo como datos, para dibujarlo en línea en la ficha (vista previa y PDF). Se genera del SVG oficial: no se edita a mano. |

Todas tienen **fondo transparente**, salvo el icono de Apple, que lo exige opaco. Las piezas solo se escalan con su proporción: no se redibujan, ni se recolorean, ni se deforman. La variante en grises y la mono derivan los tonos de la luminancia del original; no son colores nuevos.

## 2. Cómo se obtuvieron y con qué fidelidad

No hubo vectorización automática sin control. El procedimiento fue manual y se midió:
- **Logotipo** (colores planos):
  - una máscara por color sobre el original ampliado a 3×, trazada con curvas de Bézier;
  - colores: la mediana de los píxeles interiores.
- **Símbolo:**
  - el contorno exterior sale del brillo, que el original guarda a resolución completa;
  - la frontera entre la hoja verde y la azul sale de un campo de color suavizado. El WebP del original guarda el color a media resolución, y una frontera de tono directa salía escalonada;
  - cada degradado se ajusta con su dirección y siete paradas medidas en el original.

Comprobación: cada SVG se rasteriza con Chromium a 3× y se compara píxel a píxel con el original.

| Pieza | Forma (IoU) | Desviación máxima del contorno | Color |
|---|---|---|---|
| Logotipo | 0,996–0,998 por color | 1 px a 3× (⅓ px del original) | planos, mediana exacta |
| Símbolo | 0,9992 (silueta) | — | error medio 2,6/255 |

Límite conocido: el original tiene una línea oscura muy fina en el borde superior de la hoja azul. No se reproduce porque es imperceptible a los tamaños de uso.

**Logotipo horizontal:** el símbolo mide 1,3 veces la altura del logotipo entre ascendente y línea base, centrado en ella. El hueco es un cuarto del ancho del símbolo. En la interfaz, `.brand-lockup` (`src/styles/brand.css`) reproduce esas mismas proporciones con las dos piezas.

## 3. Paleta corporativa

Valores medidos en los originales: los planos del logotipo y los extremos de los degradados del símbolo. Están en `src/styles/brand.css` como `--color-brand-*`.

| Color | Valor | Representa | Contraste sobre blanco |
|---|---|---|---|
| Azul marino | `#05234b` | identidad, tipografía, elementos principales | 15,6:1 |
| Azul marino claro (círculo del símbolo) | `#063f79` | primario interactivo (enlaces, bordes, hover) | 10,5:1 |
| Naranja | `#fe8002` (símbolo `#febb02` → `#fd4201`) | energía, diferenciación | 2,5:1 |
| Verde | `#21c052` (símbolo `#33efa5` → `#029b86`) | progreso, aprendizaje | 2,4:1 |
| Azul intenso | `#0067fd` (símbolo `#01befd` → `#004ac7`) | tecnología, dinamismo; foco | 4,8:1 |
| Cian | `#01b5dc` | apoyo cromático | 2,4:1 |

**Variantes accesibles del mismo tono.** Medidas sobre la superficie (`#ffffff`), el fondo (`#f7f8fa`) y la superficie atenuada (`#f0f3f6`):

| Token | Valor | Mínimo | Para |
|---|---|---|---|
| `--color-brand-orange-ui` / `-ink` | `#db6e01` / `#ae5701` | 3:1 / 4,5:1 | icono o borde / texto |
| `--color-brand-green-ui` / `-ink` | `#1ca145` / `#168037` | 3:1 / 4,5:1 | icono o borde / texto |
| `--color-brand-cyan-ui` / `-ink` | `#0199ba` / `#017993` | 3:1 / 4,5:1 | icono o borde / texto |
| `--color-brand-blue-ink` (= `--color-accent`) | `#0060eb` | 4,5:1, también sobre los fondos suaves | texto de acento |

Sobre los fondos suaves de primario y acento, el texto naranja, verde o cian no llega a 4,5:1, así que **no** se usa ahí.

**Tokens de interfaz** (`src/styles/tokens.css`):
- `--color-foreground` y `--color-primary-strong` = azul marino (botón principal, texto);
- `--color-primary` = `#063f79`;
- `--color-accent` = `#0060eb`;
- `--color-focus` = `#0067fd`, para que el anillo de foco se distinga del azul marino de los botones.

**Uso:**
- El **azul marino es el color de la interfaz**. Naranja, verde, azul y cian aparecen en el logotipo y el símbolo, y solo como acento puntual. No se usan todos en una misma pantalla ni como fondo de bloques.
- **La marca no es un estado.** Éxito (`#24623e`), aviso (`#925015`) y error (`#b12828`) conservan sus colores y su significado. El verde de marca nunca significa «correcto» ni el naranja «aviso».
- El color nunca es la única señal (WCAG 1.4.1).

## 4. La forma de la interfaz habla la marca

La marca no es solo el logotipo. La interfaz toma su geometría y sus colores, con un significado fijo:

| Elemento | Decisión | Por qué |
|---|---|---|
| Titulares y títulos de página (`font-display`) | **Outfit**, seminegrita, por `next/font` (se sirve desde la app y no se pide nada a Google al usarla) | Es la tipografía de Google más parecida al logotipo: «a» de un piso, «o d p» redondas y geométricas. Medida contra la silueta del logotipo: IoU de 0,61, la primera de 14 candidatas (Nunito 0,58, Figtree 0,57, Urbanist 0,55, Fredoka 0,54…). Sustituye a Georgia, que no tenía relación con la marca. |
| Texto, controles y ficha | Inter (la ficha, su Inter incrustada) | Legibilidad de interfaz y paginación pedagógica estable. La ficha no cambia de tipografía. |
| Secuencias numeradas (los pasos de la landing, del escritorio y del acceso) | Los colores de **«aula»** en su orden: naranja, verde, azul y cian, en sus variantes accesibles (`src/lib/brand/tones.ts`) | El proceso del producto se cuenta con los colores de la marca. El número nunca es la única señal: el título y el orden lo dicen también. |
| «Hacer magia» (`variant="magic"`) | Degradado del azul marino claro al azul de marca; texto blanco ≥ 5,4:1 | Lo que hace la IA por sí sola se distingue de lo que decide el docente, que va en azul marino. Azul = tecnología, según la paleta. En alto contraste o con colores forzados es un botón sólido. |
| Franja de marca (`.brand-rule`) | 3 px con los cuatro colores de «aula» | La firma de la marca, decorativa (`aria-hidden`). Solo en dos sitios: la tarjeta de bienvenida y el pie. |
| Foco | Azul de marca `#0067fd` | Se distingue del azul marino de los botones. |

Lo que **no** se hace:
- repartir los colores en fondos o tarjetas;
- usar el verde o el naranja como estados;
- cambiar la tipografía de la ficha.

## 5. Dónde va la marca

| Lugar | Pieza | Tamaño |
|---|---|---|
| Cabecera de la landing y páginas públicas | logotipo horizontal | logotipo de 24 px de alto |
| Pie | logotipo horizontal | 24 px |
| Barra lateral expandida | logotipo horizontal | 24 px |
| Barra lateral plegada | **solo el símbolo** | 36 px |
| Cabecera móvil del espacio docente | logotipo horizontal | 20 px |
| Acceso y registro | logotipo horizontal | 30 px (panel lateral) · 24 px (móvil) |
| Bienvenida | logotipo horizontal | 30 px |
| Ficha del alumno (CLARO) | **solo el símbolo**, a la derecha de materia y curso | 6 mm de alto |
| Muestra de ficha de la landing | símbolo pequeño, solo en la versión adaptada | 16 px |

Las piezas son decorativas (`alt=""`) dentro de un enlace con nombre («Adaptaula, inicio»). Nunca se duplican en una misma cabecera. Nunca se ponen donde quiten espacio funcional.

## 6. La marca en la ficha (CLARO, `material_renderer@v7`)

- Cabecera de la primera página: materia y curso a la izquierda y el símbolo a la derecha, sobre la línea de acento azul marino. Debajo, Nombre y Fecha, título, actividades y el número de página en el pie.
- **Símbolo y no logotipo horizontal:**
  - la ficha se reconoce sin el nombre escrito en grande;
  - no compite con el contenido;
  - no resta espacio de respuesta: mide 6 mm fijos y la cabecera apenas crece (las ocho fichas de la galería conservan sus hojas).
- **Impresión:**
  - SVG en línea (`BrandSymbol`): en el PDF es vectorial (degradados como sombreados; ninguna imagen rasterizada añadida);
  - no depende de ninguna URL y cumple la CSP de impresión (`img-src data:`);
  - no toca los recursos fijados de los materiales del docente;
  - los ids de degradado son únicos por instancia.
- **Blanco y negro:** el símbolo se reconoce en grises. Con el perfil de alto contraste se dibuja en grises de su luminancia, porque una sola tinta plana fundiría las dos hojas de la derecha.
- La versión `standard` (histórica) no cambia.

## 7. Pendiente

- Fondo oscuro: la plataforma solo tiene tema claro. Cuando exista uno oscuro hará falta una variante del logotipo con «Adapt» en blanco, que tiene que aprobar la persona responsable de la marca.
- El símbolo en el pie de todas las páginas de una ficha suelta (hoy solo va en la cabecera de la primera): se valorará con docentes.
