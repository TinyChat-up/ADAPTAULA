import type { V22CheckId, V22Finding } from "./checks";

/**
 * What the teacher reads of the V2.2 checks on a generated sheet (ADR-047): one line per indicator found, in plain words, with the
 * activities it concerns. Advisory only: the checks are partial (a clear result never says «no hint»), they do not block or change
 * the delivery, and they never replace the teacher's own review of hints, what is evaluated and the students' autonomy.
 */
export interface MethodNote {
  check: V22CheckId;
  label: string;
  detail: string;
  targets: string[];
}

const LABEL: Record<V22CheckId, string> = {
  answer_space_homogeneity: "Espacios de respuesta distintos entre actividades comparables",
  added_terms: "Hay términos que no estaban en el original",
  option_format: "Las opciones de respuesta no tienen el mismo formato",
  slot_count: "El número de huecos puede dar una pista",
  ambiguous_target: "Un cambio podría aplicarse a más de un sitio",
  word_limit: "Una instrucción supera el límite de palabras del perfil",
  conditional_means: "Un cambio depende de medios que no constan",
  approximate_leak: "Un texto se parece a una respuesta del ejercicio",
};

export function methodNotes(findings: readonly V22Finding[]): MethodNote[] {
  return findings.filter((f) => f.result === "flagged").map((f) => ({ check: f.check, label: LABEL[f.check], detail: f.detail, targets: f.targets }));
}
