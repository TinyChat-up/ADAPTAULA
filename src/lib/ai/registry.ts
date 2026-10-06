import { DEFAULT_EFFORT, DEFAULT_MODEL_REFS } from "./config";
import { AIError } from "./errors";
import { MODEL_ALIASES, type ModelAlias, type ModelSelection, type ProviderName, type ReasoningEffort, type TextModelAlias } from "./types";

const PROVIDERS: readonly ProviderName[] = ["anthropic", "openai", "mock"];

export function parseModelRef(ref: string): { provider: ProviderName; model: string } | null {
  const index = ref.indexOf(":");
  if (index <= 0) return null;
  const provider = ref.slice(0, index) as ProviderName;
  const model = ref.slice(index + 1);
  return PROVIDERS.includes(provider) && model.length > 0 ? { provider, model } : null;
}

export type ModelEnv = Partial<Record<`AI_MODEL_${ModelAlias}`, string | undefined>>;

/** Pure: alias → provider + model from an env-like map, falling back to the defaults. */
export function resolveModel(alias: ModelAlias, env: ModelEnv, effort?: ReasoningEffort): ModelSelection {
  if (!MODEL_ALIASES.includes(alias)) throw new AIError("not_configured", `unknown alias ${String(alias)}`);
  const ref = env[`AI_MODEL_${alias}`] || DEFAULT_MODEL_REFS[alias];
  if (!ref) throw new AIError("not_configured", `no model configured for ${alias}`);
  const parsed = parseModelRef(ref);
  if (!parsed) throw new AIError("not_configured", `invalid model reference for ${alias}`);
  const fallbackEffort = alias === "IMAGE_FAST" || alias === "IMAGE_QUALITY" ? "low" : DEFAULT_EFFORT[alias as TextModelAlias];
  return { alias, provider: parsed.provider, model: parsed.model, effort: effort ?? fallbackEffort };
}
