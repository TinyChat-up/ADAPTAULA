# Piloto OCR local — auditado en PR #32

Prototipo experimental aislado. `src/` no importa el piloto ni Tesseract (prueba de fronteras, incluidos subpaths). Tesseract
es una devDependency exacta; no se ha ejecutado un build/file tracing nuevo para certificar el bundle de Vercel. No cambia
Hacer magia, análisis v3, localizador de producción, PDF, UI, Supabase ni Stripe. **Nunca aprueba recortes automáticos.**

| Archivo | Función |
| --- | --- |
| `engine.ts` | Página con PSM 3 y deskew; glifos con PSM 8; presupuestos de píxeles, componentes, grupos y tiempo |
| `pages.ts` | 11 documentos sintéticos × 5 condiciones; corpus autorizado externo con rutas y límites validados |
| `metrics.ts` | Métricas de texto, anclas, etiquetas y candidatos; emparejamiento uno a uno |
| `run.ts` | Runner, informes sin transcripciones, estado de ejecución y publicación tras completar todas las páginas |
| `results/` | Evaluación sintética completa, `ocr_pilot@audit2`; no contiene materiales reales |
| `corpus.template.json` | Referencias humanas: orden de lectura, ancla por actividad, cajas y visuales |

## Ejecución local

Instalar dependencias con `pnpm install --frozen-lockfile`. Modelo español de `@tesseract.js-data/spa@1.0.0`, variante
`4.0.0_best_int` (2,1 MB), descargado una vez a `.cache/` ignorada por Git:

```bash
mkdir -p evals/ocr-pilot/.cache
curl -sSfL -o evals/ocr-pilot/.cache/spa.traineddata.gz \
  https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int/spa.traineddata.gz
pnpm eval:ocr
pnpm exec vitest run tests/unit/ocr-pilot-metrics.test.ts tests/unit/ocr-pilot-audit.test.ts tests/unit/ocr-pilot-loader.test.ts tests/unit/ocr-pilot-runtime.test.ts
```

SHA-256 verificado antes de crear workers: `40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb`.
El idioma se carga desde una ruta local absoluta con caché de Tesseract desactivada; el núcleo Node se resuelve desde los paquetes
instalados. Falta de modelo o SHA distinto = fallo, sin fallback de descarga. La evaluación completa se ejecutó con `fetch` y
conexiones HTTP/HTTPS/TCP/TLS bloqueadas mediante preload Node heredado por los workers. Sin llamadas remotas de reconocimiento.

**Licencia/procedencia:** Tesseract.js 7.0.0 y núcleo 7.0.0 declaran Apache-2.0; el paquete del idioma spa declara MIT y su
repositorio es [naptha/tessdata](https://github.com/naptha/tessdata). Su README describe `best_int` como versión integerizada de
Tessdata Best, cuyo upstream [tesseract-ocr/tessdata_best](https://github.com/tesseract-ocr/tessdata_best) tiene licencia Apache-2.0.
Conservar los avisos aplicables de ambas procedencias; el SHA fija los bytes, no sustituye esos avisos.

## Qué miden las cifras

- **Etiquetas:** solo el vocabulario de `isLabel` (dígitos/fracciones y una letra). Una detección OCR tiene una única asociación
  primaria. Se ordenan pares por distancia de centros ≤3 mm, luego índices de referencia/OCR; asociación voraz geométrica sin
  preferencia por el texto correcto. Los empates no prueban identidad: se resuelven de modo reproducible. La asociación voraz puede reducir recall en etiquetas muy próximas aunque exista otra asociación posible; revisar esos casos humanos aparte.
- **Duplicados:** una detección sobrante se atribuye una sola vez al vecino geométrico más próximo. Si repite su lectura se cuenta
  como duplicado; si discrepa, como espuria. Cada detección contribuye una vez al denominador de precisión. Letras de palabras
  corrientes solapadas con una frase de referencia se excluyen del problema de etiquetas aisladas.
- **Recall:** etiquetas correctas / etiquetas de referencia. **Precisión:** asociaciones correctas / detecciones de etiquetas,
  incluidos confusiones, duplicados y espurias. No demuestra pertenencia a un visual o actividad ni presencia del glifo correcto.
- **WER/CER:** distancia de edición / palabras o caracteres Unicode de referencia, con inserciones, borrados y sustituciones.
  Se publican errores y denominadores; `100 − WER/CER` puede ser negativo. Se excluyen solo guiones bajos de campos vacíos.
- **Orden:** OCR agrupa por altura y luego izquierda a derecha. Referencia sintética: cajas del original sin giro. Referencia real:
  array `texts` en el orden humano de lectura. Las columnas pueden penalizar el orden OCR y no están resueltas por el piloto.
- **Ancla correcta:** solapamiento con la primera caja de consigna y distancia de centros ≤3 mm en X e Y. Una caja parcial puede
  quedar fuera de tolerancia aunque sea de la consigna correcta: `wrong` significa fallo de este criterio, no prueba de confusión
  semántica. En corpus real `anchorTextIndex` es obligatorio, independiente del matcher evaluado. En sintéticos el ancla de
  referencia todavía se deriva con el matcher de producción, limitación orientativa.
- **Coordenadas:** cajas OCR vuelven al marco original mediante la inversa de la rotación. Se prueban ambos signos, resoluciones
  150/200/300 y cajas cerca del borde. Rotar una envolvente AABB y desrotarla conserva su centro, pero expande sus lados; no usar
  esa doble envolvente para reconstruir el orden de lectura. IoU compara tinta OCR con caja tipográfica humana/vectorial, no una
  identidad de glifos.
- **Candidatos:** propuestas guionizadas, no modelo multimodal. Unidad de recall: visual oráculo elegible; erróneos: ensayos de
  candidato (incluidos distractores/página). IoU ≥0,6 solo evalúa caja. El prefiltro #31 sigue bloqueando toda aprobación.

**55 páginas-condición proceden de 11 documentos base**, mayoritariamente células, Helvetica 11 pt y una columna. No son 55
muestras independientes ni un holdout. Los umbrales se ajustaron con estos mismos documentos; no calcular una precisión real
ni intervalos binomiales como si fueran observaciones independientes. El corpus real debe separarse por documento/origen, con
fichas de reserva sin ajustar reglas y revisión humana de cada etiqueta y actividad.

## Resultado anterior y posterior a la auditoría

Informe completo: [results/report.md](results/report.md), con recuentos/denominadores en [results/report.json](results/report.json).
Motor página + etiquetas, sobre los mismos sintéticos:

| Métrica | Publicado en 53ee15b | Auditoría |
| --- | --- | --- |
| Etiquetas recuperadas | 135/135 con asociación reutilizable | 135/135 con 135 detecciones, asociación uno a uno |
| Precisión de etiquetas | Sin denominador de detecciones | 135/135 en estos sintéticos |
| Anclas exactas dentro de tolerancia | 109/115, criterio vertical | 108/115, criterio en dos dimensiones |
| Anclas tolerantes dentro de tolerancia | 113/115 | 111/115 |
| WER / CER global | 3,9 % / 1,6 % implícitos | 4,0 % / 1,7 %, denominadores 2.120 palabras / 11.245 caracteres |
| Candidatos correctos / elegibles | 19/30; referencia 23/30 | 19/30; referencia 23/30 |
| Candidatos erróneos / recortes aprobados | 0 / 0 | 0 / 0 |

La asociación original fallaba en pruebas nuevas de etiquetas próximas/repetidas, detección intermedia, OCR duplicado y lectura
incorrecta junto a otra correcta. **No se demuestra inflación del 135/135 concreto**: sus etiquetas están suficientemente
separadas. Ese resultado se mantiene; no significa precisión del 100 % en fichas reales. La segunda pasada pierde etiquetas que
tocan líneas guía, excluye tamaños fuera de 1,8–6 mm y puede agrupar erróneamente glifos vecinos. Se prueban confusiones 1/I,
0/O y B/8 en las métricas; no se promete que el motor las resuelva. Una referencia sobre papel blanco invalida el corpus en vez de
convertirse en un fallo OCR; encontrar tinta tampoco demuestra que la etiqueta exista.

**Rendimiento medido en este contenedor:** 0,6–2,8 s/página con etiquetas; mediana global 1.166 ms. RSS completo (pdf.js, canvas,
workers): 124 MB antes, 235 MB cargado, pico muestreado 1.089 MB. 171 llamadas de etiquetas, máximo 18/página, además de una llamada
de página. Tesseract.js 1,4 MB + núcleo 45,3 MB (6 variantes, una cargada) + idioma 2,1 MB. No comparar velocidad con los 1,2–4,9 s
del contenedor anterior como efecto de la corrección. No se ha probado Vercel, ni tracing del WASM/modelo, ni consumo máximo real.

En giro, el OCR reconoce texto pero el prefiltro en el marco sin enderezar conserva cobertura 1/6 (referencia 5/6). Con grano fuerte
el prefiltro falla incluso con referencia (0/6): problema geométrico distinto de reconocimiento. No se modifica ese localizador.

## Recursos y fallos

Un nuevo fixture de 1.024 formas de glifo (patrón de papel de seguridad/ruido estructurado) supera el presupuesto antes de llamar
al OCR de etiquetas. Antes podía desencadenar más de mil reconocimientos y búsqueda cuadrática sin límite.

Límites del motor: 12 millones de píxeles, 20.000 componentes, 512 glifos y 64 llamadas de etiqueta/página. El recorrido de píxeles
es lineal; la agrupación por búsqueda sigue siendo cuadrática, acotada a 512 glifos. Componentes grandes descartan su lista de
píxeles durante el recorrido y las motas pequeñas no se retienen. Máscara y stack tipado cuestan unos 5 bytes/píxel además del
raster, glifos retenidos, canvas y WASM. El RSS observado **no es una cota garantizada**.

Presupuestos: 30 s de reconocimiento de página +30 s para toda la pasada de etiquetas, con terminación de workers ante timeout;
10 minutos entre etapas para la ejecución completa. Decodificación PDF/native y trabajo síncrono no son preemptibles por ese
reloj. Ejecutar el piloto en un proceso local aislado con límite de memoria/tiempo del sistema, por ejemplo:

```bash
timeout --kill-after=10s 10m pnpm eval:ocr -- --corpus /ruta/externa/corpus
```

Antes de procesar se invalidan informes anteriores y `run-status.json` pasa a `running`. Solo al completar todas las páginas se
publican los informes y el estado `complete`. Fallo gestionado: `failed`, sin informes parciales. Si se mata el proceso, `running`
indica ejecución incompleta; no usar archivos temporales ni resultados de una ejecución sin estado completo.

## Corpus real autorizado: requisitos

1. Material con permiso de uso, sin datos personales; revisión humana previa. Ningún documento privado se utilizó en esta auditoría.
2. Corpus y manifiesto fuera de cualquier checkout Git, en un directorio local de confianza sin modificaciones concurrentes.
   El loader rechaza rutas absolutas, `..`, separadores Windows y enlaces de archivos/manifiesto que salgan del corpus. El destino
   `results/` no admite symlinks. `.gitignore` protege adicionalmente `.cache/` y una carpeta `private/` accidental.
3. PNG/JPEG/PDF: ≤20 MB/archivo, ≤30 páginas/documento, ≤150 páginas anotadas; manifiesto ≤2 MB. Imágenes ≤6.000 px/lado y ≤12 Mpx
   antes de decodificar; raster PDF ≤4.000 px/lado y ≤12 Mpx. Cajas dentro de página, IDs únicos, referencias íntegras; ≤10.000 caracteres Unicode y ≤2.000 palabras por lado en las métricas de edición. Estos controles
   no eliminan todos los riesgos de PDFs comprimidos: comenzar con PNG/JPEG saneados y mantener aislamiento/quotas del proceso.
4. `texts`: transcripción humana en orden de lectura con cajas normalizadas sobre el raster mostrado; cada actividad fija
   `anchorTextIndex` e `instructionTextIndices` (índices desde cero para ancla y líneas de esa consigna, sin tomar las de otro ejercicio). Dos revisores deben comprobar etiquetas, integridad, pertenencia y distractores.
   El vocabulario de etiquetas y la altura física soportada son acotados; registrar casos excluidos, no borrarlos para mejorar recall.
5. Informes reales: solo números, estados, IDs de actividad validados y códigos de comprobación. IDs de página/tipo se sustituyen por
   ordinales; caracteres de etiquetas, lecturas OCR, respuestas y transcripciones no se escriben. Logs muestran progreso ordinal;
   errores CLI son genéricos. No subir corpus ni sus informes a Git. El manifiesto sigue siendo sensible y requiere controles locales.

**MERGE como piloto experimental**, con estas restricciones. Siguiente paso rentable: 20–30 fichas reales autorizadas, anotadas y
separadas por origen, con reserva independiente; medir OCR y candidatos, sin integrar en Hacer magia ni pagar propuestas de modelos.
