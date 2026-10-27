# Ciclo de vida del material y prueba manual con el plan Max

Estado: **implementado, sin validar en producción**. Pendiente: aplicar la migración 033, pasar la E2E completa y hacer la prueba manual de abajo. Esta entrega no ha ejecutado IA, Stripe ni SQL remoto.

## 1. Diagnóstico del caso de la célula (1.º ESO, «Hacer magia», tres versiones rechazadas)

**Lo que se sabe y lo que no.** No he tenido acceso al registro de esa ejecución: los registros de Vercel solo se conservan una hora y no tengo lectura de la base de datos de producción. No lo he reproducido con el modelo real porque costaría dinero. Por eso **no afirmo cuál fue la causa**. El diagnóstico exacto ya está guardado en producción y se lee con la consulta 1.

Lo que el código demuestra:
- Cada parada de calidad deja su diagnóstico en `adaptation_artifacts` (`kind = 'execution_report'`, `payload.diagnosis`): categoría, regla, decisiones y unidades afectadas.
- La pantalla no lo mostraba: solo enseñaba los avisos de la revisión pedagógica (`review.warnings`). Cuando la generación fallaba en la auditoría determinista (`generator_validation`), esa revisión no existe y el docente leía solo el mensaje genérico. **Esto queda corregido** (`qualityDiagnosis`).
- El límite de tres generaciones se aplica en base de datos (`adaptation_generation_cycles`, migración 018). Una reparación automática solo se intenta cuando todos los fallos apuntan a decisiones aplicadas. Si el mismo fallo se repite en las mismas decisiones, se para con honestidad.

**Consulta 1: por qué se rechazó cada versión** (solo lectura; categorías y reglas, sin contenido de la ficha):
```sql
select r.created_at, r.payload->'diagnosis'->>'stage' as etapa,
       f->>'category' as categoria, f->>'rule' as regla, f->'decisions' as decisiones, f->'refs' as unidades
from public.adaptation_artifacts r, jsonb_array_elements(r.payload->'diagnosis'->'failures') f
where r.adaptation_id = '<id de la adaptación>' and r.kind = 'execution_report' and r.payload ? 'diagnosis'
order by r.created_at;
```
Cómo leerla. Categorías: `data_loss` es información perdida; `structure_loss` es una actividad o su espacio de respuesta perdidos; `answer_leak` es una respuesta revelada; `duplicate_support` son apoyos excesivos; `format_incompatible` es una forma de respuesta que cambia lo evaluado; `unauthorized_block`, `not_executed` y `traceability` son errores de ejecución o de estructura; `pedagogical_review` es un rechazo de la revisión con IA, el único sitio donde cabe un falso positivo del revisor. Una regla que se repite en las tres filas sobre las mismas decisiones indica que la reparación no tenía solución segura.

## 2. Por qué el análisis dijo 9 actividades

El prompt del análisis (`material-analyzer` v3) registra como actividad «todo lo que el alumno debe resolver o responder». Los apartados con su propia letra («3a», «3b», cada afirmación V/F con «a)», «b)») son entradas separadas. El contrato no tiene relación padre-hijo, así que 9 entradas pueden ser 5 ejercicios con apartados.

**Consulta 2: las entradas tal como las leyó el análisis** (es el contenido de tu propio material):
```sql
select a->>'id' as id, a->>'label' as etiqueta, a->>'page' as pagina, left(a->>'instruction', 80) as consigna
from public.materials m, jsonb_array_elements(m.analysis->'activities') a
where m.id = '<id del material>';
```
Ahora la pantalla agrupa por la etiqueta impresa (`groupActivities`) y muestra «5 actividades (9 apartados o preguntas en total)». Cada apartado aparece como «Apartado 3b». No se cambia el análisis ni el prompt. Límite: una entrada sin etiqueta cuenta como actividad propia; no se adivina a cuál pertenece.

## 3. Integridad, cuotas y privacidad

- **Reanálisis:**
  - consume una unidad de análisis, la misma política que antes (`enqueue_analysis_job`);
  - reutilizar un análisis idéntico al subir de nuevo el mismo archivo no consume nada; para forzar uno nuevo está «Volver a analizar»;
  - el doble clic y las dos pestañas dan un solo trabajo, porque la función es idempotente con el material bloqueado.
- **Retirar y restaurar:** no tocan cuotas, adaptaciones, archivos ni PDF.
- **Eliminar definitivamente:**
  - borra los archivos (original, recortes de figuras, imágenes generadas, imágenes aportadas por el docente y exportaciones PDF persistidas en `exports`, si las hubiera) y luego las filas. Hoy ningún código guarda PDF: se generan al descargar;
  - no devuelve cuota consumida;
  - conserva el libro `usage_events` y el coste en `ai_runs`;
  - libera solo las reservas de adaptaciones no entregadas, como al cancelar;
  - queda registrado en `audit_logs` sin contenido;
  - solo actúa con rol de escritura en el propio espacio de trabajo, y otro espacio recibe «no encontrado».
- **Concurrencia:**
  - reanálisis y creación de adaptación a la vez: la copia del análisis se guarda antes de encolar, así que la adaptación que fijó el análisis anterior lo conserva;
  - archivar con un trabajo en curso no lo interrumpe;
  - eliminar con un trabajo en curso se rechaza (`material_busy`);
  - un fallo de Storage durante la eliminación deja el material en «Eliminación pendiente» y se puede repetir.
- **Mensajes de fallo:** categorías y nombres de actividad, nunca contenido, prompts, modelos ni datos del alumnado.

- **Material retirado:** sus adaptaciones se consultan y continúan, pero no se crean nuevas hasta restaurarlo (servidor y base de datos).
- **Adaptación antigua tras un reanálisis:** su pantalla muestra el contexto del análisis fijado (copia de la 033), no el actual.

## 4. Guía corta: repetir la prueba Max

1. Aplica la migración `20261001003300_material_library_lifecycle.sql` en Supabase producción y despliega.
2. Abre el material de la célula. Comprueba «N actividades (M apartados…)» y la lista con «Apartado …».
3. Pulsa **Volver a analizar**, confirma y espera al resultado. Las adaptaciones anteriores siguen abriéndose con su ficha.
4. Pulsa **Hacer magia**. Si no se entrega, la tarjeta debe decir qué actividad y por qué. Contrástalo con la consulta 1.
5. Si se agotan las tres versiones, pulsa **Crear una adaptación nueva**: el análisis se reutiliza y no se gasta cuota hasta que se entregue una ficha.
6. Pulsa **Retirar de la biblioteca**. El material desaparece de la lista y aparece en «Ver materiales retirados». Restáuralo.
7. En otro material de prueba, ve a «Más opciones del material» → **Eliminar definitivamente**. Revisa la lista de lo que se borra, marca la casilla y confirma.

## 5. Pruebas

- Escritas: `tests/db/material-lifecycle.test.ts` (copia del análisis, RLS, retirada, eliminación en dos pasos, trabajo en curso) y `tests/unit/activity-groups.test.ts` (agrupación y mensajes). Ejecutadas una sola vez como comprobación puntual: 8/8.
- **No ejecutadas en esta fase**, por indicación: suite completa de unidad, BD y E2E, Playwright, capturas y PDF.
- Pendiente de escribir: una E2E de las nuevas acciones (retirar, restaurar, eliminar con confirmación reforzada) y una prueba de `purgeMaterial` con el fallo de Storage simulado.
