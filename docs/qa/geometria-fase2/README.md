# Fase II · Recuperación geométrica de figuras (prototipo)

| | |
| --- | --- |
| **Base** | `main` en `ae603e6` (PR #35 integrada) |
| **Alcance** | Prototipo en `evals/visual-location/`, sus pruebas y la documentación |
| **Motor OCR** | El de la Fase I, sin cambios |
| **Sin cambios en** | `src/`, Hacer magia, `MaterialAnalysis`, renderer PDF, Supabase, Stripe, páginas legales y UI |
| **No se ha hecho** | Llamadas de pago, entrenamiento, subir documentos externos a Git |

**Todas las fichas son sintéticas.** Las diez fichas del corpus externo son el conjunto de **desarrollo**: sus resultados ya se
conocían. La evidencia independiente es la **reserva geométrica**, ejecutada una sola vez con las reglas ya fijadas. Las cajas
humanas solo puntúan: el localizador nuevo no recibe ninguna región.

## Qué cambia: `figure_geometry@v2`

Ficheros nuevos en `evals/visual-location/`:

| Fichero | Contenido |
| --- | --- |
| `geometry.ts` | Enderezado de la página (`deskew`), transformación de regiones (`rotateRect`), normalización del papel y firmas de forma |
| `locate-v2.ts` | `locateFigure`: localizador autónomo con zonas por columna, agrupación de partes y etiquetas, y comprobaciones. La decisión es siempre BLOCKED |
| `geometry-cases.ts` | Fichas geométricas de desarrollo (10) y de reserva (10), separadas por familia de dibujo |
| `geometry-eval.ts` | Evaluación por figura, antes y después (`pnpm eval:geometry`) |
| `tests/unit/figure-geometry-v2.test.ts` | 17 pruebas sobre rásteres sintéticos |

### Qué hace el localizador, paso a paso

1. **Marco único.** La página se endereza con el giro que estima el OCR, y las cajas OCR de la Fase I ya están en ese marco.
   - Las regiones vuelven al original como la envolvente de la región girada.
   - Probado con giros de +2,3°, −3,1° y +1,2°, a 150, 200 y 300 ppp, con figuras junto al borde y con etiquetas que siguen
     dentro tras la transformación.
   - El documento fuente nunca se modifica.
2. **Ancla de la actividad.** Primero el emparejador exacto de producción. Si no encuentra la consigna, el tolerante de la Fase I,
   que rechaza cualquier línea que encaje con dos actividades.
3. **Zonas por columna.** Dos consignas en la misma fila y separadas en horizontal son evidencia de columnas: cada zona ocupa su
   columna y llega hasta la siguiente consigna de esa columna. Un dibujo que cruza el límite de zona o de columna no pertenece a
   ninguna actividad.
4. **Dibujos.** Componentes sin texto. Se excluyen:
   - motas;
   - líneas de respuesta, divisores de columna y reglas, tanto horizontales como verticales;
   - marcos de página;
   - **sombras de escáner**: componentes que tocan el borde y recorren más de media página;
   - recuadros vacíos, salvo que la consigna nombre un rectángulo o un cuadrado.
5. **Una figura, no su parte central.** Las partes a menos de 6 mm se agrupan. Las piezas pequeñas cercanas (un sol, una nube) se
   unen a la figura principal; un dibujo comparable en la misma zona es un **rival** y bloquea por unicidad. Las etiquetas OCR
   aisladas de la zona, a menos de 10 mm, entran en la región; las letras de la propia consigna no cuentan.
6. **Firmas de forma.** Son evidencia de forma, nunca de contenido:
   - **barra:** contorno cerrado buscado dentro de la región, sin regla horizontal interior (eso sería una tabla), con divisiones
     oscuras o claras y partes casi iguales;
   - **recta numérica:** eje y marcas, y que no sea una barra;
   - **esfera:** envolvente circular con agujas;
   - **triángulo o rectángulo:** esquinas de la envolvente;
   - **cuadrícula:** filas y columnas.

   Esfera, polígonos y cuadrícula solo cuentan si la consigna nombra esa forma («reloj», «triángulo», «cuadrícula», «casilla»…).
7. **Comprobaciones.**
   - Geométricas, que no se relajan:
     - ubicación;
     - unicidad;
     - integridad (ningún trazo cortado y lejos del borde de la página);
     - etiquetas reclamadas dentro;
     - sin texto corrido dentro (los restos OCR de trazos, como «|» o «x=», no son texto);
     - filtro léxico de respuesta.
   - **Semánticas, siempre `unverifiable`:** identidad, contenido completo y respuesta visual.

## Diez fichas del corpus (desarrollo)

«Antes» es el prefiltro de #31 con la caja humana como propuesta (métrica de la Fase I). «Después» es v2, **sin caja**. Una
candidata es **correcta** solo con IoU ≥ 0,6 y todas las etiquetas de referencia dentro de la región.

| Ficha | Tipo | Antes (#31): bloqueo | Después (v2) | IoU | Etiquetas dentro | Trazos cortados | Zona | Evidencia de forma | Bloqueo restante |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 Planta | esquema | `labels` (etiqueta 3 a 6 mm) | **correcta** | 0,81 | 3/3 | 0 | ancho | etiquetas de la consigna | — |
| 02 Barra | barra | `identity_evidence` (mota bajo la barra) | **correcta** | 0,91 | — | 0 | ancho | barra | — |
| 03 Recta | recta | `identity_evidence` (girada 2,3°) | **correcta** | 0,74 | 11/11 | 0 | ancho | recta | — |
| 04 Ciclo del agua | esquema | `labels` (nube separada) | **correcta** | 0,87 | 3/3 | 0 | ancho | etiquetas de la consigna | — |
| 05 Triángulo | geometría | `uniqueness` (zona colapsada) | **correcta** | 0,88 | 3/3 | 0 | columna 0–101 mm | triángulo | — |
| 05 Rectángulo | geometría | `activity_anchor` (columnas) | **correcta** | 0,79 | 4/4 | 0 | columna 101–210 mm | rectángulo | — |
| 07 Célula | esquema | correcta | **correcta** | 0,84 | 4/4 | 0 | ancho | etiquetas de la consigna | — |
| 08 Reloj | reloj | `identity_evidence` | **correcta** | 0,91 | 4/4 | 0 | ancho | esfera | — |
| 09 Paisaje | esquema | `labels` | sin verificar | 0,97 | 3/3 | 0 | ancho | — | **OCR:** la B no se lee |
| 10 Plano | cuadrícula | `activity_anchor` («Mirael») | **correcta** | 0,89 | 8/8 | 0 | ancho (ancla tolerante) | cuadrícula | — |

| Métrica | Antes | Después |
| --- | --- | --- |
| Candidatas correctas / figuras elegibles | 1/10 | **9/10** |
| Candidatas erróneas | 0 | **0** |
| Candidatas incompletas | 0 | 0 |
| Sin verificar | — | 1 (OCR) |
| Recortes aprobados | 0 | **0** |

**Origen de los bloqueos de «antes»:**

| Origen | Casos |
| --- | --- |
| Geometría | 01, 02, 03, 04, 05 (×2) y 08: etiquetas a más de 4 mm, piezas separadas, firmas frágiles ante motas o giros, y zonas a todo el ancho |
| OCR | 09 (B sin leer) y 10 («Mirael») |
| Semántica | Ninguno era el primer bloqueo |

Hoy queda **1 bloqueo de OCR (09)**. Ninguna figura del corpus termina bloqueada por geometría.

## Reserva geométrica independiente (una sola ejecución)

Son diez fichas de familias distintas a las de desarrollo:
- **Figuras elegibles (6):**
  - barra sobre papel gris y fotocopia degradada;
  - recta con flechas y fracciones, girada −2,5°;
  - reloj con los 12 números;
  - dos columnas con consignas parecidas (dos figuras);
  - esquema con guías diagonales a 300 ppp, girado 2°.
- **Negativas (5):**
  - respuesta dibujada;
  - figuras superpuestas;
  - recuadros vacíos con rayas decorativas;
  - figura entre dos actividades;
  - tabla reclamada como barra.

| Métrica | Antes (#31, caja humana) | Después (v2, sin caja) |
| --- | --- | --- |
| Candidatas correctas / elegibles | 0/6 | **2/6** (reloj, esquema diagonal) |
| Candidatas erróneas en negativas | 0/5 | **1/5** (respuesta dibujada) |
| Negativas rechazadas | — | 4/5 |
| Distractores aceptados como candidatos | 0 | 0 |
| Recortes aprobados | 0 | **0** |

| Elegible no recuperada | Resultado | Causa |
| --- | --- | --- |
| Barra gris degradada | Ninguna candidata | El grano se une a la figura: región demasiado grande, 4 trazos cortados y sin firma |
| Recta con flechas | Sin verificar | El eje se parte en dos piezas que parecen rivales; el OCR no lee el «0» |
| Columnas parecidas, triángulo | Bloqueo semántico | Región correcta (IoU 0,81), pero la consigna dice «figura» y no nombra forma ni etiquetas |
| Columnas parecidas, rectángulo | No encontrada | Es un contorno vacío y no se distingue de una caja de respuesta |

**El falso positivo de la reserva.** En la barra con la respuesta dibujada al lado, la geometría encuentra una barra válida. Es la
razón por la que `visual_answer_safety` sigue `unverifiable` y la decisión queda BLOCKED: **ningún recorte se entrega**.

Las reglas no se han tocado después de esta ejecución.

**Desarrollo geométrico** (10 fichas, usadas para ajustar):
- 5/6 candidatas correctas, 0 erróneas y 5/5 negativas rechazadas (sin figura, tabla, dos figuras, cortada y cruza columnas);
- 1 sin verificar por OCR.

## Tiempo y memoria (contenedor de 4 vCPU, no Vercel)

| | Corpus (10 fichas, 150–205 ppp) | Desarrollo y reserva geométricos |
| --- | --- | --- |
| Geometría por página, mediana (máximo) | 153 ms (341) | 64–71 ms (411) |
| Pico RSS | 509 MB | 909–984 MB |

- La geometría corre **además** del OCR de la Fase I (unos 2 s por página).
- En el corpus, el pico de RSS incluye OCR, pdf.js y canvas.
- En los conjuntos geométricos el pico es mayor porque cada ficha se rasteriza dos veces y una va a 300 ppp.
- La copia enderezada cuesta una página de grises más; se conservan los presupuestos de la Fase I.

## Seguridad

- `locateFigure` marca siempre `semantic_identity`, `complete_content` y `visual_answer_safety` como `unverifiable`, así que
  `decision` = `blocked` y `crop` = `null` en todas las ejecuciones (aceptadas: 0/31). Lo comprueban las pruebas.
- No se ha cambiado `verify.ts` (#31), `locate.ts`, ningún verificador de producción ni el contrato.
- **Candidata** significa región geométricamente coherente para revisión humana, **no** un recorte aprobado.

## Pendiente

- Grano y fotocopias muy degradadas: hace falta separar trazo y grano sin unir motas a la figura.
- Ejes partidos por el giro o por flechas: hay que reconstruir un eje continuo.
- Contornos vacíos que son figuras, cuando la consigna no nombra la forma.
- Figuras genéricas sin forma ni etiquetas en la consigna: bloqueo semántico por diseño.
- **Respuestas dibujadas:** la geometría no las detecta. Requieren una verificación semántica independiente.
- No se ha validado con escaneos físicos reales ni en Vercel.

## Reproducir

```bash
pnpm exec vitest run tests/unit/figure-geometry-v2.test.ts
pnpm eval:geometry -- --cases dev        # evals/visual-location/results-geometry-dev/
pnpm eval:geometry -- --cases holdout    # evals/visual-location/results-geometry-holdout/ (solo para medir)
pnpm eval:geometry -- --corpus /copia/externa/del/corpus   # informe en <corpus>/results-geometry/, fuera de Git
```
