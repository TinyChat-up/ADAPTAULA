import { activityStructure } from "@/lib/adaptation/structure";
import type { AnalysisActivity, AnalysisVisual } from "@/lib/schemas/material-analysis";
import { isLabel } from "./page-model";

/**
 * The printed marks a figure carries and the activity is about (docs/VISUAL_RESOURCES.md § Figuras con marcas): the letters that
 * point at its parts (A–D), the numbers of its arrows (1–4), the measures written on its sides (8 cm). They are read ONLY from the
 * analysis's own words about the visual and from the activities that use it (their instruction and the answer fields they print,
 * «A:» … «D:», «Flecha 1:» …, one per line or inline), never from a model. A figure is only located by them when every expected mark is printed, once, on
 * that drawing (`locate.ts`): the marks are evidence of identity, not of pedagogical correctness.
 */

export interface ExpectedMarks {
  /** Capital letters that must be printed on the figure, each exactly once. */
  letters: string[];
  /** Numbers that must be printed on the figure, each exactly once. */
  numbers: string[];
  /** At least two measures («8 cm») must be printed on the figure. */
  measures: boolean;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «8 cm», «3,5 m», «12 mm», «4 cm²». */
export const isMeasure = (text: string) => /^\s*\d{1,4}([.,]\d{1,2})?\s?(mm|cm|dm|m|km)(²|2)?\s*$/i.test(text);
/** The «?» of an unknown side. */
export const isUnknown = (text: string) => /^\s*\?\s*$/.test(text);
/** A printed mark of a figure: a label (`A`, `1`, `1/4`), a measure or an unknown. */
export const isMark = (text: string) => isLabel(text) || isMeasure(text) || isUnknown(text);
/** A text line made only of marks («8 cm», «A», «1 2», «?»). */
export const isMarkLine = (text: string) => isMeasure(text) || text.trim().split(/\s+/).every((t) => isLabel(t) || isUnknown(t));

const LETTERS = "ABCDEFGH";
const range = (from: string, to: string, alphabet: string) => {
  const a = alphabet.indexOf(from);
  const b = alphabet.indexOf(to);
  return a >= 0 && b > a && b - a <= 7 ? alphabet.slice(a, b + 1).split("") : [];
};
const numberRange = (from: number, to: number) => (to > from && to - from <= 9 ? Array.from({ length: to - from + 1 }, (_, i) => String(from + i)) : []);

/** «A, B, C y D», «A–D», «A a D», «de la A a la D», «las letras D (flor), C (hoja), B (tallo) y A (raíz)». */
function lettersIn(text: string): string[] {
  const r = /\b(?:de la\s+)?([A-H])\s*(?:[–—-]|\s+a\s+(?:la\s+)?)\s*([A-H])\b/.exec(text);
  if (r) return range(r[1]!, r[2]!, LETTERS);
  const list = /\b([A-H](?:\s*,\s*[A-H])+\s+y\s+[A-H])\b/.exec(text);
  if (list) return list[1]!.split(/\s*,\s*|\s+y\s+/);
  // Each letter followed by the part it names, in brackets: only right after the word «letra(s)», so a stray capital never counts.
  const named = /\bletras?\s+((?:[A-H]\s*\([^)]{1,40}\)\s*(?:,|\by\b)\s*)+[A-H]\s*\([^)]{1,40}\))/.exec(text);
  return named ? [...named[1]!.replace(/\([^)]*\)/g, "").matchAll(/\b([A-H])\b/g)].map((m) => m[1]!) : [];
}

/** «1–4», «del 1 al 4», «1 a 4», «1, 2, 3 y 4», «1 del mar al vapor, 2 del vapor a las nubes, 3 …». */
function numbersIn(text: string): string[] {
  const r = /\b(?:del\s+)?(\d)\s*(?:[–—-]|\s+al?\s+)\s*(\d)\b/.exec(text);
  if (r) return numberRange(Number(r[1]), Number(r[2]));
  const list = /\b(\d(?:\s*,\s*\d)+\s+y\s+\d)\b/.exec(text);
  if (list) return list[1]!.split(/\s*,\s*|\s+y\s+/);
  // An enumeration whose items each START with their number (after «:», «,», «;» or «y»): only a run 1, 2, … n with n ≥ 2 counts.
  const leading = [...text.matchAll(/(?:[:;,]|\by)\s*(\d)\s+(?!(?:mm|cm|dm|m|km)\b)(?=\p{L})/gu)].map((m) => Number(m[1]));
  let n = 0;
  while (leading[n] === n + 1) n++;
  return n >= 2 ? numberRange(1, n) : [];
}

/** Answer fields printed inline in an activity's context: «A:, B:, C:, D:» or «Flecha 1, Flecha 2, Flecha 3, Flecha 4». */
function inlineFields(context: string | null): string[] {
  if (!context) return [];
  const parts = context.split(/[,;\n]+/).map((p) => p.replace(/[:_.\s]+$/g, "").trim()).filter((p) => p.length > 0);
  return parts.length >= 2 && parts.every((p) => /^(?:[A-H]|(?:flecha|paso|proceso)\s+\d)$/i.test(p)) ? parts : [];
}

/** The marks the analysis says the visual carries, or null when its words name none (the figure is then not located by marks). */
export function expectedMarks(visual: Pick<AnalysisVisual, "title" | "description" | "text">, activities: readonly Pick<AnalysisActivity, "instruction" | "context" | "type" | "answer_area">[]): ExpectedMarks | null {
  const own = `${visual.title ?? ""}. ${visual.description}. ${visual.text ?? ""}`;
  const words = normalize(`${own} ${activities.map((a) => `${a.instruction} ${a.context ?? ""}`).join(" ")}`);
  const fields = activities.flatMap((a) => [...(activityStructure(a).fields ?? []).map((f) => f.label.trim()), ...inlineFields(a.context)]);

  let letters: string[] = [];
  if (/\bletras?\b/.test(words)) letters = lettersIn(own).length > 0 ? lettersIn(own) : activities.map((a) => lettersIn(`${a.instruction} ${a.context ?? ""}`)).find((l) => l.length > 0) ?? [];
  const fieldLetters = fields.filter((f) => /^[A-H]$/.test(f));
  if (letters.length === 0 && fieldLetters.length >= 2) letters = fieldLetters;

  let numbers: string[] = [];
  if (/\b(flechas?|numerad[oa]s?|pasos?)\b/.test(words)) numbers = numbersIn(own).length > 0 ? numbersIn(own) : activities.map((a) => numbersIn(`${a.instruction} ${a.context ?? ""}`)).find((n) => n.length > 0) ?? [];
  const fieldNumbers = fields.map((f) => /^(?:flecha|paso|proceso)\s+(\d)$/i.exec(f)?.[1]).filter((n): n is string => n !== undefined);
  if (numbers.length === 0 && fieldNumbers.length >= 2) numbers = fieldNumbers;

  const measures = /\b(medidas?|acotad[oa]s?|longitud(es)?|lados?\s+(de|que)\s+mide|cm|mm|centimetros|metros)\b/.test(normalize(own));
  if (letters.length < 2 && numbers.length < 2 && !measures) return null;
  return { letters: letters.length >= 2 ? [...new Set(letters)] : [], numbers: numbers.length >= 2 ? [...new Set(numbers)] : [], measures };
}
