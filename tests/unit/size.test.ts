import { describe, expect, it } from "vitest";
import { getMaterialAnalyzer } from "@/lib/ai/prompts";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { normalizeAnalysisV2 } from "@/lib/analysis/normalize-v2";
import { upgradeAnalysisV2 } from "@/lib/analysis/upgrade";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import { MaterialAnalysisDraftSchema } from "@/lib/schemas/material-analysis";
import { MaterialAnalysisDraftSchema as DraftSchemaV2 } from "@/lib/schemas/material-analysis-v2";
import { calibrateCharsPerToken, costOf, estimateOptimizedCost, projectDraftV2, projectDraftV3, reduction, schemaBlockChars, sizeOf } from "../../evals/material-analysis/size-lib";
import { worksheetDraftV2, worksheetDraftV3 } from "../../evals/material-analysis/synthetic-analyses";

const storedV2 = () => normalizeAnalysisV2(worksheetDraftV2(), { pageCount: 2 }).analysis;

describe("size benchmark: what the projections stand for", () => {
  it("projectDraftV3 is a VALID v3 draft, and normalizing it again gives back the same analysis", () => {
    for (const [draft, pageCount] of [[worksheetDraftV3(), 2], [mockAnalysisDraftV3(), 1]] as const) {
      const analysis = normalizeAnalysis(MaterialAnalysisDraftSchema.parse(draft), { pageCount }).analysis;
      const projected = projectDraftV3(analysis);
      expect(MaterialAnalysisDraftSchema.safeParse(projected).success).toBe(true);
      expect(normalizeAnalysis(MaterialAnalysisDraftSchema.parse(projected), { pageCount }).analysis).toEqual(analysis);
    }
  });

  it("projectDraftV2 is a VALID v2 draft, and normalizing it again gives back the same stored analysis", () => {
    const stored = storedV2();
    const projected = projectDraftV2(stored);
    expect(DraftSchemaV2.safeParse(projected).success).toBe(true);
    expect(normalizeAnalysisV2(DraftSchemaV2.parse(projected), { pageCount: 2 }).analysis).toEqual(stored);
  });

  it("measures compact JSON in characters and estimated tokens", () => {
    expect(sizeOf({ a: "xx" }, 2)).toEqual({ chars: 10, tokens: 5 });
    expect(reduction(100, 60)).toBeCloseTo(0.4, 6);
    expect(reduction(0, 0)).toBe(0);
  });
});

describe("v3 against v2: the saving is measured, not assumed", () => {
  const v2Size = sizeOf(projectDraftV2(storedV2()));
  const authored = sizeOf(MaterialAnalysisDraftSchema.parse(worksheetDraftV3()));
  const equivalent = sizeOf(projectDraftV3(upgradeAnalysisV2(storedV2()).analysis));

  it("the output the model must emit shrinks by at least 25 % even with the information v2 could not hold", () => {
    expect(reduction(v2Size.chars, authored.chars)).toBeGreaterThanOrEqual(0.25);
    expect(reduction(v2Size.chars, equivalent.chars)).toBeGreaterThanOrEqual(0.25);
  });

  it("v3 holds MORE information than v2 (answer areas, structured chart data, constraints) in less text", () => {
    const draft = worksheetDraftV3();
    expect(draft.visuals.some((v) => v.chart)).toBe(true);
    expect(draft.activities.every((a) => a.answer_area === "lines" && (a.answer_lines ?? 0) > 0)).toBe(true);
    expect(draft.protected.some((p) => p.type === "reasoning_constraint")).toBe(true);
  });

  it("the cached system + schema block does not grow with v3 (the new contract is paid for by removing what was redundant)", () => {
    expect(schemaBlockChars(getMaterialAnalyzer(2)).total).toBeLessThanOrEqual(schemaBlockChars(getMaterialAnalyzer(1)).total);
  });

  it("calibrates characters per token from a real run", () => {
    expect(calibrateCharsPerToken(15_293, 6_345)).toBeCloseTo(2.41, 2);
  });
});

describe("theoretical cost with the v3 contract (no API call behind it)", () => {
  const run = { model: "claude-sonnet-5-5", input: 3_369, cacheWrite: 6_345, cacheRead: 0, output: 4_928 };

  it("reproduces the real cost of a run from its recorded tokens", () => {
    expect(costOf(run)).toBeCloseTo(0.071881, 5);
  });

  it("keeps the model's reasoning constant and shrinks only the JSON it emits", () => {
    const estimate = estimateOptimizedCost(run, 3_000, 0.4, 0);
    expect(estimate.reasoningTokens).toBe(1_928);
    expect(estimate.outputOnly).toBeCloseTo(costOf({ ...run, output: 1_928 + 1_800 })!, 6);
    expect(estimate.outputOnly!).toBeLessThan(estimate.current!);
    expect(estimate.outputAndBlock).toBeCloseTo(estimate.outputOnly!, 6);
  });

  it("a smaller schema block lowers the cache write, a bigger one raises it", () => {
    expect(estimateOptimizedCost(run, 3_000, 0.4, 0.1).outputAndBlock!).toBeLessThan(estimateOptimizedCost(run, 3_000, 0.4, 0).outputAndBlock!);
    expect(estimateOptimizedCost(run, 3_000, 0.4, -0.2).outputAndBlock!).toBeGreaterThan(estimateOptimizedCost(run, 3_000, 0.4, 0).outputAndBlock!);
  });

  it("never claims the JSON was more than the whole output, and an unpriced model has no estimate", () => {
    expect(estimateOptimizedCost(run, 99_999, 0.5, 0).reasoningTokens).toBe(0);
    expect(estimateOptimizedCost({ ...run, model: "modelo-sin-precio" }, 1_000, 0.4, 0).outputOnly).toBeNull();
  });
});
