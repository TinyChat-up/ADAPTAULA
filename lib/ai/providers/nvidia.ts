import type { AIProvider } from "@/lib/ai/provider";

export class NvidiaProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.NVIDIA_API_KEY ?? "";
    this.model = process.env.NVIDIA_MODEL ?? "meta/llama-3.3-70b-instruct";
  }

  async stream(
    systemPrompt: string,
    userPrompt: string,
    onProgress: (chunkLength: number) => void,
  ): Promise<string> {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
        stream: true,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok || !response.body) {
      const err = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${err}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices: { delta: { content?: string } }[];
          };
          const chunk = parsed.choices[0]?.delta?.content ?? "";
          if (chunk) {
            fullText += chunk;
            onProgress(chunk.length);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    return fullText;
  }
}
