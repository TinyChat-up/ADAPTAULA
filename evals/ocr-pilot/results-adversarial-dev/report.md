# Piloto OCR local — fixtures SINTÉTICOS

**55 condiciones-página de 11 documentos base: no son 55 observaciones independientes ni validan documentos reales.** Las cajas de referencia se usan solo para puntuar.

Motor: ocr_pilot@phase1 · tesseract.js 7.0.0 (Tesseract 5, WASM) · spa 4.0.0_best_int · PSM 3 + enderezado; etiquetas PSM 8 con respaldo PSM 10 (reglas de recognition.ts). Generado con `pnpm eval:ocr`. Memoria (RSS de todo el proceso, con pdf.js y canvas): 139 MB antes de cargar el motor, 248 MB con los dos workers cargados, pico 925 MB. Dependencia: tesseract.js 1.4 MB + núcleo WASM 45.3 MB (6 variantes) + modelo spa 2.1 MB (gzip).

WER/CER y denominadores, precisión de etiquetas y detecciones están en report.json. Palabras/caracteres % = 100 menos tasa de edición: puede ser negativo por inserciones. Ancla hallada no implica asociación verificada. Se comprueba el soporte del mismo prefijo de consigna en su región anotada, sin comparar centros de líneas con numeración diferente; vertical ≤3 mm, X dentro de referencia. Prefijos insuficientes, referencias incoherentes y líneas entre actividades quedan sin verificar. Orden de lectura: altura y luego izquierda a derecha; no valida columnas.

## Motor «pagina»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dev | 8 | 78 | 89.7 | 88.9 | 8; 8/0/0/1 | 9; 8/0/1/0 | 0 (25) | 25 | 0 | 1 | — | 0/0 (ref — %) | 0 | 1643 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| letras_cg | 1 | 78.9 | 90 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (4) | 4 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1824 |
| 1i_0o | 1 | 71.4 | 86.8 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (4) | 4 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1422 |
| b8 | 1 | 76.5 | 89.7 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (4) | 4 | 0 | 1 | — | 0/0 (ref — %) | 0 | 1576 |
| numeros_marcas | 1 | 66.7 | 83.6 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (6) | 6 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1714 |
| dos_columnas | 1 | 100 | 100 | 100 | 2; 2/0/0/0 | 2; 2/0/0/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1643 |
| marcas | 1 | 91.7 | 96.8 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (1) | 1 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1520 |
| girado_degradado | 1 | 52.6 | 76.3 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 0 (4) | 4 | 0 | 0 | — | 0/0 (ref — %) | 0 | 2352 |
| consigna_cortada | 1 | 85.7 | 90.1 | 0 | 0; 0/0/0/1 | 1; 0/0/1/0 | 0 (2) | 2 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1404 |

## Motor «pagina+etiquetas»

### Por condición de escaneo

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dev | 8 | 95 | 97.7 | 88.9 | 8; 8/0/0/1 | 9; 8/0/1/0 | 96 (25) | 0 | 1 | 0 | 0.08 | 0/0 (ref — %) | 0 | 1714 |

### Por tipo de documento (todas las condiciones)

| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| letras_cg | 1 | 100 | 100 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (4) | 0 | 0 | 0 | 0.08 | 0/0 (ref — %) | 0 | 1941 |
| 1i_0o | 1 | 92.9 | 98.5 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 75 (4) | 0 | 1 | 0 | 0.09 | 0/0 (ref — %) | 0 | 1583 |
| b8 | 1 | 100 | 100 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (4) | 0 | 0 | 0 | 0.07 | 0/0 (ref — %) | 0 | 1693 |
| numeros_marcas | 1 | 100 | 100 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (6) | 0 | 0 | 0 | 0.07 | 0/0 (ref — %) | 0 | 1893 |
| dos_columnas | 1 | 100 | 100 | 100 | 2; 2/0/0/0 | 2; 2/0/0/0 | — (0) | 0 | 0 | 0 | — | 0/0 (ref — %) | 0 | 1714 |
| marcas | 1 | 100 | 100 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (1) | 0 | 0 | 0 | 0.1 | 0/0 (ref — %) | 0 | 1641 |
| girado_degradado | 1 | 73.7 | 87.5 | 100 | 1; 1/0/0/0 | 1; 1/0/0/0 | 100 (4) | 0 | 0 | 0 | 0.08 | 0/0 (ref — %) | 0 | 2476 |
| consigna_cortada | 1 | 95.2 | 95.6 | 0 | 0; 0/0/0/1 | 1; 0/0/1/0 | 100 (2) | 0 | 0 | 0 | 0.05 | 0/0 (ref — %) | 0 | 1497 |

Candidatos: prefiltro geométrico de #31 con la caja humana como propuesta; «ref» = mismo prefiltro con la capa de texto de referencia. Ninguna propuesta se acepta: identidad semántica, contenido completo y respuesta visual siguen sin verificar.
