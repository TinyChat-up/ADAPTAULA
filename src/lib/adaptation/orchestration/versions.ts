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

/**
 * `adaptation_planner@v3` (ADR-045/046): only for an adaptation created in the authorised pilot workspace. Its answer carries the
 * method's declarations beside the plan, hence its own output budget (not yet measured with the real model: adjust it from the
 * pilot's records, as a NEW value, never by editing a frozen row).
 */
export const PLANNER_V3_PILOT = { prompt_version: 3, max_output_tokens: 12000 } as const;

/** The rules package an adaptation was created with: the planning stage refuses any other (fails closed, no call). */
const RulesFreeze = z.object({ version: z.string().regex(/^v[0-9]+(\.[0-9]+)*$/), package_sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type RulesFreeze = z.infer<typeof RulesFreeze>;

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

export const PipelineVersionsSchema = z
  .object({
    pipeline: z.literal(PIPELINE_KIND),
    analysis_schema: z.literal(3),
    planner: Component,
    plan_schema: z.literal(1),
    context_policy: z.union([z.literal(1), z.literal(2)]),
    generator: Component,
    document_schema: z.literal(1),
    reviewer: Component,
    review_schema: z.literal(1),
    /** Present exactly when the planner is v3: the private rules it must decide with. */
    rules: RulesFreeze.optional(),
  })
  .refine((v) => (v.planner.prompt_version === 3) === (v.rules !== undefined), { message: "el planificador v3 y la huella de sus reglas van juntos", path: ["rules"] });
export type PipelineVersions = z.infer<typeof PipelineVersionsSchema>;

const frozen = (selection: ModelSelection) => ({ alias: selection.alias, provider: selection.provider, model: selection.model, effort: selection.effort });

/**
 * Pure: alias → provider/model from an env-like map, frozen. Throws a categorized AIError when an alias is not configured.
 * `plannerV3` is passed ONLY after the server checked the pilot gate (ADR-046); every other adaptation keeps the current planner.
 */
export function resolvePipelineVersions(env: ModelEnv, options: { plannerV3?: RulesFreeze } = {}): PipelineVersions {
  const v3 = options.plannerV3;
  const planner = getAdaptationPlanner(v3 ? PLANNER_V3_PILOT.prompt_version : EXPERIMENTAL_PIPELINE.planner);
  const generator = getMaterialGenerator(EXPERIMENTAL_PIPELINE.generator);
  const reviewer = getPedagogicalReviewer(EXPERIMENTAL_PIPELINE.reviewer);
  return PipelineVersionsSchema.parse({
    pipeline: PIPELINE_KIND,
    analysis_schema: EXPERIMENTAL_PIPELINE.analysisSchema,
    planner: { prompt_version: planner.version, schema_version: planner.schemaVersion, max_output_tokens: v3 ? PLANNER_V3_PILOT.max_output_tokens : PIPELINE_OUTPUT_LIMITS.planner, selection: frozen(resolveModel("STANDARD", env)) },
    plan_schema: ADAPTATION_PLAN_SCHEMA_VERSION,
    context_policy: EXPERIMENTAL_PIPELINE.contextPolicy,
    generator: { prompt_version: generator.version, schema_version: generator.schemaVersion, max_output_tokens: PIPELINE_OUTPUT_LIMITS.generator, selection: frozen(resolveModel("STANDARD", env)) },
    document_schema: MATERIAL_DOCUMENT_SCHEMA_VERSION,
    reviewer: { prompt_version: reviewer.version, schema_version: reviewer.schemaVersion, max_output_tokens: PIPELINE_OUTPUT_LIMITS.reviewer, selection: frozen(resolveModel("STANDARD", env)) },
    review_schema: PEDAGOGICAL_REVIEW_SCHEMA_VERSION,
    ...(v3 ? { rules: { version: v3.version, package_sha256: v3.package_sha256 } } : {}),
  });
}

export const modelSelectionOf = (component: PipelineVersions["planner"]): ModelSelection => ({ ...component.selection });
