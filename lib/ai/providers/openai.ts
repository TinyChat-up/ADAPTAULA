import OpenAI from "openai";
import type { AIProvider } from "@/lib/ai/provider";

// Default premium model for Pro users. Override via OPENAI_MODEL env var.
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Streams a response from OpenAI and returns the full accumulated text.
   * Uses JSON mode to guarantee structured output compatible with the
   * existing Gemini JSON schema expected by adapt/route.ts.
   */
  async stream(
    systemPrompt: string,
    userPrompt: string,
    onProgress: (chunkLength: number) => void,
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: true,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 16384,
    });

    let accumulated = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        accumulated += delta;
        onProgress(accumulated.length);
      }
    }

    if (!accumulated) throw new Error("OpenAI no devolvió texto");
    return accumulated;
  }
}
