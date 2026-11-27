import type { ResponseSpec } from "@/lib/schemas/material-document";
import { normalizeText } from "./text";

/** A narrowly explicit quantity qualifies: never infer it from an example, topic or the model's explanation. */
export function twoEvidenceFields(instruction: string, requestedLines = 1): Extract<ResponseSpec, { kind: "fields" }> | null {
  const text = normalizeText(instruction);
  if (!/\b(?:dos|2)\s+(?:pistas|evidencias|datos|pruebas)\b/.test(text)) return null;
  const stance = /\b(?:de acuerdo|postura|tu opinion)\b/.test(text);
  const lines = Math.max(3, Math.ceil(requestedLines / 2));
  return {
    kind: "fields",
    fields: [
      ...(stance ? [{ label: "Mi postura", space: "box" as const, lines: 2 }] : []),
      { label: "Evidencia 1", space: "lines", lines },
      { label: "Evidencia 2", space: "lines", lines },
    ],
  };
}
