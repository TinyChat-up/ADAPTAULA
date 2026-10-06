/**
 * Last line of defense for text that may reach logs or a terminal: provider API keys (Anthropic `sk-ant-…`,
 * OpenAI `sk-…`) and bearer tokens are masked. The real protection is never putting a secret in a log in the first place.
 */
const SECRET_PATTERNS: readonly RegExp[] = [/sk-[A-Za-z0-9_-]{16,}/g, /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, "[redactado]"), text);
}
