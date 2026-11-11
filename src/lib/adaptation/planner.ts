import { estimateCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { ACTIVE_ADAPTATION_PROMPT_VERSIONS, getAdaptationPlanner } from "@/lib/ai/prompts";
import { describeIssues, parseStructured, type ParseOutcome } from "@/lib/ai/structured";
import type { AIProvider, ModelSelection, StructuredResponse } from "@/lib/ai/types";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { DraftAdaptationPlanSchema, type DraftAdaptationPlan, type PlanIssue } from "@/lib/schemas/adaptation-plan";
import { DraftAdaptationPlanV2Schema, type DraftAdaptationPlanV2 } from "@/lib/schemas/adaptation-plan-draft-v2";
import { DraftAdaptationPlanV3Schema, type DraftAdaptationPlanV3 } from "@/lib/schemas/adaptation-plan-draft-v3";
import { AIError } from "@/lib/ai/errors";
import type { RulesBlock } from "@/lib/agent-rules/prompt-block";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { modelFacingAnalysis, modelFacingAnalysisV2 } from "./model-input";
import { plannerContextV2 } from "./plan-v2";
import { zodIssues } from "./planner-draft";
import { RejectedStageOutput, rejectedRun, type AdaptationPlanner, type StageRunRecord } from "./services";

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
  /** v3 only: the verified private rules block of this request (ADR-045). Without it, v3 does not run. */
  rules?: RulesBlock;
  signal?: AbortSignal;
}

export interface PlannerCall {
  response: StructuredResponse;
  run: StageRunRecord;
}

export const PLANNER_TIMEOUT_MS = 120_000;

/** The messages of a planner request, for the version asked for. Exposed so the evals and tests inspect exactly what a model would receive. */
export function plannerRequestParts(params: Pick<PlannerCallParams, "analysis" | "context" | "repairOf" | "version" | "rules">) {
  const version = params.version ?? ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner;
  if (version === 3) {
    // Fails closed: v3 decides with the verified rules or does not run at all.
    if (!params.rules) throw new AIError("not_configured", "adaptation_planner@v3 necesita las reglas pedagógicas verificadas");
    const prompt = getAdaptationPlanner(3) as typeof import("@prompts/adaptation-planner/v3").ADAPTATION_PLANNER_V3;
    return { prompt, parts: prompt.buildUserParts({ rules: params.rules.text, context: plannerContextV2(params.context), material: modelFacingAnalysisV2(params.analysis), ...(params.repairOf ? { repairOf: params.repairOf } : {}) }) };
  }
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
    ...(params.rules ? { rulesSha256: params.rules.package_sha256 } : {}),
  };
  return { response, run };
}

export type PlanDraft = DraftAdaptationPlan | DraftAdaptationPlanV2 | DraftAdaptationPlanV3;
export type PlanParse = { outcome: "ok"; draft: PlanDraft } | { outcome: "truncated" | "refused" | "not_json" | "schema"; issues: string[]; json?: unknown; error?: import("zod").ZodError };

/** Stop reason first (a cut-off answer is never parsed), then JSON, then the contract. */
export function parsePlanResponse(response: StructuredResponse, version: number = 1): PlanParse {
  if (response.stopReason === "refusal") return { outcome: "refused", issues: ["El modelo rechazó la petición."] };
  if (response.stopReason === "max_tokens") return { outcome: "truncated", issues: ["La salida alcanzó el límite de tokens."] };
  const parsed: ParseOutcome<PlanDraft> =
    version === 3 ? parseStructured(response.text, DraftAdaptationPlanV3Schema) : version === 2 ? parseStructured(response.text, DraftAdaptationPlanV2Schema) : parseStructured(response.text, DraftAdaptationPlanSchema);
  return parsed.ok ? { outcome: "ok", draft: parsed.data } : { outcome: parsed.kind, issues: parsed.issues, ...(parsed.kind === "schema" ? { json: parsed.json, ...(parsed.error ? { error: parsed.error } : {}) } : {}) };
}

export { describeIssues };

/**
 * `AdaptationPlanner` backed by a real model, for the pipeline. A failed answer throws (the pipeline decides what to do);
 * the single repair is the pipeline's, not this function's.
 */
export function createModelPlanner(deps: {
  analysis: MaterialAnalysis;
  selection: ModelSelection;
  provider: AIProvider;
  maxOutputTokens: number;
  version?: number;
  /** v3 only: builds the verified rules block for this sheet and context (server-side; see `agent-rules/server.ts`). */
  rulesFor?: (context: AdaptationContext) => Promise<RulesBlock>;
}): AdaptationPlanner {
  return {
    plan: async ({ context, repairOf, maxOutputTokens }) => {
      const budget = maxOutputTokens ?? deps.maxOutputTokens;
      const rules = deps.version === 3 ? await rulesFor(deps, context) : undefined;
      const { response, run } = await callPlanner({ ...deps, maxOutputTokens: budget, context, ...(repairOf ? { repairOf } : {}), ...(rules ? { rules } : {}) });
      const parsed = parsePlanResponse(response, deps.version ?? 1);
      if (parsed.outcome !== "ok") {
        const code = parsed.outcome === "refused" ? "refusal" : parsed.outcome === "truncated" ? "truncated" : "invalid_output";
        // Paths and rules only: the parsed value travels in memory for a deterministic repair and is never logged.
        const issues = parsed.error ? zodIssues(parsed.error, parsed.json) : [];
        throw new RejectedStageOutput(code, `planner output rejected: ${parsed.outcome}`, rejectedRun(run, code), {
          kind: parsed.outcome,
          issues,
          ...(parsed.outcome === "schema" ? { json: parsed.json } : {}),
          outputTokens: response.usage.outputTokens,
          maxOutputTokens: budget,
          ...(rules ? { rules: rulesUse(rules) } : {}),
        });
      }
      return { draft: parsed.draft, runs: [run], ...(rules ? { rules: rulesUse(rules) } : {}) };
    },
  };
}

async function rulesFor(deps: { rulesFor?: (context: AdaptationContext) => Promise<RulesBlock> }, context: AdaptationContext): Promise<RulesBlock> {
  if (!deps.rulesFor) throw new AIError("not_configured", "adaptation_planner@v3 necesita las reglas pedagógicas verificadas");
  return deps.rulesFor(context);
}

/** What a run keeps of the rules: version, hashes and precedent ids. Never their text. */
export const rulesUse = (block: RulesBlock) => ({ version: block.version, package_sha256: block.package_sha256, block_sha256: block.block_sha256, included: block.selection.included.map((c) => c.id) });
