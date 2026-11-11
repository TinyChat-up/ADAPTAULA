import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import { MockImageProvider } from "./providers/mock-images";
import { OpenAIImageProvider } from "./providers/openai-images";
import { AIError } from "./errors";
import type { SpendMeter } from "./spend";
import type { AIProvider, ImageProvider, ModelSelection } from "./types";

export interface ProviderDeps {
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  mockDelayMs?: number | undefined;
  /** True on the production deployment, where a mock provider must never be reachable. */
  isProduction?: boolean | undefined;
  /** Pilot deployments (ADR-046): every paid text request is counted and admitted first; paid images are refused. */
  spendMeter?: SpendMeter | undefined;
}

/**
 * alias → selection → provider. Pipelines call this and never name a vendor or a model.
 * OpenAI is a reserved slot: it is wired when the comparison in the adaptation phase needs it.
 */
export function createProvider(selection: ModelSelection, deps: ProviderDeps): AIProvider {
  switch (selection.provider) {
    case "anthropic":
      if (!deps.anthropicApiKey) throw new AIError("not_configured", "ANTHROPIC_API_KEY is not set");
      return AnthropicProvider.fromApiKey(deps.anthropicApiKey, deps.spendMeter);
    case "mock":
      if (deps.isProduction) throw new AIError("not_configured", "the mock provider is disabled in production");
      return new MockProvider({ delayMs: deps.mockDelayMs ?? 0 });
    case "openai":
      throw new AIError("not_configured", "the OpenAI provider is not available yet");
  }
}

/** alias (IMAGE_FAST / IMAGE_QUALITY) → selection → image provider. Only OpenAI has image models wired; the mock draws locally. */
export function createImageProvider(selection: ModelSelection, deps: ProviderDeps): ImageProvider {
  if (selection.alias !== "IMAGE_FAST" && selection.alias !== "IMAGE_QUALITY") throw new AIError("not_configured", "not an image alias");
  switch (selection.provider) {
    case "openai":
      // Image calls are not metered yet (V1–V7, next stage): where spend is metered, a paid image is never made.
      if (deps.spendMeter) throw new AIError("not_configured", "paid images are disabled where spend is metered");
      if (!deps.openaiApiKey) throw new AIError("not_configured", "OPENAI_API_KEY is not set");
      return OpenAIImageProvider.fromApiKey(deps.openaiApiKey);
    case "mock":
      if (deps.isProduction) throw new AIError("not_configured", "the mock provider is disabled in production");
      return new MockImageProvider();
    case "anthropic":
      throw new AIError("not_configured", "this provider has no image models");
  }
}
