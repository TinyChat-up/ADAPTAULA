import type { ModelAlias, ReasoningEffort, TextModelAlias } from "./types";

/**
 * Where logical aliases meet concrete models. Business code never imports this: it asks the registry
 * for an alias. `AI_MODEL_<ALIAS>` in the environment overrides every entry, so changing a model
 * (or the provider) is a configuration change, not a code change.
 */
export const DEFAULT_MODEL_REFS: Record<ModelAlias, string | null> = {
  ECONOMY: "anthropic:claude-haiku-4-5",
  STANDARD: "anthropic:claude-sonnet-5-5",
  PREMIUM: "anthropic:claude-opus-5-5",
  // Verified on 2026-10-12 in the provider's model list and SDK (openai@7.24.0 `ImageModel`): «flare» is the fast everyday
  // generator, «sunburst» the most capable one (generation and edits). Overridable with AI_MODEL_IMAGE_*; used only when
  // FLAG_AI_IMAGES_ENABLED is on and the provider's credentials are configured.
  IMAGE_FAST: "openai:gpt-image-2.5-flare",
  IMAGE_QUALITY: "openai:gpt-image-2.5-sunburst",
};

export const DEFAULT_EFFORT: Record<TextModelAlias, ReasoningEffort> = {
  ECONOMY: "low",
  STANDARD: "medium",
  PREMIUM: "medium",
};

/**
 * Explicit retry policy of the analysis. Every category is bounded; nothing here is an open loop.
 *
 * | Failure                                              | Policy                                                          |
 * |------------------------------------------------------|-----------------------------------------------------------------|
 * | network · timeout · 5xx/overloaded · rate limit      | SDK retries inside one call + the job's own retries with backoff |
 * | complete output that fails Zod                       | at most ONE repair call carrying the (content-free) Zod issues   |
 * | output cut off by max_tokens                         | at most ONE clean regeneration with a larger output budget       |
 * | safety / provider refusal                            | never retried, never worked around                               |
 * | corrupt or unsupported input · bad request · auth    | never retried                                                    |
 */
export const ANALYSIS_RETRY = {
  /** Retries the SDK performs by itself inside a single call (connection errors, 408/409/429/5xx). */
  sdkRetriesPerCall: 2,
  /** Repairs of complete-but-invalid JSON. Hard cap: the env override can only lower it. */
  maxRepairAttempts: 1,
  /** A truncated JSON is never repaired: it is regenerated from scratch, once, with more room (only if there is room left). */
  truncation: { maxRegenerations: 1, growthFactor: 1.5, outputTokenCeiling: 64_000 },
} as const;

/** Material analysis defaults. Each value can be overridden with AI_ANALYSIS_* variables. */
export const ANALYSIS_DEFAULTS = {
  alias: "STANDARD" as TextModelAlias,
  effort: "medium" as ReasoningEffort,
  maxRepairAttempts: ANALYSIS_RETRY.maxRepairAttempts,
  /** A 25-page worksheet transcribed in full needs room; streaming makes large values safe. */
  maxOutputTokens: 24_000,
  /** Per call; the whole job additionally respects `jobDeadlineMs`. */
  callTimeoutMs: 200_000,
  /** Must stay below the route's maxDuration (300 s) so the job can still record its failure. */
  jobDeadlineMs: 270_000,
  /** A call that cannot finish in this window is not started. */
  minCallWindowMs: 20_000,
} as const;
