import type { Plan } from "@/lib/subscriptionService";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { OpenAIProvider } from "@/lib/ai/providers/openai";

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Minimal abstraction for AI generation providers.
 * stream() accumulates the full response while calling onProgress with the
 * number of characters received so far (used to drive the progress bar).
 * Returns the raw text from the model — adapt/route.ts handles JSON parsing.
 */
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
 * free  → Gemini 2.5 Flash (fast, cost-effective)
 * pro   → OpenAI GPT-4.1 if OPENAI_API_KEY is configured, else Gemini
 *
 * Falling back to Gemini for pro when no key is present lets the app run
 * without the premium key during development without throwing at build time.
 */
export function getAIProvider(plan: Plan): AIProvider {
  if (plan === "pro") {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) return new OpenAIProvider(openaiKey);
    // No OpenAI key configured — fall back to Gemini for now
  }
  return new GeminiProvider();
}
