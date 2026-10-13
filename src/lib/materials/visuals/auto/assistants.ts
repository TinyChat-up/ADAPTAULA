import "server-only";
import { VISUAL_REWRITER_V1 } from "@prompts/visual-rewriter/v1";
import { VISUAL_SUBSTITUTE_V1 } from "@prompts/visual-substitute/v1";
import { VISUAL_SUPPORT_V1 } from "@prompts/visual-support/v1";
import type { z } from "zod";
import { estimateCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { parseStructured } from "@/lib/ai/structured";
import type { AIProvider, AIPurpose, AIRunRecord, ContentPart, ModelSelection } from "@/lib/ai/types";

/**
 * The model calls of the visual policy of «Hacer magia», through `src/lib/ai` (alias only). Each answer is parsed with Zod and
 * returned as an untrusted draft: `policy.ts` validates it (lengths, data kept, no answer, no reference to a missing image) before
 * anything reaches a sheet. Each call is one `ai_runs` row without content.
 */

export type SupportDraft = z.infer<typeof VISUAL_SUPPORT_V1.output.schema>;
export type RewriteDraft = z.infer<typeof VISUAL_REWRITER_V1.output.schema>;
export type SubstituteDraft = z.infer<typeof VISUAL_SUBSTITUTE_V1.output.schema>;

export interface VisualAssistants {
  support(input: { stage: string | null; purpose: string; activity: string }): Promise<{ draft: SupportDraft | null; run: AIRunRecord }>;
  rewrite(input: { stage: string | null; activity: string; visual: string }): Promise<{ draft: RewriteDraft | null; run: AIRunRecord }>;
  /** Recorded under the `visual_rewrite` purpose (same family of call; `prompt_key` tells them apart). */
  substitute(input: { stage: string | null; activity: string; objective: string | null; visual: string }): Promise<{ draft: SubstituteDraft | null; run: AIRunRecord }>;
}

/**
 * One structured call of a visual assistant: the answer parsed with Zod and returned as an untrusted draft, with its `ai_runs`
 * record (no content). Shared by the assistants here and the illustration pipeline (`../illustrate`).
 */
export async function callStructured<S extends z.ZodType>(provider: AIProvider, selection: ModelSelection, purpose: AIPurpose, prompt: { key: string; version: number; system: string; output: { name: string; schema: S } }, content: string | ContentPart[], maxOutputTokens = 900): Promise<{ draft: z.infer<S> | null; run: AIRunRecord }> {
  const base = { purpose, attempt: 1, alias: selection.alias, provider: selection.provider, model: selection.model, effort: selection.effort, promptKey: prompt.key, promptVersion: prompt.version };
  try {
    const parts: ContentPart[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
    const response = await provider.generateStructured({ selection, system: prompt.system, messages: [{ role: "user", content: parts }], output: { name: prompt.output.name, schema: prompt.output.schema, delivery: "prompted" }, maxOutputTokens, timeoutMs: 45_000 });
    const u = response.usage;
    const run: AIRunRecord = { ...base, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedInputTokens: u.cachedInputTokens, cacheCreationInputTokens: u.cacheCreationInputTokens, estimatedCostUsd: estimateCostUsd(response.provider, response.model, u), latencyMs: response.latencyMs, status: "success", errorCode: null };
    if (response.stopReason === "refusal") return { draft: null, run: { ...run, status: "refused", errorCode: "refused" } };
    const parsed = parseStructured(response.text, prompt.output.schema);
    return parsed.ok ? { draft: parsed.data as z.infer<S>, run } : { draft: null, run: { ...run, status: "invalid_output", errorCode: parsed.kind, issues: parsed.issues } };
  } catch (error) {
    return { draft: null, run: { ...base, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: null, latencyMs: 0, status: "error", errorCode: toAIError(error).code } };
  }
}

export function createVisualAssistants(selection: ModelSelection, provider: AIProvider): VisualAssistants {
  return {
    support: (input) => callStructured(provider, selection, "visual_support", VISUAL_SUPPORT_V1, VISUAL_SUPPORT_V1.buildUserText(input)),
    rewrite: (input) => callStructured(provider, selection, "visual_rewrite", VISUAL_REWRITER_V1, VISUAL_REWRITER_V1.buildUserText(input)),
    substitute: (input) => callStructured(provider, selection, "visual_rewrite", VISUAL_SUBSTITUTE_V1, VISUAL_SUBSTITUTE_V1.buildUserText(input)),
  };
}
