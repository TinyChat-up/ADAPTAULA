import type { z } from "zod";

/** Removes ``` fences and surrounding prose, keeping the outermost JSON object. */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export type ParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "not_json" | "schema"; issues: string[] };

/** Short, content-free descriptions of what failed validation (paths and rules, never values). */
export function describeIssues(error: z.ZodError, max = 15): string[] {
  return error.issues.slice(0, max).map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`.slice(0, 200));
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>): ParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(text));
  } catch {
    return { ok: false, kind: "not_json", issues: ["La respuesta no es JSON válido."] };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, kind: "schema", issues: describeIssues(result.error) };
}
