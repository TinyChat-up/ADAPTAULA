import { PEDAGOGICAL_REVIEWER_V1 } from "@prompts/pedagogical-reviewer/v1";
import { estimateCostUsd } from "@/lib/ai/costs";
import { AIError, toAIError } from "@/lib/ai/errors";
import { parseStructured } from "@/lib/ai/structured";
import type { AIProvider, ModelSelection, StructuredResponse } from "@/lib/ai/types";
import {
  CHECK_METHODS,
  type AiReviewDraft,
  type CheckResult,
  type PedagogicalReview,
  type ReviewCheck,
} from "@/lib/schemas/pedagogical-review";
import { ReviewerFindingsSchema, type ReviewerFindings } from "@/lib/schemas/reviewer-findings";
import { assembleReview, deterministicChecks } from "./review";
import type { ReviewInput } from "./review-checks";
import { reviewScope, type JudgedCheck, type PedagogicalReviewContext, type ReviewScope } from "./review-context";
import { RejectedStageOutput, rejectedRun, type PedagogicalReviewer, type StageRunRecord } from "./services";

/**
 * The real pedagogical reviewer and, above all, the SERVER-SIDE MERGE that bounds it. The model only observes; this module
 * decides what its findings can and cannot change:
 *  1. a deterministic FAIL always wins and a finding never softens it;
 *  2. a structural WARN (a decision still pending, a need without a decision) is never closed by a finding: the AI can add its
 *     judgment next to it, never in place of it;
 *  3. only an open SEMANTIC question (`needs_semantic_review`) can be closed, and only when every required target has a finding;
 *  4. a finding on a check the system settled, or on a target outside the scope, is rejected and recorded;
 *  5. a required judgment that never came is not a PASS: it becomes a WARN;
 *  6. "requires human review" and uncertainty are WARN at least.
 */

export const REVIEWER_TIMEOUT_MS = 90_000;

export interface ReviewerCallParams {
  reviewContext: PedagogicalReviewContext;
  selection: ModelSelection;
  provider: AIProvider;
  maxOutputTokens: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The messages of a reviewer request. Exposed so the evals and tests inspect exactly what a model would receive. */
export function reviewerRequestParts(params: Pick<ReviewerCallParams, "reviewContext">) {
  return { prompt: PEDAGOGICAL_REVIEWER_V1, parts: PEDAGOGICAL_REVIEWER_V1.buildUserParts({ reviewContext: params.reviewContext }) };
}

export interface ReviewerCall {
  response: StructuredResponse;
  run: StageRunRecord;
}

export async function callReviewer(params: ReviewerCallParams): Promise<ReviewerCall> {
  const { prompt, parts } = reviewerRequestParts(params);
  const started = Date.now();
  let response: StructuredResponse;
  try {
    response = await params.provider.generateStructured({
      selection: params.selection,
      system: prompt.system,
      messages: [{ role: "user", content: parts }],
      output: prompt.output,
      maxOutputTokens: params.maxOutputTokens,
      timeoutMs: params.timeoutMs ?? REVIEWER_TIMEOUT_MS,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    throw toAIError(error);
  }
  const run: StageRunRecord = {
    purpose: "review",
    attempt: 1,
    alias: params.selection.alias,
    provider: params.selection.provider,
    model: response.model,
    effort: params.selection.effort,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cachedInputTokens: response.usage.cachedInputTokens,
    cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
    estimatedCostUsd: estimateCostUsd(params.selection.provider, response.model, response.usage),
    latencyMs: response.latencyMs || Date.now() - started,
    status: response.stopReason === "refusal" ? "refused" : "success",
    errorCode: response.stopReason === "refusal" ? "refusal" : null,
    schemaKey: prompt.output.name,
    schemaVersion: prompt.schemaVersion,
    callKind: "initial",
    reasoningTokens: null,
  };
  return { response, run };
}

export type ReviewerParse = { outcome: "ok"; findings: ReviewerFindings } | { outcome: "truncated" | "refused" | "not_json" | "schema"; issues: string[] };

/** Stop reason first (a cut-off answer is never parsed), then JSON, then the strict contract. */
export function parseReviewerResponse(response: StructuredResponse): ReviewerParse {
  if (response.stopReason === "refusal") return { outcome: "refused", issues: ["El modelo rechazó la petición."] };
  if (response.stopReason === "max_tokens") return { outcome: "truncated", issues: ["La salida alcanzó el límite de tokens."] };
  const parsed = parseStructured(response.text, ReviewerFindingsSchema);
  return parsed.ok ? { outcome: "ok", findings: parsed.data } : { outcome: parsed.kind, issues: parsed.issues };
}

/** Findings → the draft the merge reads. A request for human review can only raise a PASS to a WARN, never lower anything. */
export function findingsToDraft(findings: ReviewerFindings): AiReviewDraft {
  return {
    checks: findings.findings.map((f) => {
      const human = f.requires_human_review === true;
      const status = human && f.verdict === "PASS" ? ("WARN" as const) : f.verdict;
      return { check: f.check_key, status, targets: f.target_ids, detail: (human ? `${f.reason} · requiere revisión humana` : f.reason).slice(0, 240) };
    }),
  };
}

export interface RejectedFinding {
  check: string;
  targets: string[];
  reason: "deterministic_check" | "target_out_of_scope";
}

export interface MergeOutcome {
  checks: CheckResult[];
  rejected: RejectedFinding[];
  /** Required judgments that never came: each one became a WARN, never a PASS. */
  pending: string[];
}

const aiResult = (c: AiReviewDraft["checks"][number]): CheckResult => ({ check: c.check, method: "ai", status: c.status, targets: [...new Set(c.targets)].slice(0, 30), detail: c.detail.slice(0, 240) });
const pendingResult = (check: ReviewCheck, targets: string[]): CheckResult => ({
  check,
  method: "ai",
  status: "WARN",
  targets: targets.slice(0, 30),
  detail: "Revisión semántica pendiente: el reviewer no emitió juicio sobre esto",
  needs_semantic_review: true,
});

/** `deterministic findings + AI findings → checks`, with the precedence rules of the header. Pure: no model, no network. */
export function mergeReviewerFindings(base: readonly CheckResult[], ai: AiReviewDraft, scope: ReviewScope): MergeOutcome {
  const rejected: RejectedFinding[] = [];
  const accepted = new Map<ReviewCheck, CheckResult[]>();
  for (const finding of ai.checks) {
    if (CHECK_METHODS[finding.check] === "deterministic") {
      rejected.push({ check: finding.check, targets: finding.targets, reason: "deterministic_check" });
      continue;
    }
    if (finding.targets.some((t) => !scope.allowed.has(t))) {
      rejected.push({ check: finding.check, targets: finding.targets, reason: "target_out_of_scope" });
      continue;
    }
    accepted.set(finding.check, [...(accepted.get(finding.check) ?? []), aiResult(finding)]);
  }

  const out: CheckResult[] = [];
  const pending: string[] = [];
  for (const current of base) {
    const findings = accepted.get(current.check) ?? [];
    const must = (scope.mustAnswer as readonly string[]).includes(current.check);
    if (CHECK_METHODS[current.check] === "deterministic") {
      out.push(current);
      continue;
    }
    if (current.status === "SKIPPED") {
      if (findings.length > 0) out.push(...findings);
      else if (must) {
        pending.push(current.check);
        out.push(pendingResult(current.check, []));
      } else out.push(current);
      continue;
    }
    if (current.needs_semantic_review) {
      // The only question an AI finding may close, and only when every required target got its own finding.
      const answered = new Set(findings.flatMap((f) => f.targets));
      const open = (scope.required[current.check as JudgedCheck] ?? current.targets).filter((t) => !answered.has(t));
      if (open.length > 0) {
        pending.push(current.check);
        out.push({ ...current, targets: open, detail: `Sin juicio semántico sobre ${open.slice(0, 4).join(", ")}${open.length > 4 ? "…" : ""}: ${current.detail}`.slice(0, 240) });
      }
      out.push(...findings);
      continue;
    }
    // Final or structural: the AI adds next to it, never in place of it. Next to a FAIL only adverse findings are kept.
    out.push(current);
    out.push(...(current.status === "FAIL" ? findings.filter((f) => f.status !== "PASS") : findings));
    if (findings.length === 0 && must) {
      pending.push(current.check);
      out.push(pendingResult(current.check, []));
    }
  }
  return { checks: out, rejected, pending };
}

/** The review a reviewer run produces: deterministic base + scoped merge. `ai: null` (no reviewer) leaves the AI checks SKIPPED. */
export function buildReviewScoped(input: ReviewInput, ai: AiReviewDraft | null, decisionIds: readonly string[]): { review: PedagogicalReview } & Pick<MergeOutcome, "rejected" | "pending"> {
  const base = deterministicChecks(input);
  if (!ai) return { review: assembleReview(input, base), rejected: [], pending: [] };
  const merged = mergeReviewerFindings(base, ai, reviewScope(base, input, decisionIds));
  return { review: assembleReview(input, merged.checks), rejected: merged.rejected, pending: merged.pending };
}

/** `PedagogicalReviewer` backed by a real model, for the pipeline. A rejected answer throws; there is no repair here. */
export function createModelReviewer(deps: { selection: ModelSelection; provider: AIProvider; maxOutputTokens: number }): PedagogicalReviewer {
  return {
    review: async ({ reviewContext }) => {
      if (!reviewContext) throw new AIError("invalid_output", "reviewer input without a review context");
      const { response, run } = await callReviewer({ ...deps, reviewContext });
      const parsed = parseReviewerResponse(response);
      if (parsed.outcome !== "ok") {
        const code = parsed.outcome === "refused" ? "refusal" : parsed.outcome === "truncated" ? "truncated" : "invalid_output";
        throw new RejectedStageOutput(code, `reviewer output rejected: ${parsed.outcome}`, rejectedRun(run, code));
      }
      return { draft: findingsToDraft(parsed.findings), runs: [run] };
    },
  };
}
