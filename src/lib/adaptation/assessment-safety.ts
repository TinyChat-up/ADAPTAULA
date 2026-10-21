import type { AnalysisActivity } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { normalizeText } from "./text";

/**
 * What an activity EVALUATES must not be handed over by a support (docs/ADAPTATION.md § Apoyos que no resuelven). A glossary that
 * defines «determinante, sustantivo, adjetivo, verbo» next to «Clasifica cada palabra como determinante, sustantivo, adjetivo o
 * verbo» turns classifying into recognising a definition. Deterministic and narrow: the categories are read from the instruction's
 * own words («como X, Y o Z»), and only a support that DEFINES two or more of them is flagged.
 */

const LIST = /(?:\bcomo\b|\ben\b|\bentre\b|\bsi es\b|\bsi son\b)\s+((?:[\p{L}]+(?:\s[\p{L}]+)?\s*,\s*)+[\p{L}]+(?:\s[\p{L}]+)?\s+(?:o|y|u)\s+[\p{L}]+(?:\s[\p{L}]+)?)/u;
const ASKS_TO_SORT = /\bclasific|\bidentific|\bindica (?:qu[eé]|la) (?:clase|tipo|categor)|\bdistingue\b|\bseñala (?:qu[eé]|la) (?:clase|tipo)/i;

const stem = (word: string) => normalizeText(word).replace(/(es|s)$/, "");

/** The categories an activity asks the student to tell apart, from its instruction («como X, Y o Z»). Empty: none stated. */
export function evaluatedCategories(activity: Pick<AnalysisActivity, "instruction" | "type">): string[] {
  if (activity.type !== "classification" && !ASKS_TO_SORT.test(activity.instruction)) return [];
  const m = LIST.exec(activity.instruction);
  if (!m) return [];
  const items = m[1]!.split(/\s*,\s*|\s+(?:o|y|u)\s+/).map((x) => x.trim()).filter(Boolean);
  return items.length >= 3 ? items : [];
}

/** Terms a support block defines: a vocabulary list, or «término: definición» lines of a help box or a list. */
function definedTerms(block: Block): string[] {
  if (block.type === "vocabulary") return block.items.map((i) => i.term);
  const lines = block.type === "help_box" ? block.text.split(/\n+/) : block.type === "list" ? block.items : [];
  return lines.flatMap((l) => {
    const m = /^\s*([\p{L}][\p{L} ]{0,30}?)\s*[:=—–-]\s+\S/u.exec(l);
    return m ? [m[1]!] : [];
  });
}

export interface ConceptLeak {
  blockId: string;
  decisionIds: string[];
  activityId: string;
  categories: string[];
}

/**
 * Support blocks (generated, never the original's) that define two or more of the categories an activity evaluates, when they are
 * placed for that activity or for the whole sheet.
 */
export function supportsDefiningEvaluatedConcepts(document: MaterialDocument, activities: readonly Pick<AnalysisActivity, "id" | "instruction" | "type">[]): ConceptLeak[] {
  const leaks: ConceptLeak[] = [];
  const blocks = allBlocks(document).filter((b) => b.trace.origin === "support" || b.trace.origin === "extension");
  for (const activity of activities) {
    const categories = evaluatedCategories(activity);
    if (categories.length === 0) continue;
    const wanted = new Set(categories.map(stem));
    for (const block of blocks) {
      const scoped = block.trace.source_refs.length === 0 || block.trace.source_refs.includes(activity.id);
      if (!scoped) continue;
      const defined = [...new Set(definedTerms(block).map(stem))].filter((t) => wanted.has(t));
      if (defined.length >= 2) leaks.push({ blockId: block.id, decisionIds: block.trace.decision_ids, activityId: activity.id, categories: defined });
    }
  }
  return leaks;
}
