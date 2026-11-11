/**
 * Static check of a JSON Schema against the documented limits of structured outputs (`output_config.format`), as published on
 * platform.claude.com («Structured outputs», read 2026-11-04): at most 24 optional parameters and 16 parameters with union types
 * (`anyOf` or a type array) across all strict schemas of a request; `additionalProperties: false` on every object; `minItems` only
 * 0 or 1; no `minLength`/`maxLength`/`minimum`/`maximum`/`multipleOf`; no recursive or external `$ref`; no regex backreferences,
 * lookaround or `\b`. The provider also has internal grammar-size limits it does not publish: passing this check is necessary,
 * not sufficient — only a real request proves the grammar compiles.
 */
export const STRUCTURED_OUTPUT_LIMITS = { optionalParameters: 24, unionParameters: 16 } as const;

const UNSUPPORTED_KEYWORDS = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems", "uniqueItems", "maxProperties", "minProperties"] as const;

export interface StructuredLimitsReport {
  optionalParameters: number;
  unionParameters: number;
  objects: number;
  problems: string[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function checkStructuredLimits(schema: Json): StructuredLimitsReport {
  const defs = (isObject(schema.$defs) ? schema.$defs : isObject(schema.definitions) ? schema.definitions : {}) as Record<string, Json>;
  const report: StructuredLimitsReport = { optionalParameters: 0, unionParameters: 0, objects: 0, problems: [] };

  const visit = (node: unknown, where: string) => {
    if (Array.isArray(node)) return node.forEach((n, i) => visit(n, `${where}[${i}]`));
    if (!isObject(node)) return;
    const ref = node.$ref;
    if (typeof ref === "string" && !ref.startsWith("#/")) report.problems.push(`${where}: $ref externo`);
    for (const k of UNSUPPORTED_KEYWORDS) if (k in node) report.problems.push(`${where}: ${k} no admitido`);
    if ("minItems" in node && node.minItems !== 0 && node.minItems !== 1) report.problems.push(`${where}: minItems ${String(node.minItems)}`);
    if (typeof node.pattern === "string" && /\\[1-9]|\(\?[=!<]|\\[bB]/.test(node.pattern)) report.problems.push(`${where}: pattern no admitido`);
    if (Array.isArray(node.anyOf) || Array.isArray(node.type)) report.unionParameters += 1;
    if (node.type === "object" || isObject(node.properties)) {
      report.objects += 1;
      if (node.additionalProperties !== false) report.problems.push(`${where}: additionalProperties no es false`);
      const props = isObject(node.properties) ? Object.keys(node.properties) : [];
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      report.optionalParameters += props.filter((p) => !required.has(p)).length;
    }
    for (const [k, v] of Object.entries(node)) if (k !== "$defs" && k !== "definitions") visit(v, `${where}.${k}`);
  };
  visit(schema, "#");
  for (const [name, def] of Object.entries(defs)) visit(def, `#/$defs/${name}`);

  // A $ref cycle is a recursive schema, which structured outputs do not support.
  const refsOf = (node: unknown, out: Set<string>): Set<string> => {
    if (Array.isArray(node)) node.forEach((n) => refsOf(n, out));
    else if (isObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string") out.add(v.split("/").pop()!);
        else refsOf(v, out);
      }
    }
    return out;
  };
  const reaches = (from: string, target: string, seen: Set<string>): boolean => {
    if (seen.has(from)) return false;
    seen.add(from);
    return [...refsOf(defs[from], new Set())].some((r) => r === target || reaches(r, target, seen));
  };
  for (const name of Object.keys(defs)) if (reaches(name, name, new Set())) report.problems.push(`#/$defs/${name}: esquema recursivo`);

  if (report.optionalParameters > STRUCTURED_OUTPUT_LIMITS.optionalParameters) report.problems.push(`${report.optionalParameters} parámetros opcionales (límite ${STRUCTURED_OUTPUT_LIMITS.optionalParameters})`);
  if (report.unionParameters > STRUCTURED_OUTPUT_LIMITS.unionParameters) report.problems.push(`${report.unionParameters} parámetros con unión (límite ${STRUCTURED_OUTPUT_LIMITS.unionParameters})`);
  return report;
}
