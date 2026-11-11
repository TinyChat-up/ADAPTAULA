import { estimateCostUsd } from "@/lib/ai/costs";
import type { ModelSelection } from "@/lib/ai/types";

/**
 * Cost ceilings of the V2.2 pilot (one material, one profile): ONE analysis call and ONE planner v3 call, no repair and no
 * regeneration. Computed BEFORE any call, from things that are fixed in advance:
 *  - the output of each call cannot exceed its `max_tokens` (the API enforces it; adaptive thinking counts inside it);
 *  - the planner's input is bounded by its system and schema, the rules block with ALL the precedents (the selection can only send
 *    fewer), the material (a projection of the analysis, whose size the analysis cap bounds) and the context.
 * Every input token is priced as a 5-minute cache write (1.25x), the most expensive way to pay for it. Here tokens are ESTIMATED
 * from characters at 2.4 per token: this is the offline pre-check only. Before each paid call the pilot counts its exact input with
 * the token-counting endpoint and reserves `callCeilingUsd` (below); characters never authorise a call by themselves.
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

/**
 * The ceiling of one paid call from its COUNTED input. The API documents the count as an estimate that may differ by a small
 * amount, so the reservation adds 10 % and 1.000 tokens to it, prices every input token as a cache write (1.25x) and the output
 * at its hard cap (`max_tokens`, which also bounds adaptive thinking).
 */
export const COUNT_MARGIN = { factor: 1.1, extraTokens: 1_000 } as const;

export function callCeilingUsd(selection: ModelSelection, countedInputTokens: number, maxOutputTokens: number): number {
  return price(selection, Math.ceil(countedInputTokens * COUNT_MARGIN.factor) + COUNT_MARGIN.extraTokens, maxOutputTokens);
}

/** Safety margin of the pilot budget: calls are reserved against 80 % of it. */
export const BUDGET_SAFETY = 0.8;

export type LedgerEvent =
  | { kind: "reserve"; label: string; usd: number }
  | { kind: "settle"; label: string; reservedUsd: number; actualUsd: number }
  | { kind: "keep"; label: string; usd: number; reason: string }
  | { kind: "stop"; reason: string };

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Reserve-then-settle accounting (the laboratory's rule): a call is made only after its ceiling is reserved within the safe budget;
 * a complete answer settles it with the real usage; anything uncertain (an error, a missing usage, a usage above the ceiling) keeps
 * the whole reservation and stops the run. Nothing is reserved after a stop.
 */
export class PilotBudget {
  readonly cap: number;
  readonly events: LedgerEvent[] = [];
  private committed = 0;
  private stopped: string | null = null;

  constructor(readonly budgetUsd: number) {
    this.cap = round6(budgetUsd * BUDGET_SAFETY);
  }

  get stopReason(): string | null {
    return this.stopped;
  }

  get committedUsd(): number {
    return round6(this.committed);
  }

  /** True when the call may be made. */
  reserve(label: string, ceilingUsd: number): boolean {
    if (this.stopped) return false;
    if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) return this.stop(`${label}: cota de coste no válida`);
    if (this.committed + ceilingUsd > this.cap) return this.stop(`${label}: $${(this.committed + ceilingUsd).toFixed(4)} superaría el límite seguro de $${this.cap.toFixed(4)}`);
    this.committed += ceilingUsd;
    this.events.push({ kind: "reserve", label, usd: ceilingUsd });
    return true;
  }

  /** A complete answer with its usage. A cost above the reservation means the ceiling was wrong: it is all kept and the run stops. */
  settle(label: string, reservedUsd: number, actualUsd: number | null): void {
    if (actualUsd === null || !Number.isFinite(actualUsd)) return this.keep(label, reservedUsd, "uso o precio desconocido");
    if (actualUsd > reservedUsd) {
      this.committed += actualUsd - reservedUsd;
      this.events.push({ kind: "keep", label, usd: actualUsd, reason: "el coste real superó la reserva" });
      this.stop(`${label}: el coste real superó la reserva`);
      return;
    }
    this.committed -= reservedUsd - actualUsd;
    this.events.push({ kind: "settle", label, reservedUsd, actualUsd });
  }

  /** Error, timeout or cut connection: the provider may have billed it, so the reservation stays whole. */
  keep(label: string, reservedUsd: number, reason: string): void {
    this.events.push({ kind: "keep", label, usd: reservedUsd, reason });
    this.stop(`${label}: ${reason}`);
  }

  stop(reason: string): false {
    this.stopped ??= reason;
    this.events.push({ kind: "stop", reason });
    return false;
  }
}
