import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { RESOURCE_ACTIONS_V3, type DraftAdaptationPlanV3 } from "@/lib/schemas/adaptation-plan-draft-v3";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { evaluatesWriting, protectedFor } from "./facts";
import { mockPlanDraftV2 } from "./mock";
import { needRefTable } from "./plan-v2";
import type { RulesUse } from "./plan-v3";
import type { AdaptationPlanner } from "./services";

/**
 * Deterministic planner draft for contract v3 (ADR-045). It is NOT the method: it only exercises the contract and the pipeline
 * offline, with the declarations a v3 planner must make. On top of the v2 mock's executive supports:
 *  - every resource decision answers the hint test (an empty list: no «yes»);
 *  - a response by keyboard that the profile does not allow is proposed only as CONDITIONAL, with its question;
 *  - where writing is what is evaluated, a motor or writing need is left as a declared residual barrier;
 *  - a decision cites a sent precedent only when the request carried one.
 */
const isResource = (d: { action: string; visual?: unknown }) => (RESOURCE_ACTIONS_V3 as readonly string[]).includes(d.action) || d.visual !== undefined;

export function mockPlanDraftV3(analysis: MaterialAnalysis, context: AdaptationContext, rules: RulesUse | null = null): DraftAdaptationPlanV3 {
  const base = mockPlanDraftV2(analysis, context);
  const refs = needRefTable(context);
  const ref = (dim: string) => refs.find((r) => r.dimension === dim)?.ref;
  const cited = rules?.included[0];
  const decisions: DraftAdaptationPlanV3["decisions"] = base.decisions.map((d) => ({
    ...d,
    status: "active" as const,
    ...(isResource(d) ? { hint_yes: [] } : {}),
    ...(cited && d.action === "segment" ? { precedents: [cited] } : {}),
  }));
  const teacher_questions: NonNullable<DraftAdaptationPlanV3["teacher_questions"]> = [];
  const residual_barriers: NonNullable<DraftAdaptationPlanV3["residual_barriers"]> = [];

  const alternative = ref("alternative_response");
  const open = analysis.activities.find((a) => a.response_format === "write_text" && !evaluatesWriting(analysis, a));
  if (alternative && open && !context.allowances.keyboard) {
    teacher_questions.push({ id: "q_1", text: "¿Puede responder con teclado en esta actividad?" });
    decisions.push({
      target: open.id,
      action: "change_response_format",
      strategies: ["response_format"],
      need_refs: [alternative],
      intensity: "light",
      response_target: "keyboard",
      preserves: protectedFor(analysis, open.id).filter((p) => p.importance !== "optional").map((p) => p.id),
      status: "conditional",
      question: "q_1",
      hint_yes: [],
    });
  }

  const motor = ref("fine_motor_demand") ?? ref("writing_amount");
  const evaluated = analysis.activities.find((a) => evaluatesWriting(analysis, a));
  if (motor && evaluated) residual_barriers.push({ target: evaluated.id, need_refs: [motor], note: "Se mantiene la escritura a mano porque es lo que se evalúa." });

  return {
    decisions,
    summary: base.summary,
    ...(teacher_questions.length > 0 ? { teacher_questions } : {}),
    ...(residual_barriers.length > 0 ? { residual_barriers } : {}),
  };
}

/** A mock planner v3. With `rules`, it reports them as a real v3 planner would (hashes and ids only). */
export function createMockPlannerV3(analysis: MaterialAnalysis, rules: RulesUse | null = null): AdaptationPlanner {
  return { plan: async ({ context }) => ({ draft: mockPlanDraftV3(analysis, context, rules), runs: [], ...(rules ? { rules } : {}) }) };
}
