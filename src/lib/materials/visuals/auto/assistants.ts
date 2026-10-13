import "server-only";
import { VISUAL_REWRITER_V1 } from "@prompts/visual-rewriter/v1";
import { VISUAL_SUBSTITUTE_V2 } from "@prompts/visual-substitute/v2";
import { VISUAL_SUBSTITUTE_V3 } from "@prompts/visual-substitute/v3";
import { VISUAL_SUPPORT_V1 } from "@prompts/visual-support/v1";
import type { z } from "zod";
import { estimateCostUsd } from "@/lib/ai/costs";
import { isTransientAIError, toAIError } from "@/lib/ai/errors";
import { parseStructured } from "@/lib/ai/structured";
import type { AIProvider, AIPurpose, AIRunRecord, ContentPart, ModelSelection } from "@/lib/ai/types";

/**
 * The model calls of the visual policy of «Hacer magia», through `src/lib/ai` (alias only). Each answer is parsed with Zod and
 * returned as an untrusted draft: `policy.ts` validates it (lengths, data kept, no answer, no reference to a missing image) before
 * anything reaches a sheet. Each call is one `ai_runs` row without content.
 */

export type SupportDraft = z.infer<typeof VISUAL_SUPPORT_V1.output.schema>;
export type RewriteDraft = z.infer<typeof VISUAL_REWRITER_V1.output.schema>;
export type SubstituteDraft = z.infer<typeof VISUAL_SUBSTITUTE_V2.output.schema> & Partial<Pick<z.infer<typeof VISUAL_SUBSTITUTE_V3.output.schema>, "choice">>;

/** `transient`: no answer because of transient provider trouble (network, timeout, overload, rate limit), not a «no». */
export interface AssistantAnswer<D> {
  draft: D | null;
  run: AIRunRecord;
  transient?: boolean;
}

export interface VisualAssistants {
  support(input: { stage: string | null; purpose: string; activity: string }): Promise<AssistantAnswer<SupportDraft>>;
  rewrite(input: { stage: string | null; activity: string; visual: string }): Promise<AssistantAnswer<RewriteDraft>>;
  /** Recorded under the `visual_rewrite` purpose (same family of call; `prompt_key` tells them apart). */
  substitute(input: Parameters<typeof VISUAL_SUBSTITUTE_V3.buildUserText>[0]): Promise<AssistantAnswer<SubstituteDraft>>;
}

/**
 * One structured call of a visual assistant: the answer parsed with Zod and returned as an untrusted draft, with its `ai_runs`
 * record (no content). Shared by the assistants here and the illustration pipeline (`../illustrate`).
 */
export async function callStructured<S extends z.ZodType>(provider: AIProvider, selection: ModelSelection, purpose: AIPurpose, prompt: { key: string; version: number; system: string; output: { name: string; schema: S } }, content: string | ContentPart[], maxOutputTokens = 900, signal?: AbortSignal): Promise<AssistantAnswer<z.infer<S>>> {
  const base = { purpose, attempt: 1, alias: selection.alias, provider: selection.provider, model: selection.model, effort: selection.effort, promptKey: prompt.key, promptVersion: prompt.version };
  try {
    const parts: ContentPart[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
    const response = await provider.generateStructured({ selection, system: prompt.system, messages: [{ role: "user", content: parts }], output: { name: prompt.output.name, schema: prompt.output.schema, delivery: "prompted" }, maxOutputTokens, timeoutMs: 45_000, ...(signal ? { signal } : {}) });
    const u = response.usage;
    const run: AIRunRecord = { ...base, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedInputTokens: u.cachedInputTokens, cacheCreationInputTokens: u.cacheCreationInputTokens, estimatedCostUsd: estimateCostUsd(response.provider, response.model, u), latencyMs: response.latencyMs, status: "success", errorCode: null };
    if (response.stopReason === "refusal") return { draft: null, run: { ...run, status: "refused", errorCode: "refused" } };
    const parsed = parseStructured(response.text, prompt.output.schema);
    return parsed.ok ? { draft: parsed.data as z.infer<S>, run } : { draft: null, run: { ...run, status: "invalid_output", errorCode: parsed.kind, issues: parsed.issues } };
  } catch (error) {
    const code = toAIError(error).code;
    return { draft: null, run: { ...base, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: null, latencyMs: 0, status: "error", errorCode: code }, transient: isTransientAIError(code) };
  }
}

export function createVisualAssistants(selection: ModelSelection, provider: AIProvider): VisualAssistants {
  return {
    support: (input) => callStructured(provider, selection, "visual_support", VISUAL_SUPPORT_V1, VISUAL_SUPPORT_V1.buildUserText(input)),
    rewrite: (input) => callStructured(provider, selection, "visual_rewrite", VISUAL_REWRITER_V1, VISUAL_REWRITER_V1.buildUserText(input)),
    substitute: (input) => input.responseFormat === "select_option"
      ? callStructured(provider, selection, "visual_rewrite", VISUAL_SUBSTITUTE_V3, VISUAL_SUBSTITUTE_V3.buildUserText(input))
      : callStructured(provider, selection, "visual_rewrite", VISUAL_SUBSTITUTE_V2, VISUAL_SUBSTITUTE_V2.buildUserText(input)),
  };
}
