import { estimateCostUsd } from "@/lib/ai/costs";
import { AIError, toAIError } from "@/lib/ai/errors";
import { ACTIVE_ADAPTATION_PROMPT_VERSIONS, getAdaptationPlanner } from "@/lib/ai/prompts";
import { describeIssues, parseStructured, type ParseOutcome } from "@/lib/ai/structured";
import type { AIProvider, ModelSelection, StructuredResponse } from "@/lib/ai/types";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { DraftAdaptationPlanSchema, type DraftAdaptationPlan, type PlanIssue } from "@/lib/schemas/adaptation-plan";
import { DraftAdaptationPlanV2Schema, type DraftAdaptationPlanV2 } from "@/lib/schemas/adaptation-plan-draft-v2";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { modelFacingAnalysis, modelFacingAnalysisV2 } from "./model-input";
import { plannerContextV2 } from "./plan-v2";
import type { AdaptationPlanner, StageRunRecord } from "./services";

/**
 * The real planner: one model call that turns `MaterialAnalysis + AdaptationContext` into an UNTRUSTED draft plan. It knows
 * nothing of repair, validation or persistence (the pipeline does that), and it only ever sees the model-facing view of the
 * material (`modelFacingAnalysis`: no inferred answers, no series names) and the derived context (never the profile).
 */

export interface PlannerCallParams {
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  selection: ModelSelection;
  provider: AIProvider;
  maxOutputTokens: number;
  timeoutMs?: number;
  /** Blocking issues of a previous attempt (only the pipeline's single repair passes this). */
  repairOf?: PlanIssue[];
  /** Prompt + draft contract version. Defaults to the active one (v1 until v2 is validated). */
  version?: number;
  signal?: AbortSignal;
}

export interface PlannerCall {
  response: StructuredResponse;
  run: StageRunRecord;
}

export const PLANNER_TIMEOUT_MS = 120_000;

/** The messages of a planner request, for the version asked for. Exposed so the evals and tests inspect exactly what a model would receive. */
export function plannerRequestParts(params: Pick<PlannerCallParams, "analysis" | "context" | "repairOf" | "version">) {
  const version = params.version ?? ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner;
  if (version === 2) {
    const prompt = getAdaptationPlanner(2) as typeof import("@prompts/adaptation-planner/v2").ADAPTATION_PLANNER_V2;
    return { prompt, parts: prompt.buildUserParts({ context: plannerContextV2(params.context), material: modelFacingAnalysisV2(params.analysis), ...(params.repairOf ? { repairOf: params.repairOf } : {}) }) };
  }
  const prompt = getAdaptationPlanner(1) as typeof import("@prompts/adaptation-planner/v1").ADAPTATION_PLANNER_V1;
  return { prompt, parts: prompt.buildUserParts({ context: params.context, material: modelFacingAnalysis(params.analysis), ...(params.repairOf ? { repairOf: params.repairOf } : {}) }) };
}

/** One model call. Provider errors are thrown (categorised); everything else is returned for the caller to judge. */
export async function callPlanner(params: PlannerCallParams): Promise<PlannerCall> {
  const { prompt, parts } = plannerRequestParts(params);
  const started = Date.now();
  let response: StructuredResponse;
  try {
    response = await params.provider.generateStructured({
      selection: params.selection,
      system: prompt.system,
      messages: [{ role: "user", content: parts }],
      output: prompt.output,
      maxOutputTokens: params.maxOutputTokens,
      timeoutMs: params.timeoutMs ?? PLANNER_TIMEOUT_MS,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    throw toAIError(error);
  }
  const model = response.model;
  const run: StageRunRecord = {
    purpose: "plan",
    attempt: 1,
    alias: params.selection.alias,
    provider: params.selection.provider,
    model,
    effort: params.selection.effort,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cachedInputTokens: response.usage.cachedInputTokens,
    cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
    estimatedCostUsd: estimateCostUsd(params.selection.provider, model, response.usage),
    latencyMs: response.latencyMs || Date.now() - started,
    status: response.stopReason === "refusal" ? "refused" : "success",
    errorCode: response.stopReason === "refusal" ? "refusal" : null,
    schemaKey: prompt.output.name,
    schemaVersion: prompt.schemaVersion,
    callKind: params.repairOf ? "repair" : "initial",
    reasoningTokens: null,
  };
  return { response, run };
}

export type PlanDraft = DraftAdaptationPlan | DraftAdaptationPlanV2;
export type PlanParse = { outcome: "ok"; draft: PlanDraft } | { outcome: "truncated" | "refused" | "not_json" | "schema"; issues: string[] };

/** Stop reason first (a cut-off answer is never parsed), then JSON, then the contract. */
export function parsePlanResponse(response: StructuredResponse, version: number = 1): PlanParse {
  if (response.stopReason === "refusal") return { outcome: "refused", issues: ["El modelo rechazó la petición."] };
  if (response.stopReason === "max_tokens") return { outcome: "truncated", issues: ["La salida alcanzó el límite de tokens."] };
  const parsed: ParseOutcome<PlanDraft> = version === 2 ? parseStructured(response.text, DraftAdaptationPlanV2Schema) : parseStructured(response.text, DraftAdaptationPlanSchema);
  return parsed.ok ? { outcome: "ok", draft: parsed.data } : { outcome: parsed.kind, issues: parsed.issues };
}

export { describeIssues };

/**
 * `AdaptationPlanner` backed by a real model, for the pipeline. A failed answer throws (the pipeline decides what to do);
 * the single repair is the pipeline's, not this function's.
 */
export function createModelPlanner(deps: { analysis: MaterialAnalysis; selection: ModelSelection; provider: AIProvider; maxOutputTokens: number; version?: number }): AdaptationPlanner {
  return {
    plan: async ({ context, repairOf }) => {
      const { response, run } = await callPlanner({ ...deps, context, ...(repairOf ? { repairOf } : {}) });
      const parsed = parsePlanResponse(response, deps.version ?? 1);
      if (parsed.outcome !== "ok") {
        const code = parsed.outcome === "refused" ? "refusal" : parsed.outcome === "truncated" ? "truncated" : "invalid_output";
        throw new AIError(code, `planner output rejected: ${parsed.outcome}`);
      }
      return { draft: parsed.draft, runs: [run] };
    },
  };
}
