# Piloto · OCR local para escaneos (sin API de pago)

Estudio de viabilidad aislado. Ningún módulo de `src/` lo importa; `tests/unit/boundaries.test.ts` lo comprueba. No hay llamadas
a Anthropic, OpenAI ni a ningún OCR remoto, y tampoco SQL, migraciones ni cambios de UI. No toca Hacer magia, `MaterialAnalysis`
ni los PDF de producción. **No autoriza recortes automáticos**: el prefiltro de #31 sigue bloqueando todas las propuestas.

| Archivo | Qué es |
| --- | --- |
| `engine.ts` | Tesseract 5 en WebAssembly (`tesseract.js`), ejecutado en el proceso sobre los píxeles del escaneo. Tiene dos pasadas: página y etiquetas |
| `pages.ts` | Entradas: los 11 fixtures de `evals/visual-location` en 5 condiciones de escaneo, y un cargador de corpus real autorizado (`manifest.json` fuera del repo) |
| `metrics.ts` | Métricas puras: texto, consignas, anclas, etiquetas y candidatos del prefiltro #31 |
| `run.ts` | Ejecución y medida de tiempo y memoria. Escribe `results/report.{md,json}` |
| `results/` | Último informe de los fixtures **sintéticos** |
| `corpus.template.json` | Plantilla del manifiesto para un corpus real autorizado |

## Ejecutar

El modelo de español se descarga **una vez**: 2,1 MB, con el sha-256 fijado en `engine.ts`. La carpeta `.cache/` está en `.gitignore`.

```bash
mkdir -p evals/ocr-pilot/.cache
curl -sSfL -o evals/ocr-pilot/.cache/spa.traineddata.gz \
  https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int/spa.traineddata.gz
pnpm eval:ocr                                   # fixtures sintéticos → evals/ocr-pilot/results/  (~3 min)
pnpm eval:ocr -- --corpus /ruta/fuera/del/repo  # corpus real autorizado → /ruta/…/results/
pnpm exec vitest run tests/unit/ocr-pilot-metrics.test.ts   # métricas, sin OCR
```

Durante el reconocimiento no se hace ninguna llamada de red.

## Fase 1 · Elección del motor

No se ha medido ninguna alternativa salvo Tesseract. La comparación de las demás es documental y sirve para elegir qué medir primero.

| Motor | Licencia | Español / etiquetas de 1–2 caracteres | Cajas | Giro | Tamaño, CPU y memoria | Vercel |
| --- | --- | --- | --- | --- | --- | --- |
| **tesseract.js 7 (Tesseract 5, WASM)** | Apache-2.0 (código y `tessdata`) | Modelo `spa` oficial. **Medido:** pierde las etiquetas aisladas en la pasada de página | Palabra, línea y bloque | Enderezado propio (`rotateAuto`): **medido** a 3° y 4,5°; a 8° no endereza. OSD de 90° aparte | **Medido:** 47 MB en `node_modules` + 2,1 MB de modelo; 1,2–4,9 s por página; pico de proceso ~1,1 GB | Sin binarios nativos ni Python; `worker_threads` + WASM. Es el único que puede ir en la misma Function |
| Tesseract nativo (CLI o bindings) | Apache-2.0 | Mismo modelo | Igual | Igual | Más rápido; requiere bibliotecas del sistema | No en Functions sin capa propia; sí en un contenedor o worker |
| PaddleOCR (PP-OCR) o RapidOCR (ONNX) | Apache-2.0 | Modelo latino multilingüe; detector propio, a priori mejor con texto corto | Cuadriláteros por línea | Clasificador de orientación | Python + Paddle, o `onnxruntime` (nativo, decenas de MB) | Dudoso en Functions (binarios nativos); viable en un contenedor |
| docTR · EasyOCR | Apache-2.0 | Buenos en documento; necesitan PyTorch o TF | Palabra o línea | Parcial | Cientos de MB y lentos en CPU | No en Functions |
| Surya | Código GPL-3.0; pesos con licencia comercial restringida | — | — | — | Pesado (PyTorch) | Descartado por licencia |
| OCR en la nube (Vision, Textract, Azure) | De pago y remoto | — | — | — | — | Excluido por las reglas de este piloto |

**Elegido: tesseract.js 7.0.0.** Es el único candidato local, con licencia permisiva y sin binarios nativos que puede ejecutarse
en el mismo runtime Node de la app. Se instala como **devDependency exacta**, porque solo lo usa este piloto. Su `postinstall`
(un aviso de opencollective) está bloqueado en `pnpm-workspace.yaml`. No entra en el bundle de producción y nada de `src/` lo importa.

## Fase 2 · Prototipo

- **Entrada:** solo los píxeles del raster escaneado (`model.texts` vacío). La capa de texto del PDF vectorial, transformada como
  los píxeles, se usa **solo como referencia para puntuar**, nunca como entrada del OCR.
- **Pasada de página:** segmentación automática (PSM 3), enderezado automático y palabras con confianza ≥ 40. Las cajas se devuelven
  en el marco enderezado y se llevan de vuelta a la página tal como se muestra.
- **Pasada de etiquetas:** busca manchas de tinta del tamaño de un glifo (1,8–6 mm de alto) que la pasada de página no leyó. Agrupa
  las que están en la misma línea (`12`, `1/4`) y relee cada grupo aislado con PSM 8, lista blanca alfanumérica y confianza ≥ 50.
  Solo lee texto: no propone figuras (no es el detector de manchas descartado en #31). **Sus umbrales se fijaron con estos mismos
  fixtures**, y son de Helvetica a 11 pt.
- **Prefiltro de #31:** se ejecuta con la capa OCR, y por separado con la de referencia, usando como propuesta la caja humana
  correcta, cada distractor y la página entera.

## Fase 3 · Resultados sobre fixtures SINTÉTICOS

**No son documentos reales.** Son 11 fichas dibujadas con Helvetica, a una columna y sin manuscrito; los umbrales se ajustaron con
ellas. Estas cifras muestran que el circuito funciona, no la precisión esperada con escaneos de aula. Informe completo, desglosado
por condición y por tipo de documento: [`results/report.md`](results/report.md).

| Condición (11 páginas cada una) | Palabras | Caracteres | Consignas (ancla exacta) | Etiquetas 1/2/3 y A/B | Candidatos con caja humana (ref.) | ms/pág (mediana) |
| --- | --- | --- | --- | --- | --- | --- |
| limpio, 300 ppp | 100 % | 100 % | 23/23 | 27/27 | 6/6 (6/6) | 1.705 |
| escáner (grano y sombra), 300 ppp | 100 % | 100 % | 23/23 | 27/27 | 6/6 (6/6) | 3.927 |
| escáner, 150 ppp | 100 % | 100 % | 23/23 | 27/27 | 6/6 (6/6) | 1.207 |
| girado +3° (4,5° una ficha), 200 ppp | 97,6 % | 97,5 % | 22/23 | 27/27 | **1/6** (5/6) | 2.390 |
| degradado (bajo contraste, grano fuerte, motas), 200 ppp | 83 % | 94,6 % | 18/23 (tolerante 22/23) | 27/27 | **0/6** (0/6) | 2.242 |

Cifras del motor «página + etiquetas»:
- **Etiquetas:** 135 impresas, 0 perdidas, 0 confusiones `1/I` u `0/O`, 0 duplicadas y 0 leídas sobre papel en blanco.
- **Posición de las etiquetas:** desvío del centro con mediana de 0,05 mm y p90 de 0,09 mm. La IoU mediana es de 0,48 porque la
  referencia es la caja tipográfica y el OCR devuelve la caja de tinta.
- **Anclas de actividad:** 109 correctas, 0 mal asignadas y 6 omitidas. Con un comparador tolerante (≤ 20 % de ediciones), que
  no está en producción, quedan 113 correctas, 0 mal asignadas y 2 omitidas. El desvío vertical de las anclas tiene un p90 de 0,34 mm.
- **Candidatos:** 0 erróneos (distractores o página entera) en todas las condiciones. Ninguna propuesta se acepta.

Solo la pasada de página (sin la de etiquetas) pierde **las 135 etiquetas**. Eso deja la cobertura de candidatos en 3/30,
frente al 76,7 % con la referencia.

**Memoria y tamaño:**
- Proceso Node completo (con pdf.js y canvas): 147 MB antes de cargar el motor, 259 MB con dos workers y un pico de 1.076 MB.
  El pico se debe a páginas de 300 ppp; no se midió por resolución.
- Dependencia: tesseract.js 1,4 MB + núcleo WASM 45,3 MB (6 variantes; se carga una) + modelo `spa` de 2,1 MB comprimido.

**Tiempo:** medido en un contenedor de 4 vCPU; ninguna cifra se ha medido en Vercel.

### Por qué falla lo girado y lo degradado

- **Girado:** el OCR lee bien, con 0 errores de palabra en 10 de 11 fichas una vez enderezada. Lo que falla es la integración: el
  prefiltro de #31 agrupa líneas en la página sin enderezar, y las cajas de palabra inclinadas se funden entre líneas, de modo que
  la consigna no se encuentra. Para escaneos hay que enderezar la página **antes** del prefiltro, no solo dentro del OCR.
- **Degradado:**
  - El OCR comete errores realistas («Obseiva», «1;» por «1,», «AyB», «lás»), y una errata en los primeros 28 caracteres rompe el
    ancla exacta. El comparador tolerante recupera 4 de 5 sin asignar mal ninguna.
  - Además, **el propio prefiltro falla con la capa de referencia (0/6)**: su umbral fijo de tinta convierte el grano en dibujo.
    Esto no es un problema del OCR.

## Fase 4 · Criterios de decisión

1. **¿Detecta las consignas con precisión útil?**
   - En fixtures limpios o con ruido moderado, sí: 100 % a 150–300 ppp y 0 anclas mal asignadas.
   - En fotocopia degradada baja al 78 % (exacta) o al 96 % (tolerante). Las erratas de OCR exigen un ancla tolerante, que hay que
     probar contra consignas parecidas.
   - Sin corpus real, la precisión útil **no está demostrada**.
2. **¿Recupera las etiquetas pequeñas?**
   - La pasada de página no: las pierde todas.
   - Con la pasada de etiquetas, 135/135 sin confusiones ni etiquetas espurias, pero solo en Helvetica de 11 pt y con umbrales
     ajustados aquí.
   - Quedan sin probar: tipografías escolares, etiquetas pegadas a líneas guía, círculos alrededor del número, manuscrito y tamaños
     menores de unos 7 pt.
3. **¿Identifica la actividad sin confundir otras consignas?** 0 anclas mal asignadas en 115 consignas, con ambos comparadores.
   Las fichas tienen consignas muy distintas entre sí. Dos consignas casi iguales («Observa la barra…» ×2) quedan sin ancla, y ese
   es el comportamiento buscado (está cubierto por un test).
4. **¿Qué cobertura de candidatos hay con cajas humanas correctas?**
   - 19/30 (63 %), frente a 23/30 (77 %) con la capa de referencia.
   - 18/18 en las condiciones limpia y con escáner.
   - 1/6 girado, por la integración; 0/6 degradado, por el prefiltro.
   - 0 candidatos erróneos, y 0 aceptaciones por diseño.
5. **¿Es viable en Vercel?**
   - **Probable, pero no comprobado.** No usa binarios nativos y cabe en tamaño.
   - Necesita del orden de 1–5 s de CPU por página (más con 1 vCPU) y un pico de unos 1,1 GB a 300 ppp. Exige una Function con
     ≥ 2 GB y el `maxDuration` de 300 s del análisis.
   - Habría que incluir el WASM y el modelo en el *file tracing*, en vez de descargarlos en runtime. Un material de 10 páginas
     consume buena parte del plazo de 270 s del job.
   - Si se integra, encaja mejor como etapa propia del job de análisis o en un worker aparte, no en la petición del docente.
     Pendiente: un despliegue de prueba.
6. **¿Aporta suficiente valor para seguir?**
   - El OCR deja de ser el cuello de botella en estos fixtures: con enderezado y pasada de etiquetas da al prefiltro una capa de
     texto casi igual a la de referencia.
   - Los bloqueos que quedan son de integración (enderezar antes) y del prefiltro (robustez al grano).
   - El valor real depende de un corpus auténtico, que no existe todavía.
7. **¿Qué sigue sin demostrarse semánticamente?**
   - Que el dibujo sea el correcto, esté completo y no muestre la respuesta.
   - **Un OCR correcto no prueba que el contenido de la figura sea correcto.** Etiquetas bien leídas en un dibujo equivocado o
     incompleto pasan igual.
   - Tampoco se ha probado la asociación figura-actividad en maquetaciones reales (dos columnas, figura antes de la consigna).
   - **No se autoriza ningún recorte automático.**

**Recomendación: INVESTIGAR MÁS**, sin integrar en producción. Siguiente paso, en este orden:
1. Reunir un corpus real autorizado de 20–30 escaneos sin datos de alumnado y ejecutar `--corpus`, con fichas de reserva que no se
   usen para ajustar umbrales.
2. Enderezar la página antes del prefiltro y medir de nuevo la condición girada.
3. Hacer robusto al grano el umbral de tinta del prefiltro.
4. Hacer un despliegue de prueba en Vercel para medir tiempo y memoria reales.

Si con el corpus real las etiquetas o las consignas fallan mucho, **descartar** antes de gastar en propuestas del modelo.

## Corpus real (cuando exista autorización)

- Los ficheros y `manifest.json` (formato en `corpus.template.json`, validado con Zod en `pages.ts`) se guardan **fuera del
  repositorio**.
- Las cajas son normalizadas, sobre la página tal como se muestra. La transcripción la hace una persona, línea por línea.
  `docType` agrupa los resultados.
- El informe se escribe dentro de la carpeta del corpus. No subir escaneos, transcripciones ni informes de un corpus real al
  repositorio.
- No deben contener nombres de alumnos ni datos personales. Solo material con permiso de uso.
