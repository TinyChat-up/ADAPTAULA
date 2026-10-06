import { z } from "zod";

/**
 * PedagogicalReview v1: concrete checks of an adapted document against the analysis, the plan and the context. No global
 * score: each check says PASS/WARN/FAIL, which targets it affects and why, in one short line. Checks that can be computed
 * are computed (`src/lib/adaptation/review.ts`); the AI reviewer only answers the ones that need judgment and can never
 * turn a deterministic FAIL into a PASS.
 */

export const PEDAGOGICAL_REVIEW_SCHEMA_VERSION = 1;

export const REVIEW_CHECKS = [
  "objectives_preserved",
  "protected_elements_preserved",
  "answers_not_leaked",
  "required_data_preserved",
  "instructions_complete",
  "constraints_preserved",
  "response_format_appropriate",
  "functional_supports_applied",
  "visual_load_reasonable",
  "reading_load_reasonable",
  "age_appropriate",
  "no_infantilization",
  "traceability_complete",
] as const;
export type ReviewCheck = (typeof REVIEW_CHECKS)[number];

/** deterministic: computed · ai: judgment only · hybrid: computed part + AI part, the worse status wins. */
export const CHECK_METHODS: Record<ReviewCheck, "deterministic" | "ai" | "hybrid"> = {
  objectives_preserved: "deterministic",
  protected_elements_preserved: "deterministic",
  /** Hybrid: the mechanical part (numbers) is computed; a textual answer cannot be excluded by matching and is left to the reviewer. */
  answers_not_leaked: "hybrid",
  required_data_preserved: "deterministic",
  instructions_complete: "deterministic",
  constraints_preserved: "deterministic",
  response_format_appropriate: "deterministic",
  functional_supports_applied: "hybrid",
  visual_load_reasonable: "deterministic",
  reading_load_reasonable: "deterministic",
  age_appropriate: "ai",
  no_infantilization: "hybrid",
  traceability_complete: "deterministic",
};

/** A FAIL here means the document cannot be delivered as it is: it changes what is taught or gives the answer away. */
export const BLOCKING_CHECKS = [
  "objectives_preserved",
  "protected_elements_preserved",
  "answers_not_leaked",
  "required_data_preserved",
  "constraints_preserved",
] as const satisfies readonly ReviewCheck[];

export const AI_REVIEW_CHECKS = REVIEW_CHECKS.filter((c) => CHECK_METHODS[c] !== "deterministic") as ReviewCheck[];

export const CHECK_STATUSES = ["PASS", "WARN", "FAIL", "SKIPPED"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const ReviewTarget = z.string().regex(/^(blk_[a-z0-9]{4,24}|(act|ctt|vis|prt|obj|sec|dec)_[0-9]{1,4})$/);

export const CheckResultSchema = z.object({
  check: z.enum(REVIEW_CHECKS),
  method: z.enum(["deterministic", "ai"]),
  status: z.enum(CHECK_STATUSES),
  targets: z.array(ReviewTarget).max(30),
  detail: z.string().max(240),
  /** The check could not decide mechanically (e.g. a textual inferred answer): a WARN that a semantic review may resolve. Optional, so v1 reviews stay valid. */
  needs_semantic_review: z.boolean().optional(),
  /** The teacher accepted a WARN/FAIL knowingly. The original status is kept for audit. */
  teacher_override: z.object({ accepted: z.literal(true), note: z.string().max(240).optional() }).optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const REVIEW_VERDICTS = ["approved", "approved_with_warnings", "needs_revision", "blocked"] as const;

export const PedagogicalReviewSchema = z.object({
  schema_version: z.literal(PEDAGOGICAL_REVIEW_SCHEMA_VERSION),
  document_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  plan_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  checks: z.array(CheckResultSchema).max(200),
  verdict: z.enum(REVIEW_VERDICTS),
  /** Only these blocks go back to the generator; the rest of the document is kept. */
  blocks_to_revise: z.array(z.string().regex(/^blk_[a-z0-9]{4,24}$/)).max(120),
});
export type PedagogicalReview = z.infer<typeof PedagogicalReviewSchema>;

/** What the AI reviewer is asked for: only the non-deterministic checks, nothing it could contradict. */
export const AiReviewDraftSchema = z.object({
  checks: z
    .array(
      z.object({
        check: z.enum(REVIEW_CHECKS).refine((c) => CHECK_METHODS[c] !== "deterministic", "Esta comprobación es determinista"),
        status: z.enum(["PASS", "WARN", "FAIL"]),
        targets: z.array(ReviewTarget).max(30),
        detail: z.string().max(240),
      }),
    )
    .max(40),
});
export type AiReviewDraft = z.infer<typeof AiReviewDraftSchema>;
