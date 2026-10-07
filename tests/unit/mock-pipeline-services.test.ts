import { describe, expect, it } from "vitest";
import { isMockPipeline, mockPipelineServices } from "@/lib/adaptation/orchestration/mock-services";
import { resolvePipelineVersions } from "@/lib/adaptation/orchestration/versions";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

describe("mock pipeline services (development and E2E)", () => {
  it("only an adaptation frozen with the mock provider in every stage uses them", () => {
    const mock = resolvePipelineVersions({ AI_MODEL_STANDARD: "mock:default" } as never);
    expect(isMockPipeline(mock)).toBe(true);
    const real = { ...mock, generator: { ...mock.generator, selection: { ...mock.generator.selection, provider: "anthropic" as const } } };
    expect(isMockPipeline(real)).toBe(false);
  });

  it("each stage records one run as the mock provider, with no tokens and no invented price", async () => {
    const versions = resolvePipelineVersions({ AI_MODEL_STANDARD: "mock:default" } as never);
    const services = mockPipelineServices(versions, fractionsAnalysis());
    const reviewed = await services.reviewer.review({} as never);
    expect(reviewed.runs).toHaveLength(1);
    expect(reviewed.runs[0]).toMatchObject({ purpose: "review", provider: "mock", inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, status: "success" });
  });
});
