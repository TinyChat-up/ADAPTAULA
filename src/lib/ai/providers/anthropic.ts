import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ANALYSIS_RETRY } from "../config";
import { AIError } from "../errors";
import type { SpendMeter } from "../spend";
import type { AIProvider, ContentPart, StopReason, StructuredRequest, StructuredResponse } from "../types";

type StreamLike = { finalMessage(): Promise<Anthropic.Message> };
/** The slice of the SDK we use, so tests can inject a fake without network. */
export interface AnthropicClientLike {
  messages: {
    stream(params: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal; timeout?: number }): StreamLike;
    /** Free token-counting endpoint. Optional: only callers that budget a call before making it need it. */
    countTokens?(params: Anthropic.MessageCountTokensParams): Promise<{ input_tokens: number }>;
  };
}

/**
 * Options for callers that must account for every request (a budget-capped evaluation). The defaults keep the production behaviour.
 *  - `promptedFallback: false`: a native schema the API rejects is NOT retried in prompted mode; the error is thrown, so one
 *    `generateStructured` is at most one request.
 *  - `deliveries`: the mode of each output, by name, decided in advance (it overrides the request's own and any remembered fallback).
 */
export interface AnthropicProviderOptions {
  promptedFallback?: boolean;
  deliveries?: Readonly<Record<string, OutputMode>>;
  /**
   * Pilot deployments (ADR-046): every HTTP request this provider makes, the structured-output fallback included, is counted and
   * admitted by the meter BEFORE it is sent, and settled after. Use with an SDK client created with `maxRetries: 0`, so that one
   * admitted request is one HTTP request.
   */
  meter?: SpendMeter;
}

/** Sonnet/Opus-class models take `output_config.effort`; Haiku does not. */
const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-/.test(model);

function toBlock(part: ContentPart): Anthropic.ContentBlockParam {
  switch (part.type) {
    case "text":
      return part.cache ? { type: "text", text: part.text, cache_control: { type: "ephemeral" } } : { type: "text", text: part.text };
    case "pdf":
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(part.data).toString("base64") } };
    case "image":
      return { type: "image", source: { type: "base64", media_type: part.mediaType, data: Buffer.from(part.data).toString("base64") } };
  }
}

/**
 * How a schema is delivered. "native" = the provider's constrained decoding (`output_config.format`). "prompted" = the exact
 * JSON Schema goes into the system prompt and the answer is validated by Zod afterwards (with the pipeline's single repair).
 * The provider rejects grammars above a size limit (HTTP 400 "compiled grammar is too large"); the full material analysis,
 * with ~90 required fields in nested arrays, is above it. Remembered for the life of the process, per model and output name.
 */
export type OutputMode = "native" | "prompted";
const promptedOutputs = new Set<string>();
const modeKey = (model: string, name: string) => `${model}:${name}`;

/** Test hook: forget which outputs were found too large for native decoding. */
export function resetOutputModes() {
  promptedOutputs.clear();
}

export function isGrammarTooLarge(error: unknown): boolean {
  return error instanceof Anthropic.BadRequestError && /grammar is too large|schema is too complex|too many (strict )?tools/i.test(error.message);
}

/** The text that carries the schema in prompted mode. Exported so the size benchmark measures exactly what is sent. */
export function schemaInstructions(schema: z.ZodType): string {
  // "input": a field with a default (e.g. an empty list) may be omitted by the model, and the schema it is shown says so.
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return [
    "FORMATO DE SALIDA",
    "Responde únicamente con un objeto JSON válido que cumpla exactamente este JSON Schema: sin Markdown, sin comentarios y sin ningún texto antes ni después.",
    "Respeta los campos obligatorios, los tipos, los valores permitidos (enum) y las longitudes máximas. Cuando un dato no exista, usa el valor que indica la descripción de cada campo.",
    "<json_schema>",
    JSON.stringify(jsonSchema),
    "</json_schema>",
  ].join("\n");
}

const STOP_REASONS: Record<string, StopReason> = { end_turn: "complete", stop_sequence: "complete", max_tokens: "max_tokens", refusal: "refusal" };

/** Maps SDK errors to our categories. The raw message stays in `cause` for logs and never reaches users. */
export function mapAnthropicError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIError("timeout", "request timed out or was aborted", { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) return new AIError("rate_limited", "rate limited", { cause: error });
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AIError("auth", "provider rejected the credentials", { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError || error instanceof Anthropic.NotFoundError) {
    return new AIError("bad_request", "provider rejected the request", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
    return new AIError("provider_unavailable", "provider unavailable", { cause: error });
  }
  if (error instanceof Anthropic.APIError && (error.status === 529 || (error.status ?? 0) >= 500)) {
    return new AIError("provider_unavailable", "provider overloaded", { cause: error });
  }
  return new AIError("unknown", "unexpected provider error", { cause: error });
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;

  constructor(
    private readonly client: AnthropicClientLike,
    private readonly options: AnthropicProviderOptions = {},
  ) {}

  static fromApiKey(apiKey: string, meter?: SpendMeter): AnthropicProvider {
    // Metered: no SDK retries (each retry would be an unadmitted request); the jobs' own retries go through the meter again.
    if (meter) return new AnthropicProvider(new Anthropic({ apiKey, maxRetries: 0 }), { meter });
    return new AnthropicProvider(new Anthropic({ apiKey, maxRetries: ANALYSIS_RETRY.sdkRetriesPerCall }));
  }

  /** The mode this request would be sent in first. */
  modeFor(request: StructuredRequest): OutputMode {
    const fixed = this.options.deliveries?.[request.output.name];
    if (fixed) return fixed;
    return request.output.delivery === "prompted" || promptedOutputs.has(modeKey(request.selection.model, request.output.name)) ? "prompted" : "native";
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const mode = this.modeFor(request);
    if (mode === "native") {
      try {
        return await this.send(request, "native");
      } catch (error) {
        const fallback = this.options.promptedFallback !== false && !this.options.deliveries?.[request.output.name];
        if (!fallback || !isGrammarTooLarge(error)) throw mapAnthropicError(error);
        promptedOutputs.add(modeKey(request.selection.model, request.output.name));
      }
    }
    try {
      return await this.send(request, "prompted");
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }

  /**
   * Input tokens of exactly what `generateStructured` would send first (same system, messages, schema and effort), from the free
   * token-counting endpoint. The API documents the count as an estimate that may differ by a small amount: callers add a margin.
   */
  async countInputTokens(request: StructuredRequest): Promise<{ mode: OutputMode; inputTokens: number }> {
    if (!this.client.messages.countTokens) throw new AIError("not_configured", "token counting is not available on this client");
    const mode = this.modeFor(request);
    const { max_tokens: _max, ...params } = this.params(request, mode);
    void _max;
    try {
      const counted = await this.client.messages.countTokens(params as Anthropic.MessageCountTokensParams);
      return { mode, inputTokens: counted.input_tokens };
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }

  private params(request: StructuredRequest, mode: OutputMode): Anthropic.MessageStreamParams {
    const effort = supportsEffort(request.selection.model) ? { effort: request.selection.effort } : {};
    return {
      model: request.selection.model,
      max_tokens: request.maxOutputTokens,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content.map(toBlock) })),
      ...(mode === "native"
        ? {
            system: request.system,
            output_config: { format: { type: "json_schema", schema: zodOutputFormat(request.output.schema).schema }, ...effort },
          }
        : {
            // Both blocks are static for a given prompt and schema: the second one closes a cacheable prefix.
            system: [
              { type: "text", text: request.system },
              { type: "text", text: schemaInstructions(request.output.schema), cache_control: { type: "ephemeral" } },
            ],
            output_config: { ...effort },
          }),
    };
  }

  private async send(request: StructuredRequest, mode: OutputMode): Promise<StructuredResponse> {
    const params = this.params(request, mode);
    const meter = this.options.meter;
    // Admitted before anything is sent; a refusal (count, price, budget, ledger) means no request at all.
    const ticket = meter ? await meter.admit({ provider: "anthropic", model: params.model, maxOutputTokens: params.max_tokens, count: () => this.count(params) }) : null;
    const started = Date.now();
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.stream(params, { ...(request.signal ? { signal: request.signal } : {}), timeout: request.timeoutMs }).finalMessage();
    } catch (error) {
      // Possibly billed (a cut stream), never with a known usage: the whole reservation stays.
      if (meter && ticket) await meter.settle(ticket, null);
      throw error;
    }
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    if (meter && ticket) await meter.settle(ticket, usage);
    return { text, stopReason: STOP_REASONS[message.stop_reason ?? ""] ?? "other", usage, provider: "anthropic", model: message.model, latencyMs: Date.now() - started };
  }

  /** The free count of exactly these parameters (without `max_tokens`, which the endpoint does not take). */
  private async count(params: Anthropic.MessageStreamParams): Promise<number> {
    if (!this.client.messages.countTokens) throw new AIError("not_configured", "token counting is not available on this client");
    const { max_tokens: _max, ...rest } = params;
    void _max;
    return (await this.client.messages.countTokens(rest as Anthropic.MessageCountTokensParams)).input_tokens;
  }
}
