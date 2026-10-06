import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { studentText } from "./document-text";
import { normalizeText, wordCount } from "./text";

/**
 * Deterministic measures of repeated information inside an adapted activity. They detect literal repetition and near-literal
 * repetition (most of a shorter sentence's words contained in another); they never decide meaning, so they report and the
 * normaliser only DROPS exact repeats. Pedagogical fidelity wins over brevity.
 */

const words = (text: string) => normalizeText(text).match(/[a-z0-9]+/g) ?? [];

/** Visible sentences of a text, normalised; fragments under 4 words say too little to compare. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/[\n.!?;:]+/)
    .map((s) => normalizeText(s))
    .filter((s) => words(s).length >= 4);
}

/** Share of the shorter sentence's words found in the other one (1 = fully contained). */
export function overlap(a: string, b: string): number {
  const [wa, wb] = [new Set(words(a)), new Set(words(b))];
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared += 1;
  return shared / small.size;
}

export const NEAR_DUPLICATE_OVERLAP = 0.8;

export interface Repeat {
  a: string;
  b: string;
  exact: boolean;
}

/** Repeats between sentences that live in different blocks (or twice in one list). Resource blocks (tables, charts) are not compared. */
export function repeatsAmong(blocks: readonly Block[]): Repeat[] {
  const units = blocks.flatMap((block, bi) => sentencesOf(studentText(block)).map((s, si) => ({ s, key: `${bi}:${si}` })));
  const found: Repeat[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const [x, y] = [units[i]!, units[j]!];
      if (x.key.split(":")[0] === y.key.split(":")[0] && x.s !== y.s) continue; // two different sentences of the same block are not a repeat
      if (x.s === y.s) found.push({ a: x.s, b: y.s, exact: true });
      else if (overlap(x.s, y.s) >= NEAR_DUPLICATE_OVERLAP) found.push({ a: x.s, b: y.s, exact: false });
    }
  }
  return found;
}

export const activityBlocksOf = (document: Pick<MaterialDocument, "pages">, ref: string): Block[] =>
  allBlocks(document).filter((b) => b.trace.source_refs.includes(ref) && b.type !== "chart" && b.type !== "table" && b.type !== "reading_text" && b.type !== "image");

/** Bands used in the experiment reports only (not a product rule). */
export function expansionBand(multiplier: number): "baja" | "moderada" | "alta" | "muy alta" {
  return multiplier <= 1.5 ? "baja" : multiplier <= 2 ? "moderada" : multiplier <= 3 ? "alta" : "muy alta";
}

export interface ActivityExpansion {
  id: string;
  transformed: boolean;
  originalWords: number;
  finalWords: number;
  multiplier: number;
  band: ReturnType<typeof expansionBand>;
  exactRepeats: number;
  nearRepeats: number;
}

/** Original instruction words → visible words of the activity and every block that traces to it (resources excluded). */
export function activityExpansion(analysis: MaterialAnalysis, document: Pick<MaterialDocument, "pages">): ActivityExpansion[] {
  return analysis.activities.map((a) => {
    const blocks = activityBlocksOf(document, a.id);
    const originalWords = wordCount(`${a.instruction} ${a.context ?? ""}`);
    const finalWords = wordCount(blocks.map(studentText).join(" "));
    const repeats = repeatsAmong(blocks);
    const multiplier = originalWords === 0 ? 1 : Math.round((finalWords / originalWords) * 100) / 100;
    return {
      id: a.id,
      transformed: blocks.some((b) => b.trace.origin !== "original"),
      originalWords,
      finalWords,
      multiplier,
      band: expansionBand(multiplier),
      exactRepeats: repeats.filter((r) => r.exact).length,
      nearRepeats: repeats.filter((r) => !r.exact).length,
    };
  });
}
