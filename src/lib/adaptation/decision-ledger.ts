import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, Decision, PlanValidation } from "@/lib/schemas/adaptation-plan";
import {
  DECISION_LEDGER_VERSION,
  DecisionLedgerSchema,
  type DecisionLedger,
  type LedgerActivity,
  type LedgerDecision,
} from "@/lib/schemas/decision-ledger";
import { DIMENSION_KEYS, type DimensionKey, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { OmittedNeed } from "./context";
import { hintTest, type HintFinding } from "./v22/hint-test";

/**
 * Builds the DecisionLedger (ADR-044, docs/AGENTE_V22.md). Pure and deterministic. It reads typed data only and never writes
 * a reason it cannot prove: an unexplained gap is `pending_review`, and `residual_barriers` lists only what the data shows.
 */
export interface LedgerInput {
  plan: AdaptationPlan;
  validation: PlanValidation;
  context: AdaptationContext;
  analysis: MaterialAnalysis;
  /** What the context builder left out (`buildAdaptationContext().omitted`). */
  omitted?: readonly OmittedNeed[];
  /** Only the support levels, to tell «no necesita» from «sin valorar». Nothing else of the learner. */
  profile?: Pick<FunctionalProfile, "supports">;
  /** Results of the V2.2 checks by decision id (`v22/checks.ts`). */
  hintFindings?: ReadonlyMap<string, readonly HintFinding[]>;
  /** Activities whose instruction is still over the profile's word limit after the plan (`v22/checks.ts`). */
  overLimit?: readonly string[];
}

/** Needs that only act on a written or marked response: without one, the activity gives them nothing to do. */
const RESPONSE_DIMENSIONS: ReadonlySet<DimensionKey> = new Set(["writing_amount", "fine_motor_demand", "selection_based_response", "alternative_response", "reduced_copying"]);

/** The activities a target reaches. */
export function activitiesOf(analysis: MaterialAnalysis, target: string): string[] {
  if (target === "document") return analysis.activities.map((a) => a.id);
  if (target.startsWith("act_")) return analysis.activities.some((a) => a.id === target) ? [target] : [];
  if (target.startsWith("sec_")) return analysis.activities.filter((a) => a.section_id === target).map((a) => a.id);
  const resource = [...analysis.texts, ...analysis.visuals].find((r) => r.id === target);
  return resource ? [...resource.activity_ids] : [];
}

function statusOf(validation: PlanValidation, d: Decision): LedgerDecision["status"] {
  const issues = validation.issues.filter((i) => i.decision_id === d.id);
  if (issues.some((i) => i.severity === "block")) return "blocked";
  if (issues.some((i) => i.severity === "review")) return "teacher_validation";
  return "justified";
}

export function buildDecisionLedger(input: LedgerInput): DecisionLedger {
  const { plan, validation, context, analysis } = input;

  const decisions: LedgerDecision[] = plan.decisions.map((d) => ({
    id: d.id,
    target: d.target,
    activities: activitiesOf(analysis, d.target),
    action: d.action,
    status: statusOf(validation, d),
    origin: d.action === "keep" && d.dimensions.length === 0 ? "none" : "individual",
    dimensions: [...d.dimensions],
    strategies: [...d.strategies],
    has_note: d.note !== undefined,
    issues: validation.issues.filter((i) => i.decision_id === d.id).map((i) => ({ flag: i.flag, severity: i.severity })),
    hint_test: hintTest(d, input.hintFindings?.get(d.id)),
  }));

  // A need counts as applied on an activity when a decision that is not blocked uses it there; blocked when only blocked ones do.
  const applied = new Map<DimensionKey, Set<string>>();
  const blocked = new Map<DimensionKey, Set<string>>();
  for (const d of decisions) {
    if (d.action === "keep") continue;
    const into = d.status === "blocked" ? blocked : applied;
    for (const dim of d.dimensions) for (const act of d.activities) into.set(dim, (into.get(dim) ?? new Set()).add(act));
  }

  const activities: LedgerActivity[] = analysis.activities.map((activity) => {
    const own = decisions.filter((d) => d.activities.includes(activity.id) && d.action !== "keep");
    const intervention = own.length === 0 ? "none" : own.every((d) => d.status === "blocked") ? "blocked_only" : "changed";
    const needs_not_applied = context.needs
      .filter((n) => !applied.get(n.dimension)?.has(activity.id))
      .map((n) => {
        if (RESPONSE_DIMENSIONS.has(n.dimension) && activity.response_format === "none") return { dimension: n.dimension, evidence: "activity_has_no_response" as const, status: "explained" as const };
        if (blocked.get(n.dimension)?.has(activity.id)) return { dimension: n.dimension, evidence: "decision_blocked" as const, status: "explained" as const };
        const conflict = context.conflicts.some((c) => c.targets.includes(activity.id) && c.dimensions.includes(n.dimension));
        // A conflict explains why applying the need is delicate, not that leaving it out was right: the teacher decides.
        return { dimension: n.dimension, evidence: conflict ? ("needs_conflict" as const) : null, status: "pending_review" as const };
      });
    return { activity: activity.id, decision_ids: own.map((d) => d.id), intervention, needs_not_applied };
  });

  // Residual barriers that the data proves: a need whose only decision on an activity was blocked, and an instruction that stays
  // over the profile's word limit. Nothing else is asserted.
  const residual_barriers: DecisionLedger["residual_barriers"] = [];
  for (const d of decisions) {
    if (d.status !== "blocked") continue;
    for (const act of d.activities) {
      for (const dim of d.dimensions) {
        if (!applied.get(dim)?.has(act)) residual_barriers.push({ activity: act, dimension: dim, evidence: "decision_blocked", decision_id: d.id });
      }
    }
  }
  for (const act of input.overLimit ?? []) residual_barriers.push({ activity: act, dimension: null, evidence: "instruction_over_limit", decision_id: null });

  const supports = input.profile?.supports;
  const ledger: DecisionLedger = {
    version: DECISION_LEDGER_VERSION,
    plan: { analysis_fingerprint: plan.analysis.fingerprint, context_fingerprint: plan.context_fingerprint },
    decisions,
    activities,
    needs: context.needs.map((n) => ({ dimension: n.dimension, level: n.level, applied_in: [...(applied.get(n.dimension) ?? [])].sort(), blocked_in: [...(blocked.get(n.dimension) ?? [])].sort() })),
    omitted_needs: (input.omitted ?? []).map((o) => ({ dimension: o.dimension, reason: o.reason })),
    profile: supports
      ? {
          not_needed: DIMENSION_KEYS.filter((k) => supports[k] === "none"),
          unassessed_count: DIMENSION_KEYS.filter((k) => supports[k] === undefined).length,
        }
      : null,
    residual_barriers,
    residual_barriers_complete: false,
  };
  return DecisionLedgerSchema.parse(ledger);
}
