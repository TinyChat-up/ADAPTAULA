import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import {
  ADAPTATION_PLAN_SCHEMA_VERSION,
  AdaptationPlanSchema,
  DraftAdaptationPlanSchema,
  type AdaptationPlan,
  type PlanValidation,
} from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { contextFingerprint } from "./context";
import { fingerprint } from "./fingerprint";
import { blockedDecisionIds, validatePlan } from "./invariants";

const unique = <T>(values: readonly T[]) => [...new Set(values)];

/**
 * Draft (planner output, untrusted) → stored plan: server ids `dec_N` in order, duplicates removed, bound to the exact
 * analysis and context it was made for (fingerprints), and validated against the strict schema.
 */
export function normalizePlan(draftInput: unknown, analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan {
  const draft = DraftAdaptationPlanSchema.parse(draftInput);
  return AdaptationPlanSchema.parse({
    schema_version: ADAPTATION_PLAN_SCHEMA_VERSION,
    analysis: { schema_version: 3, fingerprint: fingerprint(analysis) },
    context_fingerprint: contextFingerprint(context),
    adaptation_type: context.adaptation_type,
    decisions: draft.decisions.map((d, i) => ({
      ...d,
      id: `dec_${i + 1}`,
      strategies: unique(d.strategies),
      dimensions: unique(d.dimensions),
      preserves: unique(d.preserves),
      flags: unique(d.flags),
    })),
    summary: draft.summary,
  });
}

/** Whether a stored plan still matches the analysis and context it is applied to (a re-analysis invalidates it). */
export function planMatches(plan: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): boolean {
  return plan.analysis.fingerprint === fingerprint(analysis) && plan.context_fingerprint === contextFingerprint(context);
}

/**
 * Validates and, if anything blocks, returns the applicable plan without the blocked decisions plus the full validation
 * (kept for the teacher and for the planner's single repair attempt). Nothing blocked is ever applied.
 */
export function applicablePlan(plan: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): { plan: AdaptationPlan; validation: PlanValidation } {
  const validation = validatePlan(plan, analysis, context);
  const blocked = blockedDecisionIds(validation);
  if (blocked.size === 0) return { plan, validation };
  return { plan: { ...plan, decisions: plan.decisions.filter((d) => !blocked.has(d.id)) }, validation };
}
