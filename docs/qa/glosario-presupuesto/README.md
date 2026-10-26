# Reparación contextual de apoyos fuera de presupuesto

Base `1a72c1c` (#72 integrada). Rama `codex/reparacion-glosario-presupuesto`. Corrección focalizada; no es otra fase de imágenes ni un cambio de umbrales.

## Hechos y causa

El fundador aporta el diagnóstico `generator_validation` de una adaptación de Biología y Geología y un glosario de cinco entradas. El apoyo pasó de 36 a 32 palabras; el presupuesto era 24 más seis de tolerancia. El glosario de 32 palabras se reproduce con el contador actual: no hay un error aritmético del contador ni un fallo de PDF. No se dispone del original completo, perfil, plan o despliegue; no se afirma haber reproducido todos sus controles ni el primer borrador de 36 palabras.

La reparación localizada disponía del borrador anterior para conservar las decisiones no afectadas, pero al generador solo le enviaba el original, la decisión y una restricción de longitud. No le daba el apoyo fallido que debía abreviar. Las pruebas nuevas demuestran esta ausencia antes de corregirla. Esto explica una carencia de la reparación, **no demuestra que el modelo real vaya a cumplir siempre el límite con el cambio**.

## Cambio

- Solo las decisiones con un `support_out_of_budget` previo, todavía aplicadas y seleccionadas para reparación, reciben sus apoyos anteriores. La selección usa los códigos persistidos de normalización, no texto del navegador.
- El fragmento viaja como `previous_supports` dentro de `<untrusted_material>`. Nunca se introduce su texto en instrucciones fiables ni en logs. Los delimitadores se escapan mediante el serializador existente.
- La restricción de servidor incluye el recuento observado, el máximo ya vigente y la orden de corregir ese fragmento conservando términos necesarios y significado. Si no puede hacerlo sin incumplir otra regla, debe bloquear la decisión.
- Una comprobación determinista impide entregar una reparación que elimina un término del glosario anterior. Se registra `data_loss / glossary_terms_preserved`, sin contenido pedagógico en el diagnóstico. Las llamadas realizadas mantienen su registro de coste; no se añaden intentos.
- Definiciones, relaciones conceptuales, posibles respuestas filtradas y pertinencia siguen bajo los controles completos existentes. Preservar los nombres no demuestra que una definición abreviada sea correcta.
- No cambian presupuestos, tolerancias, cuotas, máximo de generaciones, modelos, prompts publicados, renderer, migraciones ni servicios remotos. No hay un segundo pipeline.

## Evidencia local

`tests/support/glossary-budget-case.ts` contiene las cinco definiciones aportadas por el fundador (sin datos identificativos) y una alternativa **manual de prueba** de 22 palabras con los mismos términos. Esa alternativa no es el resultado observado de una llamada real ni una validación docente.

- Unidad: 32 palabras sigue rechazado; 22 cabe bajo el mismo presupuesto. Reparación limitada a la decisión y target correctos, sin contenido de otras decisiones; delimitadores no rompibles; rechazo si falta un término.
- PGlite: en el pipeline real con proveedores programados, primera respuesta rechazada, segunda recibe el fragmento y entrega conservando las cinco entradas. Misma adaptación, dos generaciones y una sola unidad consumida. Si la segunda respuesta elimina una entrada, no hay entrega y queda diagnóstico para inspección, sin un nuevo bucle de llamadas.
- PDF: CLARO imprime las cinco entradas completas de la respuesta **manual de prueba**, en una hoja, color y grises; no prueba la eficacia del modelo real. [PDF color](pdf/glosario-color.pdf), [PDF grises](pdf/glosario-grises.pdf), [captura](pdf/glosario-color.png).

Resultados locales:

| Comprobación | Resultado |
| --- | --- |
| Unidad y BD completas | 1.999 correctas, 13 omitidas |
| Regresión de generador/reparación | 70/70; comprobación final de glosarios sobre bloques normalizados: 17/17 |
| PDF focalizadas de maquetación/apoyos Max | 12/12 |
| PDF del glosario de prueba, color y grises | 1/1 (dos archivos PDF) |
| E2E Hacer magia, escritorio y móvil | 6/6, 2,2 min; proveedores simulados |
| Typecheck, lint, build | Correctos; lint con un aviso previo `_id` sin usar en `analysis-run-auth.test.ts` |
| Generación real / recuperación / SQL remoto | NO EJECUTADO |

Se usan los binarios instalados de Vitest/Next/TypeScript/ESLint por el fallo del lanzador pnpm del entorno. E2E contra el servidor Supabase ficticio local (`tests/e2e/fake-supabase.mjs`), `next dev` con los valores ficticios de `playwright.config.ts`, `AI_MODEL_STANDARD=mock:default`, `E2E_BASE_URL=http://localhost:3100` y `E2E_CHROMIUM_PATH=/usr/bin/chromium`. La E2E completa no se repite en esta corrección focalizada; la ejecución anterior de #72 fue 134 correctas/2 omitidas. Ejecutarla antes de fusionar conforme a AGENTS.md; no convertir la evidencia anterior en una validación del código nuevo.

## Aplicación y límites

PR independiente, sin merge ni despliegue de producción. No se ha aplicado SQL remoto ni modificado la adaptación fallida. La consulta realizada por el fundador fue solo lectura.

La adaptación anterior conserva su estado fallido: publicar este cambio no la regenera ni reescribe sus artefactos. No usar `jobs:recover --apply` a ciegas; la herramienta existente no garantiza que esta generación almacenada pueda recuperarse ni que continuar sea gratuito. Una entrega posterior aún puede requerir la revisión de IA y una figura imprescindible puede bloquear por otro motivo. No afirmar que se han probado imágenes reales por corregir el glosario.

Tras revisar e integrar la PR, cualquier ensayo real se hará manualmente y con autorización de coste. Comprobar tanto los cinco términos como sus definiciones, ausencia de respuestas y PDF. Si el modelo vuelve a exceder el límite o cambia un concepto, la ficha debe seguir sin entregarse. No desactivar los controles para terminar el trabajo.
