import { describe, expect, it } from "vitest";
import { parseReviewerResponse } from "@/lib/adaptation/reviewer";
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
  it("una respuesta que no es JSON se reconoce como tal; una cortada o rechazada no se confunde con un error de esquema", () => {
    expect(parseReviewerResponse(answer("Esto no es JSON"))).toMatchObject({ outcome: "not_json" });
    expect(parseReviewerResponse({ ...answer("{"), stopReason: "max_tokens" } as never)).toMatchObject({ outcome: "truncated" });
    expect(parseReviewerResponse({ ...answer(""), stopReason: "refusal" } as never)).toMatchObject({ outcome: "refused" });
  });
});
