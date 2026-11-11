import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { plannerRequestParts } from "@/lib/adaptation/planner";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import type { ModelSelection } from "@/lib/ai/types";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { pilotBound, plannerBoundAfterAnalysis, tokensOf } from "../../evals/adaptation/pilot-lib";
import { V22_PROFILES } from "../../evals/adaptation/v22-profiles";

/**
 * The pilot's cost ceiling (evals/adaptation/pilot-lib.ts) is computed before the material is analysed. It must never be below what
 * the same rule gives once the analysis exists, or the budget would not be a guarantee. Synthetic sheets; no call is made.
 */
const sonnet: ModelSelection = { alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" };
const promptChars = ADAPTATION_PLANNER_V3.system.length + schemaInstructions(ADAPTATION_PLANNER_V3.output.schema).length;
const RULES_ALL = 160_000;
const rules = (chars: number) => ({ text: `<agent_rules>${"x".repeat(chars)}</agent_rules>`, version: "v9.9", package_sha256: "a".repeat(64), block_sha256: "b".repeat(64), selection: { resources: [], included: [], excluded: [] } });

describe("cota del piloto V2.2", () => {
  it("salida máxima por llamada y entrada como escritura de caché: la cota es la suma de los dos peores casos", () => {
    const bound = pilotBound({ analysisSelection: sonnet, plannerSelection: sonnet, pages: 2, analysisMaxOutputTokens: 16_000, plannerMaxOutputTokens: 32_000, plannerPromptChars: promptChars, rulesAllChars: RULES_ALL });
    expect(bound.analysis.outputTokens).toBe(16_000);
    expect(bound.planner.outputTokens).toBe(32_000);
    // Output alone: 48.000 tokens at $10/M.
    expect(bound.totalUsd).toBeGreaterThan(0.48);
    expect(bound.totalUsd).toBeCloseTo(bound.analysis.usd + bound.planner.usd, 6);
  });

  it.each([["fracciones", fractionsAnalysis], ["geografía", geographyAnalysis], ["argumentación", argumentationAnalysis]] as const)("%s: la cota previa cubre la recalculada con el análisis y cualquier selección", (_, sheet) => {
    const analysis = sheet();
    for (const profile of Object.values(V22_PROFILES)) {
      const context = buildAdaptationContext({ profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility", policy: 2 }).context;
      const { parts } = plannerRequestParts({ analysis, context, version: 3, rules: rules(100_000) });
      const userText = parts.slice(1).map((p) => (p.type === "text" ? p.text : "")).join("");
      // The analysis cap must cover the material actually produced; these synthetic analyses are far below 16.000 tokens.
      expect(tokensOf(userText.length)).toBeLessThan(16_000);
      const before = pilotBound({ analysisSelection: sonnet, plannerSelection: sonnet, pages: 2, analysisMaxOutputTokens: 16_000, plannerMaxOutputTokens: 32_000, plannerPromptChars: promptChars, rulesAllChars: RULES_ALL });
      const after = plannerBoundAfterAnalysis(sonnet, { prompt: promptChars, rules: 100_000, userText: userText.length }, 32_000);
      expect(after).toBeLessThanOrEqual(before.planner.usd);
    }
  });

  it("un modelo sin precio no permite acotar el gasto", () => {
    expect(() => pilotBound({ analysisSelection: { ...sonnet, model: "modelo-sin-precio" }, plannerSelection: sonnet, pages: 1, analysisMaxOutputTokens: 1000, plannerMaxOutputTokens: 1000, plannerPromptChars: 1, rulesAllChars: 1 })).toThrow(/No hay precio/);
  });
});
