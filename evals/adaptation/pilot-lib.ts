import { estimateCostUsd } from "@/lib/ai/costs";
import type { ModelSelection } from "@/lib/ai/types";

/**
 * Cost ceilings of the V2.2 pilot (one material, one profile): ONE analysis call and ONE planner v3 call, no repair and no
 * regeneration. Computed BEFORE any call, from things that are fixed in advance:
 *  - the output of each call cannot exceed its `max_tokens` (the API enforces it; adaptive thinking counts inside it);
 *  - the planner's input is bounded by its system and schema, the rules block with ALL the precedents (the selection can only send
 *    fewer), the material (a projection of the analysis, whose size the analysis cap bounds) and the context.
 * Every input token is priced as a 5-minute cache write (1.25x), the most expensive way to pay for it. Tokens are estimated from
 * characters at 2.4 per token (pessimistic for Spanish JSON); the exact count needs the token-counting endpoint, which is an API
 * call and is not made here.
 */
export const CHARS_PER_TOKEN = 2.4;
export const tokensOf = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** Input tokens per PDF page (text + page image) and per file (instructions), deliberately above what an A4 page costs. */
export const ANALYSIS_TOKENS_PER_PAGE = 4_000;
export const ANALYSIS_TOKENS_PER_FILE = 3_000;
/** Cached system + schema block of the analysis prompt (measured 6.345 for v1; v3 is smaller). */
export const ANALYSIS_PROMPT_TOKENS = 6_400;
/** The material sent to the planner is the analysis re-serialised with ids: at most 1.5x the analysis output. */
export const MATERIAL_FACTOR = 1.5;
/** Context, request text and wrappers: real contexts are around 1.000 tokens. */
export const CONTEXT_TOKENS = 4_000;

export interface PilotBoundInput {
  analysisSelection: ModelSelection;
  plannerSelection: ModelSelection;
  pages: number;
  analysisMaxOutputTokens: number;
  plannerMaxOutputTokens: number;
  /** Planner v3 system text + schema text, in characters. */
  plannerPromptChars: number;
  /** Rules block with every precedent of the library, in characters. */
  rulesAllChars: number;
}

export interface PilotBound {
  analysis: { inputTokens: number; outputTokens: number; usd: number };
  planner: { inputTokens: number; outputTokens: number; usd: number };
  totalUsd: number;
}

function price(selection: ModelSelection, inputTokens: number, outputTokens: number): number {
  const usd = estimateCostUsd(selection.provider, selection.model, { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: inputTokens, outputTokens });
  if (usd === null) throw new Error(`No hay precio para ${selection.provider}:${selection.model}: no se puede acotar el gasto.`);
  return usd;
}

export function pilotBound(input: PilotBoundInput): PilotBound {
  const analysisIn = input.pages * ANALYSIS_TOKENS_PER_PAGE + ANALYSIS_TOKENS_PER_FILE + ANALYSIS_PROMPT_TOKENS;
  const plannerIn = tokensOf(input.plannerPromptChars) + tokensOf(input.rulesAllChars) + Math.ceil(input.analysisMaxOutputTokens * MATERIAL_FACTOR) + CONTEXT_TOKENS;
  const analysis = { inputTokens: analysisIn, outputTokens: input.analysisMaxOutputTokens, usd: price(input.analysisSelection, analysisIn, input.analysisMaxOutputTokens) };
  const planner = { inputTokens: plannerIn, outputTokens: input.plannerMaxOutputTokens, usd: price(input.plannerSelection, plannerIn, input.plannerMaxOutputTokens) };
  return { analysis, planner, totalUsd: Math.round((analysis.usd + planner.usd) * 1_000_000) / 1_000_000 };
}

/** The planner ceiling once the analysis exists: same rule, with the real material size instead of the analysis cap. */
export function plannerBoundAfterAnalysis(selection: ModelSelection, chars: { prompt: number; rules: number; userText: number }, maxOutputTokens: number): number {
  return price(selection, tokensOf(chars.prompt) + tokensOf(chars.rules) + tokensOf(chars.userText) + CONTEXT_TOKENS, maxOutputTokens);
}
