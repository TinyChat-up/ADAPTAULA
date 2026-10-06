/**
 * Detects server secrets in text that must never contain them (client bundles, rendered pages, eval results, snapshots).
 * It reports WHAT was found (a label), never the secret itself.
 */
export const SECRET_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "SUPABASE_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CRON_SECRET",
] as const;

const SECRET_SHAPES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "clave con forma de Anthropic (sk-ant-…)", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { label: "clave con forma de OpenAI (sk-…)", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { label: "secret key de Supabase (sb_secret_…)", pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { label: "clave secreta de Stripe (sk_live_/sk_test_/rk_…)", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
];

/** Values of the secret variables that are set and long enough to be real credentials. */
export function secretEnvValues(env: Record<string, string | undefined>): Array<{ name: string; value: string }> {
  return SECRET_ENV_NAMES.flatMap((name) => {
    const value = env[name];
    return value && value.length >= 16 ? [{ name, value }] : [];
  });
}

export interface ScanOptions {
  /** Real secret values to look for verbatim. */
  values?: ReadonlyArray<{ name: string; value: string }>;
  /** Also flag the variable NAMES (right for client bundles; server code legitimately mentions them). */
  names?: boolean;
}

export function findSecrets(text: string, options: ScanOptions = {}): string[] {
  const found = new Set<string>();
  for (const { name, value } of options.values ?? []) if (text.includes(value)) found.add(`valor de ${name}`);
  for (const { label, pattern } of SECRET_SHAPES) if (pattern.test(text)) found.add(label);
  if (options.names) for (const name of SECRET_ENV_NAMES) if (text.includes(name)) found.add(`nombre ${name}`);
  return [...found];
}
