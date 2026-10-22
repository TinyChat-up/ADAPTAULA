# «Hacer magia» 2.0 — recuperación localizada, estructura del original y causas precisas

Fecha: 2026-10-21. Rama `claude/hacer-magia-2`, desde `origin/main` `5476df9` (#37 y #49–#52 integradas). Evidencia de partida: prueba real v3 sobre `da04cf1`, 8 fichas, 0,6674 USD: 3 PDF generados, 4 bloqueadas y 1 rechazada. Los originales y resultados de esa prueba **siguen fuera de Git**, con su SHA-256 verificado aparte.

**Esta entrega no incluye ninguna llamada de pago.** Los resultados por ficha de abajo son **simulados** con equivalentes sintéticos (`tests/support/real-run-v3-synthetic.ts`, textos propios con la misma estructura). No son una nueva prueba real ni un resultado del producto sobre las fichas reales.

## Causas

| Ficha | Defecto real | Causa encontrada |
| --- | --- | --- |
| 01 | `generator_validation` tras una generación | Varias comprobaciones de la auditoría no se atribuían a ninguna decisión: copia literal, áreas de respuesta, trazabilidad, bloques no efectivos y actividad ausente. También fallaba el ensamblado por un bloque que incumplía el contrato del documento. Así `repairGenerationAutomatically` no tenía nada que reparar y la ficha fallaba entera. El borrador exacto no se conserva (vivía en PGlite en memoria): el mecanismo está demostrado, el bloque concreto no. |
| 02 | Se perdían «Operaciones y unidades» y «Respuesta»; apoyos duplicados | El constructor no tenía áreas de respuesta etiquetadas: las líneas de campo acababan en el texto o desaparecían. Además, ningún paso detectaba un apoyo que repetía otro. |
| 03 | Figura geométrica no reconstruida | No existe una especificación determinista de polígono acotado (solo barras, rectas, cuadrículas y círculos). Sin recorte verificado ni ilustración, la escalera termina en «sin resolver». **Sigue bloqueada**, ahora con una causa honesta. |
| 04 | Párrafos y segmentación perdidos, elementos de ordenación unidos, «01» partido | `parseParagraphs` solo separaba en líneas en blanco: un salto simple se colapsaba en el HTML, y las lecturas solo se dividían por líneas en blanco. La ordenación no tenía forma propia. El `nowrap` de «01» ya estaba en `main` y ahora se mide en Chromium. |
| 05 | Tres oraciones unidas, campos Sujeto/Predicado perdidos, definiciones que revelaban lo evaluado | El mismo colapso de líneas y la falta de campos. Ninguna comprobación detectaba un glosario que definiera las categorías que la actividad pide clasificar. |
| 06, 07 | Bloqueadas por ilustraciones IA desactivadas, con un mensaje que culpaba al plan | `illustrationAvailability` devolvía «plan» cuando ningún plan del catálogo incluye ilustraciones y la función está desactivada para todos (`FLAG_AI_IMAGES_ENABLED=false`). El texto proponía «cuando tu plan incluya ilustraciones». **Siguen bloqueadas** mientras las ilustraciones estén desactivadas, pero con el motivo correcto. |
| 08 | Tres generaciones rechazadas | La reparación automática volvía a pedir al modelo el plan entero con las mismas restricciones. Nada detectaba que los fallos se repetían en las mismas decisiones. |

## Cambios

### Planificación y ejecución
- **Diagnóstico** (`src/lib/adaptation/generation-recovery.ts`). Cada fallo de auditoría o de revisión se clasifica en una categoría: json, schema, unauthorized_block, duplicate_support, structure_loss, data_loss, answer_leak, format_incompatible, visual_unresolved, pedagogical_review, cost_or_limit, not_executed o traceability. Lleva su regla, sus decisiones y sus unidades, y la reparación posible: determinista, fragmento por IA o ninguna. Una parada se guarda con su diagnóstico en `execution_report` y en el log `generation_stop_diagnosed`, solo con ids y nombres de regla.
- **Atribución.** Las comprobaciones de actividad ausente, bloques no efectivos, copia literal y área de respuesta nombran ahora las decisiones que escribieron esos bloques (`refs` + `decisions`). Hay dos comprobaciones nuevas, también atribuidas: bloque inválido descartado y apoyo que define lo evaluado.
- **Contrato por actividad (aplicado de forma determinista, sin nueva versión de prompt):**
  - estructura del original (`src/lib/adaptation/structure.ts`);
  - política de apoyos (`support-policy.ts`);
  - seguridad de lo evaluado (`assessment-safety.ts`);
  - y las restricciones que ya existían (datos protegidos, área de respuesta, presupuesto).

  Un rewrite que repite un elemento de ordenación o una etiqueta de campo se rechaza (`rewrite_restates_structure`) y se conserva la consigna original.

### Conservación de párrafos, etiquetas y espacios
- **Evidencia, nunca invención.** Un salto de línea simple es estructural solo si el texto lo marca: número, letra, guion, viñeta, guion de diálogo, etiqueta de campo, o varias líneas que cierran oración. Un salto a mitad de frase es un ajuste del PDF y se une. El render lo dibuja como `<br>` (`src/lib/render/inline.ts`).
- **Lecturas.** Se separan por línea en blanco. Sin líneas en blanco, se separa por oración cerrada, y el diálogo siempre va en su propio párrafo.
- **Campos etiquetados.** Las líneas finales formadas solo por «Etiqueta:» son un área de respuesta nueva, `fields`, de uso exclusivo del servidor:
  - «Operaciones…» se dibuja como caja de cálculo;
  - «Explica…» lleva varias líneas;
  - «Respuesta» lleva dos líneas;
  - cualquier otra etiqueta, una línea.
- **Ordenación.** Una casilla por elemento, en el orden impreso (`sequence`). Los elementos se dibujan una sola vez, en el área de respuesta.
- **Tamaño de letra.** No se reduce para ahorrar páginas.

### Reparación localizada (cómo funciona)
1. **Criba.** Antes de ensamblar, un bloque que incumple el contrato se descarta y se registra contra su decisión. Una decisión que se queda sin bloques pasa a «ignorada».
2. **Aislamiento.** Si el ensamblado aún falla, se deja fuera una decisión cada vez hasta encontrar la que lo rompe.
3. **Reparación determinista.** Tras la auditoría y sin llamar al modelo:
   - se repone el área de respuesta del original;
   - se quitan los vínculos a decisiones no efectivas;
   - se descartan segmentos escritos para unidades que deben quedar intactas.

   Solo se conserva si es estrictamente mejor: menos fallos, un subconjunto de los anteriores y ningún fallo determinista nuevo.
4. **Fragmento por IA.** Si hace falta el modelo, solo se le envían las decisiones restringidas (`GeneratorInput.only`). El resto del borrador anterior se conserva y se fusiona en el servidor. El artefacto registra `reused_from` y `regenerated`, y la llamada se marca como `repair`.
5. **Sin llamada.** Si la reparación consiste solo en dejar fuera decisiones, se reutiliza el borrador anterior sin pagar (log `automatic_repair_reused`).
6. **Validación completa.** Todo se vuelve a ensamblar y auditar desde cero con las mismas comprobaciones, que no se relajan. El análisis y las generaciones válidas no se pagan otra vez, porque los artefactos van por huella.

### Cómo se evitan tres generaciones defectuosas
- La firma de fallos (regla@decisiones) se guarda en cada ciclo. Si un ciclo repite la firma de otro anterior, ya no se pide otra regeneración igual: solo queda descartar sin perder cobertura, o parar con diagnóstico.
- Con un fallo atribuible, la segunda generación es localizada. En la prueba de BD el generador recibe solo `["dec_4"]` y el resto se conserva.
- Se mantienen el límite `MAX_GENERATION_CYCLES = 3`, una sola reserva y un solo consumo por adaptación, la idempotencia ante peticiones simultáneas y la devolución de la cuota si no se entrega ficha.

### Apoyos sin sobrecarga
- Un apoyo (checklist, recuadro de ayuda, lista, inicio de frases o instrucción añadida) que repite íntegramente otro se pliega en él. Ocurre si cada una de sus oraciones está contenida (solapamiento ≥ 0,8) en el de la hoja o en uno anterior de la misma actividad. Sus decisiones pasan al que queda, así que la necesidad funcional sigue cubierta y trazada.
- No se tocan los bloques del original, las actividades, los recursos ni los ejemplos.
- Un apoyo que define dos o más de las categorías que la actividad pide clasificar falla la auditoría (`answer_leak`) y se atribuye a su decisión.

### Figuras imprescindibles: motivo preciso
`IllustrationWithheld` distingue cinco motivos y la parada usa la copia de `docs/UX.md` que corresponde:

| Motivo | Situación | Parada |
| --- | --- | --- |
| `disabled` | Bandera desactivada para todos | `visual_unavailable`: «Adaptaula todavía no crea ilustraciones nuevas», sin proponer un cambio de plan |
| `not_offered` | Ningún plan del catálogo las incluye | `visual_unavailable` |
| `plan` | El plan del espacio no las incluye, pero otro sí | `visual_plan` |
| `quota` | Se han usado las del mes | `visual_quota` |
| `service` | Fallo temporal o servicio sin configurar | `visual` (genérica; se reintenta, nunca se culpa al plan) |

**Página original completa como anexo: estudiada y NO implementada.** Una página entera del original:
- puede contener otras actividades y sus respuestas impresas o la clave;
- no es accesible ni adaptada (es la barrera que se quiere evitar);
- presentarla como recurso de una actividad concreta exige verificar una identidad de página que hoy solo da la localización humana o los recortes con evidencia;
- y entregar así una ficha «completa» contradice la regla de no declarar completa una adaptación inadecuada.

Tampoco existe todavía un contrato de producto para una entrega «asistida» (estado, copia, PDF y pruebas). Se deja como decisión abierta (ADR-038) y no se implementa.

## Resultados simulados (equivalentes sintéticos; sin llamadas)

| Ficha | Antes (real v3) | Ahora (simulado) | Comprobado por |
| --- | --- | --- | --- |
| 01 | Fallida | Bloque inválido cribado, área de respuesta reparada sin modelo, ficha construible y diagnóstico atribuido. Probable mejora; no verificable sin el borrador real | `tests/unit/real-run-v3-matrix.test.ts`, `tests/db/generation-repair.test.ts` |
| 02 | Generada con defectos | Campos por problema y un único apoyo con tres decisiones trazadas | unidad + PDF Chromium |
| 03 | Bloqueada | **Sigue bloqueada** (causa `visual`, honesta) | unidad |
| 04 | Generada con defectos | Diálogo en párrafos, 4 casillas en orden y «01»/«02» en una línea medidos en Chromium | unidad + PDF/layout Chromium |
| 05 | Generada con defectos | Tres oraciones en tres líneas distintas en Chromium, Sujeto/Predicado, y fuga de definiciones detectada y atribuida | unidad + PDF/layout Chromium |
| 06 | Bloqueada (mensaje erróneo) | **Sigue bloqueada** mientras no haya ilustraciones; mensaje correcto, campos A–D conservados | unidad |
| 07 | Bloqueada (mensaje erróneo) | **Sigue bloqueada**; mensaje correcto | unidad |
| 08 | Rechazada ×3 | Firma sin progreso: máximo dos generaciones y luego descarte seguro o parada diagnosticada; campos Escuela/Hospital/Mercado | unidad + BD + PDF |

**Estimación honesta para una próxima prueba real:**
- **Con mayor probabilidad de mejorar:** 01, 02, 04, 05 y 08.
- **Siguen bloqueadas** (sin ilustraciones ni reconstrucción de polígonos): 03, 06 y 07.

El máximo alcanzable con esta entrega es 5/8, por debajo del objetivo experimental de 6/8. Eso no está demostrado y no se promete. Las fichas parciales no cuentan como completas.

## Coste estimado (sin llamadas)

- **Referencia:** prueba v3, 0,6674 USD en total para 8 fichas. Su peor caso fueron tres generaciones completas en 08.
- **Pagos que se evitan:**
  - el análisis y las generaciones válidas ya no se pagan otra vez (artefactos por huella);
  - una reparación por descarte no llama al modelo;
  - una reparación por fragmento envía solo las decisiones afectadas, con menos salida que una regeneración completa;
  - la guarda sin progreso elimina la tercera generación idéntica.
- **Cifra estimada:** del mismo orden o algo inferior a la de v3, entre 0,5 y 0,8 USD para las 8 fichas. Es una estimación, no una medida.
- **Topes:** sin escalado universal a PREMIUM. Se mantienen los límites de `ai_runs` y de presupuesto.

## Próxima prueba real (requiere una autorización expresa nueva)

Kit v4 fuera de Git (en el directorio de trabajo de la sesión, no en el repositorio):

```bash
# 1. Ensayo sin coste (proveedor simulado; resultados descartados)
./start-app.sh dry v4-ensayo
node run.mjs --mode dry --out <dir-nuevo> --fichas <dir-originales> --hashes <originales.sha256>
./stop-app.sh
# 2. Ejecución real (solo con autorización y ANTHROPIC_API_KEY en el entorno; nunca se imprime)
./start-app.sh real v4-real-1
REALRUN_CONFIRMED=1 node run.mjs --mode real --out <dir-nuevo> --fichas <dir-originales> --hashes <originales.sha256> \
  --budget 3 --cap 0.6 --max-generations 3 --previous 0.6674
./stop-app.sh
```

El kit v4:
- **Caché.** Compila cada modo y ejecución en su propio directorio (`.next-realrun-<modo>-<id>`), creado limpio, y solo borra el suyo.
- **Antes de gastar.** Verifica el SHA-256 de cada original y comprueba `/`, `/registro`, `/app/adaptar` tras el registro y el Supabase simulado. Si algo falla, aborta sin ninguna llamada de pago.
- **Sin repeticiones.** Se niega a reutilizar un directorio de salida, para no repetir automáticamente una ejecución ambigua.
- **Topes.** Detiene la ficha si supera el tope por ficha o el máximo de llamadas de generación, el total si supera el presupuesto, y cualquier coste desconocido.
- **Coste.** Registra el coste por etapa (`costePorEtapa`, `coste.json`) y la diferencia con la pasada anterior.

## Pruebas ejecutadas

- **Unidad y BD.** `pnpm test`: 131 archivos, 1869 pruebas correctas y 13 omitidas (RLS real sin credenciales). Incluye las nuevas `tests/unit/real-run-v3-matrix.test.ts` (10), `tests/unit/structure-preservation.test.ts` (8), la regresión de ilustraciones y la regeneración localizada en `tests/db/generation-repair.test.ts`.
- **PDF real.** Chromium del producto → PDF → pdf.js, con disposición medida en Chromium: `tests/pdf/real-run-v3-matrix.test.ts` (4).
- **Calidad.** Typecheck y lint correctos (un aviso previo ajeno). El build se registra en el registro de desarrollo.
- **E2E de escritorio y móvil:** en esta entrega quedaron 4 fallos sin resolver. Se cerraron después, junto con otros fallos previos y una regresión de los campos de respuesta: ver [E2E.md](E2E.md).
