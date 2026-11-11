import type { DeclarationIssueCode, PlannerDeclarations } from "../plan-v3";

/**
 * What the teacher reads of the V2.2 method in the plan review (ADR-046): per decision, whether it waits for them and why, and
 * the question it depends on; for the plan, the open questions and the barriers that remain. Plain teacher language: no model,
 * no rule text, no precedent content. A question or note the server withheld (it could reveal an answer) is shown as withheld.
 */
export interface DecisionMethodDto {
  /** Not applied unless the teacher approves it. */
  withheld: boolean;
  conditional: boolean;
  question: string | null;
  reasons: string[];
}

export interface PlanMethodDto {
  questions: Array<{ id: string; text: string | null; decisionIds: string[] }>;
  /** `target` is the activity id: the screen names it like every other target. */
  barriers: Array<{ target: string; needs: string[]; note: string | null }>;
}

const REASON: Partial<Record<DeclarationIssueCode, string>> = {
  conditional: "Depende de tu respuesta a una pregunta.",
  blocking_hint: "Podría dar una pista sobre lo que se evalúa.",
  strategy_not_for_need: "Usa un apoyo que no corresponde a las necesidades que cita.",
  declaration_missing: "No consta que se haya comprobado si da una pista.",
};

export function projectMethod(declarations: PlannerDeclarations | null | undefined): { decisions: Record<string, DecisionMethodDto>; plan: PlanMethodDto } | null {
  if (!declarations || typeof declarations.decisions !== "object") return null;
  const questionText = new Map(declarations.teacher_questions.map((q) => [q.id, q.text]));
  const decisions: Record<string, DecisionMethodDto> = {};
  for (const [id, d] of Object.entries(declarations.decisions)) {
    const reasons = [...new Set(declarations.issues.filter((i) => i.decision_id === id).map((i) => REASON[i.code]).filter((r): r is string => r !== undefined))];
    decisions[id] = { withheld: d.withheld, conditional: d.status === "conditional", question: d.question ? (questionText.get(d.question) ?? null) : null, reasons };
  }
  return {
    decisions,
    plan: {
      questions: declarations.teacher_questions.map((q) => ({ id: q.id, text: q.text, decisionIds: q.decision_ids })),
      barriers: declarations.residual_barriers.map((b) => ({ target: b.activity, needs: b.dimensions, note: b.note })),
    },
  };
}
