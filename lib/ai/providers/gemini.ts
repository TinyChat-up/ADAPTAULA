import { GEMINI_MODEL } from "@/lib/ai/model";
import type { AIProvider } from "@/lib/ai/provider";

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}

// ─── Non-streaming fallback ───────────────────────────────────────────────────

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const model = GEMINI_MODEL;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.3,
          maxOutputTokens: 16384,
        },
      }),
    },
  );

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const errData = data as { error?: { message?: string } };
    throw new Error(errData?.error?.message || "Error de Gemini (fallback)");
  }

  const candidates = data?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const rawText = candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("")
    .trim() || "";

  if (!rawText) throw new Error("Gemini fallback no devolvió texto");
  return rawText;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

async function streamGemini(
  systemPrompt: string,
  userPrompt: string,
  onProgress: (accumulatedChars: number) => void,
): Promise<string> {
  const model = GEMINI_MODEL;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.3,
          maxOutputTokens: 16384,
        },
      }),
    },
  );

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    let errorMessage = "Error de Gemini streaming";
    try {
      const parsed = JSON.parse(errorText) as { error?: { message?: string } };
      errorMessage = parsed?.error?.message || errorMessage;
    } catch { /* ignore */ }
    throw new Error(errorMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const chunk = JSON.parse(payload) as GeminiStreamChunk;
          const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (text) {
            accumulated += text;
            onProgress(accumulated.length);
          }
        } catch { /* ignore malformed chunk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!accumulated) throw new Error("Gemini streaming no devolvió texto");
  return accumulated;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class GeminiProvider implements AIProvider {
  /**
   * Streams the response from Gemini, falling back to non-streaming if needed.
   * Returns the raw text (JSON string) from the model.
   */
  async stream(
    systemPrompt: string,
    userPrompt: string,
    onProgress: (chunkLength: number) => void,
  ): Promise<string> {
    try {
      return await streamGemini(systemPrompt, userPrompt, onProgress);
    } catch (streamErr) {
      console.error("GEMINI_STREAM_FALLBACK:", streamErr);
      return await callGemini(systemPrompt, userPrompt);
    }
  }
}
