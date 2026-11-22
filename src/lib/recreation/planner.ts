import "server-only";
import { RECREATION_PLANNER_V1 } from "@prompts/recreation-planner/v1";
import { RECREATION_PLANNER_V2 } from "@prompts/recreation-planner/v2";
import { RECREATION_PLANNER_V3 } from "@prompts/recreation-planner/v3";
import { RECREATION_PLANNER_V4 } from "@prompts/recreation-planner/v4";
import { RECREATION_PLANNER_V5 } from "@prompts/recreation-planner/v5";
import { RECREATION_PLANNER_V6 } from "@prompts/recreation-planner/v6";
import { RECREATION_PLANNER_V7 } from "@prompts/recreation-planner/v7";
import { RECREATION_PLANNER_V8 } from "@prompts/recreation-planner/v8";
import { DIRECTED_RECREATION_PLANNER_V1 } from "@prompts/recreation-planner/directed-v1";
import { estimateCostUsd, priceFor } from "@/lib/ai/costs";
import type { AIProvider, AIRunRecord, ModelSelection, StructuredRequest } from "@/lib/ai/types";
import { MockProvider } from "@/lib/ai/providers/mock";
import { callStructured } from "@/lib/materials/visuals/auto/assistants";
import type { Planner } from "./pilot";

/**
 * The recreation planner on the EXISTING model plumbing: a provider from `src/lib/ai` (Anthropic in production, `MockProvider` in
 * tests), the versioned prompt `recreation_planner` v1, structured output validated against `recreation_plan@v1` by
 * `callStructured` (the helper the visual assistants already use), and an `ai_runs` record per call without content. No new agent
 * and no new transport.
 *
 * Spending is capped BEFORE each call: the worst case of the call (its input estimated from its length, its output at the maximum)
 * must fit in what is left of the recreation's budget; a model without a known price counts at a defensive fixed worst case. At most
 * two calls: the plan and, if the contract or the verifier rejects it, one repair told what to fix.
 */

export const RECREATION_PLANNER_LIMITS = {
  maxOutputTokens: 14_000,
  /** The plan plus one repair. */
  maxCalls: 2,
  /** Default ceiling for one recreation's planning (USD), when the caller sets none. */
  budgetUsd: 0.6,
  /** Worst case of one call whose model has no price in the table (never an invented 0). */
  unpricedCallUsd: 0.4,
  timeoutMs: 120_000,
} as const;

export interface PlannerBudget {
  limitUsd: number;
  spentUsd(): Promise<number>;
}

/** The worst a call can cost: its input (≈ 3 characters per token) and its maximum output at the model's price. */
export function worstCallUsd(selection: ModelSelection, inputChars: number, maxOutputTokens: number = RECREATION_PLANNER_LIMITS.maxOutputTokens): number {
  if (selection.provider === "mock") return 0;
  if (!priceFor(selection.provider, selection.model)) return RECREATION_PLANNER_LIMITS.unpricedCallUsd;
  return estimateCostUsd(selection.provider, selection.model, { inputTokens: Math.ceil(inputChars / 3), outputTokens: maxOutputTokens, cachedInputTokens: 0, cacheCreationInputTokens: 0 }) ?? RECREATION_PLANNER_LIMITS.unpricedCallUsd;
}

const RECREATION_PROMPTS = [
  RECREATION_PLANNER_V1, RECREATION_PLANNER_V2, RECREATION_PLANNER_V3, RECREATION_PLANNER_V4,
  RECREATION_PLANNER_V5, RECREATION_PLANNER_V6, RECREATION_PLANNER_V7, RECREATION_PLANNER_V8,
];

export function createRecreationPlanner(deps: { provider: AIProvider; selection: ModelSelection; budget: PlannerBudget; maxOutputTokens?: number; promptVersion?: number; recordAiRun(run: AIRunRecord): Promise<void> }): Planner {
  // The output allowance is frozen when the adaptation is created. Older pending jobs must keep their original allowance.
  const maxOutputTokens = deps.maxOutputTokens ?? RECREATION_PLANNER_LIMITS.maxOutputTokens;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > RECREATION_PLANNER_LIMITS.maxOutputTokens) {
    throw new Error("invalid recreation planner output allowance");
  }
  const promptVersion = deps.promptVersion ?? RECREATION_PLANNER_V1.version;
  const prompt = RECREATION_PROMPTS.find(({ version }) => version === promptVersion);
  if (!prompt) throw new Error("unsupported frozen recreation planner prompt version");
  let spent: number | null = null;
  return async (input, repairOf, previousPlan) => {
    // Frozen v1/v2 jobs keep the input they were designed for (no `approach`).
    const legacy = { ...input, context: Object.fromEntries(Object.entries(input.context).filter(([k]) => k !== "approach")) as typeof input.context };
    const parts = prompt.version === 1
      ? prompt.buildUserParts(legacy, repairOf)
      : prompt.buildUserParts(prompt.version === 2 ? legacy : input, repairOf, previousPlan);
    const chars = prompt.system.length + parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0);
    spent ??= await deps.budget.spentUsd();
    if (spent + worstCallUsd(deps.selection, chars, maxOutputTokens) > deps.budget.limitUsd + 1e-9) return { draft: null, run: null, stop: "budget_exhausted" };
    const { draft, run } = await callStructured(deps.provider, deps.selection, "plan", prompt, parts, maxOutputTokens, AbortSignal.timeout(RECREATION_PLANNER_LIMITS.timeoutMs), RECREATION_PLANNER_LIMITS.timeoutMs);
    spent += run.estimatedCostUsd ?? worstCallUsd(deps.selection, chars, maxOutputTokens);
    await deps.recordAiRun({ ...run, attempt: repairOf ? 2 : 1 });
    return { draft, run };
  };
}

/** Isolated fixture transport. It has no selection or provider through which it could make a paid request. */
export function createDirectedRecreationPlanner(fixture: (request: StructuredRequest) => unknown) {
  const prompt = DIRECTED_RECREATION_PLANNER_V1;
  const provider = new MockProvider({ fixtures: { [prompt.output.name]: fixture } });
  const selection: ModelSelection = { alias: "STANDARD", provider: "mock", model: "directed-fixture", effort: "medium" };
  return (content: string) => callStructured(provider, selection, "plan", prompt, content, RECREATION_PLANNER_LIMITS.maxOutputTokens);
}
