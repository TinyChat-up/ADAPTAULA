import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ANALYSIS_RETRY } from "../config";
import { AIError } from "../errors";
import type { AIProvider, ContentPart, StopReason, StructuredRequest, StructuredResponse } from "../types";

type StreamLike = { finalMessage(): Promise<Anthropic.Message> };
/** The slice of the SDK we use, so tests can inject a fake without network. */
export interface AnthropicClientLike {
  messages: { stream(params: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal; timeout?: number }): StreamLike };
}

/** Sonnet/Opus-class models take `output_config.effort`; Haiku does not. */
const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-/.test(model);

function toBlock(part: ContentPart): Anthropic.ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
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

  constructor(private readonly client: AnthropicClientLike) {}

  static fromApiKey(apiKey: string): AnthropicProvider {
    return new AnthropicProvider(new Anthropic({ apiKey, maxRetries: ANALYSIS_RETRY.sdkRetriesPerCall }));
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const key = modeKey(request.selection.model, request.output.name);
    if (request.output.delivery !== "prompted" && !promptedOutputs.has(key)) {
      try {
        return await this.send(request, "native");
      } catch (error) {
        if (!isGrammarTooLarge(error)) throw mapAnthropicError(error);
        promptedOutputs.add(key);
      }
    }
    try {
      return await this.send(request, "prompted");
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }

  private async send(request: StructuredRequest, mode: OutputMode): Promise<StructuredResponse> {
    const started = Date.now();
    const effort = supportsEffort(request.selection.model) ? { effort: request.selection.effort } : {};
    const params: Anthropic.MessageStreamParams = {
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

    const message = await this.client.messages
      .stream(params, { ...(request.signal ? { signal: request.signal } : {}), timeout: request.timeoutMs })
      .finalMessage();
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return {
      text,
      stopReason: STOP_REASONS[message.stop_reason ?? ""] ?? "other",
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
      provider: "anthropic",
      model: message.model,
      latencyMs: Date.now() - started,
    };
  }
}
