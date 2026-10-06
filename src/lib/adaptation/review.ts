import {
  BLOCKING_CHECKS,
  CHECK_METHODS,
  PEDAGOGICAL_REVIEW_SCHEMA_VERSION,
  PedagogicalReviewSchema,
  REVIEW_CHECKS,
  type AiReviewDraft,
  type CheckResult,
  type CheckStatus,
  type PedagogicalReview,
  type ReviewCheck,
} from "@/lib/schemas/pedagogical-review";
import { fingerprint } from "./fingerprint";
import {
  answersNotLeaked,
  constraintsPreserved,
  functionalSupportsApplied,
  instructionsComplete,
  noInfantilization,
  objectivesPreserved,
  protectedElementsPreserved,
  readingLoadReasonable,
  requiredDataPreserved,
  responseFormatAppropriate,
  traceabilityComplete,
  visualLoadReasonable,
  type ReviewInput,
} from "./review-checks";

export type { ReviewInput } from "./review-checks";

const DETERMINISTIC: Partial<Record<ReviewCheck, (input: ReviewInput) => CheckResult>> = {
  objectives_preserved: objectivesPreserved,
  protected_elements_preserved: protectedElementsPreserved,
  answers_not_leaked: answersNotLeaked,
  required_data_preserved: requiredDataPreserved,
  instructions_complete: instructionsComplete,
  constraints_preserved: constraintsPreserved,
  response_format_appropriate: responseFormatAppropriate,
  functional_supports_applied: functionalSupportsApplied,
  visual_load_reasonable: visualLoadReasonable,
  reading_load_reasonable: readingLoadReasonable,
  no_infantilization: noInfantilization,
  traceability_complete: traceabilityComplete,
};

const RANK: Record<CheckStatus, number> = { SKIPPED: 0, PASS: 1, WARN: 2, FAIL: 3 };

/** Every check, computed where possible. Checks that only an AI can judge come back as SKIPPED until the reviewer runs. */
export function deterministicChecks(input: ReviewInput): CheckResult[] {
  return REVIEW_CHECKS.map((check) => {
    const run = DETERMINISTIC[check];
    return run ? run(input) : { check, method: "ai" as const, status: "SKIPPED" as const, targets: [], detail: "Requiere la revisión IA" };
  });
}

/**
 * Merges the AI reviewer's answers: it can fill the AI checks and add its findings to the hybrid ones, never soften a
 * deterministic result (the worse status wins) and never touch a purely deterministic check.
 */
export function mergeAiChecks(checks: CheckResult[], ai: AiReviewDraft | null): CheckResult[] {
  if (!ai) return checks;
  const out = [...checks];
  for (const a of ai.checks) {
    if (CHECK_METHODS[a.check] === "deterministic") continue;
    const aiResult: CheckResult = { check: a.check, method: "ai", status: a.status, targets: a.targets, detail: a.detail };
    const index = out.findIndex((c) => c.check === a.check && (c.method === "ai" || CHECK_METHODS[a.check] === "hybrid"));
    const current = index >= 0 ? out[index]! : null;
    if (current === null) out.push(aiResult);
    else if (current.status === "SKIPPED") out[index] = aiResult;
    // An open semantic question can be closed by a PASS; a finding (WARN/FAIL) is added next to it. Nothing else is ever softened.
    else if (current.needs_semantic_review) {
      if (aiResult.status === "PASS") out[index] = aiResult;
      else out.push(aiResult);
    } else if (RANK[aiResult.status] > RANK[current.status]) out.push(aiResult);
  }
  return out;
}

export function verdictOf(checks: CheckResult[]): PedagogicalReview["verdict"] {
  const effective = checks.filter((c) => !c.teacher_override);
  if (effective.some((c) => c.status === "FAIL" && (BLOCKING_CHECKS as readonly string[]).includes(c.check))) return "blocked";
  if (effective.some((c) => c.status === "FAIL")) return "needs_revision";
  if (effective.some((c) => c.status === "WARN")) return "approved_with_warnings";
  return "approved";
}

export function buildReview(input: ReviewInput, ai: AiReviewDraft | null = null): PedagogicalReview {
  return assembleReview(input, mergeAiChecks(deterministicChecks(input), ai));
}

/** Verdict, blocks to revise and fingerprints for a finished list of checks (shared by the permissive and the scoped merge). */
export function assembleReview(input: ReviewInput, checks: CheckResult[]): PedagogicalReview {
  const blocks = checks.filter((c) => c.status === "FAIL").flatMap((c) => c.targets.filter((t) => t.startsWith("blk_")));
  return PedagogicalReviewSchema.parse({
    schema_version: PEDAGOGICAL_REVIEW_SCHEMA_VERSION,
    document_fingerprint: fingerprint(input.document),
    plan_fingerprint: fingerprint(input.plan),
    checks,
    verdict: verdictOf(checks),
    blocks_to_revise: [...new Set(blocks)],
  });
}

export function checkOf(review: Pick<PedagogicalReview, "checks">, check: ReviewCheck): CheckResult {
  const matches = review.checks.filter((c) => c.check === check);
  return matches.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a), matches[0]!);
}
