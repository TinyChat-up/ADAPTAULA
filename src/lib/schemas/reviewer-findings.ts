import { z } from "zod";
import { AI_REVIEW_CHECKS, ReviewTarget } from "./pedagogical-review";

/**
 * What `pedagogical_reviewer@v1` writes: compact findings, nothing else. It is NOT a `PedagogicalReview`: the server composes
 * that from the deterministic findings plus these (docs/ADAPTATION.md § Reviewer). Strict on purpose: a reviewer observes and
 * evaluates, it never corrects, so a field such as `improved_text` or `replacement` is a contract violation, not an extra.
 * The checks it may name are only the ones that need judgment (hybrid and AI); the deterministic ones are not offered.
 */

export const REVIEWER_FINDINGS_VERSION = 1;

export const ReviewerFindingSchema = z
  .object({
    check_key: z.enum(AI_REVIEW_CHECKS as [(typeof AI_REVIEW_CHECKS)[number], ...(typeof AI_REVIEW_CHECKS)[number][]]),
    target_ids: z.array(ReviewTarget).max(10),
    verdict: z.enum(["PASS", "WARN", "FAIL"]),
    reason: z.string().trim().min(1).max(160),
    requires_human_review: z.boolean().optional(),
  })
  .strict();
export type ReviewerFinding = z.infer<typeof ReviewerFindingSchema>;

export const ReviewerFindingsSchema = z.object({ findings: z.array(ReviewerFindingSchema).max(12) }).strict();
export type ReviewerFindings = z.infer<typeof ReviewerFindingsSchema>;
