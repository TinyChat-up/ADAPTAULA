import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { studentText } from "./document-text";
import { containsTerm } from "./review-checks";
import { answerParts, canonicalSet, contentStems, evaluatedStems, numericTokens, protectedValues, relations, structuralCategories, taskData, taskItems, visibleTaskText } from "./support-evidence";
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

// ---------------------------------------------------------------------------------------------------------------------
// Etapa 2.1 · one place for what a support must never hand over
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A support makes the task reachable; it never performs what the activity evaluates. This module is the single home of that rule:
 * the protection that has always BLOCKED (`defines_listed_categories`, above) and the findings that only WARN until their precision
 * is measured. The two kinds are told apart by evidence, never by a count of coincidences (two matching numbers, words or categories
 * are not evidence by themselves):
 *   · verifiable   the support carries an answer part, or an example whose result IS an item's answer;
 *   · structural   it follows from the structure of the task (the same equivalence demonstrated, the task's own numbers, an item
 *                  assigned to a category of the answer table);
 *   · lexical      a term of the support is the activity's evaluated concept (only for activities that ask to explain or interpret).
 * A definition or a criterion card consulted to APPLY knowledge (classify primes, sort living from non-living) is legitimate and is
 * recorded as cleared, not as a finding: the student still performs the operation. Only the blocking one may stop a sheet.
 */

export type SupportFindingCode =
  | "defines_listed_categories"
  | "direct_answer_part"
  | "example_solves_item"
  | "example_near_item"
  | "example_reuses_data"
  | "assigns_item_to_category"
  | "defines_evaluated_concept";
export type FindingEvidence = "verifiable" | "structural" | "lexical";
export type FindingAction = "block" | "warn";

export const FINDING_POLICY: Record<SupportFindingCode, { evidence: FindingEvidence; action: FindingAction }> = {
  defines_listed_categories: { evidence: "verifiable", action: "block" },
  direct_answer_part: { evidence: "verifiable", action: "warn" },
  example_solves_item: { evidence: "verifiable", action: "warn" },
  example_near_item: { evidence: "structural", action: "warn" },
  example_reuses_data: { evidence: "structural", action: "warn" },
  assigns_item_to_category: { evidence: "structural", action: "warn" },
  defines_evaluated_concept: { evidence: "lexical", action: "warn" },
};

export type SupportCleared = "criterion_card" | "lexical_coincidence";

export interface SupportFinding {
  code: SupportFindingCode;
  evidence: FindingEvidence;
  action: FindingAction;
  block_id: string;
  activity_id: string;
  decision_ids: string[];
  /**
   * Etapa 2.2: the answer part found in the support is RELIABLE (stated by the sheet, or deduced AND present in the material itself).
   * Only a literal finding may start a repair; a part that is only the analyzer's inference stays a warning (uncertainty keeps the support).
   */
  literal?: true;
}

export interface SupportAssessment {
  findings: SupportFinding[];
  cleared: Array<{ block_id: string; activity_id: string; class: SupportCleared }>;
  supports_checked: number;
}

/** Activities whose answer is an explanation or an interpretation (structured fields, not the verb of the instruction). */
const EXPLAINING = new Set<AnalysisActivity["type"]>(["short_answer", "open_question", "reading_comprehension", "graph_interpretation", "experiment"]);
const SUPPORT_ORIGINS = new Set<Block["trace"]["origin"]>(["support", "extension"]);

const linesOf = (block: Block): string[] => {
  switch (block.type) {
    case "vocabulary": return block.items.map((i) => `${i.term}: ${i.definition}`);
    case "help_box": return block.text.split(/(?<=[.!?])\s+|\n+/);
    case "list": case "checklist": return block.items;
    case "worked_example": return [block.problem, ...block.steps, block.result];
    default: return [studentText(block)];
  }
};

/** The part of a worked example that states its outcome: its result and its steps, not the problem it poses. */
const outcomeOf = (block: Extract<Block, { type: "worked_example" }>) => [...block.steps, block.result].join("\n");

/**
 * The answer parts that can be trusted as the answer: all of them when the sheet states the answer; when the analyzer only deduced
 * it, only a part that the material itself also contains (a linked text, a protected element, an objective). A deduced number or a
 * guessed word is not evidence.
 */
export function reliableAnswerParts(analysis: MaterialAnalysis, activity: AnalysisActivity): string[] {
  const parts = answerParts(activity);
  if (activity.expected_answer.basis === "source") return parts;
  const ground = [
    ...analysis.texts.filter((t) => activity.resource_ids.includes(t.id)).map((t) => t.text),
    ...protectedValues(analysis, activity),
    ...analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id)).map((o) => o.text),
  ].join("\n");
  return parts.filter((part) => containsTerm(ground, part));
}

function assessBlock(block: Block, activity: AnalysisActivity, analysis: MaterialAnalysis): { codes: SupportFindingCode[]; cleared?: SupportCleared; literal?: true } {
  const codes: SupportFindingCode[] = [];
  const text = studentText(block);
  const visible = visibleTaskText(analysis, activity);

  // Verifiable: an answer part (whole, never a digit) that the sheet does not already show.
  const given = answerParts(activity).filter((part) => !containsTerm(visible, part) && containsTerm(text, part));
  let literal: true | undefined;
  if (given.length > 0) {
    codes.push(block.type === "worked_example" ? "example_solves_item" : "direct_answer_part");
    const reliable = new Set(reliableAnswerParts(analysis, activity));
    if (given.some((part) => reliable.has(part))) literal = true;
  }

  if (block.type === "worked_example") {
    const mine = canonicalSet(numericTokens(block.problem));
    const task = canonicalSet(taskData(analysis, activity));
    const shared = [...mine].filter((n) => task.has(n));
    if (shared.length >= 2 && shared.length * 2 >= mine.size) codes.push("example_reuses_data");
    // Structural: the same relation (2/4 = 1/2 beside 4/8 = 1/2) demonstrated, written with other numbers.
    const answers = [...answerParts(activity), ...protectedValues(analysis, activity)].flatMap((a) => relations(a));
    const keys = new Set(answers.map((r) => r.key));
    const literals = new Set(answers.map((r) => r.literal));
    if (relations([block.problem, outcomeOf(block)].join("\n")).some((r) => keys.has(r.key) && !literals.has(r.literal))) codes.push("example_near_item");
    if (shared.length === 1 && codes.length === 0) return { codes, cleared: "lexical_coincidence" };
  }

  // Structural: an item of the task assigned to a category of its answer table, inside one line of the support.
  const items = taskItems(analysis, activity);
  const categories = structuralCategories(analysis, activity).map((c) => ({ c, stems: contentStems(c) })).filter((c) => c.stems.size > 0);
  if (items.length > 0 && categories.length > 0 && block.type !== "worked_example") {
    const assigns = linesOf(block).some((line) => {
      const stems = contentStems(line);
      return items.some((i) => containsTerm(line, i)) && categories.some(({ stems: cs }) => [...cs].every((s) => stems.has(s)));
    });
    if (assigns) codes.push("assigns_item_to_category");
  }

  // Lexical: what the support defines is the concept the activity evaluates.
  const definitional = block.type === "vocabulary" || (block.type === "help_box" && (block.variant === "key_idea" || block.variant === "reminder"));
  if (definitional && codes.length === 0) {
    const evaluated = evaluatedStems(analysis, activity);
    const covers =
      block.type === "vocabulary"
        ? block.items.some((i) => {
            const stems = contentStems(i.term);
            return stems.size > 0 && [...stems].every((s) => evaluated.has(s));
          })
        : [...contentStems(studentText(block))].filter((s) => evaluated.has(s)).length >= 2;
    if (covers) {
      if (EXPLAINING.has(activity.type)) codes.push("defines_evaluated_concept");
      else return { codes, cleared: "criterion_card" };
    } else if (block.type === "help_box" && block.variant === "key_idea" && [...contentStems(studentText(block))].some((s) => evaluated.has(s))) {
      return { codes, cleared: "lexical_coincidence" };
    }
  }
  return { codes, ...(literal ? { literal } : {}) };
}

export function assessSupports(analysis: MaterialAnalysis, document: MaterialDocument): SupportAssessment {
  const findings: SupportFinding[] = [];
  const cleared: SupportAssessment["cleared"] = [];
  const blocks = allBlocks(document);
  const add = (code: SupportFindingCode, block: Block, activityId: string) =>
    findings.push({ code, ...FINDING_POLICY[code], block_id: block.id, activity_id: activityId, decision_ids: block.trace.decision_ids });

  // The protection that blocks, exactly as it has always been (the generation audit reads this same list).
  for (const leak of supportsDefiningEvaluatedConcepts(document, analysis.activities)) add("defines_listed_categories", blocks.find((b) => b.id === leak.blockId)!, leak.activityId);

  let checked = 0;
  for (const block of blocks) {
    if (!SUPPORT_ORIGINS.has(block.trace.origin) || block.type === "activity") continue;
    const refs = block.trace.source_refs.filter((r) => r.startsWith("act_"));
    if (refs.length !== 1) continue;
    const activity = analysis.activities.find((a) => a.id === refs[0]);
    if (!activity) continue;
    checked += 1;
    const result = assessBlock(block, activity, analysis);
    for (const code of result.codes) {
      add(code, block, activity.id);
      if (result.literal && (code === "direct_answer_part" || code === "example_solves_item")) findings[findings.length - 1]!.literal = true;
    }
    // A block the blocking protection already stopped is not also «cleared».
    if (result.cleared && !findings.some((f) => f.block_id === block.id)) cleared.push({ block_id: block.id, activity_id: activity.id, class: result.cleared });
  }
  return { findings, cleared, supports_checked: checked };
}
