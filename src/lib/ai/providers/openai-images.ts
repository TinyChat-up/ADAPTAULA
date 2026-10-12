import OpenAI, { toFile } from "openai";
import type { ImageGenerateParamsNonStreaming, ImageEditParamsNonStreaming, ImagesResponse } from "openai/resources/images";
import { ANALYSIS_RETRY } from "../config";
import { AIError } from "../errors";
import type { ImageProvider, ImageRequest, ImageResponse } from "../types";

/** The slice of the SDK we use, so tests can inject a fake without network. */
export interface OpenAIImagesClientLike {
  images: {
    generate(params: ImageGenerateParamsNonStreaming, options?: { signal?: AbortSignal; timeout?: number }): Promise<ImagesResponse>;
    edit(params: ImageEditParamsNonStreaming, options?: { signal?: AbortSignal; timeout?: number }): Promise<ImagesResponse>;
  };
}

/** Maps SDK errors to our categories. A moderation block is a refusal: never retried, never worked around. */
export function mapOpenAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof OpenAI.APIUserAbortError || error instanceof OpenAI.APIConnectionTimeoutError) return new AIError("timeout", "request timed out or was aborted", { cause: error });
  if (error instanceof OpenAI.RateLimitError) return new AIError("rate_limited", "rate limited", { cause: error });
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return new AIError("auth", "provider rejected the credentials", { cause: error });
  if (error instanceof OpenAI.BadRequestError && (error.code === "moderation_blocked" || /moderation/i.test(String(error.code ?? "")))) return new AIError("refusal", "blocked by the provider's content policy", { cause: error });
  if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError || error instanceof OpenAI.NotFoundError) return new AIError("bad_request", "provider rejected the request", { cause: error });
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.InternalServerError) return new AIError("provider_unavailable", "provider unavailable", { cause: error });
  if (error instanceof OpenAI.APIError && (error.status ?? 0) >= 500) return new AIError("provider_unavailable", "provider overloaded", { cause: error });
  return new AIError("unknown", "unexpected provider error", { cause: error });
}

/**
 * Transport only: the prompt arrives built (and versioned) by the pipeline. Always one opaque PNG, so the bytes can be validated,
 * hashed and printed like any other asset. Edits send the source picture; nothing else of the material travels.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai" as const;

  constructor(private readonly client: OpenAIImagesClientLike) {}

  static fromApiKey(apiKey: string): OpenAIImageProvider {
    return new OpenAIImageProvider(new OpenAI({ apiKey, maxRetries: ANALYSIS_RETRY.sdkRetriesPerCall }));
  }

  async generateImage(request: ImageRequest): Promise<ImageResponse> {
    const started = Date.now();
    const options = { signal: request.signal, timeout: request.timeoutMs };
    const common = { model: request.selection.model, prompt: request.prompt, size: request.size, quality: request.quality, output_format: "png" as const, background: "opaque" as const, n: 1 };
    let response: ImagesResponse;
    try {
      if (request.images && request.images.length > 0) {
        const image = await Promise.all(request.images.map((im, i) => toFile(Buffer.from(im.data), `source-${i}.${im.mediaType.split("/")[1]}`, { type: im.mediaType })));
        response = await this.client.images.edit({ ...common, image }, options);
      } else {
        response = await this.client.images.generate({ ...common, moderation: "auto" }, options);
      }
    } catch (error) {
      throw mapOpenAIError(error);
    }
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new AIError("invalid_output", "the provider returned no image");
    const usage = response.usage;
    return {
      image: { data: new Uint8Array(Buffer.from(b64, "base64")), mediaType: "image/png" },
      usage: { textInputTokens: usage?.input_tokens_details?.text_tokens ?? usage?.input_tokens ?? 0, imageInputTokens: usage?.input_tokens_details?.image_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 },
      provider: "openai",
      model: request.selection.model,
      latencyMs: Date.now() - started,
    };
  }
}
