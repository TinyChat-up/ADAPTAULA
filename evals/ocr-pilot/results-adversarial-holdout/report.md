# Piloto OCR local — fixtures SINTÉTICOS

**55 condiciones-página de 11 documentos base: no son 55 observaciones independientes ni validan documentos reales.** Las cajas de referencia se usan solo para puntuar.

Motor: ocr_pilot@phase1 · tesseract.js 7.0.0 (Tesseract 5, WASM) · spa 4.0.0_best_int · PSM 3 + enderezado; etiquetas PSM 8 con respaldo PSM 10 (reglas de recognition.ts). Generado con `pnpm eval:ocr`. Memoria (RSS de todo el proceso, con pdf.js y canvas): 137 MB antes de cargar el motor, 247 MB con los dos workers cargados, pico 916 MB. Dependencia: tesseract.js 1.4 MB + núcleo WASM 45.3 MB (6 variantes) + modelo spa 2.1 MB (gzip).

WER/CER y denominadores, precisión de etiquetas y detecciones están en report.json. Palabras/caracteres % = 100 menos tasa de edición: puede ser negativo por inserciones. Ancla hallada no implica asociación verificada. Se comprueba el soporte del mismo prefijo de consigna en su región anotada, sin comparar centros de líneas con numeración diferente; vertical ≤3 mm, X dentro de referencia. Prefijos insuficientes, referencias incoherentes y líneas entre actividades quedan sin verificar. Orden de lectura: altura y luego izquierda a derecha; no valida columnas.

## Motor «pagina»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| holdout | 7 | 81.1 | 92.3 | 62.5 | 5; 5/0/0/3 | 6; 5/0/1/2 | 4.2 (24) | 23 | 0 | 1 | 1 | 0/0 (ref — %) | 0 | 1667 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| serif_cgqo | 1 | 78.9 | 89.7 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (4) | 4 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1700 |
| courier_confusiones | 1 | 68.4 | 84.8 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (6) | 6 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1558 |
| cuadricula | 1 | 63.6 | 81.2 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (8) | 8 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1398 |
| esfera | 1 | 71.4 | 87.9 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (4) | 4 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1667 |
| columnas_girado | 1 | 100 | 100 | 0 | 0; 0/0/0/2 | 0; 0/0/0/2 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 2004 |
| marcas_degradado | 1 | 81.3 | 96.3 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 50 (2) | 1 | 0 | 1 | 1 | 0/0 (ref — %) | 0 | 1729 |
| consigna_partida | 1 | 100 | 100 | 0 | 0; 0/0/0/1 | 1; 0/0/1/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1534 |

## Motor «pagina+etiquetas»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| holdout | 7 | 95.5 | 98.9 | 62.5 | 5; 5/0/0/3 | 6; 5/0/1/2 | 91.7 (24) | 0 | 2 | 1 | 0.35 | 0/0 (ref — %) | 0 | 1812 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| serif_cgqo | 1 | 100 | 100 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (4) | 0 | 0 | 0 | 0.47 | 0/0 (ref — %) | 0 | 1818 |
| courier_confusiones | 1 | 94.7 | 98.7 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 83.3 (6) | 0 | 1 | 0 | 0.35 | 0/0 (ref — %) | 0 | 1693 |
| cuadricula | 1 | 100 | 100 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (8) | 0 | 0 | 0 | 0.1 | 0/0 (ref — %) | 0 | 1612 |
| esfera | 1 | 92.9 | 98.5 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 75 (4) | 0 | 1 | 0 | 0.09 | 0/0 (ref — %) | 0 | 1812 |
| columnas_girado | 1 | 100 | 100 | 0 | 0; 0/0/0/2 | 0; 0/0/0/2 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 2068 |
| marcas_degradado | 1 | 75 | 93.8 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (2) | 0 | 0 | 1 | 0.05 | 0/0 (ref — %) | 0 | 1923 |
| consigna_partida | 1 | 100 | 100 | 0 | 0; 0/0/0/1 | 1; 0/0/1/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1594 |

Candidatos: prefiltro geométrico de #31 con la caja humana como propuesta; «ref» = mismo prefiltro con la capa de texto de referencia. Ninguna propuesta se acepta: identidad semántica, contenido completo y respuesta visual siguen sin verificar.
