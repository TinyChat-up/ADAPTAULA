import { ANALYSIS_DEFAULTS } from "@/lib/ai/config";
import { estimateCostUsd, sumCosts } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { analyzeMaterialFile, type AnalyzeFile } from "@/lib/ai/pipeline/analyze";
import { MockProvider } from "@/lib/ai/providers/mock";
import { activeMaterialAnalyzer, getMaterialAnalyzer, type AnalyzerDefinition } from "@/lib/ai/prompts";
import { parseModelRef, resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createProvider } from "@/lib/ai/router";
import type { AIProvider, AIRunRecord, ModelSelection } from "@/lib/ai/types";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { digestAnalysis, sumTokens, type CaseReport, type RunDescriptor } from "./report";
import { scoreAnalysis } from "./score";
import type { Expectations } from "./types";

export type Env = ModelEnv & { AI_ANALYSIS_ALIAS?: string; AI_ANALYSIS_EFFORT?: string; ANTHROPIC_API_KEY?: string; OPENAI_API_KEY?: string };

export interface SelectionArgs {
  mock: boolean;
  /** STANDARD, ECONOMY… for this run only (the benchmark compares aliases on the same file). */
  alias?: string | null;
  /** `provider:model`, overriding the alias' configured model for this run only (the benchmark comparison hook). */
  model: string | null;
  effort: string | null;
}

/**
 * Same alias, effort, prompt and schema for every provider: only the model reference changes. Nothing here names a vendor.
 * `--model openai:<id>` becomes usable the day an OpenAI provider exists (router.ts); until then it fails with a clear message.
 */
export function resolveSelection(args: SelectionArgs, env: Env): ModelSelection {
  const alias = ((args.alias as ModelSelection["alias"] | null | undefined) ?? (env.AI_ANALYSIS_ALIAS as ModelSelection["alias"] | undefined)) ?? ANALYSIS_DEFAULTS.alias;
  const effort = (args.effort ?? env.AI_ANALYSIS_EFFORT ?? ANALYSIS_DEFAULTS.effort) as ModelSelection["effort"];
  if (args.mock) return { alias, provider: "mock", model: "default", effort };
  if (args.model) {
    const parsed = parseModelRef(args.model);
    if (!parsed) throw new Error(`--model debe tener la forma proveedor:modelo (recibido "${args.model}").`);
    return { alias, provider: parsed.provider, model: parsed.model, effort };
  }
  return resolveModel(alias, env, effort);
}

export function makeProvider(selection: ModelSelection, env: Env): AIProvider {
  return selection.provider === "mock" ? new MockProvider() : createProvider(selection, { anthropicApiKey: env.ANTHROPIC_API_KEY, isProduction: false });
}

/** Tokens of the cached system + schema block of the analysis prompts (v1 measured 6.345; v2 is a little smaller). */
export const PROMPT_BLOCK_TOKENS = 6_400;

/**
 * Deliberately pessimistic ceiling: ~2k input tokens per page and ~3k per file, ~5k output tokens per page (never more than the
 * hard cap `maxOutputTokens` per file when one is given: a call cannot emit more) and the prompt block written to the cache
 * (1.25x) once per file, as if each call came after the 5-minute cache window.
 */
export function worstCaseCostUsd(selection: ModelSelection, input: { files: number; pages: number; maxOutputTokens?: number }): number | null {
  const output = input.pages * 5000;
  return estimateCostUsd(selection.provider, selection.model, {
    inputTokens: input.pages * 2000 + input.files * 3000,
    outputTokens: input.maxOutputTokens === undefined ? output : Math.min(output, input.maxOutputTokens * input.files),
    cachedInputTokens: 0,
    cacheCreationInputTokens: PROMPT_BLOCK_TOKENS * input.files,
  });
}

/** Prompt version for a run: `--prompt-version`, else AI_ANALYSIS_PROMPT_VERSION, else the registry's default. */
export function resolveAnalyzer(version: number | null, env: { AI_ANALYSIS_PROMPT_VERSION?: string }): AnalyzerDefinition {
  const fromEnv = env.AI_ANALYSIS_PROMPT_VERSION ? Number(env.AI_ANALYSIS_PROMPT_VERSION) : null;
  return version !== null || fromEnv !== null ? getMaterialAnalyzer((version ?? fromEnv)!) : activeMaterialAnalyzer();
}

export function describeRun(selection: ModelSelection, realModel: string | null, label: string | null, analyzer: AnalyzerDefinition = activeMaterialAnalyzer()): RunDescriptor {
  const prompt = analyzer;
  return {
    provider: selection.provider,
    model: realModel ?? selection.model,
    alias: selection.alias,
    effort: selection.effort,
    prompt: `${prompt.key}@v${prompt.version}`,
    schemaVersion: analyzer.schemaVersion,
    startedAt: new Date().toISOString(),
    label,
  };
}

export interface AnalyzedCase {
  report: CaseReport;
  analysis: MaterialAnalysis | null;
  realModel: string | null;
}

/** Runs the REAL pipeline over one file and condenses the outcome. Failed attempts still count their tokens and cost. */
export async function analyzeCase(input: {
  analyzer?: AnalyzerDefinition;
  id: string;
  title: string;
  stage: string | null;
  file: AnalyzeFile;
  pageCount: number;
  selection: ModelSelection;
  provider: AIProvider;
  expect?: Expectations;
  maxOutputTokens?: number;
  singleCall?: boolean;
}): Promise<AnalyzedCase> {
  const runs: AIRunRecord[] = [];
  const started = Date.now();
  const base = { id: input.id, title: input.title, stage: input.stage };
  const common = () => ({
    tokens: sumTokens(runs),
    costUsd: sumCosts(runs.map((r) => r.estimatedCostUsd)),
    latencyMs: runs.reduce((n, r) => n + r.latencyMs, 0),
    calls: runs.length,
    attempts: runs.map((r) => ({ attempt: r.attempt, status: r.status, errorCode: r.errorCode, issues: r.issues ?? [], outputTokens: r.outputTokens })),
  });

  try {
    const outcome = await analyzeMaterialFile({
      ...(input.analyzer ? { analyzer: input.analyzer } : {}),
      file: input.file,
      pageCount: input.pageCount,
      teacherContext: {},
      selection: input.selection,
      provider: input.provider,
      maxRepairAttempts: ANALYSIS_DEFAULTS.maxRepairAttempts,
      maxOutputTokens: input.maxOutputTokens ?? ANALYSIS_DEFAULTS.maxOutputTokens,
      ...(input.singleCall ? { singleCall: true } : {}),
      deadlineAt: started + ANALYSIS_DEFAULTS.jobDeadlineMs,
      onRun: (run) => void runs.push(run),
    });
    // Scored in the current (v3) shape whatever prompt produced it, so runs of different prompt versions are comparable.
    const score = input.expect ? scoreAnalysis(outcome.canonical, input.expect, input.pageCount) : null;
    const report: CaseReport = {
      ...base,
      subject: outcome.canonical.identification.subject.value,
      delivered: true,
      failure: null,
      passed: score?.passed ?? null,
      score: score?.ratio ?? null,
      hardFailures: score?.hardFailures ?? 0,
      softFailures: score?.softFailures ?? 0,
      hallucinations: score?.hallucinations ?? 0,
      failedChecks: (score?.checks ?? []).filter((c) => !c.ok).map(({ name, severity, detail }) => ({ name, severity, ...(detail ? { detail } : {}) })),
      ...common(),
      warnings: outcome.meta.warnings,
      digest: digestAnalysis(outcome.canonical),
    };
    return { report, analysis: outcome.canonical, realModel: outcome.meta.model };
  } catch (error) {
    const failure = toAIError(error);
    const report: CaseReport = {
      ...base,
      subject: null,
      delivered: false,
      failure: failure.code,
      passed: input.expect ? false : null,
      score: input.expect ? 0 : null,
      hardFailures: 0,
      softFailures: 0,
      hallucinations: 0,
      failedChecks: [],
      ...common(),
      warnings: [],
      digest: null,
    };
    return { report, analysis: null, realModel: runs.at(-1)?.model ?? null };
  }
}
