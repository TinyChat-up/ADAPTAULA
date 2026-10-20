import { describe, expect, it } from "vitest";
import { sequentialIds } from "@/lib/adaptation/document";
import { answerSignatures, leakedSignature } from "@/lib/adaptation/text";
import { answersOf, materialNumbers } from "@/lib/adaptation/facts";
import { createMockGenerator, createMockPlanner, createMockReviewer, mockPlanDraft } from "@/lib/adaptation/mock";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { checkOf } from "@/lib/adaptation/review";
import { summarizeCost, type AdaptationPlanner, type StageRunRecord } from "@/lib/adaptation/services";
import { studentText } from "@/lib/adaptation/document-text";
import { allBlocks } from "@/lib/schemas/material-document";
import { argumentationAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { evaluateScenario } from "../../evals/adaptation/run";
import { PROFILES, SCENARIOS } from "../../evals/adaptation/scenarios";
import { contextFor } from "./adaptation-helpers";

const run = (analysis = geographyAnalysis(), profile = PROFILES.executive, planner?: AdaptationPlanner) =>
  runAdaptation(
    { profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" },
    { planner: planner ?? createMockPlanner(analysis), generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds() },
  );

describe("offline adaptation eval (mock pipeline, no provider)", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s keeps what is taught and meets its expectations", async (_, scenario) => {
    const { failures, result } = await evaluateScenario(scenario);
    expect(failures).toEqual([]);
    expect(result.review.verdict).not.toBe("blocked");
  });

  it("13 · no scenario ever puts an inferred answer into student content or into the answer key", async () => {
    for (const scenario of SCENARIOS) {
      const { result } = await evaluateScenario(scenario);
      const analysis = scenario.analysis();
      const numbers = materialNumbers(analysis);
      for (const answer of answersOf(analysis).filter((a) => a.basis === "inferred")) {
        const signatures = answerSignatures(answer.value, numbers);
        for (const block of allBlocks(result.document)) expect(leakedSignature(studentText(block), signatures), `${scenario.id} ${block.id}`).toBeNull();
        expect(result.document.answer_key.some((e) => e.value === answer.value)).toBe(false);
      }
    }
  });

  it("the whole pipeline is deterministic with the mocks: same input, same plan, document and review", async () => {
    const [a, b] = [await run(), await run()];
    expect(b.plan).toEqual(a.plan);
    expect(b.document).toEqual(a.document);
    expect(b.review).toEqual(a.review);
  });
});

describe("functional supports reach the document", () => {
  it("10 · executive functions: steps, checklist and planner traced to their decisions; at most 3 tasks per page", async () => {
    const result = await run();
    const blocks = allBlocks(result.document);
    expect(blocks.some((b) => b.type === "checklist")).toBe(true);
    expect(blocks.some((b) => b.type === "planner")).toBe(true);
    expect(blocks.some((b) => b.type === "activity" && (b.steps?.length ?? 0) > 0)).toBe(true);
    for (const b of blocks.filter((x) => x.type === "checklist" || x.type === "planner")) expect(b.trace.decision_ids.length).toBeGreaterThan(0);
    for (const page of result.document.pages) expect(page.blocks.filter((b) => b.type === "activity").length).toBeLessThanOrEqual(3);
    expect(checkOf(result.review, "functional_supports_applied").status).toBe("PASS");
  });

  it("11 · vocabulary support adds a glossary with the required vocabulary, traced to its decision", async () => {
    const result = await run(argumentationAnalysis(), PROFILES.language);
    const glossary = allBlocks(result.document).find((b) => b.type === "vocabulary");
    expect(glossary?.type === "vocabulary" && glossary.items.map((i) => i.term)).toEqual(["tesis", "argumento", "conector", "registro"]);
    expect(glossary!.trace.decision_ids).toHaveLength(1);
  });

  it("the mock planner never builds a support on the task's own data (no hidden answers)", () => {
    for (const scenario of SCENARIOS) {
      const analysis = scenario.analysis();
      const draft = mockPlanDraft(analysis, contextFor(analysis, scenario.profile, scenario.adaptationType));
      expect(draft.decisions.flatMap((d) => d.supports).every((s) => !s.uses_task_data)).toBe(true);
    }
  });
});

describe("C · plan validation with one repair: whatever still blocks is dropped, never applied", () => {
  it("asks the planner once more with the blocking issues, then applies only valid decisions", async () => {
    const analysis = geographyAnalysis();
    const calls: number[] = [];
    const bad = { target: "vis_1", action: "remove", strategies: ["visual_load_reduction"], dimensions: ["visual_distraction_reduction"], intensity: "moderate", preserves: [], supports: [], flags: [] };
    const planner: AdaptationPlanner = {
      plan: async ({ repairOf }) => {
        calls.push(repairOf?.length ?? 0);
        return { draft: { decisions: [bad], summary: [] }, runs: [] };
      },
    };
    const result = await run(analysis, PROFILES.executive, planner);
    expect(calls).toEqual([0, 1]);
    expect(result.plan.decisions).toEqual([]);
    expect(result.validation.issues.some((i) => i.flag === "required_data_removed" && i.severity === "block")).toBe(true);
    expect(allBlocks(result.document).some((b) => b.trace.source_refs.includes("vis_1"))).toBe(true);
  });
});

describe("L · cost per stage, never a made-up 0", () => {
  const record = (over: Partial<StageRunRecord>): StageRunRecord => ({
    purpose: "plan", attempt: 1, alias: "STANDARD", provider: "anthropic", model: "m", effort: "medium", promptKey: "adaptation_planner", promptVersion: 1,
    inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cacheCreationInputTokens: 2000, estimatedCostUsd: 0.01, latencyMs: 1000, status: "success", errorCode: null,
    schemaKey: "adaptation_plan", schemaVersion: 1, callKind: "initial", reasoningTokens: null, ...over,
  });

  it("sums per stage, counts repairs and keeps the analysis apart", () => {
    const cost = summarizeCost([record({}), record({ callKind: "repair", estimatedCostUsd: 0.005 }), record({ purpose: "generate", estimatedCostUsd: 0.03 }), record({ purpose: "review", estimatedCostUsd: 0.02 })], 0.054);
    expect(cost.stages.plan).toMatchObject({ calls: 2, repairs: 1, inputTokens: 2000 });
    expect(cost.stages.plan!.costUsd).toBeCloseTo(0.015);
    expect(cost.adaptationUsd).toBeCloseTo(0.065);
    expect(cost.analysisUsd).toBe(0.054);
    expect(cost.incomplete).toBe(false);
  });

  it("a call without a known price makes the total a marked lower bound", () => {
    const cost = summarizeCost([record({ estimatedCostUsd: null }), record({ purpose: "generate" })], 0.05);
    expect(cost.incomplete).toBe(true);
    expect(cost.adaptationUsd).toBeCloseTo(0.01);
  });
});
