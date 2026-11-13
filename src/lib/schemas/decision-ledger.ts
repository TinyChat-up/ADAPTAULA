import { z } from "zod";
import { AdaptationActionSchema, DecisionIdSchema, FLAG_SEVERITIES, ReviewFlagSchema, StrategyKeySchema } from "./adaptation-plan";
import { DimensionKeySchema } from "./functional-profile";

/**
 * DecisionLedger v1 (ADR-044): the per-activity record of an adaptation plan, derived on the server from the plan, its
 * validation, the context and the analysis. It never comes from a model and is never shown to the student.
 *
 * Its rule is to state only what the data shows. When the reason for something cannot be deduced (why a need was not applied,
 * whether a barrier remains, whether a resource gives a hint that only a teacher can judge), the entry says `pending_review`
 * instead of inventing a justification.
 */
export const DECISION_LEDGER_VERSION = 1;

/** justified: valid and backed by an active need. teacher_validation: it applies, but the teacher must see it. blocked: not applied. */
export const LEDGER_DECISION_STATUSES = ["justified", "teacher_validation", "blocked"] as const;

/** The eight hint questions of the V2.2 method (identifiers only; the method itself is private). */
export const HINT_QUESTIONS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"] as const;
export type HintQuestion = (typeof HINT_QUESTIONS)[number];

/**
 * deterministic: decided from typed data. partial: an indicator is checked; not finding it does not prove there is no hint.
 * teacher_judgment: not checked automatically at all.
 */
export const HINT_COVERAGES = ["deterministic", "partial", "teacher_judgment"] as const;
export type HintCoverage = (typeof HINT_COVERAGES)[number];

/**
 * flagged: the indicator was found. clear: a deterministic check passed. not_detected: a partial check found nothing (the teacher
 * still decides). pending_review: nothing was checked. not_applicable: the decision adds no presentation, visual or space resource.
 */
export const HINT_RESULTS = ["flagged", "clear", "not_detected", "pending_review", "not_applicable"] as const;
export type HintResult = (typeof HINT_RESULTS)[number];

export const HintCheckSchema = z.object({
  question: z.enum(HINT_QUESTIONS),
  coverage: z.enum(HINT_COVERAGES),
  result: z.enum(HINT_RESULTS),
  detail: z.string().max(240).nullable(),
  /**
   * What the planner v3 itself answered (ADR-045): a declaration, never a check. «no» does not clear anything; «yes» withholds the
   * decision for the teacher. Null when the plan comes from a planner that declares nothing (v1, v2).
   */
  declared: z.enum(["yes", "no", "not_answered"]).nullable(),
});
export type HintCheck = z.infer<typeof HintCheckSchema>;

/** Evidence that explains why an active need is not applied on an activity. Absent evidence = pending review, never a guess. */
export const NOT_APPLIED_EVIDENCE = ["activity_has_no_response", "decision_blocked", "needs_conflict"] as const;
/** Evidence of a barrier that remains after the plan. Only these can be deduced; anything else is the teacher's to judge. */
export const RESIDUAL_EVIDENCE = ["decision_blocked", "instruction_over_limit"] as const;

const ActivityRef = z.string().regex(/^act_[0-9]{1,4}$/);

export const LedgerDecisionSchema = z.object({
  id: DecisionIdSchema,
  target: z.string().max(20),
  /** The activities this decision reaches (its target, the activities that use its text or visual, or all for `document`). */
  activities: z.array(ActivityRef).max(150),
  action: AdaptationActionSchema,
  status: z.enum(LEDGER_DECISION_STATUSES),
  /** individual: backed by needs of this profile. none: it changes nothing (`keep`). Plan decisions are never universal. */
  origin: z.enum(["individual", "none"]),
  dimensions: z.array(DimensionKeySchema).max(4),
  strategies: z.array(StrategyKeySchema).max(3),
  /** Whether the planner wrote a note. Its text is not copied: the plan already holds it. */
  has_note: z.boolean(),
  issues: z.array(z.object({ flag: ReviewFlagSchema, severity: z.enum(FLAG_SEVERITIES) })).max(40),
  hint_test: z.array(HintCheckSchema).length(HINT_QUESTIONS.length),
  /** Planner v3 declarations for this decision; null for v1 and v2. `withheld`: not applied without the teacher. */
  declared: z
    .object({ status: z.enum(["active", "conditional"]), question: z.string().max(10).nullable(), precedents: z.array(z.string().max(12)).max(6), withheld: z.boolean() })
    .nullable(),
});
export type LedgerDecision = z.infer<typeof LedgerDecisionSchema>;

export const NotAppliedNeedSchema = z.object({
  dimension: DimensionKeySchema,
  evidence: z.enum(NOT_APPLIED_EVIDENCE).nullable(),
  /** explained: the evidence accounts for it. pending_review: no evidence in the data, or the evidence needs a teacher. */
  status: z.enum(["explained", "pending_review"]),
});

export const LedgerActivitySchema = z.object({
  activity: ActivityRef,
  decision_ids: z.array(DecisionIdSchema).max(60),
  /** none: no decision touches it (not intervening is a valid decision). blocked_only: every decision on it is blocked. */
  intervention: z.enum(["none", "changed", "blocked_only"]),
  needs_not_applied: z.array(NotAppliedNeedSchema).max(69),
});
export type LedgerActivity = z.infer<typeof LedgerActivitySchema>;

export const ResidualBarrierSchema = z.object({
  activity: ActivityRef,
  dimension: DimensionKeySchema.nullable(),
  evidence: z.enum(RESIDUAL_EVIDENCE),
  decision_id: DecisionIdSchema.nullable(),
});

export const DecisionLedgerSchema = z.object({
  version: z.literal(DECISION_LEDGER_VERSION),
  plan: z.object({ analysis_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), context_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
  decisions: z.array(LedgerDecisionSchema).max(60),
  activities: z.array(LedgerActivitySchema).max(150),
  needs: z.array(z.object({ dimension: DimensionKeySchema, level: z.enum(["low", "medium", "high"]), applied_in: z.array(ActivityRef), blocked_in: z.array(ActivityRef) })).max(69),
  /** Needs the context builder left out, with its own reason (presentation, not applicable, resolved by presentation). */
  omitted_needs: z.array(z.object({ dimension: DimensionKeySchema, reason: z.enum(["presentation_only", "not_applicable", "resolved_by_presentation", "out_of_scope"]) })).max(69),
  /** «No necesita» and «sin valorar» are different: neither activates a support, and neither is inferred. Null: profile not given. */
  profile: z.object({ not_needed: z.array(DimensionKeySchema).max(69), unassessed_count: z.number().int().min(0) }).nullable(),
  residual_barriers: z.array(ResidualBarrierSchema).max(300),
  /** Always false: the ledger only lists barriers it can prove. Absence of an entry is not absence of a barrier. */
  residual_barriers_complete: z.literal(false),
  /**
   * What a planner v3 declared under the V2.2 method, kept apart from what the platform proves: the rules used (hashes and ids), its
   * questions for the teacher and the barriers it says it leaves. Every entry is pending the teacher's review. Null for v1 and v2.
   */
  declarations: z
    .object({
      rules: z.object({ version: z.string().max(20), package_sha256: z.string().regex(/^[a-f0-9]{64}$/), block_sha256: z.string().regex(/^[a-f0-9]{64}$/), precedents_sent: z.number().int().min(0) }).nullable(),
      teacher_questions: z.array(z.object({ id: z.string().max(10), text: z.string().max(200).nullable(), decision_ids: z.array(DecisionIdSchema).max(30) })).max(8),
      residual_barriers: z.array(z.object({ activity: ActivityRef, dimensions: z.array(DimensionKeySchema).max(4), note: z.string().max(160).nullable(), status: z.literal("pending_review") })).max(20),
      issues: z.array(z.object({ decision_id: DecisionIdSchema.nullable(), code: z.string().max(40), message: z.string().max(240) })).max(80),
    })
    .nullable(),
});
export type DecisionLedger = z.infer<typeof DecisionLedgerSchema>;
