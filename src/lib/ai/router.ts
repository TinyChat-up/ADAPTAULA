import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import { AIError } from "./errors";
import type { AIProvider, ModelSelection } from "./types";

export interface ProviderDeps {
  anthropicApiKey?: string | undefined;
  mockDelayMs?: number | undefined;
  /** True on the production deployment, where a mock provider must never be reachable. */
  isProduction?: boolean | undefined;
}

/**
 * alias → selection → provider. Pipelines call this and never name a vendor or a model.
 * OpenAI is a reserved slot: it is wired when the comparison in the adaptation phase needs it.
 */
export function createProvider(selection: ModelSelection, deps: ProviderDeps): AIProvider {
  switch (selection.provider) {
    case "anthropic":
      if (!deps.anthropicApiKey) throw new AIError("not_configured", "ANTHROPIC_API_KEY is not set");
      return AnthropicProvider.fromApiKey(deps.anthropicApiKey);
    case "mock":
      if (deps.isProduction) throw new AIError("not_configured", "the mock provider is disabled in production");
      return new MockProvider({ delayMs: deps.mockDelayMs ?? 0 });
    case "openai":
      throw new AIError("not_configured", "the OpenAI provider is not available yet");
  }
}
