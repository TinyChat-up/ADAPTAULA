import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, Decision, PlanValidation } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { PLAN_REVIEW_SCHEMA_VERSION, PlanReviewSchema, type PlanReview, type PlanReviewEntry } from "@/lib/schemas/plan-review";
import { fingerprint } from "./fingerprint";
import { classifyPlan, validatePlan, type DecisionStatus, type PlanClassification } from "./invariants";

/**
 * Applies a review on top of a raw plan. The raw plan is never modified; every decision keeps its whole history:
 *   raw decision → validator result → review → effective decision.
 * Rules: nothing is applied without an explicit approval; a decision the validator blocked cannot be approved (an edit may
 * fix it, and is re-validated); a rejected decision produces nothing; restrictions travel to the generator.
 */

export type ReviewOutcome = "applied" | "rejected" | "unreviewed" | "approval_refused_blocked" | "edit_still_blocked";

export interface ReviewedDecision {
  id: string;
  raw: Decision;
  rawStatus: DecisionStatus;
  rawIssues: PlanClassification["decisions"][number]["issues"];
  review: PlanReviewEntry | null;
  outcome: ReviewOutcome;
  /** What the generator is asked to execute; null when nothing is applied. */
  effective: Decision | null;
  origin: "planner" | "teacher_edit" | null;
  modifiedFields: string[];
  restrictions: string[];
}

export interface ReviewedPlan {
  /** The planner's plan, exactly as produced. */
  raw: AdaptationPlan;
  validation: PlanValidation;
  classification: PlanClassification;
  review: PlanReview;
  decisions: ReviewedDecision[];
  /** Applied decisions only (edits included), same ids, same fingerprints as the raw plan. */
  effective: AdaptationPlan;
  effectiveValidation: PlanValidation;
}

const changedFields = (raw: Decision, edited: Decision): string[] =>
  (["action", "intensity", "strategies", "supports", "response_target", "note"] as const).filter((k) => JSON.stringify(raw[k] ?? null) !== JSON.stringify(edited[k] ?? null));

export function reviewPlan(raw: AdaptationPlan, reviewInput: PlanReview, analysis: MaterialAnalysis, context: AdaptationContext): ReviewedPlan {
  const review = PlanReviewSchema.parse(reviewInput);
  if (review.plan_fingerprint !== fingerprint(raw)) throw new Error("La revisión corresponde a otro plan (huella distinta).");
  const known = new Set(raw.decisions.map((d) => d.id));
  for (const entry of review.entries) if (!known.has(entry.decision_id)) throw new Error(`La revisión cita una decisión inexistente: ${entry.decision_id}`);

  const validation = validatePlan(raw, analysis, context);
  const classification = classifyPlan(raw, validation);

  const decisions: ReviewedDecision[] = raw.decisions.map((d) => {
    const status = classification.decisions.find((c) => c.id === d.id)!;
    const entry = review.entries.find((e) => e.decision_id === d.id) ?? null;
    const base = { id: d.id, raw: d, rawStatus: status.status, rawIssues: status.issues, review: entry, modifiedFields: [] as string[], restrictions: entry?.restrictions ?? [] };
    if (!entry) return { ...base, outcome: "unreviewed" as const, effective: null, origin: null };
    if (entry.action === "rejected") return { ...base, outcome: "rejected" as const, effective: null, origin: null, restrictions: [] };
    if (entry.action === "approved") {
      return status.status === "blocked"
        ? { ...base, outcome: "approval_refused_blocked" as const, effective: null, origin: null }
        : { ...base, outcome: "applied" as const, effective: d, origin: "planner" as const };
    }
    const edited: Decision = { ...d, ...entry.edits };
    const check = validatePlan({ ...raw, decisions: raw.decisions.map((x) => (x.id === d.id ? edited : x)) }, analysis, context);
    const stillBlocked = check.issues.some((i) => i.severity === "block" && i.decision_id === d.id);
    return stillBlocked
      ? { ...base, outcome: "edit_still_blocked" as const, effective: null, origin: null, modifiedFields: changedFields(d, edited) }
      : { ...base, outcome: "applied" as const, effective: edited, origin: "teacher_edit" as const, modifiedFields: changedFields(d, edited) };
  });

  const effective: AdaptationPlan = { ...raw, decisions: decisions.flatMap((d) => (d.effective ? [d.effective] : [])) };
  return { raw, validation, classification, review, decisions, effective, effectiveValidation: validatePlan(effective, analysis, context) };
}

/**
 * Review used when nobody reviewed the plan (the offline pipeline): everything the validator did not block is approved, the
 * rest is rejected, so behaviour is the same as dropping blocked decisions. Marked `auto`, never presented as a teacher's.
 */
export function autoReview(raw: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): PlanReview {
  const classification = classifyPlan(raw, validatePlan(raw, analysis, context));
  return {
    schema_version: PLAN_REVIEW_SCHEMA_VERSION,
    plan_fingerprint: fingerprint(raw),
    reviewer: { kind: "auto" },
    reviewed_at: "auto",
    entries: classification.decisions.map((c) =>
      c.status === "blocked"
        ? { decision_id: c.id, action: "rejected" as const, reason: "Bloqueada por las invariantes deterministas" }
        : { decision_id: c.id, action: "approved" as const, reason: c.status === "review" ? "Aplicada con aviso de revisión" : "Sin avisos" },
    ),
  };
}

/**
 * A teacher's edit of the supports carries only KINDS the browser chose; whether a support is built on the task's own data is
 * not something the browser can declare or the server can prove, so it is derived, never taken from the payload:
 *   · a kind the proposal already had keeps the proposal's own value (editing something else never launders it to false);
 *   · a kind the teacher adds is "unknown" and is treated as `true`, the conservative reading the validator already knows
 *     (it turns into a block or a review, never into silence).
 * Applied when the review is SUBMITTED, so persisted reviews keep exactly the values they were saved with.
 */
export function normalizeTeacherEdits(raw: AdaptationPlan, review: PlanReview): PlanReview {
  if (review.reviewer.kind !== "teacher") return review;
  return {
    ...review,
    entries: review.entries.map((entry) => {
      const supports = entry.edits?.supports;
      if (!supports) return entry;
      const original = raw.decisions.find((d) => d.id === entry.decision_id)?.supports ?? [];
      return {
        ...entry,
        edits: { ...entry.edits, supports: supports.map((s) => ({ kind: s.kind, uses_task_data: original.some((o) => o.kind === s.kind) ? original.filter((o) => o.kind === s.kind).some((o) => o.uses_task_data) : true })) },
      };
    }),
  };
}

export const appliedDecisions = (reviewed: ReviewedPlan) => reviewed.decisions.filter((d) => d.outcome === "applied" && d.effective);
