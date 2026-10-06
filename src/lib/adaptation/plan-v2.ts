import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, DraftAdaptationPlan } from "@/lib/schemas/adaptation-plan";
import { DraftAdaptationPlanV2Schema } from "@/lib/schemas/adaptation-plan-draft-v2";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { normalizePlan } from "./plan";

/**
 * `DraftAdaptationPlan v2` → `AdaptationPlan v1`. The need references are local and deterministic: `need_N` is the N-th active
 * need of the context the planner was given (same order, same context, same references, so a stored plan can always be
 * resolved again). A reference the context does not have is an invalid draft: no dimension is ever invented or guessed.
 */

export type PlanDraftErrorCode = "unknown_need_ref";

export class PlanDraftError extends Error {
  readonly code: PlanDraftErrorCode;
  constructor(code: PlanDraftErrorCode, message: string) {
    super(message);
    this.name = "PlanDraftError";
    this.code = code;
  }
}

export interface NeedRef {
  ref: string;
  dimension: DimensionKey;
}

export const needRefTable = (context: Pick<AdaptationContext, "needs">): NeedRef[] => context.needs.map((n, i) => ({ ref: `need_${i + 1}`, dimension: n.dimension }));

/**
 * The context as the v2 planner sees it: each need carries its reference, and `presentation` is left out (the assembler
 * resolves it from the context; the planner has nothing to decide there, and it was the source of duplicated decisions).
 * Nothing is added from the catalog.
 */
export function plannerContextV2(context: AdaptationContext) {
  const { presentation: _resolvedBySystem, ...rest } = context;
  void _resolvedBySystem;
  return { ...rest, needs: context.needs.map((n, i) => ({ ref: `need_${i + 1}`, ...n })) };
}

/** Resolves a v2 draft (already untrusted JSON) to the v1 draft shape. Throws a ZodError on a wrong value, a PlanDraftError on an unknown reference. */
export function resolvePlanDraftV2(draftInput: unknown, context: Pick<AdaptationContext, "needs">): DraftAdaptationPlan {
  const draft = DraftAdaptationPlanV2Schema.parse(draftInput);
  const table = new Map(needRefTable(context).map((n) => [n.ref, n.dimension]));
  return {
    decisions: draft.decisions.map(({ need_refs, preserves, supports, flags, ...rest }, i) => ({
      ...rest,
      dimensions: [
        ...new Set(
          need_refs.map((ref) => {
            const dimension = table.get(ref);
            if (!dimension) throw new PlanDraftError("unknown_need_ref", `La decisión ${i + 1} cita ${ref}, que no existe en el contexto (${table.size} necesidades)`);
            return dimension;
          }),
        ),
      ],
      preserves: preserves ?? [],
      supports: supports ?? [],
      flags: flags ?? [],
    })),
    summary: draft.summary,
  } as DraftAdaptationPlan;
}

export function normalizePlanV2(draftInput: unknown, analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan {
  return normalizePlan(resolvePlanDraftV2(draftInput, context), analysis, context);
}

/** The normaliser of the draft's version: a v1 draft is never read with v2's rules, or the other way round. */
export function normalizePlanFor(version: number, draftInput: unknown, analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan {
  return version === 2 ? normalizePlanV2(draftInput, analysis, context) : normalizePlan(draftInput, analysis, context);
}
