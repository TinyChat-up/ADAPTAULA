import { VISUAL_SPEC_VERSION, VisualSpecSchema, type ComparisonSpec } from "./spec";

/**
 * «Compara y escribe >, < o =: 2/3 ☐ 3/5   4/8 ☐ 1/2» → the comparison items of the activity, read from its printed words only.
 * Deterministic and conservative: it answers only when the text asks for the three relations, every fraction of the text belongs
 * to exactly one pair, and no pair already shows a relation (that would be an example or the answer). Otherwise null, and the
 * activity keeps the answer area the analysis gave it.
 */

const FRACTION = String.raw`(\d{1,3})\s*\/\s*(\d{1,3})`;
// Where the student writes the sign in the original: a box glyph, a run of underscores or dots, empty brackets… or nothing.
const GAP = String.raw`\s*(?:[□☐▢◻⬜]|_{2,}|\.{3,}|…|\[\s*\]|\(\s*\)|\?)?\s*`;
const PAIR = new RegExp(`${FRACTION}${GAP}${FRACTION}`, "g");
const ANY_FRACTION = new RegExp(FRACTION, "g");
const RELATION_SHOWN = new RegExp(`${FRACTION}\\s*(?:<|>|=|≤|≥)\\s*${FRACTION}`);

const asksForRelations = (text: string) => (/[<]/.test(text) && /[>]/.test(text) && /=/.test(text)) || (/\bmayor\b/i.test(text) && /\bmenor\b/i.test(text) && /\bigual\b/i.test(text));

export interface ParsedComparison {
  spec: ComparisonSpec;
  /** The part of the text that held the pairs and nothing else (it is drawn by the comparison, never printed twice). */
  pairsOnly: boolean;
}

function pairsOf(text: string): Array<{ left: { n: number; d: number }; right: { n: number; d: number } }> | null {
  if (RELATION_SHOWN.test(text)) return null;
  const pairs = [...text.matchAll(PAIR)].map((m) => ({ left: { n: Number(m[1]), d: Number(m[2]) }, right: { n: Number(m[3]), d: Number(m[4]) } }));
  const fractions = [...text.matchAll(ANY_FRACTION)].length;
  return pairs.length > 0 && pairs.length * 2 === fractions ? pairs : null;
}

/** `instruction` asks; `context` (optional) may hold the pairs on their own line, as printed. */
export function comparisonFromText(instruction: string, context: string | null): ParsedComparison | null {
  const all = context ? `${instruction}\n${context}` : instruction;
  if (!asksForRelations(all)) return null;
  const fromContext = context ? pairsOf(context) : null;
  const pairsInInstruction = [...instruction.matchAll(ANY_FRACTION)].length;
  const pairs = fromContext && pairsInInstruction === 0 ? fromContext : pairsOf(all);
  if (!pairs || pairs.length > 8) return null;
  const spec = VisualSpecSchema.safeParse({ spec_version: VISUAL_SPEC_VERSION, kind: "comparison", items: pairs });
  if (!spec.success || spec.data.kind !== "comparison") return null;
  const residue = fromContext && context ? context.replace(PAIR, " ").replace(/[\s,;.·|]+/g, "").replace(/^y$/i, "") : "x";
  return { spec: spec.data, pairsOnly: fromContext !== null && pairsInInstruction === 0 && residue.length === 0 };
}
