import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicClientLike } from "@/lib/ai/providers/anthropic";

/**
 * The pilot's record of every HTTP request to the provider (ADR-045). It wraps a client created with `maxRetries: 0`, so one entry
 * is one request: nothing is retried behind its back, and the run can show how many calls it made. Usage comes from the final
 * message; a request that fails has none, which the budget treats as its whole ceiling.
 */
export interface MeteredCall {
  kind: "count" | "message";
  outcome: "ok" | "error";
  /** A format in `output_config` means native structured output. */
  native: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cachedInputTokens: number | null;
  stopReason: string | null;
}

const nativeOf = (params: { output_config?: unknown }) => Boolean((params.output_config as { format?: unknown } | null | undefined)?.format);
const blank = (kind: MeteredCall["kind"], native: boolean): MeteredCall => ({ kind, outcome: "error", native, inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cachedInputTokens: null, stopReason: null });

export function meteredClient(inner: AnthropicClientLike): { client: AnthropicClientLike; calls: MeteredCall[] } {
  const calls: MeteredCall[] = [];
  const client: AnthropicClientLike = {
    messages: {
      stream(params, options) {
        const entry = blank("message", nativeOf(params));
        calls.push(entry);
        const stream = inner.messages.stream(params, options);
        return {
          async finalMessage(): Promise<Anthropic.Message> {
            const message = await stream.finalMessage();
            Object.assign(entry, {
              outcome: "ok",
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
              cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
              stopReason: message.stop_reason,
            });
            return message;
          },
        };
      },
      async countTokens(params) {
        const entry = blank("count", nativeOf(params));
        calls.push(entry);
        if (!inner.messages.countTokens) throw new Error("token counting is not available on this client");
        const counted = await inner.messages.countTokens(params);
        Object.assign(entry, { outcome: "ok", inputTokens: counted.input_tokens });
        return counted;
      },
    },
  };
  return { client, calls };
}

/** The real usage of one message call, for settling its reservation. Null when it failed or has no usage. */
export function usageOf(call: MeteredCall | undefined): { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationInputTokens: number } | null {
  if (!call || call.kind !== "message" || call.outcome !== "ok" || call.inputTokens === null || call.outputTokens === null) return null;
  return { inputTokens: call.inputTokens, outputTokens: call.outputTokens, cachedInputTokens: call.cachedInputTokens ?? 0, cacheCreationInputTokens: call.cacheCreationInputTokens ?? 0 };
}
