import { estimateCostUsd } from "./costs";
import { AIError } from "./errors";
import type { AIUsage, ProviderName } from "./types";

/**
 * Metered spend (ADR-046). Where a deployment has a pilot budget, EVERY paid request to a provider is counted first (the free
 * token-counting endpoint, same parameters as the request) and its ceiling is reserved in a ledger that serialises admissions
 * (database lock). Nothing is sent unless the reservation fits; a request that cannot be counted, priced or admitted is not sent.
 * The ceiling is what the request could cost at most: the count with a margin (the endpoint gives an estimate), all priced as
 * cache writes (the dearest input), plus the full output budget. A complete answer settles at its real usage; an error, an
 * unknown usage or a settlement that never happens keeps the whole reservation. Transport-agnostic: the ledger is injected.
 */
export const COUNT_MARGIN = { factor: 1.1, extraTokens: 1_000 } as const;

/** The most a request may cost, or null when the model has no price (then it cannot be admitted). */
export function requestCeilingUsd(provider: ProviderName, model: string, countedInputTokens: number, maxOutputTokens: number): number | null {
  const input = Math.ceil(countedInputTokens * COUNT_MARGIN.factor) + COUNT_MARGIN.extraTokens;
  return estimateCostUsd(provider, model, { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: input, outputTokens: maxOutputTokens });
}

export interface SpendLedger {
  /** Reserve `reservedUsd` if the campaign's committed spend plus it fits the budget; `id` null means refused. */
  admit(row: { provider: ProviderName; model: string; countedInputTokens: number; maxOutputTokens: number; reservedUsd: number }): Promise<{ id: string | null; committedUsd: number }>;
  /** Settle once: the real cost, or null to keep the whole reservation. */
  settle(id: string, settledUsd: number | null): Promise<void>;
}

export interface SpendTicket {
  id: string;
  provider: ProviderName;
  model: string;
  reservedUsd: number;
}

export interface SpendMeter {
  admit(request: { provider: ProviderName; model: string; maxOutputTokens: number; count: () => Promise<number> }): Promise<SpendTicket>;
  settle(ticket: SpendTicket, usage: AIUsage | null): Promise<void>;
}

export type SpendRefusal = "count_failed" | "no_price" | "budget_exhausted" | "ledger_unavailable";

export class SpendRefused extends AIError {
  constructor(readonly reason: SpendRefusal, options?: { cause?: unknown }) {
    // Not retryable: a refused budget does not change by trying again, and nothing was sent.
    super("not_configured", `pilot spend refused: ${reason}`, options);
    this.name = "SpendRefused";
  }
}

export function createSpendMeter(ledger: SpendLedger, onRefusal?: (reason: SpendRefusal, detail: { committedUsd?: number; reservedUsd?: number }) => void): SpendMeter {
  const refuse = (reason: SpendRefusal, detail: { committedUsd?: number; reservedUsd?: number } = {}, cause?: unknown): never => {
    onRefusal?.(reason, detail);
    throw new SpendRefused(reason, cause === undefined ? undefined : { cause });
  };
  return {
    async admit({ provider, model, maxOutputTokens, count }) {
      let counted: number;
      try {
        counted = await count();
      } catch (error) {
        return refuse("count_failed", {}, error);
      }
      if (!Number.isInteger(counted) || counted < 0) return refuse("count_failed");
      const reservedUsd = requestCeilingUsd(provider, model, counted, maxOutputTokens);
      if (reservedUsd === null || reservedUsd <= 0) return refuse("no_price");
      let admitted: { id: string | null; committedUsd: number };
      try {
        admitted = await ledger.admit({ provider, model, countedInputTokens: counted, maxOutputTokens, reservedUsd });
      } catch (error) {
        return refuse("ledger_unavailable", { reservedUsd }, error);
      }
      if (!admitted.id) return refuse("budget_exhausted", { committedUsd: admitted.committedUsd, reservedUsd });
      return { id: admitted.id, provider, model, reservedUsd };
    },
    async settle(ticket, usage) {
      const actual = usage ? estimateCostUsd(ticket.provider, ticket.model, usage) : null;
      try {
        await ledger.settle(ticket.id, actual);
      } catch {
        // The answer already arrived: a failed settlement must not turn it into an error. The reservation stays pending, so it
        // keeps counting at its whole ceiling (conservative) until someone reconciles it.
      }
    },
  };
}
