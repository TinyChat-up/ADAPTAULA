# Propuesta · Identificación fiable de figuras en escaneos (Fase 8.2B.7)

Estado: **propuesta con prototipo aislado; no activada en producción.** Fecha: 2026-10-14. Base: `main` en `f827001`, con la PR #30
integrada. Prototipo y pruebas: `evals/visual-location/` y `tests/unit/visual-location-prototype.test.ts`. No se ha llamado a ningún
modelo real. Todas las cifras de precisión, coste y latencia que no digan «medido» son **estimaciones**.

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

**Diagnóstico.** Al escaneo no le falta un detector de manchas mejor. Le falta **una evidencia de «qué actividad» que no venga del
modelo que propone**. En un PDF nativo esa evidencia es la capa de texto. En un escaneo puede serlo una capa de texto obtenida por
**OCR local**: un algoritmo distinto, determinista y sin coste por llamada.

## 2. Arquitectura recomendada

**Proponer en el análisis, anclar con OCR local y aceptar por contrato:**

1. **Propuesta (enfoque A).** El análisis inicial, que ya ve todas las páginas, devuelve para cada visual imprescindible:
   - su página y una región candidata;
   - una descripción identificativa;
   - la actividad a la que pertenece;
   - las etiquetas que deben conservarse (por ejemplo «1», «2», «3» o «A», «B»);
   - los elementos internos (texto libre);
   - sus propias dudas.

   No añade ninguna llamada. Todo es una afirmación del modelo.
2. **Capa de texto.** El PDF nativo usa la suya. Un escaneo o una foto pasa por OCR local (por ejemplo Tesseract en WASM; por
   decidir), con el texto normalizado y la página enderezada. Se cachea por (`source_sha256`, página, versión del OCR).
3. **Verificación determinista.** Reutiliza `activityAnchors`, `activityZones`, `candidates` y las firmas de `shapes.ts`. Acepta
   solo si **todas** las comprobaciones de la sección 4 se verifican. **No hay puntuación**: una comprobación fallida o no
   verificable bloquea.
4. **Recorte.** Siempre la **región del servidor**, nunca la caja del modelo. Se guarda con la receta `visual_crop@v1`, el
   localizador `auto` y la evidencia por comprobación. Las garantías de la PR #30 siguen vigentes, y la clave de caché añade la
   versión del prompt y del verificador.
5. **Hacer magia** no cambia de flujo. Consume recortes ya verificados. Si falta uno imprescindible, la parada honesta sigue igual.

No es una segunda arquitectura. Cambian dos cosas del motor existente:
- hay una capa de texto más, la del OCR;
- la propuesta pasa a estar disponible desde el análisis, en lugar de aparecer solo como hipótesis de visión tardía.

## 3. Alternativas comparadas

| Criterio | **A · En el análisis inicial** | **B · Bajo demanda en Hacer magia** | C · Detector sin modelo (PR #30) | D · El modelo verifica su propuesta |
| --- | --- | --- | --- | --- |
| Llamadas extra | 0 (la misma llamada) | 1 por página con figura pendiente (máximo 3) | 0 | ≥ 1 |
| Coste marginal estimado | ≈ 0,001 USD por visual (salida) | ≈ 0,005–0,006 USD por página | 0 | Como B |
| Latencia en Hacer magia | 0 (se calcula al analizar) | +3–8 s por página (estimado), en el camino crítico | ≈ 1–3 s de CPU | +3–8 s |
| Reutilización | Por versión del material, para todas las adaptaciones | Por versión del material (caché de la ejecución) | Total | — |
| Contexto del modelo | Documento completo y su propio análisis: coherencia entre visual y actividad | Una página y descripciones resumidas | Ninguno | — |
| Trazabilidad | `ai_runs` del análisis + evidencia por comprobación | `ai_runs` propio + evidencia | Evidencia de píxeles | Circular |
| Riesgo principal | Coordenadas imprecisas de un modelo que ve el PDF a baja resolución | Coste y latencia en cada adaptación; más superficie de llamada | Falsos positivos demostrados (A–J) | **No es verificación independiente** |
| Decisión | **Recomendado** como fuente de propuestas | Se conserva solo el *fallback* de visión existente para PDF nativos | Descartado | Descartado |

**Por qué no B como vía principal.** Añade coste y latencia a cada adaptación. Además ve menos contexto que el análisis, que ya
relacionó cada visual con su actividad. La ventaja de B (una resolución de página controlada) también se consigue en A si se le
envían las imágenes de página a la resolución adecuada. Esto es una decisión pendiente; ver la sección 7.

**Por qué no C.** La PR #30 demostró que «la única mancha grande» no identifica nada.

**Por qué no D.** Que el mismo modelo, u otro de la misma familia, confirme su propia caja no aporta una evidencia distinta.

## 4. Contrato de aceptación

Contrato tipado: `evals/visual-location/contract.ts` (`FigureProposalSchema`, `VerificationReport`). Cada comprobación termina en
`verified`, `failed` o `unverifiable`, y solo `verified` en **todas** acepta.

| Comprobación | Qué se exige | Evidencia independiente del modelo |
| --- | --- | --- |
| `provenance` | SHA del original de la propuesta = SHA almacenado; la página existe; la región es válida | Hash de los bytes; recuento de páginas |
| `text_layer` | La página tiene capa de texto (PDF u OCR local) | Algoritmo distinto del modelo |
| `activity_anchor` | La consigna de la actividad (según el análisis) aparece impresa en esa página | Coincidencia entre la transcripción del modelo y el OCR: dos fuentes |
| `placement` | La región del servidor está en la zona de su actividad y no en la de otra | Geometría del texto |
| `snap` | La caja propuesta cae sobre un dibujo que encontró el servidor (IoU ≥ 0,5); el recorte es del servidor | Píxeles |
| `uniqueness` | No hay otro dibujo de tamaño comparable en la zona, ni otra propuesta sobre el mismo dibujo | Píxeles; reglas y grupos de reglas excluidos |
| `integrity` | Ningún trazo cruza el borde del recorte y el dibujo no toca el borde de la página | Píxeles |
| `labels` | Las etiquetas que afirma la propuesta **y** las que nombra la consigna («números 1, 2 y 3») están impresas dentro del recorte | OCR + texto del análisis |
| `foreign_text` | No hay texto corrido dentro (consigna, otra actividad, campos del alumno) | OCR |
| `answer_leak` | Ninguna palabra de la respuesta esperada aparece en el recorte ni en sus rótulos (a 10 mm o menos) | OCR + respuesta del análisis |
| `identity_evidence` | Firma de forma (barra, recta numérica) **o** las etiquetas que nombra la consigna dentro del dibujo | Píxeles u OCR |

**Lo que sigue siendo hipótesis.**
- Que una figura genérica «sea una célula».
- Los `required_elements` sin etiqueta.
- Que un dibujo sin etiquetas esté completo en lo que no se ve.

Por eso una figura genérica **sin etiquetas nombradas por la consigna queda bloqueada** (`identity_evidence: unverifiable`). Su
única prueba sería su posición, y eso no basta.

**Versionado y caché.** La clave es (`material_id`, `source_sha256`, `analysis_fingerprint`, versión del prompt, versión del OCR,
`VERIFIER_VERSION`). Si cambia cualquiera, se revalida. Un recorte anterior que el verificador vigente no vuelve a aceptar no se usa
(mismo criterio que `auto_not_revalidated`).

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
| Célula con etiquetas 1, 2 y 3 | Aceptada | Todas las comprobaciones verificadas |
| Dos figuras similares en la misma zona | Bloqueada | `uniqueness` |
| Figura decorativa grande en la cabecera | Célula aceptada; la flor, bloqueada | `placement`, `uniqueness` |
| Rótulo enorme junto a la figura | Célula aceptada; el rótulo, bloqueado | `snap`: el texto está enmascarado |
| Figura que se sale del borde | Bloqueada | `integrity` |
| Etiquetas a más de 1 cm | Bloqueada | `labels`: quedarían fuera |
| Figura en la zona de otra actividad | Bloqueada | `placement` |
| Escaneo con ruido, sombra y rotación de 1,5° | Aceptada | Las líneas de respuesta torcidas no cuentan como rival |
| Tres actividades y dos figuras | Las dos aceptadas; las cajas cruzadas, bloqueadas | Firma de barra; etiquetas A y B |
| Documento sin la figura | Bloqueada | `snap` |
| Rótulo que da la respuesta («núcleo») | Bloqueada | `answer_leak` |

Resultados (`pnpm exec vitest run tests/unit/visual-location-prototype.test.ts`, 15 pruebas PASS):

- **OCR perfecto:** 42 propuestas, 0 falsos positivos, 0 falsos negativos, cobertura 6/6 visuales aceptables.
- **OCR que pierde la mitad de las cajas cortas:** 0 falsos positivos y 5 falsos negativos (cobertura 1/6). El sistema se degrada
  bloqueando, no aceptando de más.

**Advertencia.** El verificador se ajustó con estos mismos fixtures, en tres correcciones:
- una caja de verdad mal escrita;
- la fuga de respuesta en los rótulos adyacentes;
- las líneas de respuesta torcidas.

Estas cifras son **pruebas de regresión del contrato, no una estimación de precisión real**. Tampoco miden si un modelo propone
bien.

## 6. Riesgos que siguen sin resolver

- **OCR real.**
  - Dígitos sueltos y letras de etiqueta: el OCR los lee peor que el texto corrido, y cada etiqueta perdida bloquea (falso
    negativo).
  - Letra manuscrita: fuera de alcance.
  - Rotaciones mayores de 2–3° sin enderezar.
  - Tamaño y memoria del motor en Vercel. Nada de esto está medido.
- **Maquetación.** Las zonas van de una consigna a la siguiente, a todo lo ancho. Dos columnas, figuras compartidas entre
  actividades o una figura antes de su consigna fallan, y bloquean.
- **Identidad semántica.** Una figura genérica sin etiquetas nombradas no se puede aceptar. Es una limitación deliberada, no un
  error que vaya a desaparecer.
- **Calidad de las coordenadas del modelo** viendo el PDF dentro del análisis. Si sus cajas no caen con IoU ≥ 0,5, el enfoque A no
  aporta y habría que valorar B. Desconocido.
- **Fugas de respuesta.** La comprobación es léxica: no detecta una solución dibujada (una flecha, una casilla marcada).
- **Coste de revalidar** al cambiar la versión del OCR o del verificador: se repite el trabajo de CPU, no llamadas.

## 7. Decisiones pendientes (sin ADR todavía)

1. **Motor de OCR local.** Licencia, tamaño, memoria y latencia en Vercel. Medirlo antes de elegir.
2. **Contrato del análisis.** Cómo ampliar `MaterialAnalysis` (v4, campo opcional `location` por visual) sin romper el v3
   almacenado, y con qué resolución se envían las páginas al analizador.
3. **Alcance del contrato.** Si sustituye también a la puntuación del localizador en PDF nativos, o solo se aplica a páginas sin
   texto.
4. **Qué hacer con un bloqueo.** Mantener la parada (recomendado) o pedir al docente que confirme la propuesta. Esto último sería
   una decisión de producto, no técnica.

Solo se escribirá un ADR cuando el experimento de la sección 9 dé un resultado.

## 8. Medición

- **Verdad:** caja y etiquetas de cada figura imprescindible, anotadas por una persona con el localizador humano existente.
- **Falso positivo:** recorte aceptado que no es la figura verdadera (IoU < 0,6), que pierde una etiqueta o que contiene una
  respuesta. **Objetivo: 0.** Con 0 errores en *n* aceptados, el límite superior al 95 % es ≈ 3/*n* (regla del tres), así que
  hacen falta ≥ 60 aceptados para afirmar «< 5 %».
- **Falso negativo:** figura verificable a mano que se bloquea. Se desglosa por comprobación (`labels`, `text_layer`, `snap`…) para
  saber si falla el OCR, el modelo o la maquetación.
- **Cobertura:** figuras imprescindibles aceptadas / figuras imprescindibles de escaneos que hoy paran Hacer magia.

## 9. Experimento real mínimo

Requiere autorización: llamadas de pago y material real sin datos del alumnado.

1. **Corpus.** 30 fichas escaneadas reales, de Primaria a Bachillerato, con unas 60 figuras imprescindibles. Anotación humana con el
   localizador existente: unas 2–3 horas.
2. **Fase 1, sin modelo.** OCR local + verificador con **propuestas oráculo** (las cajas anotadas). Mide el techo: cuántas figuras
   verificables bloquean el OCR o la maquetación. Coste API: 0.
3. **Fase 2, con modelo.** Reanálisis con un prompt de análisis v4 en borrador, que devuelve `location`, sobre esas 30 fichas. Una
   sola ejecución, con tope de gasto. Mide el acierto de las propuestas y los falsos positivos y negativos del conjunto.
4. **Criterio de decisión.**
   - Implementar solo si hay **0 falsos positivos con ≥ 60 aceptados** (o el límite superior < 5 %) y una cobertura ≥ 40 % de las
     figuras que hoy paran.
   - Si la fase 1 ya bloquea más del 50 %, el problema es el OCR o la maquetación, y no compensa pagar la fase 2.

## 10. Coste estimado por material

Ninguna cifra está medida para este flujo. Base: precio STANDARD registrado en `ai/costs.ts`, 2 USD/M de entrada y 10 USD/M de
salida; análisis **medido** de 0,043–0,058 USD por material (`COSTS.md`).

| Componente | Estimación | Supuesto |
| --- | --- | --- |
| A · campos de ubicación en el análisis | ≈ +0,001 USD por visual; ≈ 0,003–0,005 USD por material | 80–120 tokens de salida por visual + ~300 de instrucciones |
| B · llamada de visión por página | ≈ 0,005–0,006 USD por página; ≤ 0,017 USD por material | ~1.300 tokens de imagen (página a 100 ppp) + 400 de texto + 200 de salida |
| OCR local | 0 USD de API; ≈ 1–4 s de CPU por página (estimado) | Motor WASM, página a 200–300 ppp |
| Verificador | Despreciable; < 1 s por página | Medido solo en el prototipo, sobre fixtures |
| Experimento (fase 2) | ≈ 1,5–3 USD en total | 30 reanálisis de 0,05–0,10 USD |

Latencia en Hacer magia con A: ninguna llamada nueva. El OCR y la verificación se hacen al analizar o la primera vez, y se cachean
por versión del material.
