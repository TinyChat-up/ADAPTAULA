import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { normalizeText } from "./text";

/**
 * Observable evidence that a support handed over what an activity evaluates (etapa 2.1). Pure helpers over the analysis's structured
 * fields: whole answer PARTS (an exercise with several parts has several answers), full numbers and fractions (never single digits),
 * the items and categories of the task itself. No wording of an instruction decides anything here.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Numbers and fractions, whole
// ---------------------------------------------------------------------------------------------------------------------

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** «1.000» → 1000, «17,5» → 17.5, «4/8» → 1/2. Whole tokens only: a digit is never compared alone. */
export function canonicalNumber(raw: string): string {
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  if (fraction) {
    const n = Number(fraction[1]);
    const d = Number(fraction[2]);
    if (d === 0) return raw.trim();
    const g = gcd(n, d);
    return `${n / g}/${d / g}`;
  }
  const plain = raw.trim().replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").replace(",", ".");
  return String(Number(plain));
}

const TOKEN = /\d+\s*\/\s*\d+|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;

/** The full numeric tokens of a text, as written (fractions with their two parts, thousands with their dots). */
export function numericTokens(text: string): string[] {
  return (text.match(TOKEN) ?? []).map((t) => t.replace(/\s+/g, ""));
}

/** Distinct tokens, compared by value: «4/8» and «1/2» are the same token. */
export const canonicalSet = (tokens: readonly string[]) => new Set(tokens.map(canonicalNumber));

// ---------------------------------------------------------------------------------------------------------------------
// Relations a = b, a < b between two whole values («2/4 = 1/2»)
// ---------------------------------------------------------------------------------------------------------------------

const VALUE = String.raw`(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)`;
// Not preceded by an operator: «5/6 - 2/6 = 3/6» is an operation, not the relation 2/6 = 3/6.
const RELATION = new RegExp(String.raw`(?<![\d/.,+\-−×x*÷:]\s?)${VALUE}\s*(?:\(\s*)?(=|<|>|≥|≤|≈)\s*${VALUE}`, "g");

const value = (raw: string) => {
  const c = canonicalNumber(raw);
  const f = /^(\d+)\/(\d+)$/.exec(c);
  return f ? Number(f[1]) / Number(f[2]) : Number(c);
};

/** Each relation of a text in canonical form: sides reduced, «a > b» written as «b < a», equalities ordered. */
export function relations(text: string): Array<{ literal: string; key: string }> {
  const out: Array<{ literal: string; key: string }> = [];
  for (const m of text.matchAll(RELATION)) {
    const [, left, op, right] = m as unknown as [string, string, string, string];
    const l = canonicalNumber(left);
    const r = canonicalNumber(right);
    const swap = op === ">" || op === "≥" || (op === "=" || op === "≈" ? value(left) > value(right) : false);
    const flipped = op === ">" ? "<" : op === "≥" ? "≤" : op;
    const key = swap ? `${r} ${flipped} ${l}` : `${l} ${op} ${r}`;
    out.push({ literal: `${left.replace(/\s+/g, "")}${op}${right.replace(/\s+/g, "")}`, key });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Answer parts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The separate answers of an exercise: «a) Núcleo; b) Membrana plasmática; c) …» are three. A part that is a label and its value
 * («Entran sustancias: 1») is also offered by its value. Parts too short to identify anything («3», «V») are never evidence.
 */
export function answerParts(activity: Pick<AnalysisActivity, "expected_answer">): string[] {
  const { basis, value: raw } = activity.expected_answer;
  if (basis === "not_inferable" || !raw) return [];
  const parts = raw
    .split(/\s*;\s*|\s+(?=[a-h]\)\s)|\n+/)
    .map((p) => p.replace(/^\s*[a-h]\)\s*/i, "").trim())
    .filter(Boolean);
  const offered = parts.flatMap((p) => {
    const afterColon = p.includes(":") ? p.slice(p.lastIndexOf(":") + 1).trim() : "";
    return afterColon ? [p, afterColon] : [p];
  });
  return [...new Set(offered)].filter(identifies);
}

/** A part identifies something when it is a word of four letters or more, a fraction, a decimal or a number of three digits or more. */
function identifies(part: string): boolean {
  const text = normalizeText(part);
  if (/^[\d\s/.,]+$/.test(text)) return /\d+\s*\/\s*\d+|\d+[.,]\d+|\d{3,}/.test(text);
  return text.replace(/[^a-z]/g, "").length >= 4;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the student already sees in the task
// ---------------------------------------------------------------------------------------------------------------------

const cells = (v: MaterialAnalysis["visuals"][number]) => [
  ...(v.table ? [v.table.headers.join(" "), ...v.table.rows.map((r) => r.join(" "))] : []),
  ...(v.chart ? [v.chart.categories.join(" ")] : []),
];

/** The sheet of the task: its instruction, context and the cells of its tables and charts. A reading is a source, not the sheet. */
export function visibleTaskText(analysis: MaterialAnalysis, activity: AnalysisActivity): string {
  const visuals = analysis.visuals.filter((v) => activity.resource_ids.includes(v.id));
  return [activity.instruction, activity.context ?? "", ...visuals.flatMap(cells)].join("\n");
}

/** The numbers the student works with, whole: the sheet of the task plus its linked texts. */
export function taskData(analysis: MaterialAnalysis, activity: AnalysisActivity): string[] {
  const texts = analysis.texts.filter((t) => activity.resource_ids.includes(t.id)).map((t) => t.text);
  const charts = analysis.visuals.filter((v) => activity.resource_ids.includes(v.id) && v.chart).flatMap((v) => v.chart!.series.map((s) => s.values.join(" ")));
  return numericTokens([visibleTaskText(analysis, activity), ...texts, ...charts].join("\n"));
}

/** Things the student is given to classify or assign: the short list texts the activity works with («Algas · Agua · Garzas»). */
export function taskItems(analysis: MaterialAnalysis, activity: AnalysisActivity): string[] {
  const lists = [activity.context ?? "", ...analysis.texts.filter((t) => activity.resource_ids.includes(t.id) && t.kind !== "reading_text" && t.text.length <= 240).map((t) => t.text)];
  return [...new Set(lists.flatMap((l) => l.split(/\s*[·;,]\s*|\s+y\s+/)).map((s) => s.trim().replace(/[.«»"]/g, "")).filter((s) => s.length >= 3 && s.length <= 40))];
}

/** The categories of the answer structure: the headers of the tables the activity works with. */
export function structuralCategories(analysis: MaterialAnalysis, activity: AnalysisActivity): string[] {
  return analysis.visuals.filter((v) => activity.resource_ids.includes(v.id) && v.table).flatMap((v) => v.table!.headers.map((h) => h.trim()).filter((h) => h.length >= 3));
}

// ---------------------------------------------------------------------------------------------------------------------
// What the activity evaluates, in content stems (lexical, so only ever a WEAK signal)
// ---------------------------------------------------------------------------------------------------------------------

const STOP = new Set(
  "para como pero sobre entre desde hasta cuando donde porque cada esta este estos estas esos esas otro otra otros otras mismo misma ser son tiene tienen hace hacen puede pueden uso usa usar debe deben tambien ademas segun muy mas menos todo todos toda todas algun alguna alguno algunos algunas ninguno una unos unas del las los con sin por que the".split(" "),
);
/** Words that name the task or the kind of learning, not the thing learnt. */
const GENERIC = new Set(
  "significado relacion relaciones concepto conceptos idea ideas forma formas texto textos esquema esquemas actividad actividades alumno alumnado estudiante explicar explica identificar interpretar reconocer comprender entender describir analizar valorar justificar sobre ejemplo ejemplos informacion datos dato".split(" "),
);

/** Content stems of a text: lowercase, no accents, no function or task words, five letters of each word (alimento ≈ alimentaria). */
export function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeText(text).split(/[^a-z0-9]+/)) {
    if (STOP.has(raw) || GENERIC.has(raw) || /^\d+$/.test(raw)) continue;
    // Singular and plural are one stem (vivo ≈ vivos, flecha ≈ flechas).
    const word = raw.length > 4 ? raw.replace(/(es|s)$/, "") : raw;
    if (word.length < 4) continue;
    out.add(word.slice(0, 5));
  }
  return out;
}

const EVALUATED = new Set(["concept", "target_operation", "reasoning_constraint", "formula"]);

/** What the activity evaluates, from structured fields only: its protected concept/operation/constraint and its objectives. */
export function evaluatedStems(analysis: MaterialAnalysis, activity: AnalysisActivity): Set<string> {
  const values = analysis.protected_elements.filter((p) => p.activity_ids.includes(activity.id) && EVALUATED.has(p.type)).map((p) => p.value);
  const objectives = analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id)).map((o) => o.text);
  return contentStems([...values, ...objectives].join(" "));
}

/** The protected values of an activity (any type): where an equivalence the activity evaluates may be written down. */
export const protectedValues = (analysis: MaterialAnalysis, activity: AnalysisActivity) => analysis.protected_elements.filter((p) => p.activity_ids.includes(activity.id)).map((p) => p.value);
