# Propuesta auditada · Ubicación de figuras en escaneos (Fase 8.2B.7)

Estado: **propuesta con prototipo aislado; no activada en producción.** Fecha: 2026-10-14. Base: `main` en `f827001`, con la PR #30
integrada. Prototipo y pruebas: `evals/visual-location/` y `tests/unit/visual-location-prototype.test.ts`. No se ha llamado a ningún
modelo real. Auditoría de PR #31: el prototipo original aceptaba recortes semánticamente incorrectos. El prototipo corregido solo
emite candidatos diagnósticos y **no aprueba recortes**. Todas las cifras de coste y latencia que no digan «medido» son estimaciones.

## 1. Punto de partida

Lo que hay hoy (contrato `auto_visuals@v5`, ADR-027):

- **Análisis.** `MaterialAnalysis` v3 guarda de cada visual la página, el tipo, el papel, la descripción y las actividades que lo
  usan. **No guarda posición.** El analizador ya recibe el PDF o la imagen completa en **una** llamada multimodal
  (`materials/analysis-job.ts`).
- **Localizador automático** (`auto/locate.ts`). Ancla cada figura a la consigna impresa de su actividad, que encuentra en la capa
  de texto del PDF. La figura tiene que estar en la zona de esa actividad, ser única y salir en un recorte limpio. Firma de forma
  solo para barra y recta numérica. La visión (`visual_locator@v1`, una llamada por página, máximo 3) solo **suma acuerdo** sobre
  una región que la geometría ya encontró.
- **Escaneos.** No tienen capa de texto, así que no hay ancla: se rechazan siempre. El experimento de la PR #30, que buscaba
  «figura única sin ancla», aceptó a 0,75 letras, logotipos, consignas y figuras sin sus etiquetas (fixtures A–J de
  `docs/qa/pr30/`). Se retiró.
- **Procedencia (PR #30).** Cada recorte exige un localizador completo, el SHA del original, un motor conocido, ancla y zona, y una
  relación íntegra entre el activo, el localizador, la receta y la ruta. Esta propuesta **conserva todas esas garantías**.

**Diagnóstico.** OCR local puede aportar anclas de ubicación independientes en implementación del modelo, pero su salida procede
de los mismos píxeles, puede perder consignas o desplazar cajas y no demuestra que el dibujo sea la figura requerida. El análisis
que propone la caja y transcribe la consigna es una sola fuente correlacionada.

## 2. Arquitectura recomendada

**Proponer en el análisis y generar candidatos con OCR local; mantener la aprobación bloqueada hasta disponer de evidencia
semántica suficiente:**

1. **Propuesta (enfoque A).** El análisis inicial, que ya ve todas las páginas, devuelve para cada visual imprescindible:
   - su página y una región candidata;
   - una descripción identificativa;
   - la actividad a la que pertenece;
   - las etiquetas que deben conservarse (por ejemplo «1», «2», «3» o «A», «B»);
   - los elementos internos (texto libre);
   - sus propias dudas.

   No añadiría una llamada explícita si la ampliación del análisis funcionase en el intento existente. Sí añade tokens de entrada y
   salida, puede cambiar reintentos y latencia; hay que medirlo. Todo es una afirmación del modelo.
2. **Capa de texto.** El PDF nativo usa la suya. Un escaneo o una foto pasa por OCR local (por ejemplo Tesseract en WASM; por
   decidir), con el texto normalizado y la página enderezada. Se cachea por (`source_sha256`, página, versión del OCR).
3. **Prefiltro determinista.** Reutiliza `activityAnchors`, `activityZones`, `candidates` y `shapes.ts`. Puede producir una región
   geométrica del servidor para revisión o análisis, pero **no autoriza su uso**. Forma, ancla y etiquetas no verifican identidad,
   partes ausentes ni respuestas dibujadas. Una comprobación no verificable bloquea el recorte.
4. **Recorte futuro.** Exigir la región del servidor y todas las garantías de procedencia de PR #30. La clave de caché debe incluir
   versión del original, análisis, prompt, OCR y verificador. El prototipo solo compara dos hashes suministrados por el llamador;
   no calcula ni valida el SHA de los bytes persistidos.
5. **Hacer magia** no cambia de flujo. Consume recortes ya verificados. Si falta uno imprescindible, la parada honesta sigue igual.

Esto es una hipótesis para evaluar, no una arquitectura aprobada. La selección humana existente sigue siendo el camino viable
cuando la comprobación automática no puede identificar con seguridad la figura.

## 3. Alternativas comparadas

| Criterio | **A · En el análisis inicial** | **B · Bajo demanda en Hacer magia** | C · Detector sin modelo (PR #30) | D · El modelo verifica su propuesta |
| --- | --- | --- | --- | --- |
| Llamadas extra | 0 (la misma llamada) | 1 por página con figura pendiente (máximo 3) | 0 | ≥ 1 |
| Coste marginal estimado | ≈ 0,001 USD por visual (salida) | ≈ 0,005–0,006 USD por página | 0 | Como B |
| Latencia en Hacer magia | 0 (se calcula al analizar) | +3–8 s por página (estimado), en el camino crítico | ≈ 1–3 s de CPU | +3–8 s |
| Reutilización | Por versión del material, para todas las adaptaciones | Por versión del material (caché de la ejecución) | Total | — |
| Contexto del modelo | Documento completo y su propio análisis: coherencia entre visual y actividad | Una página y descripciones resumidas | Ninguno | — |
| Trazabilidad | `ai_runs` del análisis + evidencia de propuesta (no certificación) | `ai_runs` propio + evidencia | Evidencia de píxeles | Circular |
| Riesgo principal | Coordenadas imprecisas de un modelo que ve el PDF a baja resolución | Coste y latencia en cada adaptación; más superficie de llamada | Falsos positivos demostrados (A–J) | **No es verificación independiente** |
| Decisión | Probar sin activarlo como fuente de recortes | Se conserva solo el *fallback* existente para PDF nativos | Descartado | Descartado |

**Por qué A es solo hipótesis.** Aprovecha el análisis existente, pero una caja de baja resolución puede fallar. Aumentar la
resolución también aumenta coste y latencia, y el análisis que afirma la relación visual-actividad puede estar equivocado.

**Por qué no C.** La PR #30 demostró que «la única mancha grande» no identifica nada.

**Por qué no D.** Que el mismo modelo, u otro de la misma familia, confirme su propia caja no aporta una evidencia distinta.

## 4. Contrato de aceptación

Contrato tipado: `evals/visual-location/contract.ts`. `candidate` solo significa que pasaron las once comprobaciones geométricas
y léxicas. `crop` permanece nulo y la decisión es `blocked` mientras `semantic_identity`, `complete_content` o
`visual_answer_safety` sean `unverifiable`. No existe evidencia para cambiar estos tres estados en este prototipo.

| Comprobación | Qué se exige | Evidencia independiente del modelo |
| --- | --- | --- |
| `provenance` | Dos SHA recibidos coinciden; la página y región son válidas | Solo igualdad de argumentos en el prototipo; la producción debe comprobar bytes persistidos |
| `text_layer` | La página tiene capa de texto (PDF u OCR local) | Algoritmo distinto del modelo |
| `activity_anchor` | La consigna transcrita por el análisis coincide con una caja OCR | Corroboración parcial; si falta otra consigna OCR, la zona se expande |
| `placement` | El centro está en la zona inferida de esa actividad | Geometría condicionada por la integridad del OCR; no prueba pertenencia |
| `snap` | La caja propuesta cae sobre un dibujo que encontró el servidor (IoU ≥ 0,5); el recorte es del servidor | Píxeles |
| `uniqueness` | No hay otro dibujo de tamaño comparable en la zona, ni otra propuesta sobre el mismo dibujo | Píxeles; reglas y grupos de reglas excluidos |
| `integrity` | Ningún trazo detectado cruza el borde y el candidato no toca la página | Píxeles; no detecta partes borradas o ausentes |
| `labels` | Las etiquetas declaradas o nombradas tienen cajas OCR dentro | OCR; no prueba que el glifo esté visible ni sea correcto |
| `foreign_text` | No hay texto corrido dentro (consigna, otra actividad, campos del alumno) | OCR |
| `answer_leak` | No coincide una palabra de ≥4 letras de la respuesta esperada con texto cercano | Cribado léxico parcial; respuesta del propio análisis |
| `identity_evidence` | Firma de forma o etiquetas nombradas dentro | Solo morfología; no contenido semántico |
| `semantic_identity` | Contenido correcto y figura de esta actividad | **No verificable** con estas fuentes |
| `complete_content` | Todas las partes necesarias sobreviven | **No verificable** para partes ausentes sin etiqueta |
| `visual_answer_safety` | No revela la solución mediante dibujo, número o marca | **No verificable** con cribado léxico |

Las cinco propiedades son distintas: **ubicación** puede tener un candidato; **pertenencia** queda condicionada a todos los
anclajes; **identidad semántica**, **integridad pedagógica** y **ausencia de respuesta visual** siguen sin comprobarse. Los
`required_elements` son texto libre del mismo modelo y no se verifican. Por ello, también se bloquean barras y células con
etiquetas, aunque la geometría pase.

**Versionado y caché.** La clave es (`material_id`, `source_sha256`, `analysis_fingerprint`, versión del prompt, versión del OCR,
`VERIFIER_VERSION`). Si cambia cualquiera, se revalida. Un recorte anterior que el verificador vigente no vuelve a aceptar no se usa
(mismo criterio que `auto_not_revalidated`). No se modifica `MaterialAnalysis` v3: un experimento futuro usaría un sidecar versionado
ligado a material y SHA, o un esquema nuevo con lector de v3 y ausencia de propuesta = bloqueo. Nunca interpretar datos v3 como
ubicaciones verificadas.

## 5. Prototipo aislado y pruebas

Está en `evals/visual-location/` y no lo importa ningún módulo de `src/`. No hay migraciones, llamadas, OCR real ni cambios en
Hacer magia. Contiene:

- `fixtures.ts`: 11 hojas sintéticas con verdad conocida, «escaneadas» (raster con grano, tono de papel, sombra y rotación
  opcional). La capa de texto que recibe el verificador es la del PDF vectorial, transformada como los píxeles: representa un **OCR
  perfecto**. `ocrLoss` elimina cajas cortas para simular un OCR débil.
- `verify.ts`: el verificador del contrato.
- `harness.ts`: propuestas guionizadas que hacen el papel del modelo (correcta, desplazada, distractor, página entera, caja de otro
  visual) y métricas de falsos positivos, falsos negativos y cobertura.

| Caso | Propuesta correcta | Motivo |
| --- | --- | --- |
| Célula con etiquetas 1, 2 y 3 | Candidato, recorte bloqueado | Etiquetas no prueban identidad ni partes internas |
| Dos figuras similares en la misma zona | Bloqueada | `uniqueness` |
| Figura decorativa grande en la cabecera | Célula candidata; la flor sin candidato | `placement`, `uniqueness` |
| Rótulo enorme junto a la figura | Célula candidata; el rótulo sin candidato | `snap`: el texto está enmascarado |
| Figura que se sale del borde | Bloqueada | `integrity` |
| Etiquetas a más de 1 cm | Bloqueada | `labels`: quedarían fuera |
| Figura en la zona de otra actividad | Bloqueada | `placement` |
| Escaneo con ruido, sombra y rotación de 1,5° | Candidato, recorte bloqueado | Simulación OCR derivada del vector; no prueba OCR real |
| Tres actividades y dos figuras | Dos candidatas; las cajas cruzadas sin candidato | Firma de barra; etiquetas A y B |
| Documento sin la figura | Bloqueada | `snap` |
| Rótulo que da la respuesta («núcleo») | Bloqueada | `answer_leak` |

Resultados de los fixtures originales: 42 propuestas guionizadas, 6 visuales oráculo elegibles. El prototipo anterior aceptaba
6/6 de esos visuales, sin errores *en el conjunto con el que se ajustó*. Cuatro contraejemplos nuevos demostraron aceptación
indebida: núcleo borrado, barra 5/8 en vez de 3/8, figura de otra actividad tras perder su ancla OCR y etiqueta ausente en píxeles
pero presente en OCR. El prototipo corregido emite candidatos diagnósticos cuando pasan sus 11 filtros, pero **0 recortes
aceptados** y cobertura automática **0/6** por los tres controles no verificables. Cero falsos positivos por bloquear todo no es
una estimación de precisión. La degradación `ocrLoss` solo elimina cajas cortas; no representa las confusiones y desplazamientos
de un OCR real. Las pruebas nuevas incluyen confusión `1/I`, duplicación y desplazamiento de cajas OCR.

**Advertencia.** El verificador se ajustó con estos mismos fixtures, en tres correcciones:
- una caja de verdad mal escrita;
- la fuga de respuesta en los rótulos adyacentes;
- las líneas de respuesta torcidas.

Estas cifras son **pruebas de regresión del contrato, no una estimación de precisión real**. Tampoco miden si un modelo propone
bien.

## 6. Riesgos que siguen sin resolver

> **Piloto OCR local (2026-10-14, [`evals/ocr-pilot`](../../evals/ocr-pilot/README.md)).** Tesseract 5 en WASM sobre los
> píxeles de los 11 fixtures **sintéticos**, en 5 condiciones de escaneo.
> - La pasada de página pierde todas las etiquetas aisladas. Una segunda pasada por glifo recupera 135 de 135, sin confusiones
>   `1/I` u `0/O`.
> - Consignas: 109/115 con ancla exacta y 0 mal asignadas.
> - Candidatos con caja humana: 19/30, frente a 23/30 con la capa de referencia.
> - Lo girado falla por integración: hay que enderezar antes del prefiltro.
> - Lo degradado falla también en el prefiltro: su umbral de tinta no tolera el grano.
>
> Nada de esto está validado con escaneos reales ni en Vercel. Recomendación: **investigar más**. Los riesgos siguientes siguen
> abiertos para documentos reales.

- **OCR real.**
  - Dígitos sueltos y letras de etiqueta: el OCR los lee peor que el texto corrido, y cada etiqueta perdida bloquea (falso
    negativo).
  - Letra manuscrita: fuera de alcance.
  - Confusión `1/I` o `0/O`, cajas duplicadas, desplazadas o contradictorias; el OCR sintético actual recibe cajas perfectas
    transformadas junto a los píxeles, por lo que no prueba estas garantías. Una caja errónea puede simular una etiqueta existente.
  - Rotaciones mayores de 2–3° sin enderezar y variaciones de escala; solo existe un caso sintético de 1,5°.
  - Tamaño y memoria del motor en Vercel. Nada de esto está medido.
- **Maquetación.** Las zonas van de una consigna reconocida a la siguiente, a todo lo ancho. En dos columnas, consignas próximas,
  figuras antes de la consigna, gráfico y texto mezclados, o un ancla OCR omitida, la zona puede incluir figuras ajenas; no siempre
  se produce un rechazo geométrico. No hay garantía de asociación visual-actividad.
- **Identidad semántica.** Dos dibujos distintos con los mismos números, un adorno dentro de la zona o una barra con sombreado
  incorrecto pueden pasar el prefiltro. Etiquetas y firma de forma no demuestran contenido.
- **Calidad de las coordenadas del modelo** viendo el PDF dentro del análisis. Si sus cajas no caen con IoU ≥ 0,5, el enfoque A no
  aporta y habría que valorar B. Desconocido.
- **Fugas de respuesta.** La comprobación es léxica y se apoya en la respuesta esperada del mismo análisis: no detecta una
  solución dibujada, un número, una flecha o una casilla marcada.
- **Coste de revalidar** al cambiar la versión del OCR o del verificador: se repite el trabajo de CPU, no llamadas.

## 7. Decisiones pendientes (sin ADR todavía)

1. **Motor de OCR local.** Para el experimento: tesseract.js 7 (Apache-2.0, WASM, devDependency aislada); medido en el piloto
   (47 MB, 1,2–4,9 s/página en 4 vCPU, pico de proceso ≈1,1 GB). Falta medirlo en Vercel y con escaneos reales.
2. **Contrato del análisis.** Sidecar versionado o v4 con lector de v3, sin convertir propuestas anteriores en recortes válidos;
   medir tokens, latencia, errores y resolución. El análisis actual registra llamadas e intentos; una extensión no garantiza que
   se mantenga una sola llamada efectiva.
3. **Alcance del contrato.** Mantener intacto el localizador de PDF nativos mientras no exista una verificación independiente
   suficiente para los escaneos.
4. **Qué hacer con un bloqueo.** Mantener la parada (recomendado) o pedir al docente que confirme la propuesta. Esto último sería
   una decisión de producto, no técnica.

Solo se escribirá un ADR cuando el experimento de la sección 9 dé un resultado.

## 8. Medición

- **Verdad humana:** por figura imprescindible, anotar actividad, página, caja, partes y etiquetas necesarias, legibilidad,
  respuestas visibles y posible contaminación del recorte. Dos revisores resuelven desacuerdos antes de evaluar; incluir negativos
  (adornos y figuras de otra actividad). El umbral IoU de 0,6 solo comprueba caja, no integridad.
- **Unidades y denominadores:** los intentos son *propuestas* (puede haber varias por figura); la cobertura se mide por *figura
  imprescindible*; los incidentes de entrega también por *material*. Informar numerador y denominador por separado: candidatos,
  recortes aceptados, aceptados incorrectos, figuras elegibles bloqueadas y materiales con algún error. Etiquetas: integridad por
  figura con todas las etiquetas presentes en el raster, no solo cajas OCR.
- **Incertidumbre:** 0 errores entre 60 aceptados da límite superior binomial unilateral 95 %
  `1 - 0,05^(1/60) = 4,87 %`, bajo independencia. Fichas de un mismo origen no son independientes; estratificar por tipo y
  reportar también intervalo por material. Una muestra pequeña con 0 errores no prueba seguridad absoluta.

## 9. Experimento real mínimo

El siguiente experimento **no requiere gasto API**: reunir, con permiso para su uso, un piloto de 20–30 escaneos reales sin datos
del alumnado de distinta maquetación; fijar anotaciones humanas de figuras, actividad, etiquetas, partes y respuestas; instalar
un OCR local fuera de producción y ejecutar solo el prefiltro con cajas oráculo, sin generar ni servir recortes automáticos. Medir
recuerdo de candidatos, errores de anclaje/OCR, tiempo y memoria por página, por tipo de ficha. Mantener aparte fichas que no se
utilicen para ajustar reglas. Si el OCR y las zonas fallan mucho, parar aquí. Esta fase no puede medir precisión de propuestas de
un modelo ni tasa de recortes seguros.

Una eventual prueba pagada requeriría autorización aparte y un mecanismo justificable para verificar identidad, integridad y
fuga visual. Para un objetivo ilustrativo de ≥60 aceptados y cobertura ≥40 %, hacen falta **al menos 150 figuras elegibles**;
30 fichas/60 figuras no bastan. Predefinir un conjunto de evaluación independiente con diversidad de fuentes y materiales,
congelar reglas antes de usarlo, y exigir 0 errores observados en ≥60 aceptados, cota superior unilateral <5 % solo bajo el
supuesto de independencia, cobertura ≥40 % con intervalo y cero incidentes por material en esa muestra. Estos son filtros para
decidir si ampliar investigación, **no autorización automática para producción**.

## 10. Coste estimado por material

Ninguna cifra está medida para este flujo. Base: precio STANDARD registrado en `ai/costs.ts`, 2 USD/M de entrada y 10 USD/M de
salida; análisis **medido** de 0,043–0,058 USD por material (`COSTS.md`).

| Componente | Estimación | Supuesto |
| --- | --- | --- |
| A · campos de ubicación en el análisis | ≈ +0,0008–0,0012 USD por visual de salida +0,0006 USD por material de instrucciones; para 2–4 figuras ≈0,0022–0,0054 USD/material | 80–120 tokens de salida por visual a 10 USD/M + ~300 tokens de entrada a 2 USD/M; sin reintentos ni imágenes de mayor resolución |
| B · llamada de visión por página | ≈ 0,005–0,006 USD por página; ≤ 0,017 USD por material | ~1.300 tokens de imagen (página a 100 ppp) + 400 de texto + 200 de salida |
| OCR local | 0 USD de API; 0,6–2,8 s por página **medido** en la auditoría del piloto sobre fixtures (contenedor local, no en Vercel) | tesseract.js, página a 150–300 ppp, más la pasada de etiquetas |
| Verificador | Despreciable; < 1 s por página | Medido solo en el prototipo, sobre fixtures |
| Experimento (fase 2) | ≈ 1,5–3 USD en total | 30 reanálisis de 0,05–0,10 USD |

Estas cifras omiten reintentos, ampliación de imagen y costes de CPU; deben medirse contra el prompt anterior con el mismo corpus.
La opción A no obliga a añadir una llamada en Hacer magia si el análisis y OCR terminan antes, pero puede aumentar su latencia
inicial y la tasa de reintentos. No cambia el comportamiento de producción en esta PR.

Auditoría PR #32: el piloto usa asociación uno a uno, anclas con criterio en X/Y y corpus real con referencia humana explícita.
135/135 se mantiene sobre 11 documentos sintéticos ×5 condiciones dependientes, sin evidenciar precisión real. Ver [límites,
privacidad y requisitos de corpus](../../evals/ocr-pilot/README.md). No se autoriza integrar OCR ni aprobar recortes.
