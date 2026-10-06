import { z } from "zod";
import { getAdaptationPlanner, getMaterialGenerator, getPedagogicalReviewer } from "@/lib/ai/prompts";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { MODEL_ALIASES, type ModelSelection } from "@/lib/ai/types";
import { PEDAGOGICAL_REVIEW_SCHEMA_VERSION } from "@/lib/schemas/pedagogical-review";
import { MATERIAL_DOCUMENT_SCHEMA_VERSION } from "@/lib/schemas/material-document";
import { ADAPTATION_PLAN_SCHEMA_VERSION } from "@/lib/schemas/adaptation-plan";

/**
 * Versions are resolved ONCE, when an adaptation is created, and persisted with it (`adaptations.pipeline_versions`). Every
 * stage, retry and resume reads them from the row, never from the environment or from today's defaults: a job that waits for a
 * teacher's review for a week behaves the same as one that does not. Aliases are the business vocabulary; the concrete
 * provider/model an alias meant at creation is frozen next to it (data, not a hardcoded model in domain code).
 */

export const PIPELINE_KIND = "experimental-1" as const;

/** The experimental pipeline's components. Existing versions stay published; this is the choice for NEW adaptations only. */
export const EXPERIMENTAL_PIPELINE = { planner: 2, contextPolicy: 2, generator: 2, reviewer: 1, analysisSchema: 3 } as const;

/** Output budgets measured in the real runs (docs/ADAPTATION.md); persisted so a later change never alters a pending job. */
export const PIPELINE_OUTPUT_LIMITS = { planner: 4000, generator: 3000, reviewer: 2000 } as const;

const ModelFreeze = z.object({
  alias: z.enum(MODEL_ALIASES),
  provider: z.enum(["anthropic", "openai", "mock"]),
  model: z.string().min(1),
  effort: z.enum(["low", "medium", "high"]),
});
const Component = z.object({
  prompt_version: z.number().int().positive(),
  schema_version: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  selection: ModelFreeze,
});

export const PipelineVersionsSchema = z.object({
  pipeline: z.literal(PIPELINE_KIND),
  analysis_schema: z.literal(3),
  planner: Component,
  plan_schema: z.literal(1),
  context_policy: z.union([z.literal(1), z.literal(2)]),
  generator: Component,
  document_schema: z.literal(1),
  reviewer: Component,
  review_schema: z.literal(1),
});
export type PipelineVersions = z.infer<typeof PipelineVersionsSchema>;

const frozen = (selection: ModelSelection) => ({ alias: selection.alias, provider: selection.provider, model: selection.model, effort: selection.effort });

/** Pure: alias → provider/model from an env-like map, frozen. Throws a categorized AIError when an alias is not configured. */
export function resolvePipelineVersions(env: ModelEnv): PipelineVersions {
  const planner = getAdaptationPlanner(EXPERIMENTAL_PIPELINE.planner);
  const generator = getMaterialGenerator(EXPERIMENTAL_PIPELINE.generator);
  const reviewer = getPedagogicalReviewer(EXPERIMENTAL_PIPELINE.reviewer);
  return PipelineVersionsSchema.parse({
    pipeline: PIPELINE_KIND,
    analysis_schema: EXPERIMENTAL_PIPELINE.analysisSchema,
    planner: { prompt_version: planner.version, schema_version: planner.schemaVersion, max_output_tokens: PIPELINE_OUTPUT_LIMITS.planner, selection: frozen(resolveModel("STANDARD", env)) },
    plan_schema: ADAPTATION_PLAN_SCHEMA_VERSION,
    context_policy: EXPERIMENTAL_PIPELINE.contextPolicy,
    generator: { prompt_version: generator.version, schema_version: generator.schemaVersion, max_output_tokens: PIPELINE_OUTPUT_LIMITS.generator, selection: frozen(resolveModel("STANDARD", env)) },
    document_schema: MATERIAL_DOCUMENT_SCHEMA_VERSION,
    reviewer: { prompt_version: reviewer.version, schema_version: reviewer.schemaVersion, max_output_tokens: PIPELINE_OUTPUT_LIMITS.reviewer, selection: frozen(resolveModel("STANDARD", env)) },
    review_schema: PEDAGOGICAL_REVIEW_SCHEMA_VERSION,
  });
}

export const modelSelectionOf = (component: PipelineVersions["planner"]): ModelSelection => ({ ...component.selection });
