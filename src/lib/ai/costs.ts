import type { AIUsage, ImageUsage, ProviderName } from "./types";

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

/**
 * Image models (USD per million tokens), from the provider's pricing page on 2026-10-12. An image is billed by its tokens: text
 * prompt in, image in (edits), image out; the response carries the counts, so the cost is exact for what was produced.
 */
export const IMAGE_PRICES_AS_OF = "2026-10-12";

interface ImagePrice {
  match: RegExp;
  textInput: number;
  imageInput: number;
  imageOutput: number;
}

export const IMAGE_MODEL_PRICES: readonly ImagePrice[] = [
  { match: /^gpt-image-2\.5-(sunburst|flare)/, textInput: 5, imageInput: 8, imageOutput: 30 },
  { match: /^gpt-image-2(-\d{4}-\d{2}-\d{2})?$/, textInput: 5, imageInput: 8, imageOutput: 30 },
  { match: /^gpt-image-1\.5/, textInput: 5, imageInput: 8, imageOutput: 32 },
  { match: /^gpt-image-1-mini/, textInput: 2, imageInput: 2.5, imageOutput: 8 },
  { match: /^gpt-image-1$/, textInput: 5, imageInput: 10, imageOutput: 40 },
];

export function estimateImageCostUsd(provider: ProviderName, model: string, usage: ImageUsage): number | null {
  if (provider === "mock") return 0;
  if (provider !== "openai") return null;
  const price = IMAGE_MODEL_PRICES.find((p) => p.match.test(model));
  if (!price) return null;
  const cost = (usage.textInputTokens * price.textInput + usage.imageInputTokens * price.imageInput + usage.outputTokens * price.imageOutput) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
