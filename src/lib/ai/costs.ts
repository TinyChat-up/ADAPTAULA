import type { AIUsage, ProviderName } from "./types";

/**
 * The one place with prices (USD per million tokens). Update `PRICES_AS_OF` with any change.
 * A model that is not listed has NO price: its cost is `null`, never an invented number.
 */
export const PRICES_AS_OF = "2026-10-01";

interface Price {
  match: RegExp;
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes cost 1.25x the input price. */
  cacheWriteMultiplier: number;
}

export const MODEL_PRICES: readonly Price[] = [
  { match: /^claude-sonnet-5-5/, input: 2, output: 10, cacheRead: 0.2, cacheWriteMultiplier: 1.25 },
  { match: /^claude-opus-5-5/, input: 4, output: 20, cacheRead: 0.2, cacheWriteMultiplier: 1.25 },
  { match: /^claude-haiku-4-5/, input: 1, output: 5, cacheRead: 0.1, cacheWriteMultiplier: 1.25 },
];

export function priceFor(provider: ProviderName, model: string): Price | null {
  if (provider !== "anthropic") return null;
  return MODEL_PRICES.find((p) => p.match.test(model)) ?? null;
}

/** Estimated cost in USD, or null when the price is unknown. The mock provider is free. */
export function estimateCostUsd(provider: ProviderName, model: string, usage: AIUsage): number | null {
  if (provider === "mock") return 0;
  const price = priceFor(provider, model);
  if (!price) return null;
  const perToken = 1 / 1_000_000;
  const cost =
    usage.inputTokens * price.input * perToken +
    usage.cacheCreationInputTokens * price.input * price.cacheWriteMultiplier * perToken +
    usage.cachedInputTokens * price.cacheRead * perToken +
    usage.outputTokens * price.output * perToken;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Sum of known costs; null as soon as one run has no price (a partial sum would understate the cost). */
export function sumCosts(costs: readonly (number | null)[]): number | null {
  let total = 0;
  for (const cost of costs) {
    if (cost === null) return null;
    total += cost;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}
