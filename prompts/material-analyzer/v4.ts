import { MATERIAL_ANALYZER_V3 } from "./v3";

/** The same untrusted-material boundary and V3 transcription rules, with an evidence-backed activity analysis. */
export const MATERIAL_ANALYZER_V4 = {
  ...MATERIAL_ANALYZER_V3,
  version: 4,
  schemaVersion: 4,
  system: MATERIAL_ANALYZER_V3.system
    .replace("- respuestas esperables cuando puedan inferirse con suficiente confianza.", "- el razonamiento y las decisiones que corresponden al alumno.")
    .replace(/^- answer:.*\n/m, "- Omite las soluciones. No completes respuestas, ejercicios ni criterios que el original no proporciona.\n") + `

## Comprensión pedagógica por actividad

Rellena comprehension para cada actividad. Describe lo que el original pide. No resuelvas la actividad ni sugieras una adaptación.

- objectives: enlaza solo objetivos de esta actividad. Usa explicit si el objetivo está literalmente en el material y puedes citarlo. Si el objetivo es una lectura pedagógica de la consigna, usa interpreted y cita el fragmento que la motiva. Ante varias lecturas incompatibles, deja la interpretación pendiente en uncertainties.
- operations: acciones cognitivas que realmente exige la consigna. Elegir un procedimiento y calcular son acciones diferentes. Localizar una frase y deducir una causa tampoco son equivalentes.
- student_decisions: decisiones que debe tomar el alumno. Si le corresponde seleccionar datos, elegir y ordenar operaciones, decidir un criterio, inferir una relación o defender una conclusión, regístralo sin indicar qué debería elegir, deducir o contestar.
- information: datos ya presentes que el alumno necesita para resolver. Cita un fragmento literal que incluya las cantidades, unidades o relaciones relevantes. Para datos de un gráfico o tabla cita su id con quote null. No completes datos ilegibles ni inventes títulos, valores o etiquetas.
- essential_resources: solo los recursos enlazados que resultan imprescindibles para resolver la actividad. Indica el recurso y la evidencia de que la actividad lo necesita. Un adorno no es imprescindible.
- response_format_role: assessed si la forma de responder es parte de la exigencia o una condición explícita. access si la evidencia indica que el medio de respuesta se puede separar del aprendizaje exigido. Si no se distingue con seguridad, devuelve null y una incertidumbre. Nunca equipares un campo corto con una respuesta que elimina una justificación. Una consigna de argumentar, redactar o elaborar un texto protege esa producción y su razonamiento.
- evaluation: lo que permite valorar el aprendizaje, incluida la argumentación, el procedimiento o la producción escrita cuando corresponda. No conviertas la existencia de un recuadro en un criterio de evaluación.
- conditions: conserva las restricciones que cambian lo que se aprende, decide o resuelve. Cita la condición literal, incluidos mínimos, unidades, negaciones y límites al procedimiento. Un apoyo de acceso no puede anticipar las decisiones del alumno ni eliminar estas condiciones.
- evidence: usa como source_ref el id local de esta actividad para citar su consigna o contexto, o el id de un texto o visual ya enlazado. Incluye una cita literal como quote. Se permite quote null únicamente al señalar un visual cuyo contenido necesitas consultar. No uses una descripción que has inventado como cita.
- uncertainties: indica qué campo queda pendiente y por qué. Si la consigna es ambigua, los datos no se leen o falta evidencia, conserva solo lo que puedes respaldar. Una pregunta abierta puede tener una exigencia clara aunque no tenga solución única.

Una lista vacía señala que el análisis no registra elementos para ese campo. No la rellenes por semejanza con otra ficha.
`,
} as const;
