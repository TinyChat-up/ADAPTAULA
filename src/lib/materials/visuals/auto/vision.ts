import "server-only";
import { VISUAL_LOCATOR_V1 } from "@prompts/visual-locator/v1";
import { estimateCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { parseStructured } from "@/lib/ai/structured";
import type { AIProvider, AIRunRecord, ModelSelection } from "@/lib/ai/types";
import { NormalizedBoundsSchema } from "../geometry";
import type { Hypothesis } from "./locate";

/**
 * The vision fallback: ONE call for one page, through `src/lib/ai` (alias, never a model id here), its answer validated with Zod
 * and recorded as an `ai_runs` row without content. What it returns is only a set of hypotheses for the deterministic locator.
 */

export interface VisionFigure {
  id: string;
  kind: string;
  description: string;
  activity: string | null;
}

export interface VisionLocator {
  locate(input: { pagePng: Uint8Array; figures: readonly VisionFigure[] }): Promise<{ hypotheses: Map<string, Hypothesis>; run: AIRunRecord }>;
}

const MAX_OUTPUT_TOKENS = 600;
const TIMEOUT_MS = 45_000;

export function createVisionLocator(selection: ModelSelection, provider: AIProvider): VisionLocator {
  const prompt = VISUAL_LOCATOR_V1;
  return {
    async locate({ pagePng, figures }) {
      const base = { purpose: "locate_visual" as const, attempt: 1, alias: selection.alias, provider: selection.provider, model: selection.model, effort: selection.effort, promptKey: prompt.key, promptVersion: prompt.version };
      const empty = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
      let response;
      try {
        response = await provider.generateStructured({
          selection,
          system: prompt.system,
          messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", data: pagePng }, { type: "text", text: prompt.buildUserText(figures) }] }],
          output: { name: prompt.output.name, schema: prompt.output.schema, delivery: "prompted" },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: TIMEOUT_MS,
        });
      } catch (error) {
        const code = toAIError(error).code;
        return { hypotheses: new Map(), run: { ...base, ...empty, estimatedCostUsd: null, latencyMs: 0, status: "error", errorCode: code } };
      }
      const usage = response.usage;
      const run: AIRunRecord = { ...base, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens, cacheCreationInputTokens: usage.cacheCreationInputTokens, estimatedCostUsd: estimateCostUsd(response.provider, response.model, usage), latencyMs: response.latencyMs, status: "success", errorCode: null };
      if (response.stopReason === "refusal") return { hypotheses: new Map(), run: { ...run, status: "refused", errorCode: "refused" } };
      const parsed = parseStructured(response.text, prompt.output.schema);
      if (!parsed.ok) return { hypotheses: new Map(), run: { ...run, status: "invalid_output", errorCode: parsed.kind, issues: parsed.issues } };
      const asked = new Set(figures.map((f) => f.id));
      const hypotheses = new Map<string, Hypothesis>();
      for (const v of parsed.data.visuals) {
        if (!asked.has(v.visual_id) || !v.found || !v.box) continue;
        // Outside the page or degenerate: not even a hypothesis.
        const bounds = NormalizedBoundsSchema.safeParse(v.box);
        if (bounds.success) hypotheses.set(v.visual_id, { bounds: bounds.data, confidence: v.confidence });
      }
      return { hypotheses, run };
    },
  };
}
