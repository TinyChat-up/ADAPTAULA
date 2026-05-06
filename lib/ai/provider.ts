import type { Plan } from "@/lib/subscriptionService";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { NvidiaProvider } from "@/lib/ai/providers/nvidia";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface AIProvider {
  stream(
    systemPrompt: string,
    userPrompt: string,
    onProgress: (chunkLength: number) => void,
  ): Promise<string>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns the appropriate AI provider for the given plan.
 *
 * free → NVIDIA Llama 3.3 70B (NIM API, OpenAI-compatible)
 * pro  → Gemini 2.5 Flash (Google AI API)
 */
export function getAIProvider(plan: Plan): AIProvider {
  if (plan === "free") {
    return new NvidiaProvider();
  }
  // pro → Gemini 2.5 Flash
  return new GeminiProvider();
}
