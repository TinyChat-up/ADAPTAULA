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

// ---------------------------------------------------------------------------------------------------------------------
// pedagogical_reviewer@v2 (etapa 2.3): the same findings plus ONE judgment per support under review
// ---------------------------------------------------------------------------------------------------------------------

export const REVIEWER_FINDINGS_V2_VERSION = 2;

/**
 * What a support does with respect to what the activity evaluates (docs/ADAPTATION.md § Revisión semántica de los apoyos):
 *   performs    it carries out the evaluated competence or hands over an item's answer;
 *   hints       it facilitates the answer more than access requires, without performing it;
 *   legitimate  it gives access, teaches a procedure or is a criterion to APPLY: the student still does the evaluated work;
 *   unsure      the reviewer cannot tell (an honest answer, never read as «legitimate»).
 */
export const SUPPORT_CLASSES = ["performs", "hints", "legitimate", "unsure"] as const;
export type SupportClass = (typeof SUPPORT_CLASSES)[number];

/** HOW a support performs or facilitates. `analogy_of_item` is the indirect case: it never confirms anything by itself. */
export const SUPPORT_HOWS = ["states_concept", "performs_operation", "resolves_item", "assigns_item", "gives_result", "analogy_of_item", "other"] as const;
export type SupportHow = (typeof SUPPORT_HOWS)[number];

/** The most judgments one answer carries: the server never sends more supports than this, so the contract never has to grow with the sheet. */
export const MAX_SUPPORT_JUDGMENTS = 12;

export const SupportJudgmentSchema = z
  .object({
    block_id: z.string().regex(/^blk_[a-z0-9]{4,24}$/),
    class: z.enum(SUPPORT_CLASSES),
    how: z.enum(SUPPORT_HOWS).optional(),
    protected_id: z.string().regex(/^prt_[0-9]{1,4}$/).optional(),
    reason: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type SupportJudgment = z.infer<typeof SupportJudgmentSchema>;

/** `support_judgments` is optional on purpose: an answer without it is valid, and every support then simply stays unjudged (never approved). */
export const ReviewerFindingsV2Schema = z
  .object({ findings: z.array(ReviewerFindingSchema).max(12), support_judgments: z.array(SupportJudgmentSchema).max(MAX_SUPPORT_JUDGMENTS).optional() })
  .strict();
export type ReviewerFindingsV2 = z.infer<typeof ReviewerFindingsV2Schema>;

/** What the formal clean-up changed, as counts only (never a value of the answer). */
export interface SanitationCounts {
  reasons_truncated: number;
  judgment_keys_dropped: number;
  judgments_over_limit: number;
}

const JUDGMENT_KEYS = new Set(["block_id", "class", "how", "protected_id", "reason"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The only repairs of an answer BEFORE the strict contract, all formal and none able to change a verdict or an id:
 *   · a reason longer than its limit is cut (160 for a finding, 120 for a judgment);
 *   · a key a judgment should not carry is dropped (never stored, never read);
 *   · judgments beyond the limit are dropped (those supports stay unjudged, which is never an approval).
 * A missing, mistyped or invented id, a wrong verdict or class, a finding with an extra key, an answer without a required field: none of
 * that is «fixed» here; the contract rejects it (and the bounded re-ask of the pipeline applies).
 */
export function sanitizeReviewerV2(raw: unknown): { value: unknown; counts: SanitationCounts } {
  const counts: SanitationCounts = { reasons_truncated: 0, judgment_keys_dropped: 0, judgments_over_limit: 0 };
  if (!isRecord(raw)) return { value: raw, counts };
  const cut = (text: unknown, max: number) => {
    if (typeof text !== "string" || text.trim().length <= max) return text;
    counts.reasons_truncated += 1;
    return text.trim().slice(0, max).trimEnd();
  };
  const out: Record<string, unknown> = { ...raw };
  if (Array.isArray(raw.findings)) out.findings = raw.findings.map((f) => (isRecord(f) && "reason" in f ? { ...f, reason: cut(f.reason, 160) } : f));
  if (Array.isArray(raw.support_judgments)) {
    const judgments = raw.support_judgments.slice(0, MAX_SUPPORT_JUDGMENTS);
    counts.judgments_over_limit = raw.support_judgments.length - judgments.length;
    out.support_judgments = judgments.map((j) => {
      if (!isRecord(j)) return j;
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(j)) {
        if (JUDGMENT_KEYS.has(key)) kept[key] = value;
        else counts.judgment_keys_dropped += 1;
      }
      return "reason" in kept ? { ...kept, reason: cut(kept.reason, 120) } : kept;
    });
  }
  return { value: out, counts };
}
