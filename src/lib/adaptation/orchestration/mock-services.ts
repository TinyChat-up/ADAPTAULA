import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { createMockGenerator, createMockPlanner, createMockReviewer } from "../mock";
import type { StageRunRecord } from "../services";
import type { PipelineServices } from "./orchestrator";
import type { PipelineVersions } from "./versions";

/**
 * The pipeline's stages when an adaptation was CREATED with the mock provider frozen in its versions (local development and the
 * E2E suite: `AI_MODEL_STANDARD=mock:default`). The mock provider only knows the analysis, so the plan, the document and the
 * review come from the deterministic stand-ins of `../mock` — the same ones the database tests use. Nothing here calls a model.
 * Each stage still records one run (provider `mock`, no tokens, no price) so the accounting path is the production one.
 */

type Component = PipelineVersions["planner"];

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

function mockRun(purpose: StageRunRecord["purpose"], component: Component, key: string, latencyMs: number): StageRunRecord {
  const s = component.selection;
  return {
    purpose,
    attempt: 1,
    alias: s.alias,
    provider: s.provider,
    model: s.model,
    effort: s.effort,
    promptKey: key,
    promptVersion: component.prompt_version,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    estimatedCostUsd: null,
    latencyMs,
    status: "success",
    errorCode: null,
    schemaKey: key,
    schemaVersion: component.schema_version,
    callKind: "initial",
    reasoningTokens: null,
  };
}

export const isMockPipeline = (versions: PipelineVersions) => [versions.planner, versions.generator, versions.reviewer].every((c) => c.selection.provider === "mock");

export function mockPipelineServices(versions: PipelineVersions, analysis: MaterialAnalysis, delayMs = 0): PipelineServices {
  const version = (c: Component) => (c.prompt_version >= 2 ? 2 : 1);
  const planner = createMockPlanner(analysis, version(versions.planner));
  const generator = createMockGenerator(version(versions.generator));
  const reviewer = createMockReviewer();
  return {
    planner: {
      plan: async (input) => {
        await sleep(delayMs);
        return { ...(await planner.plan(input)), runs: [mockRun("plan", versions.planner, "adaptation_planner", delayMs)] };
      },
    },
    generator: {
      generate: async (input) => {
        await sleep(delayMs);
        return { ...(await generator.generate(input)), runs: [mockRun("generate", versions.generator, "material_generator", delayMs)] };
      },
    },
    reviewer: {
      review: async (input) => {
        await sleep(delayMs);
        return { ...(await reviewer.review(input)), runs: [mockRun("review", versions.reviewer, "pedagogical_reviewer", delayMs)] };
      },
    },
  };
}
