import type { AdaptationStore } from "./store";

/**
 * Cost of an adaptation, by stage, from `ai_runs`. The material's analysis is SHARED by every adaptation of it: it is reported
 * apart and never added into an adaptation's total. A run whose price is unknown is `null` (never 0) and makes the total a lower
 * bound (`incomplete`). No pricing decisions here.
 */

export interface StageCostLine {
  calls: number;
  usd: number;
  unknown: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface AdaptationCostBreakdown {
  planning: StageCostLine;
  generation: StageCostLine;
  review: StageCostLine;
  adaptationTotalUsd: number;
  /** True when some call had no known price: the totals are lower bounds. */
  incomplete: boolean;
  /** The material's analysis, shared; null if the material was never analysed through ai_runs. */
  sharedAnalysisUsd: number | null;
}

const line = (): StageCostLine => ({ calls: 0, usd: 0, unknown: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0);

export function aggregateCost(adaptationRuns: ReadonlyArray<Record<string, unknown>>, analysisRuns: ReadonlyArray<Record<string, unknown>>): AdaptationCostBreakdown {
  const stages = { plan: line(), generate: line(), review: line() };
  for (const r of adaptationRuns) {
    const stage = stages[r.purpose as keyof typeof stages];
    if (!stage) continue;
    stage.calls += 1;
    stage.inputTokens += num(r.input_tokens);
    stage.cacheWriteTokens += num(r.cache_creation_input_tokens);
    stage.cacheReadTokens += num(r.cached_input_tokens);
    stage.outputTokens += num(r.output_tokens);
    if (r.estimated_cost_usd === null || r.estimated_cost_usd === undefined) stage.unknown += 1;
    else stage.usd += num(r.estimated_cost_usd);
  }
  const analysisKnown = analysisRuns.filter((r) => r.estimated_cost_usd !== null && r.estimated_cost_usd !== undefined);
  const total = stages.plan.usd + stages.generate.usd + stages.review.usd;
  return {
    planning: stages.plan,
    generation: stages.generate,
    review: stages.review,
    adaptationTotalUsd: Math.round(total * 1e6) / 1e6,
    incomplete: stages.plan.unknown + stages.generate.unknown + stages.review.unknown > 0,
    sharedAnalysisUsd: analysisRuns.length === 0 ? null : Math.round(analysisKnown.reduce((a, r) => a + num(r.estimated_cost_usd), 0) * 1e6) / 1e6,
  };
}

export async function getAdaptationCost(store: AdaptationStore, adaptationId: string, materialId: string): Promise<AdaptationCostBreakdown> {
  const [adaptationRuns, analysisRuns] = await Promise.all([store.listAiRuns({ adaptationId }), store.listAiRuns({ materialId })]);
  return aggregateCost(adaptationRuns, analysisRuns);
}
