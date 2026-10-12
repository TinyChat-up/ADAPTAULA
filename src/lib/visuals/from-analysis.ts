import type { AnalysisVisual } from "@/lib/schemas/material-analysis";
import { VISUAL_SPEC_VERSION, VisualSpecSchema, less, parseLabel, reduce, sameValue, specIssues, tickValue, type Fraction, type VisualSpec } from "./spec";

/**
 * What the analysis's own words CLAIM a simple mathematical figure is. Only explicit, complete and self-consistent descriptions
 * give a claim: every number the figure needs must be written (parts AND shaded parts; interval AND divisions); a figure with a
 * marked point or any word the spec cannot carry gives none (it may be the task's data).
 *
 * A claim is never a figure by itself: a complete description is not evidence that it reflects the original. It is used to
 * (1) reject a crop whose pixels contradict it (`contradicts`), and (2) select, among the drawings of the original page, the
 * one whose pixels say exactly the same (`sameStructure`); only that pixel reading is drawn. Grids and circles have no pixel
 * reader, so they are never rebuilt from words.
 */

const WORD_NUMBERS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const DIVISION_WORDS: Record<string, number> = { medios: 2, tercios: 3, cuartos: 4, quintos: 5, sextos: 6, septimos: 7, octavos: 8, novenos: 9, decimos: 10 };
const NUM = String.raw`(\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)`;
const toNumber = (s: string) => (/^\d+$/.test(s) ? Number(s) : (WORD_NUMBERS[s] ?? NaN));
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

const SHADED = String.raw`(?:coloread[ao]s?|sombread[ao]s?|pintad[ao]s?|rellen[ao]s?)`;
const UNSHADED = /\b(sin colorear|en blanco|ninguna (?:parte )?(?:coloreada|sombreada|pintada)|vaci[ao])\b/;
const MARKED_POINT = /\b(punto|puntos|senalad[ao]|marcad[ao] con|flecha|una x|letra [a-z]\b)/;

function partsAndShaded(text: string): { parts: number; shaded: number } | null {
  const parts = new RegExp(String.raw`dividid[ao]s? en ${NUM} partes`).exec(text);
  if (!parts) return null;
  const n = toNumber(parts[1]!);
  const shaded = new RegExp(String.raw`${NUM} (?:de ellas |partes |de las partes )?(?:estan |aparecen )?${SHADED}`).exec(text);
  const m = shaded ? toNumber(shaded[1]!) : UNSHADED.test(text) ? 0 : NaN;
  return Number.isFinite(n) && Number.isFinite(m) && m <= n ? { parts: n, shaded: m } : null;
}

const fractionRe = String.raw`(\d{1,3}(?:\/\d{1,3})?)`;

function numberLine(text: string): VisualSpec | null {
  if (MARKED_POINT.test(text)) return null;
  const interval = new RegExp(String.raw`(?:de|desde(?: el)?) ${fractionRe} (?:a|al|hasta(?: el)?) ${fractionRe}`).exec(text);
  if (!interval) return null;
  const start = parseLabel(interval[1]!);
  const end = parseLabel(interval[2]!);
  if (!start || !end || !less(start, end)) return null;
  let divisions: number | null = null;
  let labelled: Fraction[] = [];
  const marks = /marcas? (?:en|de) ([0-9/ ,y]+)/.exec(text);
  if (marks) {
    const values = marks[1]!.split(/,| y /).map((x) => parseLabel(x.trim())).filter((x): x is Fraction => x !== null);
    if (values.length < 2) return null;
    const k = values.length - 1;
    // The listed marks must be exactly the equal division of the interval, in order.
    const candidate = { start, end, divisions: k };
    if (!values.every((v, i) => sameValue(v, tickValue(candidate, i)))) return null;
    divisions = k;
    labelled = values;
  } else {
    const split = new RegExp(String.raw`(?:dividida en ${NUM} partes iguales|(?:en|por) (medios|tercios|cuartos|quintos|sextos|septimos|octavos|novenos|decimos))`).exec(text);
    if (!split) return null;
    divisions = split[1] ? toNumber(split[1]) : (DIVISION_WORDS[split[2]!] ?? NaN);
    if (!Number.isFinite(divisions)) return null;
    labelled = [start, end];
  }
  const spec = { start, end, divisions: divisions! };
  // A unit interval in quarters: «1/4» marks; an integer interval: integers. Labels only where the description gives them.
  const labels = Array.from({ length: divisions! + 1 }, (_, i) => i)
    .filter((i) => labelled.some((v) => sameValue(v, tickValue(spec, i))))
    .map((i) => {
      const v = reduce(tickValue(spec, i));
      return { tick: i, text: v.d === 1 ? String(v.n) : `${v.n}/${v.d}` };
    });
  return verified({ spec_version: VISUAL_SPEC_VERSION, kind: "number_line", ...spec, labels });
}

function verified(candidate: unknown): VisualSpec | null {
  const parsed = VisualSpecSchema.safeParse(candidate);
  return parsed.success && specIssues(parsed.data).length === 0 ? parsed.data : null;
}

export function specFromAnalysis(visual: Pick<AnalysisVisual, "kind" | "title" | "description" | "text">): VisualSpec | null {
  const text = normalize(`${visual.title ?? ""}. ${visual.description}. ${visual.text ?? ""}`);
  if (visual.kind === "number_line" || /\brecta (numerica|numerada)\b/.test(text)) return numberLine(text);
  if (MARKED_POINT.test(text)) return null;
  const shading = (parts: number, shaded: number) => Array.from({ length: shaded }, (_, i) => i).filter((i) => i < parts);
  if (/\bcuadricula\b/.test(text)) {
    const dims = new RegExp(String.raw`${NUM} filas? (?:y|por|x) ${NUM} columnas?`).exec(text) ?? /(\d{1,2}) ?x ?(\d{1,2})/.exec(text);
    if (!dims) return null;
    const rows = toNumber(dims[1]!);
    const cols = toNumber(dims[2]!);
    const shaded = new RegExp(String.raw`${NUM} (?:casillas|cuadrados|celdas) ${SHADED}`).exec(text);
    const k = shaded ? toNumber(shaded[1]!) : UNSHADED.test(text) ? 0 : NaN;
    if (![rows, cols, k].every(Number.isFinite)) return null;
    return verified({ spec_version: VISUAL_SPEC_VERSION, kind: "grid", rows, cols, shaded: shading(rows * cols, k) });
  }
  const counts = partsAndShaded(text);
  if (!counts) return null;
  if (/\b(circulo|circunferencia|pizza|tarta|rueda)\b/.test(text)) return verified({ spec_version: VISUAL_SPEC_VERSION, kind: "part_whole", shape: "circle", parts: counts.parts, shaded: shading(counts.parts, counts.shaded) });
  if (/\b(barra|tira|rectangulo|segmento)\b/.test(text)) return verified({ spec_version: VISUAL_SPEC_VERSION, kind: "fraction_bar", parts: counts.parts, shaded: shading(counts.parts, counts.shaded) });
  return null;
}

/**
 * Same figure, as far as the claim can say: same kind and same numbers (parts and how many shaded; interval and divisions).
 * Which parts are shaded and which ticks are labelled come from the pixels, never from the claim.
 */
export function sameStructure(claim: VisualSpec, read: VisualSpec): boolean {
  if (claim.kind === "fraction_bar" && read.kind === "fraction_bar") return claim.parts === read.parts && claim.shaded.length === read.shaded.length;
  if (claim.kind === "number_line" && read.kind === "number_line") return sameValue(claim.start, read.start) && sameValue(claim.end, read.end) && claim.divisions === read.divisions;
  return false;
}

/** A pixel reading that a complete description of the same visual says is a different figure: the crop is not that visual. */
export function contradicts(visual: Pick<AnalysisVisual, "kind" | "title" | "description" | "text">, read: VisualSpec): boolean {
  const claim = specFromAnalysis(visual);
  return claim !== null && claim.kind === read.kind && !sameStructure(claim, read);
}

/**
 * The figure is coherent with the activities that use it: every fraction an activity asks to place on a number line lies on one of
 * its ticks (a line in fifths cannot carry «marca 3/4»).
 */
export function consistentWithActivities(spec: VisualSpec, activityTexts: readonly string[]): boolean {
  const fractions = activityTexts.flatMap((t) => [...normalize(t).matchAll(/\b(\d{1,3})\/(\d{1,3})\b/g)].map((m) => ({ n: Number(m[1]), d: Number(m[2]) }))).filter((f) => f.d > 0);
  if (spec.kind === "number_line") {
    const inside = fractions.filter((f) => !less(f, spec.start) && !less(spec.end, f));
    return inside.every((f) => Array.from({ length: spec.divisions + 1 }, (_, i) => tickValue(spec, i)).some((t) => sameValue(t, f)));
  }
  return true;
}
