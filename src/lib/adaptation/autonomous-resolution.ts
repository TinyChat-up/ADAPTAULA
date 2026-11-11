import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, Decision } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { DecisionEdits, PlanReview, PlanReviewEntry } from "@/lib/schemas/plan-review";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import { candidates, viable } from "./automatic-resolution";
import { isResolvedByPresentation } from "./context";
import type { PlannerDeclarations } from "./plan-v3";

/**
 * «Hacer magia» with planner V2.2 never hands a method question to the teacher (docs/ADAPTATION.md § Hacer magia). A decision the
 * method withheld (conditional on an answer the profile does not hold, a hint that could give the answer away, a strategy that does
 * not serve its need) is resolved HERE, internally and deterministically, in this order:
 *   1. safe variant   the same decision without what made it unsafe (supports that carry the task's own data are dropped; nothing
 *                     else about it changes): kept only if the invariants accept it and an executor exists;
 *   2. alternative    an existing capability that does the same job for the same need (`candidates`), re-validated the same way;
 *   3. original       the conservative default: the decision is left out and the ORIGINAL stays as it is. Never an invented
 *                     adaptation, never a guess about the learner.
 * Every resolution keeps its cause and reason: the teacher can read them afterwards (trace), nobody has to answer anything.
 *
 * Keeping the original is NOT the same as resolving a barrier. When a decision is left out, every HIGH need it served is checked
 * against what is still applied (another approved or edited decision, or the presentation layer); a high need left with nothing is
 * reported in `uncovered`, and the caller must not finish the sheet automatically: it stops honestly with that need named.
 */

export type WithheldCause = "conditional" | "answer_hint" | "strategy_not_for_need" | "undeclared";
export type WithheldResolutionKind = "safe_variant" | "alternative" | "kept_original";

export interface WithheldResolution {
  decision_id: string;
  cause: WithheldCause;
  kind: WithheldResolutionKind;
  reason: string;
}

const REASONS: Record<WithheldResolutionKind, string> = {
  safe_variant: "Se aplica sin lo que podía dar pistas de la respuesta; el resto de la decisión no cambia",
  alternative: "Se aplica una alternativa segura que cumple la misma función para la misma necesidad",
  kept_original: "Se conserva el original: la decisión dependía de información que el perfil no recoge (decisión conservadora)",
};

function causeOf(id: string, declarations: PlannerDeclarations): WithheldCause {
  const codes = declarations.issues.filter((i) => i.decision_id === id).map((i) => i.code);
  if (codes.includes("blocking_hint")) return "answer_hint";
  if (codes.includes("strategy_not_for_need")) return "strategy_not_for_need";
  if (codes.includes("conditional") || codes.includes("declaration_missing")) return "conditional";
  return "undeclared";
}

/** The decision without the supports built on the task's own data (the only way a support can hand over the answer). */
function withoutRevealingSupports(d: Decision): DecisionEdits | null {
  const safe = d.supports.filter((s) => !s.uses_task_data && s.kind !== "worked_example");
  if (safe.length === d.supports.length || safe.length === 0 || d.action !== "add_support") return null;
  return { supports: safe };
}

export interface UncoveredNeed {
  decision_id: string;
  dimensions: DimensionKey[];
}

export function resolveWithheldAutonomously(
  review: PlanReview,
  plan: AdaptationPlan,
  declarations: PlannerDeclarations,
  analysis: MaterialAnalysis,
  context: AdaptationContext,
): { review: PlanReview; resolutions: WithheldResolution[]; uncovered: UncoveredNeed[] } {
  if (review.reviewer.kind === "teacher") return { review, resolutions: [], uncovered: [] };
  const withheld = Object.entries(declarations.decisions).filter(([, v]) => v.withheld).map(([id]) => id);
  if (withheld.length === 0) return { review, resolutions: [], uncovered: [] };
  const entries = new Map<string, PlanReviewEntry>(review.entries.map((e) => [e.decision_id, e]));
  const resolutions: WithheldResolution[] = [];
  for (const id of withheld) {
    const d = plan.decisions.find((x) => x.id === id);
    if (!d) continue;
    const cause = causeOf(id, declarations);
    // A foreign strategy or a conditional decision keeps its action; a hinting one keeps what does not hint.
    const options: Array<{ kind: WithheldResolutionKind; edits: DecisionEdits | null }> = [
      { kind: "safe_variant", edits: cause === "answer_hint" || cause === "conditional" ? withoutRevealingSupports(d) : null },
      ...candidates(d, analysis).map((c) => ({ kind: "alternative" as const, edits: c.edits })),
    ];
    const found = options.find((o) => o.edits !== null && viable(plan, d, o.edits, analysis, context));
    if (found?.edits) {
      entries.set(id, { decision_id: id, action: "edited", reason: REASONS[found.kind].slice(0, 160), edits: found.edits });
      resolutions.push({ decision_id: id, cause, kind: found.kind, reason: REASONS[found.kind] });
    } else {
      entries.set(id, { decision_id: id, action: "rejected", reason: REASONS.kept_original.slice(0, 160) });
      resolutions.push({ decision_id: id, cause, kind: "kept_original", reason: REASONS.kept_original });
    }
  }
  // What is still applied after the resolution, and the high needs a left-out decision no longer serves.
  const applied = plan.decisions.filter((d) => {
    const entry = entries.get(d.id);
    return entry !== undefined && entry.action !== "rejected";
  });
  const high = new Set(context.needs.filter((n) => n.level === "high").map((n) => n.dimension));
  const uncovered: UncoveredNeed[] = [];
  for (const r of resolutions) {
    if (r.kind !== "kept_original") continue;
    const d = plan.decisions.find((x) => x.id === r.decision_id)!;
    const lost = d.dimensions.filter((dim) => high.has(dim) && !isResolvedByPresentation(dim, context.presentation) && !applied.some((o) => o.dimensions.includes(dim)));
    if (lost.length > 0) uncovered.push({ decision_id: d.id, dimensions: lost });
  }
  return { review: { ...review, entries: [...entries.values()] }, resolutions, uncovered };
}
