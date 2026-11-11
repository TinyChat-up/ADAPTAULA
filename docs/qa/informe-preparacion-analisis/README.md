# Informe de preparación del análisis (paso 1, modo sombra)

Objetivo: que el análisis deje el documento lo mejor preparado posible para que «Hacer magia» encuentre menos problemas, **sin cambiar todavía nada de lo que el sistema hace**. Esta primera entrega solo **mide**.

## Qué es y qué no es
- Un informe **determinista y gratuito** (sin modelo, sin red) que se calcula al terminar un análisis, **solo a partir del análisis y del propio archivo**. No conoce a ningún alumno ni perfil: la viabilidad específica del perfil es otra comprobación (paso posterior), mantenida aparte.
- **No es un veredicto.** Un PDF escaneado, una ficha compleja o una figura sin ruta identificada son *hechos*, nunca «no viable». Nada lee el informe para bloquear ni para decidir: modo sombra.
- Vive en `materials.analysis_meta.readiness`. **Sin migraciones.**

## Qué contiene (`src/lib/schemas/analysis-readiness.ts`, versión 1)
Solo códigos, identificadores técnicos (`act_3`, `vis_2`…), estados y recuentos; el esquema es **estricto** y no tiene ningún campo de texto libre.

| Bloque | Contenido |
|---|---|
| `source` | `pdf` o `image`, páginas, páginas leídas, **capa de texto** (`present`, `partial`, `absent`, `not_applicable`) y páginas sin texto. |
| `fidelity` | Contraste del análisis con lo que el PDF imprime: textos, actividades, celdas de tabla, etiquetas de esquema y números (incluidos los de los datos protegidos), con recuentos de comprobados y no encontrados. Fórmulas (LaTeX) aparte (`skipped_math`). Solo se comparan las páginas que imprimen texto. |
| `references` | Actividades y cuántas tienen recursos; actividades que remiten a «el esquema» sin recurso ni figura en su página; figuras requeridas que nadie usa; espacios de respuesta desconocidos; respuestas inferidas. |
| `visuals` | Una **pista** por figura según lo que dice el propio análisis: `data_in_analysis`, `flow_claim`, `structured_claim`, `needs_original`, `not_needed`. Una pista no es una promesa ni un veredicto. |
| `findings` | Hasta 30 `{code, severity (info/review), target?, count?}`; primero los de revisión. 11 códigos cerrados. |

Comparación tolerante: sin mayúsculas, acentos, ligaduras, signos, espacios ni guiones de final de línea; textos largos por ventanas (cobertura ≥ 80 %); números de dos o más dígitos.

## Compatibilidad comprobada antes de guardar (`analysis_meta`)
- La columna es `jsonb` con solo `check (jsonb_typeof = 'object')`; la escribe `complete_analysis_job` (`p_meta`) y la copia la reutilización por caché (`tryReuseAnalysis`, que propaga el meta analizado).
- `AnalysisMetaSchema` gana `readiness` **opcional y tolerante** (`.optional().catch(undefined)`): un meta anterior sigue siendo válido y **un informe que esta versión no entiende se lee como «ninguno» y no invalida el meta** (lo necesitan la caché y la ficha del material). Probado: meta sin informe, con informe, con informe corrupto, ida y vuelta por JSON, y `pickReusableAnalysis` con y sin informe.
- El informe no entra en ninguna huella (`analysis_fingerprint` se calcula del análisis, no del meta): la caché y las adaptaciones existentes no se ven afectadas.
- Mismo archivo ⇒ mismo análisis ⇒ mismo informe: se copia con la reutilización, sin recalcular.

## Modo sombra y coste
- El cálculo ocurre en `runAnalysisJob`, después del análisis y antes de guardar, con **presupuesto propio (≤ 15 s)** y respetando el plazo del trabajo. **Nunca lanza**: si el PDF no se puede leer, si se agota el tiempo o si el rasterizador no está disponible, el informe dice `unavailable` con su motivo (o no hay informe) y el análisis se guarda exactamente como antes.
- **Cero llamadas a modelos**, cero filas en `ai_runs`. Lee las cadenas impresas del PDF **una sola vez** (≤ 30 páginas), sin dibujar nada.
- Para que funcione en las rutas del análisis (`/api/materials/*/analysis/run` y `/api/cron/materials`) se añaden los ficheros de pdf.js a su traza (`next.config.ts`) y a la comprobación `smoke:raster`.
- Registro: `analysis_readiness` (estado, capa de texto, fidelidad y códigos; nunca contenido).

## Cómo medirlo (solo lectura)
```sql
-- Estados y capa de texto de los análisis con informe
select readiness->>'status' status, readiness->'source'->>'text_layer' capa, readiness->'fidelity'->>'status' fidelidad, count(*)
from (select analysis_meta->'readiness' readiness from public.materials where analysis_meta ? 'readiness') m group by 1,2,3;

-- Códigos de hallazgo más frecuentes
select f->>'code' code, f->>'severity' severity, count(*)
from public.materials m, jsonb_array_elements(m.analysis_meta->'readiness'->'findings') f group by 1,2 order by 3 desc;
```
Criterio para pasar al bloqueo (paso posterior, con tu decisión): tasa de falsos positivos conocida por tipo de hallazgo.

## Validado con el PDF real del estanque (sin modelos de pago)
Con el análisis real de «Un estanque en equilibrio» y su PDF de 2 páginas: capa de texto presente, **fidelidad `ok`** (5 textos, 10 fragmentos de actividad, 6 celdas, 4 etiquetas de esquema y 6 números comprobados; **0 no encontrados**), esquema con pista `flow_claim`, tablas `data_in_analysis` / `needs_original`, y 2 respuestas inferidas como información. La primera versión de la comparación daba **un falso aviso** (un enunciado que la ficha reparte alrededor de una cita y el análisis une); se corrigió comparando por frases y está cubierto por una prueba.

## Pruebas (`tests/unit/analysis-readiness.test.ts`, 23, más 2 en `analysis-job.test.ts`)
PDF digital (fiel y con transcripción errónea), PDF escaneado, PDF mixto, imagen, esquemas (etiquetas, pista `flow_claim`), tablas (celdas), referencias ausentes, figuras requeridas sin uso, recursos protegidos (número no impreso), fórmulas, privacidad (ninguna palabra del material en el informe; el esquema rechaza campos libres), cota de tamaño, determinismo, degradación sin romper el análisis y compatibilidad de `analysis_meta`.

## Pendiente (no incluido)
- **Paso 2:** adelantar la localización y verificación visual al análisis (reutilizando el motor existente, con la llamada de visión acotada y solo cuando esté justificada).
- **Comprobación de viabilidad según el perfil** (independiente de este informe).
- Backfill de materiales ya analizados: no se hace; se calculará bajo demanda cuando haga falta.
- Umbrales de fidelidad y falsos positivos: se calibrarán con los datos reales de la sombra.
