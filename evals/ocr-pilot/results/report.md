# Piloto OCR local — fixtures SINTÉTICOS

**Fixtures sintéticos: no validan el comportamiento con documentos reales.** Las cajas de referencia se usan solo para puntuar.

Motor: tesseract.js 7.0.0 (Tesseract 5, WASM) · spa 4.0.0_best_int · PSM 3 + enderezado automático en página, PSM 8 en etiquetas. Generado con `pnpm eval:ocr`. Memoria (RSS de todo el proceso, con pdf.js y canvas): 147 MB antes de cargar el motor, 259 MB con los dos workers cargados, pico 1076 MB. Dependencia: tesseract.js 1.4 MB + núcleo WASM 45.3 MB (6 variantes) + modelo spa 2.1 MB (gzip).

## Motor «pagina»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| limpio_300 | 11 | 93.6 | 97.6 | 100 | 23/0/0 | 23/0/0 | 0 (27) | 27 | — | 0 | — | 1/6 (ref 100 %) | 0 | 1660 |
| escaner_300 | 11 | 93.6 | 97.6 | 100 | 23/0/0 | 23/0/0 | 0 (27) | 27 | — | 0 | — | 1/6 (ref 100 %) | 0 | 3843 |
| escaner_150 | 11 | 93.6 | 97.6 | 100 | 23/0/0 | 23/0/0 | 0 (27) | 27 | — | 0 | — | 1/6 (ref 100 %) | 0 | 1175 |
| girado_200 | 11 | 91.3 | 94.9 | 95.7 | 22/0/1 | 22/0/1 | 0 (27) | 27 | — | 0 | — | 0/6 (ref 83.3 %) | 0 | 2317 |
| degradado_200 | 11 | 78.1 | 92.3 | 60.9 | 18/0/5 | 22/0/1 | 0 (27) | 27 | — | 0 | — | 0/6 (ref 0 %) | 0 | 2200 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| celula_numeros | 40 | 88.6 | 95.3 | 91.3 | 75/0/5 | 78/0/2 | 0 (125) | 125 | — | 0 | — | 0/20 (ref 80 %) | 0 | 2208 |
| barra_y_letras | 5 | 89.1 | 95.8 | 80 | 14/0/1 | 15/0/0 | 0 (10) | 10 | — | 0 | — | 3/10 (ref 70 %) | 0 | 2052 |
| sin_figura | 5 | 97.8 | 99.5 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | — | 0 | — | 0/0 (ref — %) | 0 | 2064 |
| rotulos_palabra | 5 | 96.4 | 98.6 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | — | 0 | — | 0/0 (ref — %) | 0 | 2098 |

## Motor «pagina+etiquetas»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| limpio_300 | 11 | 100 | 100 | 100 | 23/0/0 | 23/0/0 | 100 (27) | 0 | — | 0 | 0.08 | 6/6 (ref 100 %) | 0 | 1705 |
| escaner_300 | 11 | 100 | 100 | 100 | 23/0/0 | 23/0/0 | 100 (27) | 0 | — | 0 | 0.08 | 6/6 (ref 100 %) | 0 | 3927 |
| escaner_150 | 11 | 100 | 100 | 100 | 23/0/0 | 23/0/0 | 100 (27) | 0 | — | 0 | 0.1 | 6/6 (ref 100 %) | 0 | 1207 |
| girado_200 | 11 | 97.6 | 97.5 | 95.7 | 22/0/1 | 22/0/1 | 100 (27) | 0 | — | 0 | 0.11 | 1/6 (ref 83.3 %) | 0 | 2390 |
| degradado_200 | 11 | 83 | 94.6 | 60.9 | 18/0/5 | 22/0/1 | 100 (27) | 0 | — | 0 | 0.08 | 0/6 (ref 0 %) | 0 | 2242 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| celula_numeros | 40 | 96.1 | 98.3 | 91.3 | 75/0/5 | 78/0/2 | 100 (125) | 0 | — | 0 | 0.08 | 12/20 (ref 80 %) | 0 | 2262 |
| barra_y_letras | 5 | 94.9 | 98.2 | 80 | 14/0/1 | 15/0/0 | 100 (10) | 0 | — | 0 | 0.12 | 7/10 (ref 70 %) | 0 | 2145 |
| sin_figura | 5 | 97.8 | 99.5 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | — | 0 | — | 0/0 (ref — %) | 0 | 2085 |
| rotulos_palabra | 5 | 95.8 | 98.7 | 100 | 10/0/0 | 10/0/0 | — (0) | 0 | — | 0 | — | 0/0 (ref — %) | 0 | 2152 |

Candidatos: prefiltro geométrico de #31 con la caja humana como propuesta; «ref» = mismo prefiltro con la capa de texto de referencia. Ninguna propuesta se acepta: identidad semántica, contenido completo y respuesta visual siguen sin verificar.
