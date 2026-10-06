import { ZodError } from "zod";
import type { SubjectOption } from "@/lib/analysis/subjects";
import type { AnalysisMeta, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { ANALYSIS_DEFAULTS, ANALYSIS_RETRY } from "../config";
import { estimateCostUsd, sumCosts } from "../costs";
import { AIError, toAIError } from "../errors";
import { activeMaterialAnalyzer, type AnalyzerDefinition } from "../prompts";
import { describeIssues, parseStructured } from "../structured";
import type { AIMessage, AIProvider, AIRunRecord, ImageMediaType, ModelSelection, StructuredResponse } from "../types";

export type AnalyzeFile =
  | { kind: "pdf"; data: Uint8Array }
  | { kind: "image"; mediaType: ImageMediaType; data: Uint8Array };

export interface AnalyzeParams {
  /** Prompt + contract in use. Defaults to the registry's active one; the evals pass another to compare versions. */
  analyzer?: AnalyzerDefinition;
  file: AnalyzeFile;
  /** Verified by the server (PDF) or 1 (image). */
  pageCount: number | null;
  teacherContext: { stage?: string | undefined; grade?: string | undefined; subject?: string | undefined; topic?: string | undefined };
  subjects?: readonly SubjectOption[];
  selection: ModelSelection;
  provider: AIProvider;
  /** Lowered to `ANALYSIS_RETRY.maxRepairAttempts` if higher: the policy cap is not configurable upwards. */
  maxRepairAttempts: number;
  maxOutputTokens: number;
  /** Recorded in `analysis_meta`: the teacher explicitly asked to ignore the cache. */
  forcedReanalysis?: boolean;
  /** Exactly one model call: no repair and no regeneration. For budget-capped validations; a failure is reported as it is. */
  singleCall?: boolean;
  /** Epoch ms by which the job must be finished. */
  deadlineAt?: number;
  callTimeoutMs?: number;
  signal?: AbortSignal;
  /** Called after every model call, success or not: persists `ai_runs`. */
  onRun?: (run: AIRunRecord) => void | Promise<void>;
  onStep?: (step: "analyzing" | "validating") => void | Promise<void>;
  now?: () => number;
}

export interface AnalyzeOutcome {
  /** Exactly what gets stored in `materials.analysis` (schema version = `meta.schema_version`). */
  analysis: unknown;
  /** The same analysis in the current (v3) shape, for the UI, the scoring and later phases. */
  canonical: MaterialAnalysis;
  meta: AnalysisMeta;
  runs: AIRunRecord[];
}

/**
 * Material → structured analysis. Provider-agnostic and database-free, so the job runner, the evals
 * and the tests all use exactly the same code:
 *
 *   model → parse → Zod (draft) → normalize (server ids, references) → Zod (stored)
 *
 * Retries follow `ANALYSIS_RETRY` (config.ts) and are bounded by construction: at most one repair of a complete
 * but invalid answer, at most one clean regeneration of a truncated one, and never anything after a refusal.
 * Transient provider errors are thrown to the caller (the job retries them with backoff).
 */
export async function analyzeMaterialFile(params: AnalyzeParams): Promise<AnalyzeOutcome> {
  const prompt = params.analyzer ?? activeMaterialAnalyzer();
  const now = params.now ?? Date.now;
  const callTimeoutMs = params.callTimeoutMs ?? ANALYSIS_DEFAULTS.callTimeoutMs;
  const runs: AIRunRecord[] = [];

  const base: AIMessage[] = [
    { role: "user", content: prompt.buildUserParts({ file: params.file, pageCount: params.pageCount, teacherContext: params.teacherContext }) },
  ];
  let messages = base;
  let repairsLeft = params.singleCall ? 0 : Math.min(Math.max(0, params.maxRepairAttempts), ANALYSIS_RETRY.maxRepairAttempts);
  let regenerationsLeft: number = params.singleCall ? 0 : ANALYSIS_RETRY.truncation.maxRegenerations;
  let outputBudget = params.maxOutputTokens;
  const maxCalls = 1 + repairsLeft + regenerationsLeft;
  let warnings: string[] = [];

  for (let attempt = 1; attempt <= maxCalls; attempt++) {
    const remaining = params.deadlineAt === undefined ? Infinity : params.deadlineAt - now();
    if (remaining < ANALYSIS_DEFAULTS.minCallWindowMs) throw new AIError("timeout", "not enough time left for another model call");
    await params.onStep?.("analyzing");

    const record = async (partial: Pick<AIRunRecord, "status" | "errorCode"> & { response?: StructuredResponse; latencyMs?: number; issues?: string[] }) => {
      const usage = partial.response?.usage;
      const run: AIRunRecord = {
        purpose: "analyze",
        attempt,
        alias: params.selection.alias,
        provider: params.selection.provider,
        model: partial.response?.model ?? params.selection.model,
        effort: params.selection.effort,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
        estimatedCostUsd: usage ? estimateCostUsd(params.selection.provider, partial.response?.model ?? params.selection.model, usage) : 0,
        latencyMs: partial.response?.latencyMs ?? partial.latencyMs ?? 0,
        status: partial.status,
        errorCode: partial.errorCode,
        ...(partial.issues ? { issues: partial.issues } : {}),
      };
      runs.push(run);
      await params.onRun?.(run);
    };

    const startedAt = now();
    let response: StructuredResponse;
    try {
      response = await params.provider.generateStructured({
        selection: params.selection,
        system: prompt.system,
        messages,
        output: prompt.output,
        maxOutputTokens: outputBudget,
        timeoutMs: Math.min(callTimeoutMs, remaining),
        ...(params.signal ? { signal: params.signal } : {}),
      });
    } catch (error) {
      const failure = toAIError(error);
      await record({ status: "error", errorCode: failure.code, latencyMs: now() - startedAt });
      throw failure;
    }

    if (response.stopReason === "refusal") {
      await record({ status: "refused", errorCode: "refusal", response });
      throw new AIError("refusal", "the model refused to analyze the material");
    }
    if (response.stopReason === "max_tokens") {
      await record({ status: "invalid_output", errorCode: "truncated", response });
      const raised = Math.min(ANALYSIS_RETRY.truncation.outputTokenCeiling, Math.floor(outputBudget * ANALYSIS_RETRY.truncation.growthFactor));
      // Regenerating with the same room would only truncate again: it only makes sense when there is more room to give.
      if (regenerationsLeft === 0 || raised <= outputBudget) throw new AIError("truncated", "the output hit the token limit");
      regenerationsLeft -= 1;
      outputBudget = raised;
      messages = base;
      continue;
    }

    await params.onStep?.("validating");
    const parsed = parseStructured(response.text, prompt.output.schema);
    let issues: string[] = parsed.ok ? [] : parsed.issues;
    if (parsed.ok) {
      try {
        const normalized = prompt.normalize(parsed.data, { pageCount: params.pageCount, ...(params.subjects ? { subjects: params.subjects } : {}) });
        warnings = normalized.warnings;
        await record({ status: "success", errorCode: null, response });
        const meta: AnalysisMeta = {
          schema_version: prompt.schemaVersion,
          prompt_key: prompt.key,
          prompt_version: prompt.version,
          source: "model",
          cache_hit: false,
          forced_reanalysis: params.forcedReanalysis === true,
          model_alias: params.selection.alias,
          provider: params.selection.provider,
          model: response.model,
          effort: params.selection.effort,
          analyzed_at: new Date(now()).toISOString(),
          attempts: attempt,
          cost_usd: sumCosts(runs.map((r) => r.estimatedCostUsd)),
          warnings: warnings.slice(0, 30),
          reused_from_material_id: null,
        };
        return { analysis: normalized.stored, canonical: prompt.toCanonical(normalized.stored), meta, runs };
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        issues = describeIssues(error);
      }
    }

    await record({ status: "invalid_output", errorCode: "invalid_output", response, issues });
    if (repairsLeft === 0) throw new AIError("invalid_output", `output did not match the schema after ${attempt} attempt(s)`);
    repairsLeft -= 1;

    messages = [
      ...base,
      { role: "assistant", content: [{ type: "text", text: response.text }] },
      { role: "user", content: [{ type: "text", text: prompt.repairMessage(issues) }] },
    ];
  }

  throw new AIError("invalid_output", "unreachable");
}
