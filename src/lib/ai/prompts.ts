import { MATERIAL_ANALYZER_V1 } from "@prompts/material-analyzer/v1";
import { MATERIAL_ANALYZER_V2 } from "@prompts/material-analyzer/v2";
import { MATERIAL_ANALYZER_V3 } from "@prompts/material-analyzer/v3";
import { ADAPTATION_PLANNER_V1 } from "@prompts/adaptation-planner/v1";
import { ADAPTATION_PLANNER_V2 } from "@prompts/adaptation-planner/v2";
import { MATERIAL_GENERATOR_V1 } from "@prompts/material-generator/v1";
import { MATERIAL_GENERATOR_V2 } from "@prompts/material-generator/v2";
import { PEDAGOGICAL_REVIEWER_V1 } from "@prompts/pedagogical-reviewer/v1";
import type { z } from "zod";
import { normalizeAnalysis, type NormalizeOptions } from "@/lib/analysis/normalize";
import { normalizeAnalysisV2 } from "@/lib/analysis/normalize-v2";
import { upgradeAnalysisV2 } from "@/lib/analysis/upgrade";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis, type MaterialAnalysisDraft } from "@/lib/schemas/material-analysis";
import { MaterialAnalysisDraftSchema as MaterialAnalysisDraftSchemaV2, type MaterialAnalysisDraft as MaterialAnalysisDraftV2, type MaterialAnalysisV2 } from "@/lib/schemas/material-analysis-v2";

/**
 * Prompt registry. Published versions are immutable: a change means a new file and a bumped number, and nothing switches
 * version silently. Each analyzer pairs a prompt with the contract it produces:
 *   v1 → draft v2 → stored MaterialAnalysis v2 (historical; lifted to v3 when read)
 *   v2 → draft v3 → stored MaterialAnalysis v3
 *   v3 → draft v3 → stored MaterialAnalysis v3 (same contract as v2; adjusted prompt, see its header)
 * `AI_ANALYSIS_PROMPT_VERSION` picks the one in use (default: v3, validated with the real model on two worksheets; v1 and v2 stay published and immutable for traceability).
 */
export interface AnalyzerDefinition {
  key: "material_analyzer";
  version: number;
  /** Schema version of the analysis it stores. */
  schemaVersion: 2 | 3;
  system: string;
  buildUserParts: typeof MATERIAL_ANALYZER_V2.buildUserParts;
  repairMessage: (issues: readonly string[]) => string;
  /** What the provider is asked to return (name + Zod contract). */
  output: { name: string; schema: z.ZodType };
  /** Draft → the analysis exactly as it is stored. Throws a ZodError if the result breaks the stored contract. */
  normalize: (draft: unknown, options: NormalizeOptions) => { stored: unknown; warnings: string[] };
  /** Stored analysis → the current (v3) shape that the UI, the evals and later phases consume. */
  toCanonical: (stored: unknown) => MaterialAnalysis;
}

const V1: AnalyzerDefinition = {
  ...MATERIAL_ANALYZER_V1,
  schemaVersion: 2,
  output: { name: "material_analysis", schema: MaterialAnalysisDraftSchemaV2 },
  normalize: (draft, options) => {
    const { analysis, warnings } = normalizeAnalysisV2(draft as MaterialAnalysisDraftV2, options);
    return { stored: analysis, warnings };
  },
  toCanonical: (stored) => upgradeAnalysisV2(stored as MaterialAnalysisV2).analysis,
};

const V2: AnalyzerDefinition = {
  ...MATERIAL_ANALYZER_V2,
  schemaVersion: 3,
  output: { name: "material_analysis_v3", schema: MaterialAnalysisDraftSchema },
  normalize: (draft, options) => {
    const { analysis, warnings } = normalizeAnalysis(draft as MaterialAnalysisDraft, options);
    return { stored: analysis, warnings };
  },
  toCanonical: (stored) => stored as MaterialAnalysis,
};

/** Same contract as v2 (same draft schema, same normalizer): only the prompt text differs. */
const V3: AnalyzerDefinition = { ...V2, ...MATERIAL_ANALYZER_V3, schemaVersion: 3 };

export const PROMPTS = { material_analyzer: { 1: V1, 2: V2, 3: V3 } } as const;
export const ANALYZER_VERSIONS = [1, 2, 3] as const;
export type AnalyzerVersion = (typeof ANALYZER_VERSIONS)[number];

/** The version in use unless configured otherwise (keep in step with the default of `AI_ANALYSIS_PROMPT_VERSION`). */
export const ACTIVE_PROMPT_VERSIONS = { material_analyzer: 3 } as const satisfies Record<string, AnalyzerVersion>;

export function getMaterialAnalyzer(version: number): AnalyzerDefinition {
  const analyzer = (PROMPTS.material_analyzer as Record<number, AnalyzerDefinition | undefined>)[version];
  if (!analyzer) throw new Error(`No existe material_analyzer@v${version}.`);
  return analyzer;
}

export function activeMaterialAnalyzer(version: number = ACTIVE_PROMPT_VERSIONS.material_analyzer): AnalyzerDefinition {
  return getMaterialAnalyzer(version);
}

/** Prompts of the adaptation pipeline (Fase 4). Same rule: published versions are immutable. */
export const ADAPTATION_PROMPTS = { adaptation_planner: { 1: ADAPTATION_PLANNER_V1, 2: ADAPTATION_PLANNER_V2 }, material_generator: { 1: MATERIAL_GENERATOR_V1, 2: MATERIAL_GENERATOR_V2 }, pedagogical_reviewer: { 1: PEDAGOGICAL_REVIEWER_V1 } } as const;
export const ACTIVE_ADAPTATION_PROMPT_VERSIONS = { adaptation_planner: 1, material_generator: 1 } as const;

/** Planner versions are immutable and coexist: v1 produced the frozen evidence, v2 is not the active one until it is validated. */
export function getAdaptationPlanner(version: number = ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner): typeof ADAPTATION_PLANNER_V1 | typeof ADAPTATION_PLANNER_V2 {
  const prompt = (ADAPTATION_PROMPTS.adaptation_planner as Record<number, typeof ADAPTATION_PLANNER_V1 | typeof ADAPTATION_PLANNER_V2 | undefined>)[version];
  if (!prompt) throw new Error(`No existe adaptation_planner@v${version}.`);
  return prompt;
}

/** Generator versions are immutable and coexist: v1 produced the frozen evidence, v2 is not the active one until it is validated. */
export function getMaterialGenerator(version: number = ACTIVE_ADAPTATION_PROMPT_VERSIONS.material_generator): typeof MATERIAL_GENERATOR_V1 | typeof MATERIAL_GENERATOR_V2 {
  const prompt = (ADAPTATION_PROMPTS.material_generator as Record<number, typeof MATERIAL_GENERATOR_V1 | typeof MATERIAL_GENERATOR_V2 | undefined>)[version];
  if (!prompt) throw new Error(`No existe material_generator@v${version}.`);
  return prompt;
}

/** The reviewer is published but NOT active anywhere: it needs its first real validation before any default. The version is explicit. */
export function getPedagogicalReviewer(version: number): typeof PEDAGOGICAL_REVIEWER_V1 {
  const prompt = (ADAPTATION_PROMPTS.pedagogical_reviewer as Record<number, typeof PEDAGOGICAL_REVIEWER_V1 | undefined>)[version];
  if (!prompt) throw new Error(`No existe pedagogical_reviewer@v${version}.`);
  return prompt;
}
