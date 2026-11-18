import { IMAGE_MODEL_PRICES, estimateImageCostUsd } from "@/lib/ai/costs";
import { SpendRefused, createSpendMeter, type SpendLedger, type SpendMeter } from "@/lib/ai/spend";
import type { ImageProvider, ImageRequest, ImageResponse, ImageSize, ProviderName } from "@/lib/ai/types";

/**
 * The money guard of the real recreation evaluation (ADR-052). ONE ledger for the whole run, with the authorised limit:
 *   · text (Claude: plan, repair, brief, review): the product's `SpendMeter` (ADR-046) — every HTTP request is counted with the
 *     free token-counting endpoint, its worst case (input as cache writes + the full output budget) reserved BEFORE it is sent,
 *     and settled at its real usage; the SDK makes no retries (one admitted request = one request);
 *   · images (OpenAI): this wrapper — the worst case of the image (prompt + the output tokens of its size and quality, with a margin)
 *     reserved BEFORE the call, settled at the real usage; no SDK retries either.
 * A request that does not fit what is left of the limit is NOT sent (`SpendRefused`): the run stops spending there. A failed or
 * unpriced call keeps its whole reservation (conservative). Prices come from `src/lib/ai/costs.ts`, checked by a person before a run.
 */

export interface LedgerEntry {
  id: string;
  provider: ProviderName;
  model: string;
  reservedUsd: number;
  settledUsd: number | null;
  settled: boolean;
}

export interface MemoryLedger extends SpendLedger {
  readonly limitUsd: number;
  /** What counts against the limit: settled costs, plus the full reservation of anything unsettled or unpriced. */
  committedUsd(): number;
  entries(): readonly LedgerEntry[];
  refusals(): number;
}

export function createMemoryLedger(limitUsd: number): MemoryLedger {
  const entries: LedgerEntry[] = [];
  let refused = 0;
  const committed = () => entries.reduce((sum, e) => sum + (e.settled && e.settledUsd !== null ? e.settledUsd : e.reservedUsd), 0);
  return {
    limitUsd,
    committedUsd: committed,
    entries: () => entries,
    refusals: () => refused,
    async admit(row) {
      if (committed() + row.reservedUsd > limitUsd + 1e-9) {
        refused++;
        return { id: null, committedUsd: committed() };
      }
      const id = `spend_${entries.length + 1}`;
      entries.push({ id, provider: row.provider, model: row.model, reservedUsd: row.reservedUsd, settledUsd: null, settled: false });
      return { id, committedUsd: committed() };
    },
    async settle(id, settledUsd) {
      const entry = entries.find((e) => e.id === id);
      if (entry && !entry.settled) Object.assign(entry, { settled: true, settledUsd });
    },
  };
}

/** The text meter on that ledger (the product's own). */
export const textMeter = (ledger: MemoryLedger): SpendMeter => createSpendMeter(ledger);

/**
 * Output tokens of one generated image by size and quality (the provider's published table for its image models), with a 25 %
 * margin: the reservation must be a ceiling, not an average.
 */
const IMAGE_OUTPUT_TOKENS: Record<ImageRequest["quality"], Record<ImageSize, number>> = {
  low: { "1024x1024": 272, "1536x1024": 408, "1024x1536": 408 },
  medium: { "1024x1024": 1056, "1536x1024": 1584, "1024x1536": 1584 },
  high: { "1024x1024": 4160, "1536x1024": 6240, "1024x1536": 6240 },
};
const PROMPT_TOKENS_CEILING = 1_500;

/** The most one image may cost, or null when the model has no price in the table (then it is never sent). */
export function imageCeilingUsd(model: string, size: ImageSize, quality: ImageRequest["quality"]): number | null {
  const price = IMAGE_MODEL_PRICES.find((p) => p.match.test(model));
  if (!price) return null;
  const output = Math.ceil(IMAGE_OUTPUT_TOKENS[quality][size] * 1.25);
  return Math.round(((PROMPT_TOKENS_CEILING * price.textInput + output * price.imageOutput) / 1_000_000) * 1_000_000) / 1_000_000;
}

/** An image provider whose every call is admitted by the ledger before it is sent and settled after. */
export function meteredImages(provider: ImageProvider, ledger: MemoryLedger): ImageProvider {
  return {
    name: provider.name,
    async generateImage(request: ImageRequest): Promise<ImageResponse> {
      const ceiling = imageCeilingUsd(request.selection.model, request.size, request.quality);
      if (ceiling === null) throw new SpendRefused("no_price");
      const { id } = await ledger.admit({ provider: request.selection.provider, model: request.selection.model, countedInputTokens: PROMPT_TOKENS_CEILING, maxOutputTokens: 0, reservedUsd: ceiling });
      if (!id) throw new SpendRefused("budget_exhausted");
      try {
        const response = await provider.generateImage(request);
        await ledger.settle(id, estimateImageCostUsd(response.provider, response.model, response.usage));
        return response;
      } catch (error) {
        // A failed image may still be billed: its whole reservation stays.
        await ledger.settle(id, null);
        throw error;
      }
    },
  };
}
