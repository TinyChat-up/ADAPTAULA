import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import { allBlocks } from "@/lib/schemas/material-document";
import { AI_REVIEW_CHECKS, type CheckResult, type CheckStatus, type ReviewCheck } from "@/lib/schemas/pedagogical-review";
import { studentText } from "./document-text";
import { planExecutability, type ExecutionRoute } from "./execution";
import { deterministicChecks } from "./review";
import type { ReviewInput } from "./review-checks";
import type { ReviewedPlan } from "./plan-review";

/**
 * The minimum a pedagogical reviewer needs, built deterministically (same input, same context, same fingerprint). It is a
 * narrowing, not a copy: only the checks the AI answers (never the ones TypeScript already settled), only the active needs,
 * the student-visible text of the document, the decisions that explain what is and is not in it, the protected elements of
 * the activities under judgment and, for the semantic leak check only, the inferred answers as INTERNAL REFERENCE.
 * Never: the learner's alias or labels, diagnosis, the catalog of dimensions, administrative fields, answer keys.
 */

export const REVIEW_CONTEXT_VERSION = 1;

export type JudgedCheck = (typeof AI_REVIEW_CHECKS)[number];

export interface PedagogicalReviewContext {
  context_version: typeof REVIEW_CONTEXT_VERSION;
  language: string;
  audience: { stage: AdaptationContext["education"]["stage"]; age_band: AdaptationContext["audience"]["age_band"]; register: AdaptationContext["audience"]["register"]; infantilization_guard: boolean };
  active_needs: Array<{ dimension: DimensionKey; level: "low" | "medium" | "high" }>;
  /** Result of the checks the system already computed that the reviewer judges on top of. Context, not something to re-decide. */
  deterministic: Array<{ check: JudgedCheck; status: CheckStatus; detail: string; needs_semantic_review?: true }>;
  /** What the plan decided and whether it reached the document: applied, rejected (reviewer's team), or pending for the renderer. */
  decisions: Array<{ id: string; target: string; action: string; outcome: string; route: ExecutionRoute | null; supports: string[]; addresses: DimensionKey[] }>;
  document: { blocks: Array<{ id: string; type: string; origin: string; refs: string[]; decisions: string[]; text: string }> };
  protected: Array<{ id: string; type: string; importance: string; value: string; activity_ids: string[] }>;
  /** Deduced answers, to compare with what the student sees. NEVER source content, never to be quoted. */
  internal_reference_only: Array<{ activity: string; inferred_answer: string; use: "internal_reference_only" }>;
  review_scope: {
    /** The only ids a finding may point at. */
    allowed_targets: string[];
    /** Checks that must come back with at least one finding. */
    must_answer: JudgedCheck[];
    /** For a check with an open semantic question: every one of these targets needs its own finding. */
    required_targets: Partial<Record<JudgedCheck, string[]>>;
  };
}

const isJudged = (check: ReviewCheck): check is JudgedCheck => (AI_REVIEW_CHECKS as readonly string[]).includes(check);

/** Where the reviewer's authority begins and ends, derived from the deterministic results. Also used by the server-side merge. */
export interface ReviewScope {
  allowed: ReadonlySet<string>;
  mustAnswer: readonly JudgedCheck[];
  required: Partial<Record<JudgedCheck, string[]>>;
}

export function reviewScope(base: readonly CheckResult[], input: ReviewInput, decisionIds: readonly string[]): ReviewScope {
  const semantic = base.find((c) => c.check === "answers_not_leaked" && c.needs_semantic_review);
  const allowed = new Set<string>([...allBlocks(input.document).map((b) => b.id), ...input.analysis.activities.map((a) => a.id), ...decisionIds]);
  const mustAnswer: JudgedCheck[] = AI_REVIEW_CHECKS.filter((c) => c !== "answers_not_leaked" || semantic !== undefined);
  return { allowed, mustAnswer, required: semantic ? { answers_not_leaked: [...semantic.targets] } : {} };
}

export function buildPedagogicalReviewContext(input: ReviewInput, reviewed?: ReviewedPlan): PedagogicalReviewContext {
  const { analysis, context, document } = input;
  const base = deterministicChecks(input);
  const execution = reviewed ? planExecutability(reviewed, analysis, context) : null;
  const decisionIds = (reviewed ? reviewed.raw.decisions : input.plan.decisions).map((d) => d.id);
  const scope = reviewScope(base, input, decisionIds);

  const blocks = allBlocks(document).filter((b) => b.trace.origin !== "structure");
  const adaptedRefs = new Set(blocks.filter((b) => b.trace.origin !== "original").flatMap((b) => b.trace.source_refs));
  const underJudgment = new Set([...adaptedRefs, ...(scope.required.answers_not_leaked ?? [])]);
  const answerFor = new Set(scope.required.answers_not_leaked ?? []);

  return {
    context_version: REVIEW_CONTEXT_VERSION,
    language: context.education.language,
    audience: { stage: context.education.stage, age_band: context.audience.age_band, register: context.audience.register, infantilization_guard: context.audience.infantilization_guard },
    active_needs: context.needs.map((n) => ({ dimension: n.dimension, level: n.level })),
    deterministic: base.filter((c) => isJudged(c.check) && c.status !== "SKIPPED").map((c) => ({ check: c.check as JudgedCheck, status: c.status, detail: c.detail, ...(c.needs_semantic_review ? { needs_semantic_review: true as const } : {}) })),
    decisions: (reviewed ? reviewed.decisions : input.plan.decisions.map((d) => ({ id: d.id, raw: d, outcome: "applied", effective: d }))).map((rd) => {
      const d = rd.effective ?? rd.raw;
      const route = execution?.decisions.find((x) => x.id === rd.id)?.route ?? null;
      return { id: rd.id, target: d.target, action: d.action, outcome: route === "deferred_to_renderer" ? "deferred_to_renderer" : rd.outcome, route, supports: d.supports.map((s) => s.kind), addresses: d.dimensions };
    }),
    document: { blocks: blocks.map((b) => ({ id: b.id, type: b.type, origin: b.trace.origin, refs: b.trace.source_refs, decisions: b.trace.decision_ids, text: b.type === "image" || b.type === "chart" ? "" : studentText(b) })) },
    protected: analysis.protected_elements.filter((p) => p.activity_ids.some((a) => underJudgment.has(a))).map((p) => ({ id: p.id, type: p.type, importance: p.importance, value: p.value, activity_ids: p.activity_ids })),
    internal_reference_only: analysis.activities
      .filter((a) => a.expected_answer.basis === "inferred" && a.expected_answer.value && answerFor.has(a.id))
      .map((a) => ({ activity: a.id, inferred_answer: a.expected_answer.value!, use: "internal_reference_only" as const })),
    review_scope: { allowed_targets: [...scope.allowed].sort(), must_answer: [...scope.mustAnswer], required_targets: scope.required },
  };
}

