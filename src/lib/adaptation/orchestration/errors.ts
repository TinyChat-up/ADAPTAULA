import { AIError, type AIErrorCode } from "@/lib/ai/errors";

/**
 * Failure taxonomy of the orchestrated pipeline. Every failure has a code and exactly one handling kind:
 *   retryable             the system may try again by itself within the attempt budget (transient provider trouble)
 *   non_retryable         trying again cannot help (refusal, credentials, corrupt input, schema already repaired once)
 *   human_action_required a person must decide (review the plan again, re-analyse, acknowledge an ambiguous attempt)
 */

export const ADAPTATION_ERROR_CODES = [
  "invalid_input",
  "stale_analysis",
  "planner_schema",
  "planner_validation",
  "plan_review_required",
  "stale_review",
  "invalid_review",
  "execution_unsupported",
  "entitlement_exhausted",
  "entitlement_unavailable",
  "entitlement_not_reserved",
  "generator_schema",
  "generator_validation",
  "deterministic_review_failed",
  "reviewer_schema",
  "reviewer_blocked",
  "ambiguous_attempt",
  "provider_transient",
  "provider_refusal",
  "provider_credentials",
  "cancelled",
  "internal",
] as const;
export type AdaptationErrorCode = (typeof ADAPTATION_ERROR_CODES)[number];
export type FailureKind = "retryable" | "non_retryable" | "human_action_required";

export const FAILURE_KIND: Readonly<Record<AdaptationErrorCode, FailureKind>> = {
  invalid_input: "non_retryable",
  stale_analysis: "human_action_required",
  planner_schema: "non_retryable",
  planner_validation: "human_action_required",
  plan_review_required: "human_action_required",
  stale_review: "human_action_required",
  invalid_review: "human_action_required",
  execution_unsupported: "human_action_required",
  // Not a provider problem and not retryable by the system; the user or the product can resolve it (free a unit, change plan).
  entitlement_exhausted: "human_action_required",
  entitlement_unavailable: "non_retryable",
  entitlement_not_reserved: "human_action_required",
  generator_schema: "non_retryable",
  generator_validation: "non_retryable",
  deterministic_review_failed: "human_action_required",
  reviewer_schema: "non_retryable",
  reviewer_blocked: "human_action_required",
  ambiguous_attempt: "human_action_required",
  provider_transient: "retryable",
  provider_refusal: "non_retryable",
  provider_credentials: "non_retryable",
  cancelled: "non_retryable",
  internal: "retryable",
};

export class AdaptationError extends Error {
  readonly kind: FailureKind;
  constructor(readonly code: AdaptationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AdaptationError";
    this.kind = FAILURE_KIND[code];
  }
}

export type Stage = "planning" | "generation" | "review";

/**
 * AI failure → taxonomy, per stage. The retry policy is the existing central one (`AIError.retryable`): only transient
 * provider errors and genuinely unexpected ones are retried; a schema-invalid answer already got its one repair (or none, by
 * design) where the stage allows it, so it is final.
 */
export function classifyAIFailure(error: unknown, stage: Stage): { code: AdaptationErrorCode; retryable: boolean } {
  if (error instanceof AdaptationError) return { code: error.code, retryable: error.kind === "retryable" };
  const ai = error instanceof AIError ? error : null;
  if (!ai) return { code: "internal", retryable: true };
  const schemaCode: Record<Stage, AdaptationErrorCode> = { planning: "planner_schema", generation: "generator_schema", review: "reviewer_schema" };
  const byCode: Partial<Record<AIErrorCode, AdaptationErrorCode>> = {
    provider_unavailable: "provider_transient",
    rate_limited: "provider_transient",
    timeout: "provider_transient",
    refusal: "provider_refusal",
    auth: "provider_credentials",
    not_configured: "provider_credentials",
    invalid_output: schemaCode[stage],
    truncated: schemaCode[stage],
    bad_request: "invalid_input",
  };
  const code = byCode[ai.code] ?? "internal";
  return { code, retryable: FAILURE_KIND[code] === "retryable" };
}
