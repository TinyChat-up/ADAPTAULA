# Fase I · Mejora del reconocimiento de fichas escaneadas (piloto OCR)

| Concepto | Detalle |
| --- | --- |
| Base | `main` en `153721a` (PR #34 integrada) |
| Motor | El mismo: tesseract.js 7.0.0 con el modelo `spa` fijado. Sin segundo motor ni dependencias nuevas |
| Alcance | Solo `evals/ocr-pilot/`, sus pruebas y la documentación |
| Producción | Nada conectado a Hacer magia, ningún recorte aprobado y sin cambios en `src/`, Supabase, Stripe ni UI |

**Las diez fichas del corpus son sintéticas, con efectos de escaneo simulados.** No validan el comportamiento con escaneos
físicos reales. El corpus se conserva fuera de Git:
- se evaluó sobre copias;
- las imágenes y el manifiesto originales se dejaron de solo lectura;
- se comprobó por SHA-256 que siguen idénticos;
- las referencias humanas solo puntúan y nunca seleccionan la lectura del OCR.

## Qué se ha corregido

| Clase de error | Caso observado | Regla aplicada (`evals/ocr-pilot/recognition.ts`) |
| --- | --- | --- |
| Letra C perdida | 04, 05 (×2), 09 y 10 | Un componente conectado es un solo carácter. PSM 8 inventaba «Los» o «Lol» a partir de una C; ahora esa lectura se rechaza y se pide una segunda lectura en modo carácter (PSM 10). Las variantes de caja de una letra («Cc») se funden |
| C leída como «c» o «e» | 04, 05 y 10 | En c, o, s, u, v, w, x y z la minúscula tiene la misma forma que la mayúscula. Se decide por la altura frente a las mayúsculas y dígitos de la página. La página de 04 leía la C como «e» y ahora se relee en la pasada de etiquetas |
| Glifo degradado por el recorte | Todas | Imagen del glifo con su borde antialiasado (nunca otro trazo oscuro), escalado suave a unos 64 px y margen del 60 % |
| 3 y 9 del reloj perdidos | 08 | Un glifo que toca una marca recta horizontal o vertical se separa eliminando las tiradas de tinta largas. Solo se aplica a componentes demasiado grandes para ser un glifo |
| Marcas leídas como N, 1, 7, A o X | 04 (rayos del sol) y 08 (marcas del reloj) | Se rechaza un componente que es un único trazo recto. Las lecturas sueltas de una sola letra que la página hace en una línea propia se reenvían a la pasada de etiquetas. Tres o más lecturas idénticas, alineadas y del mismo tamaño se tratan como textura |
| 0 y O | Recta y regla sintéticas | O/0, B/8, S/5 y Z/2 toman el tipo de su fila si al menos dos vecinas son todas dígitos o todas letras. Una fila mixta no se toca |
| Columnas mezcladas | 05 | Las líneas salen de la estructura de líneas del propio Tesseract y no de reagrupar toda la página por altura. Un hueco del tamaño de una columna también parte la línea. El orden de lectura va por filas y de izquierda a derecha |
| Comienzo de consigna perdido | 08 («¿Cuántos», confianza 30) y 09 («Observa el», confianza 0) | Se conserva una palabra de baja confianza solo si parece una palabra y tiene al menos tres vecinas confiadas en su misma línea de Tesseract |

**Regresión detectada y corregida durante la fase.** La primera versión aceptaba una «E» con confianza de palabra 9 dentro de una
consigna degradada del fixture histórico `answer_leak`. Ahora se exige confianza de palabra y de símbolo, y hay una prueba para ello.

**Probado y descartado: releer las líneas dudosas en modo línea (PSM 7).**
- La relectura solo podía cambiar espacios o puntuación.
- En el corpus no mejoró nada: WER 9,5 % con ella frente a 9,4 % sin ella.
- Costaba 16 llamadas, un tercer worker y más memoria.
- «Mirael» sigue igual: Tesseract no separa «Mira el» aunque se relea.

## Diez fichas: antes → después

Mismo corpus, mismo modelo y misma ejecución completa (`run-status: complete`), con el motor «página + etiquetas».

| Ficha | Etiquetas | Confundidas | Espurias | Consignas encontradas | Bien asociadas | Sin verificar | Errores de palabra | Errores de carácter | Candidatas | Llamadas OCR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 Partes de la planta | 4/4 | 0 | 0 | 2/2 | 2/2 | 0 | 5/58 | 8/291 | 0/1 | 5 |
| 02 Barra de fracciones | — | 0 | 0 | 2/2 | 2/2 | 0 | 4/47 | 5/296 | 0/1 | 2 → **1** |
| 03 Recta numérica | 11/11 | 0 | 0 | 2/2 | 2/2 | 0 | 6/63 | 7/298 | 0/1 | 13 → **12** |
| 04 Ciclo del agua | 2/3 → **3/3** | 1 → **0** | 4 → **0** | 2/2 | 2/2 | 0 | 12/57 → **7/57** | 23/289 → **14/289** | 0/1 | 5 |
| 05 Geometría a dos columnas | 5/7 → **7/7** | 0 | 0 | 1/2 → **2/2** | 0/2 → **2/2** | 1 → **0** | 6/55 | 9/312 → **7/312** | 0/2 | 9 → **10** |
| 06 Comprensión (sin dibujo) | — | 0 | 0 | 2/2 | 2/2 | 0 | 4/93 | 5/520 | — | 2 → **1** |
| 07 Célula vegetal | 4/4 | 0 | 0 | 2/2 | 2/2 | 0 | 3/58 | 3/302 | 1/1 | 5 |
| 08 Reloj analógico | 2/4 → **4/4** | 0 | 3 → **0** | 1/2 → **2/2** | 1/2 → **2/2** | 0 | 8/48 → **4/48** | 17/260 → **5/260** | 0/1 | 18 → **5** |
| 09 Paisaje y mapa | 1/3 → **2/3** | 0 | 0 | 1/2 → **2/2** | 1/2 → **2/2** | 0 | 9/53 → **6/53** | 22/287 → **9/287** | 0/1 | 8 → **3** |
| 10 Plano en cuadrícula | 7/8 → **8/8** | 0 | 0 | 1/2 | 1/2 | 0 | 11/55 → **10/55** | 22/289 → **19/289** | 0/1 | 15 → **12** |

## Métricas globales del corpus

| Métrica | Antes | Después |
| --- | --- | --- |
| Etiquetas correctas (recall) | 36/44 (81,8 %) | **43/44 (97,7 %)** |
| Detecciones de etiqueta / precisión | 44 / 81,8 % | **43 / 100 %** |
| Perdidas · confundidas · duplicadas · espurias | 7 · 1 · 0 · 7 | **1 · 0 · 0 · 0** |
| WER | 11,6 % (68/587) | **9,4 % (55/587)** |
| CER | 3,8 % (121/3.144) | **2,6 % (82/3.144)** |
| Consignas encontradas (matcher exacto) | 16/20 | **19/20** |
| Bien asociadas · incorrectas · sin verificar · omitidas | 15 · 0 · 1 · 4 | **19 · 0 · 0 · 1** |
| Comparador tolerante: bien asociadas · incorrectas · sin verificar · omitidas | 16 · 0 · 1 · 3 | **20 · 0 · 0 · 0** |
| Figuras candidatas / candidatos erróneos / recortes aprobados | 1/10 · 0 · 0 | 1/10 · 0 · 0 (sin cambios: geometría fuera de alcance) |
| Llamadas OCR: página + etiquetas (máximo por página) | 82 (18) | **59 (12)** |
| Tiempo por página, mediana (máximo) | 1.991 ms (2.437) | 2.094 ms (2.579) |
| RSS antes del motor · con workers · pico | 155 · 262 · 565 MB | 147 · 259 · 558 MB |

Los tiempos varían unos ±150 ms entre ejecuciones en este contenedor de 4 vCPU. Se midieron en este contenedor, no en Vercel.

## Casos adversariales sintéticos independientes

Están en `evals/ocr-pilot/adversarial.ts`. Las fichas se dibujaron como vectores para esta fase y se entregan como píxeles a 200 ppp.
Hay dos conjuntos disjuntos:

| Conjunto | Fichas | Contenido | Uso |
| --- | --- | --- | --- |
| **Desarrollo** | 8 | C/G/O/S, 1/10/0/O, B/8/3/E, regla con números que tocan sus marcas, dos columnas con consignas casi iguales, rayado con cruces, girada 2,5° y degradada, y consigna partida | Comprobar reglas durante el desarrollo |
| **Reserva** | 7 | Times y Courier, Q, I, cuadrícula, esfera con marcas, columnas giradas −2°, texturas degradadas y consigna partida | Se ejecutó **una sola vez** al final, con el motor anterior y con el nuevo. No se usó para elegir ningún umbral |

| Conjunto | Métrica | Antes (`main`) | Después |
| --- | --- | --- | --- |
| Desarrollo | Etiquetas correctas / detecciones | 15/25 · 27 | **24/25 · 25** |
| Desarrollo | Precisión | 55,6 % | **96 %** |
| Desarrollo | Confundidas · perdidas · espurias | 6 · 4 · 6 | **1 · 0 · 0** |
| Desarrollo | Consignas bien asociadas · incorrectas · sin verificar · omitidas | 6 · 0 · 1 · 2 | **8 · 0 · 0 · 1** |
| Desarrollo | WER / CER | 14,9 % / 5,9 % | **5,0 % / 2,3 %** |
| **Reserva** | Etiquetas correctas / detecciones | 17/24 · 27 | **22/24 · 25** |
| **Reserva** | Precisión | 63 % | **88 %** |
| **Reserva** | Confundidas · perdidas · espurias | 3 · 4 · 7 | **2 · 0 · 1** |
| **Reserva** | Consignas bien asociadas · incorrectas · sin verificar · omitidas | 5 · 0 · 0 · 3 | 5 · 0 · 0 · 3 |
| **Reserva** | WER / CER | 11,4 % / 3,9 % | **4,5 % / 1,1 %** |
| **Reserva** | Llamadas de etiquetas (máximo por página) | 69 (47) | **34 (11)** |

En la reserva quedan:
- dos «0» leídos como «O» sin contexto de fila (Courier y esfera);
- un «7» espurio en el rayado degradado.

Las tres consignas omitidas de la reserva tienen una primera línea impresa de menos de 28 caracteres, menos de lo que exige el
matcher. Ocurre en las dos columnas giradas y en la consigna partida. **El caso de columnas de la reserva no llega a probar la
separación de columnas**; es un defecto de diseño de esa ficha y no se ha corregido después de ver el resultado.

## Fixtures históricos (55 condiciones-página): sin regresiones

| Métrica | `main` | Fase I |
| --- | --- | --- |
| Etiquetas | 135/135, precisión 100 % | 135/135, precisión 100 % |
| Anclas exactas bien · mal · sin verificar · omitidas | 109 · 0 · 0 · 6 | 109 · 0 · 0 · 6 |
| Anclas tolerantes bien · mal · sin verificar · omitidas | 113 · 0 · 0 · 2 | 113 · 0 · 1 · 1 |
| WER | 3,9 % (82/2.120) | 3,9 % (82/2.120) |
| CER | 1,6 % (178/11.245) | 1,5 % (165/11.245) |
| Candidatos | 19/30, 0 erróneos | 19/30, 0 erróneos |
| Mediana | 2.003 ms/pág | 2.087 ms/pág |
| Pico RSS | 1.106 MB | 1.116 MB |

En el comparador tolerante, una consigna que antes no se encontraba se encuentra ahora y queda «sin verificar». No se cuenta como
correcta.

## Errores que siguen pendientes

1. **09:** una B atravesada por una línea guía diagonal. La separación de trazos solo trata tiradas horizontales y verticales.
2. **10:** «Mirael». Tesseract une «Mira el» incluso al releer. El matcher exacto de producción no la encuentra; el tolerante sí.
   No se ha cambiado el matcher de producción.
3. **0/O sin contexto:** con una sola etiqueta o una fila mixta no hay evidencia para elegir.
4. **«I» y «l» de palo:** se rechazan a propósito como trazo recto, porque se prefiere perder una etiqueta a inventarla. La «I»
   con serifas sí se lee.
5. **Consignas con la primera línea corta:** no se anclan, por falta de evidencia según el criterio heredado.
6. **Geometría:** sin cambios, 1/10 candidatas. Bloqueos por ficha:

   | Bloqueo | Fichas |
   | --- | --- |
   | `labels` | 01, 04 y 09 |
   | `identity_evidence` | 02, 03 y 08 |
   | `uniqueness` / `activity_anchor` por columnas | 05 |
   | `activity_anchor` por «Mirael» | 10 |

   Ningún recorte se aprueba: identidad, contenido completo y respuesta visual siguen sin verificarse.

## Reproducir

```bash
pnpm exec vitest run tests/unit/ocr-recognition-phase1.test.ts   # reglas, sin OCR
pnpm eval:ocr -- --adversarial dev                                # results-adversarial-dev/
pnpm eval:ocr -- --adversarial holdout                            # results-adversarial-holdout/ (solo para medir)
timeout --kill-after=10s 10m pnpm eval:ocr -- --corpus /copia/externa/del/corpus
```

La línea base se obtuvo con un worktree de `main` (`153721a`). Se le añadió el mismo generador adversarial y la opción
`--adversarial`, sin tocar su motor.
