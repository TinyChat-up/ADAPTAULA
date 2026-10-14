# Piloto OCR local — fixtures SINTÉTICOS

**55 condiciones-página de 11 documentos base: no son 55 observaciones independientes ni validan documentos reales.** Las cajas de referencia se usan solo para puntuar.

Motor: tesseract.js 7.0.0 (Tesseract 5, WASM) · spa 4.0.0_best_int · PSM 3 + enderezado automático en página, PSM 8 en etiquetas. Generado con `pnpm eval:ocr`. Memoria (RSS de todo el proceso, con pdf.js y canvas): 124 MB antes de cargar el motor, 235 MB con los dos workers cargados, pico 1089 MB. Dependencia: tesseract.js 1.4 MB + núcleo WASM 45.3 MB (6 variantes) + modelo spa 2.1 MB (gzip).

WER/CER y denominadores, precisión de etiquetas y detecciones están en report.json. Palabras/caracteres % = 100 menos tasa de edición: puede ser negativo por inserciones. Ancla correcta exige solapamiento y distancia de centros ≤3 mm en dos dimensiones. Orden de lectura: altura y luego izquierda a derecha; no valida columnas.

## Motor «pagina»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| limpio_300 | 11 | 93.6 | 97.6 | 100 | 23/0/0 | 23/0/0 | 0 (27) | 27 | 0 | 0 | — | 1/6 (ref 100 %) | 0 | 754 |
| escaner_300 | 11 | 93.6 | 97.6 | 100 | 23/0/0 | 23/0/0 | 0 (27) | 27 | 0 | 0 | — | 1/6 (ref 100 %) | 0 | 2051 |
| escaner_150 | 11 | 93.6 | 97.6 | 100 | 23/0/0 | 23/0/0 | 0 (27) | 27 | 0 | 0 | — | 1/6 (ref 100 %) | 0 | 597 |
| girado_200 | 11 | 91.3 | 94.9 | 95.7 | 22/0/1 | 22/0/1 | 0 (27) | 27 | 0 | 0 | — | 0/6 (ref 83.3 %) | 0 | 1174 |
| degradado_200 | 11 | 77.4 | 91.9 | 60.9 | 17/1/5 | 20/2/1 | 0 (27) | 27 | 0 | 0 | — | 0/6 (ref 0 %) | 0 | 1144 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| celula_numeros | 40 | 88.5 | 95.2 | 91.3 | 74/1/5 | 77/1/2 | 0 (125) | 125 | 0 | 0 | — | 0/20 (ref 80 %) | 0 | 1143 |
| barra_y_letras | 5 | 89.1 | 95.8 | 80 | 14/0/1 | 14/1/0 | 0 (10) | 10 | 0 | 0 | — | 3/10 (ref 70 %) | 0 | 1119 |
| sin_figura | 5 | 97.3 | 99.2 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1139 |
| rotulos_palabra | 5 | 96.4 | 98.6 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1169 |

## Motor «pagina+etiquetas»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| limpio_300 | 11 | 100 | 100 | 100 | 23/0/0 | 23/0/0 | 100 (27) | 0 | 0 | 0 | 0.08 | 6/6 (ref 100 %) | 0 | 809 |
| escaner_300 | 11 | 100 | 100 | 100 | 23/0/0 | 23/0/0 | 100 (27) | 0 | 0 | 0 | 0.08 | 6/6 (ref 100 %) | 0 | 2104 |
| escaner_150 | 11 | 100 | 100 | 100 | 23/0/0 | 23/0/0 | 100 (27) | 0 | 0 | 0 | 0.1 | 6/6 (ref 100 %) | 0 | 611 |
| girado_200 | 11 | 97.6 | 97.5 | 95.7 | 22/0/1 | 22/0/1 | 100 (27) | 0 | 0 | 0 | 0.11 | 1/6 (ref 83.3 %) | 0 | 1197 |
| degradado_200 | 11 | 82.3 | 94.2 | 60.9 | 17/1/5 | 20/2/1 | 100 (27) | 0 | 0 | 0 | 0.08 | 0/6 (ref 0 %) | 0 | 1175 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| celula_numeros | 40 | 96 | 98.2 | 91.3 | 74/1/5 | 77/1/2 | 100 (125) | 0 | 0 | 0 | 0.08 | 12/20 (ref 80 %) | 0 | 1174 |
| barra_y_letras | 5 | 94.9 | 98.2 | 80 | 14/0/1 | 14/1/0 | 100 (10) | 0 | 0 | 0 | 0.12 | 7/10 (ref 70 %) | 0 | 1164 |
| sin_figura | 5 | 97.3 | 99.2 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1151 |
| rotulos_palabra | 5 | 95.8 | 98.7 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1182 |

Candidatos: prefiltro geométrico de #31 con la caja humana como propuesta; «ref» = mismo prefiltro con la capa de texto de referencia. Ninguna propuesta se acepta: identidad semántica, contenido completo y respuesta visual siguen sin verificar.
