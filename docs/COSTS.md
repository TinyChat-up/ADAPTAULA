# Costes y rentabilidad de una adaptación

> **Estado actual (2026-10-23):** las cifras de este análisis son históricas; 026 sustituyó los cupos y precios del catálogo descritos abajo y mantiene las imágenes desactivadas. El piloto propone cinco aprobadas solo en PGlite, con 3 por adaptación y 0,50 USD defensivos, pendientes de aprobación comercial. No se han revalidado tarifas ni disponibilidad remotas. Un presupuesto de admisión no garantiza una factura máxima. [Estimaciones y límites del ensayo](qa/max-visuales/PRUEBA_MANUAL.md#5-coste-estimado-y-significado-de-cinco-imágenes).

Auditoría del coste completo de una adaptación de «Hacer magia», hecha el 13-10-2026 sobre la PR #25. Las cifras están en USD.

**Cada cifra dice de dónde sale:**
- **Medido:** una llamada real registrada en evals anteriores (`docs/ADAPTATION.md`, `docs/ROADMAP.md`).
- **Precio oficial:** tarifa publicada por el proveedor y copiada en `src/lib/ai/costs.ts`.
- **Estimado:** cálculo propio, todavía sin medir.

**Lo que no sabemos todavía:** no hay telemetría de producción accesible desde aquí. El coste real de cada cuenta se obtiene con
`docs/qa/costes/coste-por-adaptacion.sql`, de solo lectura y validado en `tests/db/illustrations.test.ts`. Hasta que haya semanas
de datos de la beta, ninguna cuota ni ningún precio debe darse por definitivo.

## 1. Dónde se usa cada proveedor

| Paso | Proveedor y alias | Cuándo | `ai_runs.purpose` | Se asocia a |
| --- | --- | --- | --- | --- |
| Análisis del material | Anthropic, STANDARD (Sonnet 5.5) | Una vez por material y versión; se reutiliza entre adaptaciones | `analyze` | material |
| Localizar visuales en escaneos | Anthropic, STANDARD con visión | Solo si hay figuras que localizar y la geometría no basta; una vez por material | `locate_visual` | material |
| Plan | Anthropic, STANDARD | Una vez, más una reparación como máximo | `plan` | adaptación |
| Generación | Anthropic, STANDARD | Hasta 3 ciclos de generación por adaptación (`MAX_GENERATION_CYCLES`) | `generate` | adaptación |
| Revisión pedagógica | Anthropic, STANDARD | Una por generación entregable | `review` | adaptación |
| Asistentes visuales (apoyo, reescritura, sustitución) | Anthropic, STANDARD | Solo si un visual no se resuelve con el original o con una figura exacta; la sustitución, hasta 2 intentos por actividad | `visual_support`, `visual_rewrite` | adaptación |
| Brief de ilustración | Anthropic, STANDARD | Solo si hace falta una ilustración | `image_brief` | adaptación |
| Imagen | **OpenAI**, IMAGE_QUALITY (`gpt-image-2.5-sunburst`) | Como mucho 2 por ilustración | `image` | adaptación |
| Revisión de la imagen | Anthropic, STANDARD con visión | Una por imagen | `image_review` | adaptación |
| Figuras exactas (VisualSpec) | Ninguno: código propio | Siempre que se pueda | — | — |
| Almacenamiento y PDF | Ninguno: Supabase Storage y Chromium en Vercel | — | — | — |

OpenAI solo se usa para la imagen, y Anthropic para todo lo demás.

## 2. ¿Registra `ai_runs` lo necesario?

**Sí:**
- Cada llamada guarda proveedor, modelo, alias, `prompt_key` y versión, esfuerzo, intento, tokens (entrada, salida, lectura y
  escritura de caché), coste estimado, latencia, estado y código de error.
- No guarda contenido.
- Los rechazos y los fallos también se registran.
- Si el modelo no tiene precio, el coste es `null`, nunca 0.
- `ai_spend_summary` (migración 018) ya suma el gasto real por workspace y periodo, con todos los propósitos.

**Observaciones (ninguna bloquea):**
1. **Tokens de imagen.** `input_tokens` suma los tokens de texto y de imagen de entrada. El coste se calcula en el momento con las
   tarifas separadas, así que es correcto, pero no se puede recalcular después con otro precio. Si hace falta, se añadiría
   `image_input_tokens` en una migración futura.
2. **Imagen fallida.** Una imagen que falla por timeout queda con coste `null` y 0 tokens, aunque el proveedor podría haberla
   facturado. Por eso el techo de gasto la cuenta, por prudencia, al coste de su peor caso solo si tuvo éxito; las fallidas sin
   respuesta no se cuentan. Hay que vigilarlo con la facturación de OpenAI.
3. **Análisis compartido.** El análisis y la localización no llevan `adaptation_id`: se reparten entre las adaptaciones del
   material. La consulta 3 del SQL los muestra aparte.
4. **Infraestructura.** Almacenamiento y PDF no pasan por `ai_runs`: su coste está en la factura de Vercel y Supabase.

## 3. Precios oficiales vigentes (verificados el 13-10-2026)

| Modelo | Entrada | Salida | Caché (lectura) |
| --- | --- | --- | --- |
| Claude Sonnet 5.5 (STANDARD) | 2 $/M | 10 $/M | 0,20 $/M |
| Claude Opus 5.5 (PREMIUM, no se usa por defecto) | 4 $/M | 20 $/M | 0,20 $/M |
| Claude Haiku 4.5 (ECONOMY) | 1 $/M | 5 $/M | 0,10 $/M |
| `gpt-image-2.5-sunburst` | Texto 5 $/M · imagen 8 $/M | Imagen 30 $/M (15 $/M en Batch) | Texto 1,25 $/M · imagen 2 $/M |

**Lo que no publica OpenAI:** cuántos tokens produce una imagen de calidad media de 1536×1024 con este modelo (su calculadora no
cubre la 2.5). Suponemos unos 1.600 tokens de salida, como en la generación anterior. Es una **estimación**, y la primera
ejecución real del eval la medirá.

## 4. Coste de una adaptación

**Medido:** cadena limpia sin imágenes, Primaria 0,098 y Bachillerato 0,124:

| Paso | Coste medido (USD) |
| --- | --- |
| Análisis | 0,043–0,058 |
| Plan | 0,023–0,033 |
| Generación | 0,014–0,018 |
| Revisión | 0,018–0,021 |

**Estimado:**

| Paso | Coste estimado (USD) | Por qué |
| --- | --- | --- |
| Un ciclo de corrección (generación + revisión) | 0,035–0,04 | — |
| Una llamada de asistente visual | ≤ 0,012 | Salida máxima de 900 tokens |
| Brief o revisión de imagen | ≤ 0,02 cada uno | Salida máxima de 1.500 tokens |
| Imagen media de 1536×1024 | ≈ 0,05 | Con un techo prudente de 0,08 |
| Localización con visión en escaneos | 0,01–0,03 por página | Sin medir |
| Almacenamiento de una ilustración | Despreciable | PNG de 0,5–1,5 MB; ≈ 0,00003 USD/mes |
| PDF | < 0,001 | Unos segundos de función |

### Escenarios

- **Típico:** la cadena limpia (0,11), con cada ilustración aprobada al primer intento (0,07).
- **Peor caso:**
  - 3 ciclos de generación, una reparación del plan, y asistentes visuales con 2 intentos de sustitución (≈ 0,30 sin imágenes);
  - cada ilustración con 2 imágenes y 2 revisiones, aprobada o no (0,13; si no se aprueba, se devuelve la unidad pero se pagan las
    llamadas).

| Imágenes | Típico | Peor caso |
| --- | --- | --- |
| 0 (fracciones: todo VisualSpec) | 0,11 | 0,30 |
| 1 (célula) | 0,18 | 0,43 |
| 2 | 0,25 | 0,56 |
| 3 | 0,32 | 0,69 |

**Techo duro de imágenes (nuevo en esta PR).** `ILLUSTRATION_BUDGET`, o `plans.features.illustration_budget_usd`, limita lo que
gastan las ilustraciones de **una** adaptación: 0,50 USD por defecto.
- Se cuenta desde `ai_runs`, incluidos los reintentos y los ciclos de corrección.
- Se comprueba en el servidor **antes** de cada llamada, con el peor caso de esa llamada.
- Un aplazamiento por falta de tiempo o por un fallo transitorio puede repetir una ilustración, pero no supera el techo.

**Estimación histórica de admisión (no garantizada): ≈ 0,30 + 0,50 = 0,80 USD.** La cifra solo crece si el modelo de imagen gasta más tokens
de los estimados en una llamada ya empezada.

**Fallos no medidos:** un rechazo de contenido del proveedor de imagen se registra y no se reintenta. Una imagen que no es un PNG
válido cuesta su llamada y pasa al segundo intento.

## 5. Márgenes con los planes actuales (sin cambiar nada)

Precios de la tabla `plans`: Pro 9,99 €/mes con 75 adaptaciones y 100 análisis; Max 17,99 €/mes con 150 adaptaciones, 250 análisis
y 50 imágenes.

| | Pro | Max |
| --- | --- | --- |
| Ingreso neto aprox. (IVA 21 % y comisión de pago fuera) | ≈ 7,9 € ≈ 8,5 USD | ≈ 14,4 € ≈ 15,5 USD |
| Coste IA usando **todo** el cupo, sin imágenes (análisis 0,05 + adaptación 0,06) | ≈ 9,5 USD | ≈ 21,5 USD |
| Imágenes usando todo el cupo (0,10 cada una) | — | ≈ 5 USD |
| Margen con el cupo lleno | **negativo** | **negativo** |
| Margen si se usa un 30 % | ≈ 5,6 USD (≈ 66 %) | ≈ 7,5 USD (≈ 50 %) |

*Supuesto de cambio: 1 € ≈ 1,08 USD.*

**Conclusión:** el riesgo no está en las imágenes, sino en que los cupos actuales de análisis y adaptaciones, **usados al
100 %**, cuestan más que el precio. Las imágenes, con techo, son la parte acotada. No cambio precios ni cuotas: hay que medir el uso
real durante la beta y después decidir.

## 6. Propuesta (no aplicada)

| | Free | Pro | Max | Beta 30 días |
| --- | --- | --- | --- | --- |
| Ilustraciones generadas al mes | 0 (sin cambios) | **10** | **30** (hoy 50) | **10** en total |
| Ilustraciones por adaptación (`illustrations_per_adaptation`) | — | **2** | **3** | **2** |
| Techo por adaptación (`illustration_budget_usd`) | — | **0,35** | **0,50** | **0,35** |
| Figuras exactas, originales reutilizados, VisualSpec | Sí | Sí | Sí | Sí |
| Coste máximo de imágenes al mes | 0 | ≈ 1,3 USD | ≈ 3,9 USD | ≈ 1,3 USD |

- Free no tiene generación libre de ilustraciones. Si una actividad necesita una ilustración imprescindible, la ficha se detiene y
  lo dice: «tu plan no incluye ilustraciones». Nunca se entrega una actividad sin su imagen.
- Para que Pro y Max sean rentables también con el cupo lleno, hay que revisar con datos los cupos de análisis y adaptaciones, que
  son los que más pesan, o los precios. Es una decisión comercial, no de esta PR.
- **Alertas en el proveedor:** configurar en OpenAI un *budget* mensual con alertas (por ejemplo, 50 USD) y en Anthropic su
  límite de gasto. No son un límite estricto: el límite real es el del servidor (cuota `image`, techo por adaptación y presupuesto
  de fallos).
- Los nuevos campos de `features` (`illustrations_per_adaptation`, `illustration_budget_usd`) ya se leen en el código: aplicarlos
  es un `update` de datos sobre `plans`, sin migración de esquema, que hará una persona cuando se decida.
