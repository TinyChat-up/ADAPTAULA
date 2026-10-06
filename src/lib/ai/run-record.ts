import type { AIRunRecord } from "./types";

/** Row of `ai_runs` for one model call. Identifiers only: never material content, prompts or learner data. */
export function toAiRunRow(run: AIRunRecord, ids: { workspaceId: string | null; jobId: string | null; materialId: string | null }) {
  return {
    workspace_id: ids.workspaceId,
    job_id: ids.jobId,
    material_id: ids.materialId,
    purpose: run.purpose,
    model_alias: run.alias,
    provider: run.provider,
    model: run.model,
    prompt_key: run.promptKey,
    prompt_version: run.promptVersion,
    effort: run.effort,
    input_tokens: run.inputTokens,
    output_tokens: run.outputTokens,
    cached_input_tokens: run.cachedInputTokens,
    cache_creation_input_tokens: run.cacheCreationInputTokens,
    estimated_cost_usd: run.estimatedCostUsd,
    latency_ms: run.latencyMs,
    status: run.status,
    error_code: run.errorCode,
    attempt: run.attempt,
  };
}
