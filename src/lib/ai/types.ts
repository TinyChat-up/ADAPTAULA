import type { z } from "zod";

export const MODEL_ALIASES = ["ECONOMY", "STANDARD", "PREMIUM", "IMAGE_FAST", "IMAGE_QUALITY"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];
export type TextModelAlias = Exclude<ModelAlias, "IMAGE_FAST" | "IMAGE_QUALITY">;
export const TEXT_MODEL_ALIASES = ["ECONOMY", "STANDARD", "PREMIUM"] as const satisfies readonly TextModelAlias[];

export type ProviderName = "anthropic" | "openai" | "mock";
export type ReasoningEffort = "low" | "medium" | "high";

export type AIPurpose = "analyze" | "plan" | "generate" | "review" | "revise_block" | "image_brief" | "image" | "image_review" | "locate_visual" | "visual_support" | "visual_rewrite";

/** Resolved by `registry.ts` from env/config. Business code handles aliases; only this layer sees model ids. */
export interface ModelSelection {
  alias: ModelAlias;
  provider: ProviderName;
  model: string;
  effort: ReasoningEffort;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

/** Provider-neutral message content. Each provider translates it to its own wire format. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "pdf"; data: Uint8Array }
  | { type: "image"; mediaType: ImageMediaType; data: Uint8Array };

export interface AIMessage {
  role: "user" | "assistant";
  content: ContentPart[];
}

export interface StructuredRequest {
  selection: ModelSelection;
  system: string;
  messages: AIMessage[];
  /** The Zod schema is the contract; each provider derives its own JSON Schema flavor from it. */
  /**
   * `delivery`: "auto" tries the provider's constrained decoding first and falls back to the schema in the prompt when it is
   * rejected for size; "prompted" goes straight to the schema in the prompt (one billed call, no probe).
   */
  output: { name: string; schema: z.ZodType; delivery?: "auto" | "prompted" };
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
}

export type StopReason = "complete" | "max_tokens" | "refusal" | "other";

/**
 * What a provider returns: untrusted text plus accounting. Parsing, Zod validation and normalization
 * are the pipeline's job, never the provider's: a provider is not a source of truth.
 */
export interface StructuredResponse {
  text: string;
  stopReason: StopReason;
  usage: AIUsage;
  provider: ProviderName;
  model: string;
  latencyMs: number;
}

export interface GeneratedImage {
  data: Uint8Array;
  mediaType: "image/png" | "image/webp";
}

/** Transport only: prompts, schemas and business rules live in the pipelines, so a provider is swappable by config. */
export interface AIProvider {
  readonly name: ProviderName;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
}

/** Output sizes every supported image model accepts (portrait, square, landscape). */
export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/**
 * One image from an image model: a generation, or an edit when `images` carries the picture to work from. The prompt is built
 * by the pipeline from a versioned template (`prompts/`); the provider only transports it.
 */
export interface ImageRequest {
  selection: ModelSelection;
  prompt: string;
  size: ImageSize;
  quality: "low" | "medium" | "high";
  images?: ReadonlyArray<{ mediaType: ImageMediaType; data: Uint8Array }>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ImageUsage {
  textInputTokens: number;
  imageInputTokens: number;
  outputTokens: number;
}

export interface ImageResponse {
  image: GeneratedImage;
  usage: ImageUsage;
  provider: ProviderName;
  model: string;
  latencyMs: number;
}

/** Image models are a separate transport: a provider that draws is not one that writes JSON (and vice versa). */
export interface ImageProvider {
  readonly name: ProviderName;
  generateImage(request: ImageRequest): Promise<ImageResponse>;
}

/** One row of `ai_runs`. Never holds material content, prompts or learner data. */
export interface AIRunRecord {
  purpose: AIPurpose;
  attempt: number;
  alias: ModelAlias;
  provider: ProviderName;
  model: string;
  effort: ReasoningEffort;
  promptKey: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
  status: "success" | "error" | "refused" | "invalid_output";
  errorCode: string | null;
  /** Why an answer was rejected: schema paths and rules only, never values (see `describeIssues`). Logged and reported, not persisted. */
  issues?: string[];
}
