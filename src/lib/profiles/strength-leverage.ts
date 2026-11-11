import type { StrategyKey } from "@/lib/schemas/adaptation-plan";
import type { LearningObservations } from "@/lib/schemas/learning-observations";
import { BARRIERS, STRENGTHS } from "./learning-catalog";

/**
 * The learner's functional profile is the centre of every decision (docs/ADAPTATION.md § El perfil como centro): a declared strength
 * is not decoration, it decides WHICH of the strategies that serve a need is the one to use. Each strength names the strategies it
 * makes easier to take up. Closed lists, declared by the teacher: nothing about the learner is inferred from them, and no strategy
 * is ever added for a strength alone (a strategy still has to serve a need of the profile).
 */
export const STRENGTH_LEVERAGE: Record<keyof typeof STRENGTHS, readonly StrategyKey[]> = {
  concrete_examples: ["worked_example", "comprehension_support"],
  oral_expression: ["response_format"],
  visual_information: ["visual_support", "spatial_organization"],
  hands_on: ["worked_example", "task_sequencing"],
  clear_instructions: ["instruction_clarification", "task_sequencing"],
  everyday_connections: ["prior_knowledge_activation", "comprehension_support"],
  inquiry: ["extension", "prior_knowledge_activation"],
  subject_knowledge: ["prior_knowledge_activation"],
  chooses_options: ["response_choice"],
  step_lists: ["task_sequencing", "planning_support"],
  short_tasks: ["pacing", "task_sequencing"],
  graphic_organizers: ["spatial_organization", "visual_support"],
};

/** The candidate strategies of a need, those a declared strength makes easier first (stable: the rest keep their order). */
export function rankByStrengths(candidates: readonly StrategyKey[], observations: LearningObservations | undefined): StrategyKey[] {
  const favoured = new Set((observations?.strengths ?? []).flatMap((id) => STRENGTH_LEVERAGE[id]));
  return [...candidates.filter((s) => favoured.has(s)), ...candidates.filter((s) => !favoured.has(s))];
}

export interface DecisionJustification {
  decision_id: string;
  /** The needs of the profile that motivate the change (dimension keys). */
  needs: string[];
  /** Declared barriers this decision reduces (catalog ids). */
  barriers: Array<keyof typeof BARRIERS>;
  /** Declared strengths this decision takes advantage of (catalog ids). */
  strengths: Array<keyof typeof STRENGTHS>;
  /** What stays as it is: the protected elements the decision keeps. */
  preserves: string[];
}

/** Why each applied decision exists, from the profile alone (no model, no student data): which need, barrier and strength. */
export function justifyDecisions(
  decisions: ReadonlyArray<{ id: string; dimensions: readonly string[]; strategies: readonly StrategyKey[]; preserves: readonly string[] }>,
  observations: LearningObservations | undefined,
): DecisionJustification[] {
  return decisions.map((d) => ({
    decision_id: d.id,
    needs: [...d.dimensions],
    barriers: (observations?.barriers ?? []).filter((id) => BARRIERS[id].supports.some((s) => d.dimensions.includes(s))),
    strengths: (observations?.strengths ?? []).filter((id) => STRENGTH_LEVERAGE[id].some((s) => d.strategies.includes(s))),
    preserves: [...d.preserves],
  }));
}
