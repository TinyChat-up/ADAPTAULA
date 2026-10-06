import { readFileSync } from "node:fs";
import { buildAdaptationContext, contextFingerprint } from "@/lib/adaptation/context";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { plannerRequestParts } from "@/lib/adaptation/planner";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import { estimateCostUsd } from "@/lib/ai/costs";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import type { AdaptationContext, ContextPolicy } from "@/lib/schemas/adaptation-context";
import type { AdaptationType } from "@/lib/schemas/adaptation-type";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { ModelSelection } from "@/lib/ai/types";

/**
 * Pieces of the real-planner experiment that do not call a provider: loading the stored analysis, the functional profile
 * of the experiment, the pre-flight checks and the worst-case cost. Used by `planner-run.ts` and by the tests.
 */

/**
 * Executive-function needs expressed only with real catalog dimensions (no label, no diagnosis):
 * keeping several steps active → working_memory_support · sequencing → instruction_chunking · starting the task →
 * planning_support · less executive load → number_of_visible_tasks · clear organisation → predictable_structure,
 * explicit_expectations · reviewing the work → checklist_support. No reading, vision or maths dimension.
 */
export const EXECUTIVE_EXPERIMENT_PROFILE: FunctionalProfile = {
  schema_version: 1,
  supports: {
    working_memory_support: "high",
    instruction_chunking: "high",
    planning_support: "high",
    number_of_visible_tasks: "medium",
    predictable_structure: "medium",
    checklist_support: "medium",
    explicit_expectations: "low",
  },
  limits: {},
  allowances: {},
};

export interface StoredAnalysisSource {
  analysis: MaterialAnalysis;
  /** What produced it, as recorded by the analysis eval run. */
  producedBy: { prompt: string | null; schemaVersion: number | null; alias: string | null; label: string | null };
  warnings: string[];
}

/** Reads the analysis saved by `pnpm eval:analysis -- --private` (never calls the analyzer). */
export function loadStoredAnalysis(file: string): StoredAnalysisSource {
  const data = JSON.parse(readFileSync(file, "utf8")) as { run?: Record<string, unknown>; analyses?: Array<{ analysis?: unknown }> };
  const raw = data.analyses?.[0]?.analysis;
  if (raw === undefined) throw new Error("El archivo no contiene ningún análisis.");
  const parsed = parseStoredAnalysis(raw);
  if (!parsed.analysis || parsed.storedVersion !== 3) throw new Error("El análisis guardado no es un MaterialAnalysis v3 legible.");
  return {
    analysis: parsed.analysis,
    producedBy: {
      prompt: typeof data.run?.prompt === "string" ? data.run.prompt : null,
      schemaVersion: typeof data.run?.schemaVersion === "number" ? data.run.schemaVersion : null,
      alias: typeof data.run?.alias === "string" ? data.run.alias : null,
      label: typeof data.run?.label === "string" ? data.run.label : null,
    },
    warnings: parsed.warnings,
  };
}

export function buildExperimentContext(analysis: MaterialAnalysis, adaptationType: AdaptationType = "accessibility", policy: ContextPolicy = 1): AdaptationContext {
  return buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType, policy }).context;
}

/** Words that must never reach a model: conditions/labels, alias fields, contact data. */
const FORBIDDEN = [
  /\b(tdah|tda|tea|autis\w*|asperger|dislex\w*|discalcul\w*|disgraf\w*|sindrome|trastorno|diagn\w+|medic\w+|dictamen|informe psicopedag\w+|neae|nee)\b/i,
  /display_name|learner|alumno_id|profile_id/i,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\b\d{8}[A-Z]\b/,
];

/** What a scan found, as short labels (never the surrounding text). */
export function scanForbidden(text: string): string[] {
  return FORBIDDEN.flatMap((pattern) => {
    const m = text.match(pattern);
    return m ? [m[0].slice(0, 30)] : [];
  });
}

/** Pessimistic: Spanish JSON measured ≈ 2.4 chars/token for the schema block; the same ratio is used for everything. */
export const CHARS_PER_TOKEN = 2.4;
export const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

export interface PlannerPreflight {
  systemChars: number;
  schemaChars: number;
  userChars: number;
  cacheableTokens: number;
  uncachedInputTokens: number;
  worstCaseUsd: number | null;
  forbiddenFound: string[];
  contextFingerprint: string;
  analysisFingerprint: string;
  deterministic: boolean;
}

export function preflightPlanner(analysis: MaterialAnalysis, context: AdaptationContext, selection: ModelSelection, maxOutputTokens: number, version = 1): PlannerPreflight {
  const { prompt, parts } = plannerRequestParts({ analysis, context, version });
  const schemaText = schemaInstructions(prompt.output.schema);
  const userText = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const cacheableTokens = estimateTokens(prompt.system.length + schemaText.length);
  const uncachedInputTokens = estimateTokens(userText.length) + 50;
  const again = buildExperimentContext(analysis, context.adaptation_type, context.policy_version ?? 1);
  return {
    systemChars: prompt.system.length,
    schemaChars: schemaText.length,
    userChars: userText.length,
    cacheableTokens,
    uncachedInputTokens,
    // Cold cache: the whole system + schema block is written (1.25x). The output is the hard cap of the call.
    worstCaseUsd: estimateCostUsd(selection.provider, selection.model, { inputTokens: uncachedInputTokens, cacheCreationInputTokens: cacheableTokens, cachedInputTokens: 0, outputTokens: maxOutputTokens }),
    forbiddenFound: scanForbidden(`${prompt.system}\n${schemaText}\n${userText}`),
    contextFingerprint: contextFingerprint(context),
    analysisFingerprint: fingerprint(analysis),
    deterministic: contextFingerprint(again) === contextFingerprint(context),
  };
}
