import { normalizeText } from "@/lib/adaptation/text";
import { twoEvidenceFields } from "@/lib/adaptation/evidence-space";
import type { ResponseSpec } from "@/lib/schemas/material-document";
import type { RecreationActivity } from "./contract";

export const MIN_CALCULATION_MM = 34;
export const isCalculationField = (label: string): boolean => /^(?:operacion(?:es)?|calculos?|procedimiento de calculo)$/.test(normalizeText(label));

export const calculationResponse = (): ResponseSpec => ({
  kind: "fields",
  fields: [
    { label: "Operaciones", space: "grid", lines: 6 },
    { label: "Resultado", space: "box", lines: 2, unit: true },
  ],
});

export function writtenResponse(activity: RecreationActivity & { executor: Extract<RecreationActivity["executor"], { kind: "short_answer" }> }): ResponseSpec {
  if (activity.operations.includes("locate_evidence") || activity.operations.includes("justify")) {
    const evidence = twoEvidenceFields([activity.prompt, ...activity.steps].join(" "), activity.executor.lines);
    if (evidence) return evidence;
  }
  const producesReasoning = activity.operations.some((o) => o === "justify" || o === "predict" || o === "propose" || o === "evaluate_claim");
  return { kind: "lines", lines: Math.max(activity.executor.lines, producesReasoning ? 3 : 1) };
}
