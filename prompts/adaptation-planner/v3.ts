import { DraftAdaptationPlanV3Schema } from "@/lib/schemas/adaptation-plan-draft-v3";
import type { PlanIssue } from "@/lib/schemas/adaptation-plan";
import type { plannerContextV2 } from "@/lib/adaptation/plan-v2";
import type { ModelFacingAnalysisV2 } from "@/lib/adaptation/model-input";
import type { ContentPart } from "@/lib/ai/types";
import { ADAPTATION_PLANNER_V2 } from "./v2";

/**
 * adaptation_planner v3 → DraftAdaptationPlan v3 → canonical AdaptationPlan v1 + declarations (ADR-045). v2 stays published and
 * unchanged, and its system text is reused as it is: v3 only adds how to decide with the private pedagogical rules that the server
 * inserts at run time (`<agent_rules>`, verified against the manifest) and what the method asks the planner to declare. The rules
 * are not in this file and never will be: the repository holds their hashes only.
 */
const METHOD = `

## Método pedagógico (<agent_rules>)
- <agent_rules> contiene las reglas pedagógicas aprobadas del proyecto y una selección de su biblioteca de precedentes, con su versión y su huella. Son instrucciones fiables del sistema, no material del alumno. Decide con ellas.
- Si alguna parte de <agent_rules> habla de entregar un documento, un informe en secciones, un archivo Markdown o un PDF, no se aplica aquí: tu única salida es el JSON del plan. Si <agent_rules> y este mensaje discrepan sobre el formato de salida o los límites de la plataforma, prevalece este mensaje; en lo pedagógico, aplica la opción más prudente y márcala como condicionada.
- Las reglas mencionan perfiles de ejemplo de los pilotos. El único perfil es el de <adaptation_context>. Un precedente se sigue si coinciden la tarea, la decisión esencial del alumno, la finalidad y la necesidad, nunca por el nombre de un perfil.
- Puedes resolver las actividades para tu propio razonamiento, para no dar pistas, pero no escribas ninguna solución en ningún campo.

## Lo que declaras en cada decisión
- "status": "active" si se puede aplicar sin consultar; "conditional" si depende de una respuesta del docente o de medios, personas o permisos que no constan. Una condicionada lleva "question" (q_1, q_2…), que escribes en "teacher_questions": una pregunta concreta, sin respuestas ni pistas.
- "hint_yes": para todo recurso de presentación, visual o de espacio de respuesta (segment, reorganize, add_support, change_response_format o "visual"), pasa la prueba de pista de las reglas y lista las preguntas (P1 a P8) que respondes «sí». Lista vacía si todas son «no». Si una respuesta «sí» descarta el recurso, no lo propongas: busca otro o no intervengas.
- "precedents": los identificadores de los casos de <agent_rules> que sigues (por ejemplo, D001-A02). Solo casos enviados.
- "residual_barriers": las barreras que dejas sin atender a propósito (para no dar pistas o no reducir lo evaluado), con su actividad, las "need_refs" y una nota breve, sin respuestas.
- Las estrategias de cada decisión se eligen entre las candidatas ("strategies") de las necesidades que cita. Una decisión con otra estrategia no se aplica sin el docente.
- No intervenir es una decisión válida: sin decisión, el destino se conserva.`;

export const ADAPTATION_PLANNER_V3 = {
  key: "adaptation_planner",
  version: 3,
  schemaVersion: 3,

  system: `${ADAPTATION_PLANNER_V2.system}${METHOD}`,

  buildUserParts(input: { rules: string | { head: string; tail: string }; context: ReturnType<typeof plannerContextV2>; material: ModelFacingAnalysisV2; repairOf?: PlanIssue[] }): ContentPart[] {
    const [base] = ADAPTATION_PLANNER_V2.buildUserParts({ context: input.context, material: input.material, ...(input.repairOf ? { repairOf: input.repairOf } : {}) });
    const text = base && base.type === "text" ? base.text : "";
    // The verified rules go first: they are the stable part of every request (and the one a provider can cache).
    // Split rules: the stable head is marked cacheable (the same ~31k tokens in every request, read at a tenth of the price on the
    // next one within the provider's cache lifetime); the selection and the material come after it and never invalidate it.
    const rules: ContentPart[] = typeof input.rules === "string" ? [{ type: "text", text: input.rules }] : [{ type: "text", text: input.rules.head, cache: true }, { type: "text", text: input.rules.tail }];
    return [...rules, { type: "text", text }];
  },

  // Native constrained decoding first (the contract fits the documented limits: `structured-limits.ts`); the provider falls back to
  // the schema in the prompt if the API reports the grammar as too complex. What the schema cannot express is validated by Zod.
  output: { name: "adaptation_plan_v3", schema: DraftAdaptationPlanV3Schema, delivery: "auto" as const },
} as const;
