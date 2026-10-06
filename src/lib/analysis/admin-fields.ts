import type { ADMIN_FIELD_TYPES } from "@/lib/schemas/material-analysis";

export type AdminFieldType = (typeof ADMIN_FIELD_TYPES)[number];
export interface AdminField {
  type: AdminFieldType;
  label: string;
}

/** Labels of the blank fields printed on a worksheet, longest first so "nombre y apellidos" wins over "nombre". */
const LABELS: ReadonlyArray<{ type: AdminFieldType; words: readonly string[] }> = [
  { type: "student_name", words: ["nombre y apellidos", "apellidos y nombre", "nombre y apellido", "nombre del alumno", "nombre del alumna", "nombre del alumno/a", "alumno/a", "alumno", "alumna", "apellidos", "nombre"] },
  { type: "class_group", words: ["curso y grupo", "curso", "grupo", "clase"] },
  { type: "date", words: ["fecha"] },
  { type: "list_number", words: ["n.º de lista", "nº de lista", "numero de lista", "n.º", "nº", "n°"] },
  { type: "student_id", words: ["dni", "n.º de expediente", "expediente"] },
  { type: "score", words: ["calificacion", "puntuacion", "nota"] },
  { type: "signature", words: ["firma"] },
];

const BLANK = "[_.\\u2026\\-\\u2013\\u2014\\s]";
const unaccent = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const PATTERN = new RegExp(
  `(${LABELS.flatMap((l) => l.words)
    .map(unaccent)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|")})(\\s*:\\s*${BLANK}*|${BLANK}{2,})`,
  "gi",
);

const typeOf = (label: string): AdminFieldType => LABELS.find((l) => l.words.some((w) => unaccent(w) === label))?.type ?? "other";

/**
 * Labels that identify the STUDENT. If a sheet arrives already filled in ("Nombre y apellidos: Ana López"), the value is personal
 * data and must never be stored: the line is removed and only the existence of the field is kept. Bare "Nombre" is not in this
 * list on purpose: in a language worksheet it can be legitimate content.
 */
const STUDENT_VALUE = new RegExp(`^\\s*(nombre y apellidos|apellidos y nombre|nombre del alumno/a|nombre del alumno|nombre del alumna|alumno/a|alumno|alumna|dni)\\s*:\\s*[^\\s_.\u2026\\-\u2013\u2014]`, "i");

/** A page number on its own ("Página 1 de 2", "Pág. 3", "2/4"): rendering metadata, never pedagogical content. */
export function isPageNumberOnly(text: string): boolean {
  return /^(p[aá]g(ina)?\.?\s*)?\d{1,3}(\s*(de|\/)\s*\d{1,3})?$/i.test(text.trim());
}

/**
 * Removes the lines that are ONLY blank administrative fields ("Nombre y apellidos: ____  Fecha: ____") and reports what
 * they were. A line with a filled-in value, or with any other text, is left alone: this never guesses. Used both on model
 * output (defense in depth) and when lifting v2 analyses, where such lines were mixed into headings and notes.
 */
export function extractAdministrative(text: string): { rest: string; fields: AdminField[]; valuesDropped: number } {
  const fields: AdminField[] = [];
  const kept: string[] = [];
  let valuesDropped = 0;
  for (const line of text.split("\n")) {
    const plain = unaccent(line);
    const filled = STUDENT_VALUE.exec(plain);
    if (filled) {
      const label = unaccent(filled[1]!.toLowerCase());
      fields.push({ type: typeOf(label), label: line.slice(0, filled[1]!.length).replace(/\s+/g, " ").trim() });
      valuesDropped += 1;
      continue;
    }
    const matches = [...plain.matchAll(PATTERN)];
    if (matches.length === 0) {
      kept.push(line);
      continue;
    }
    const leftover = plain.replace(PATTERN, "").replace(/[\s|/,;:·\-–—_.…]+/g, "");
    if (leftover.length > 0) {
      kept.push(line);
      continue;
    }
    for (const match of matches) {
      const label = unaccent(match[1]!.toLowerCase());
      // Same length before and after removing accents, so the original spelling can be read back.
      const original = plain.length === line.length ? line.slice(match.index!, match.index! + match[1]!.length) : match[1]!;
      fields.push({ type: typeOf(label), label: original.replace(/\s+/g, " ").trim() });
    }
  }
  return { rest: kept.join("\n").trim(), fields, valuesDropped };
}
