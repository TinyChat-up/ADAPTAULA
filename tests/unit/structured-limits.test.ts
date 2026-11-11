import { describe, expect, it } from "vitest";
import { checkStructuredLimits } from "@/lib/ai/structured-limits";

/** The static check of the documented structured-output limits, on small synthetic schemas. */
const obj = (properties: Record<string, unknown>, required: string[], extra: Record<string, unknown> = {}) => ({ type: "object", properties, required, additionalProperties: false, ...extra });

describe("límites de las salidas estructuradas", () => {
  it("cuenta opcionales y uniones, y acepta un esquema dentro de los límites", () => {
    const report = checkStructuredLimits(obj({ a: { type: "string" }, b: { anyOf: [{ type: "string" }, { type: "null" }] }, c: { type: "array", items: { type: "string" }, minItems: 1 } }, ["a"]));
    expect(report).toMatchObject({ optionalParameters: 2, unionParameters: 1, problems: [] });
  });

  it("marca lo que la API no admite", () => {
    const report = checkStructuredLimits({ type: "object", properties: { a: { type: "string", minLength: 1, pattern: "(?=x)" }, b: { type: "array", minItems: 2 }, c: { $ref: "http://x/y" } }, required: ["a", "b", "c"] });
    expect(report.problems.join(" | ")).toMatch(/additionalProperties no es false/);
    expect(report.problems.join(" | ")).toMatch(/minLength no admitido/);
    expect(report.problems.join(" | ")).toMatch(/pattern no admitido/);
    expect(report.problems.join(" | ")).toMatch(/minItems 2/);
    expect(report.problems.join(" | ")).toMatch(/\$ref externo/);
  });

  it("detecta esquemas recursivos y el exceso de opcionales", () => {
    const recursive = { $defs: { node: obj({ child: { $ref: "#/$defs/node" } }, []) }, ...obj({ root: { $ref: "#/$defs/node" } }, ["root"]) };
    expect(checkStructuredLimits(recursive).problems.some((p) => p.includes("recursivo"))).toBe(true);
    const many = obj(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, { type: "string" }])), []);
    expect(checkStructuredLimits(many).problems.some((p) => p.includes("25 parámetros opcionales"))).toBe(true);
  });
});
