# Corrección focalizada de anclas y etiquetas del prototipo OCR

Base: `main` / `37c381b` (PR #32 integrada). Solo `evals/`, pruebas y documentación.

## Defectos y correcciones

**A · Evaluación:** se comparaban centros de cajas con distinta numeración/extensión. Ahora `found` conserva lo que encontró el matcher sin modificarlo. La asociación contrasta un prefijo reconocible de la misma consigna con su región anotada: centros de las cajas de soporte dentro de X, solapamiento y el límite vertical existente de 3 mm. No se amplía tolerancia. Prefijos menores que la evidencia del matcher (hasta 28 caracteres), referencias incoherentes, coincidencias empatadas y líneas entre actividades quedan `unverifiable`, no correctas. La transcripción completa se mide aparte con recall/WER/CER. El evaluador tolerante mantiene su 20 % de edición y exige un mejor prefijo único.

El corpus mantiene las veinte referencias originales: texto, índices, orden de líneas y cajas coherentes, sin cambios. Son referencias de generación sintética, no doble anotación humana independiente. No se usan las cajas de referencia para ayudar al reconocimiento ni al matcher.

**A · Requisitos inventados:** el regex tomaba el inicio de una palabra ordinaria como etiqueta y se detenía antes de otra lista válida. `instructionLabels()` solo admite enumeraciones explícitas completas de al menos dos elementos, de acuerdo con su vocabulario (números/letras/etiquetas). Una lista incompleta o ambigua no añade requisitos. Cambio exclusivo del prototipo; `figure_proposal_verifier@proto3`.

Regresiones con numeración en ambos lados, cajas parciales, prefijos genéricos, consignas duplicadas, otra actividad/columna, líneas fusionadas, referencias ausentes/contradictorias, detección tolerante y contadores separados. Las 24 pruebas iniciales dieron 17 fallos antes de corregir.

## Misma ejecución de diez fichas: antes → después

Datos y documentos solo fuera de Git; aquí se publican únicamente recuentos y diagnóstico. **Son fichas sintéticas con efectos de escaneo simulados.** No validan materiales escolares reales. La salida genérica del CLI llama «real» a cualquier `--corpus`: en este caso significa corpus externo, no escaneo físico.

| Ficha | Etiquetas | Anclas encontradas | Asociadas correctamente | Sin verificar después | Candidatas geométricas | Bloqueo principal después |
|---|---|---|---|---|---|---|
| 01 | 4/4 → 4/4 | 2/2 → 2/2 | 0/2 → 2/2 | 0 | 0/1 → 0/1 | C: etiqueta 3 fuera del recorte. |
| 02 | No aplica | 2/2 → 2/2 | 0/2 → 2/2 | 0 | 0/1 → 0/1 | C: firma de barra. |
| 03 | 11/11 → 11/11 | 2/2 → 2/2 | 0/2 → 2/2 | 0 | 0/1 → 0/1 | A corregido: desaparece «es»; C: firma de recta. |
| 04 | 2/3 → 2/3 | 2/2 → 2/2 | 0/2 → 2/2 | 0 | 0/1 → 0/1 | B: C confundida y espurias; C: recorte incompleto. |
| 05 | 5/7 → 5/7 | 1/2 → 1/2 | 0/2 → 0/2 | 1 | 0/2 → 0/2 | B: dos C perdidas; C: columnas mezcladas y zonas/rivalidad. |
| 06 | No aplica | 2/2 → 2/2 | 0/2 → 2/2 | 0 | No aplica | No hay visual requerido; no se ensaya el adorno. |
| 07 | 4/4 → 4/4 | 2/2 → 2/2 | 0/2 → 2/2 | 0 | 1/1 → 1/1 | Solo bloqueos semánticos no verificables (candidata presente). |
| 08 | 2/4 → 2/4 | 1/2 → 1/2 | 0/2 → 1/2 | 0 | 0/1 → 0/1 | B: 3/9 y una consigna; C: etiquetas fuera del contrato del recorte. |
| 09 | 1/3 → 1/3 | 1/2 → 1/2 | 0/2 → 1/2 | 0 | 0/1 → 0/1 | B: comienzo de consigna y B/C perdidos. |
| 10 | 7/8 → 7/8 | 1/2 → 1/2 | 0/2 → 1/2 | 0 | 0/1 → 0/1 | B: «Mirael» y C; asociación exacta ausente. |

Exacto: **16/20 encontradas; 15/20 asociadas; 1/20 sin verificar (columnas); 4/20 no encontradas**. Antes: 16 encontradas, 0 correctas, 16 fuera de tolerancia y 4 omitidas. No implica mejora de lectura: se ha reparado su evaluación.

Tolerante experimental: **17/20 encontradas; 16/20 asociadas; 1/20 sin verificar; 3/20 no encontradas**. El hallazgo adicional es la consigna con palabras unidas; no modifica el localizador ni sus candidatos. No sumar resultados de ambos matchers.

## Qué permanece igual

- **B · OCR:** 36/44 etiquetas; 7 perdidas, 1 confundida, 7 espurias, 0 duplicadas. WER 11,6 % (68/587); CER 3,8 % (121/3.144). Coinciden por ficha ambos motores, errores de texto, etiquetas, espurias, confianza media y llamadas. No se optimiza C.
- **C · Geometría:** 1/10 candidatas con OCR y 1/10 con referencia (en fichas distintas), sin cambios. En 03 cambia la primera causa visible de `labels` a `identity_evidence`: la firma de recta ya fallaba y no se ha tocado. Persisten etiquetas fuera del recorte, trazos cortados, firmas y mezcla de columnas.
- **Límite semántico:** candidata no significa recorte aprobado. Identidad, contenido completo y respuesta visual continúan sin verificar. Cero aprobaciones. Reloj/cuadrícula siguen teniendo límites de contrato incluso con texto de referencia.
- La ficha 06 no genera ensayos de figuras: no demuestra rechazo de su decoración.

La ejecución local terminó completa con red bloqueada y supervisor de 2 GiB/10 min: 11,872 s y pico RSS muestreado del grupo de procesos de 540.114.944 bytes. No son límites absolutos del runtime nativo ni una prueba Vercel. Documentos fuente, manifiesto, imágenes, OCR, geometría, límites y modelo sin cambios. No se repite la evaluación histórica de 55 condiciones-página ni la suite completa. `results/report.*` conserva explícitamente la referencia histórica `ocr_pilot@audit2`; esta comparación usa `ocr_pilot@audit3`.

## Verificación focalizada

- **100/100 pruebas en siete archivos:** `ocr-anchor-association` (29), `ocr-pilot-metrics`, `ocr-pilot-audit`, `ocr-pilot-loader`, `visual-location-prototype`, `visual-location-adversarial` y `boundaries`.
- **Typecheck PASS**, **lint sin errores** (aviso previo `_id` en `analysis-run-auth.test.ts`) y `git diff --check` PASS.
- Ejecutados los binarios locales equivalentes a los scripts: `node_modules/.bin/vitest run …`, `node_modules/.bin/next typegen && node_modules/.bin/tsc --noEmit`, `node_modules/.bin/eslint`. El lanzador pnpm intentaba reinstalar dependencias y escribir fuera del workspace; no se reinstaló ni cambió el lockfile.
- Ejecución OCR local sobre las diez entradas originales; estado `complete`, SHA del manifiesto e imágenes conservados. Reportes detallados y observaciones solo fuera de Git.

## Recomendación

**MERGE como reparación del piloto y su evaluación.** No activa OCR en Hacer magia ni autoriza recortes. No hay cambios de `src/`, dependencias, UI, SQL, Stripe, Supabase o migraciones.
