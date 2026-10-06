import { redactSecrets } from "@/lib/security/redact";

type Fields = Record<string, string | number | boolean | null | undefined>;

// Anything that could carry material content, prompts, identities or credentials is dropped, not masked.
const FORBIDDEN_KEY = /name|email|content|text|prompt|note|token|secret|key|password|answer/i;
const MAX_VALUE_LENGTH = 200;

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    out[key] = typeof value === "string" ? redactSecrets(value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value) : value;
  }
  return out;
}

function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...clean(fields) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** Structured logs with opaque ids only (workspaceId, jobId, materialId). Never content, names or secrets. */
export const logger = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
