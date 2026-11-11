import { describe, expect, it } from "vitest";
import { parseReviewerResponse, reviewerRejectionIssues } from "@/lib/adaptation/reviewer";
import { zodIssues } from "@/lib/adaptation/planner-draft";
import type { StructuredResponse } from "@/lib/ai/types";

const answer = (text: string): StructuredResponse => ({ text, stopReason: "complete", model: "m", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0 } }) as never;

describe("el rechazo de una revisión malformada dice POR QUÉ (rutas y reglas, nunca el contenido)", () => {
  it("un motivo de más de 160 caracteres, un campo de más y un identificador inválido se reconocen por su ruta", () => {
    const secret = "TEXTO-DE-LA-FICHA-QUE-NO-DEBE-APARECER";
    const long = `${secret} ${"x".repeat(200)}`;
    const parsed = parseReviewerResponse(answer(JSON.stringify({ findings: [{ check_key: "age_appropriate", target_ids: ["actividad 3"], verdict: "WARN", reason: long, improved_text: "otra cosa" }] })));
    expect(parsed.outcome).toBe("schema");
    if (parsed.outcome !== "schema" || !parsed.error) throw new Error("expected a schema rejection with its error");
    const issues = zodIssues(parsed.error);
    expect(issues.map((i) => i.path).sort()).toEqual(["findings.0", "findings.0.reason", "findings.0.target_ids.0"].sort());
    expect(JSON.stringify(issues)).not.toContain(secret);
  });
  it("la traza guarda solo códigos, rutas y reglas del esquema: ni valores de la respuesta ni claves inventadas por el modelo", () => {
    const secret = "NOMBRE-DE-ALUMNO-Y-FRASE-DE-LA-FICHA";
    const parsed = parseReviewerResponse(answer(JSON.stringify({ findings: [{ check_key: secret, target_ids: [secret], verdict: secret, reason: secret.repeat(10), [secret]: "otro valor", requires_human_review: secret }] })));
    if (parsed.outcome !== "schema" || !parsed.error) throw new Error("expected a schema rejection");
    const issues = reviewerRejectionIssues(parsed.error);
    const trace = JSON.stringify(issues);
    expect(trace).not.toContain(secret);
    expect(trace).not.toContain("alumno");
    // Only fixed vocabulary: known codes, schema property names, the rule's own numbers; an invented key counts, it is never named.
    expect(issues.every((i) => ["too_big", "invalid_value", "invalid_type", "invalid_format", "unrecognized_keys", "too_small", "custom", "missing", "other"].includes(i.code))).toBe(true);
    expect(issues.find((i) => i.code === "unrecognized_keys")).toMatchObject({ rule: "campos no permitidos: 1" });
    expect(issues.every((i) => /^[A-Za-z0-9_.()í?]+$/.test(i.path))).toBe(true);
  });
  it("una respuesta que no es JSON se reconoce como tal; una cortada o rechazada no se confunde con un error de esquema", () => {
    expect(parseReviewerResponse(answer("Esto no es JSON"))).toMatchObject({ outcome: "not_json" });
    expect(parseReviewerResponse({ ...answer("{"), stopReason: "max_tokens" } as never)).toMatchObject({ outcome: "truncated" });
    expect(parseReviewerResponse({ ...answer(""), stopReason: "refusal" } as never)).toMatchObject({ outcome: "refused" });
  });
});
