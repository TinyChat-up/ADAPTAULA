import "server-only";
import { serverEnv } from "@/lib/config/env.server";
import { ANALYSIS_DEFAULTS } from "./config";
import { getMaterialAnalyzer, type AnalyzerDefinition } from "./prompts";
import { resolveModel, type ModelEnv } from "./registry";
import { createProvider } from "./router";
import type { AIProvider, ModelSelection } from "./types";

export interface AnalysisRuntime {
  analyzer: AnalyzerDefinition;
  selection: ModelSelection;
  provider: AIProvider;
  maxRepairAttempts: number;
  maxOutputTokens: number;
}

/** Builds the analysis setup from the environment. Throws a categorized AIError when it is not configured. */
export function getAnalysisRuntime(): AnalysisRuntime {
  const env = serverEnv();
  const selection = resolveModel(env.AI_ANALYSIS_ALIAS, env as ModelEnv, env.AI_ANALYSIS_EFFORT);
  const provider = createProvider(selection, {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    mockDelayMs: env.MOCK_AI_DELAY_MS,
    isProduction: process.env.VERCEL_ENV === "production",
  });
  return {
    analyzer: getMaterialAnalyzer(env.AI_ANALYSIS_PROMPT_VERSION),
    selection,
    provider,
    maxRepairAttempts: env.AI_ANALYSIS_MAX_REPAIR_ATTEMPTS ?? ANALYSIS_DEFAULTS.maxRepairAttempts,
    maxOutputTokens: env.AI_ANALYSIS_MAX_OUTPUT_TOKENS ?? ANALYSIS_DEFAULTS.maxOutputTokens,
  };
}

/** The analyzer in use (prompt + contract), for code that needs its identity without building a provider. */
export function activeAnalyzer(): AnalyzerDefinition {
  return getMaterialAnalyzer(serverEnv().AI_ANALYSIS_PROMPT_VERSION);
}

/**
 * Provider for a selection that was FROZEN elsewhere (the adaptation pipeline persists alias, provider and model at creation):
 * only the credentials come from the environment, never the model.
 */
export function providerFor(selection: ModelSelection): AIProvider {
  const env = serverEnv();
  return createProvider(selection, {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    mockDelayMs: env.MOCK_AI_DELAY_MS,
    isProduction: process.env.VERCEL_ENV === "production",
  });
}
