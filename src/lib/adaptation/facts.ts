import type { AnalysisActivity, AnalysisProtected, AnalysisText, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { normalizeText, numbersIn } from "./text";

/**
 * Deterministic facts of a MaterialAnalysis v3 that constrain an adaptation. Every rule here reads ids and typed fields;
 * the few text heuristics are conservative (when in doubt, the fact says "protect"). The tolerated debt of the analysis
 * (inferred series names, non-literal section titles, redundant protected elements) is never used as a fact.
 */

export const CONSTRAINT_TYPES = ["response_constraint", "reasoning_constraint", "format_requirement", "units_or_magnitudes", "evaluation_criterion"] as const;
const CLOSED_ACTIVITY_TYPES = ["multiple_choice", "true_false", "fill_blank", "matching", "classification", "sequencing"] as const;

/** Production verbs. "Identificar los argumentos de un texto" is comprehension, not writing. */
const WRITING_OBJECTIVE = /\b(redact|escrib|compon|resum|produc\w* (un |una )?(texto|redaccion)|elabor\w* (un |una )?(texto|redaccion))/;
const TEXT_FORM_QUESTION = /\b(parrafo|linea \d|conector|registro|tesis|argument|metafora|figura|estilo|rasgos?|autor|fragmento|verso|estrofa|subraya|cita|narrador|tono)/;
const LANGUAGE_SUBJECT = /(lengua|literatura|ingles|frances|aleman|latin|griego|filosofia|valenci|catal|euskera|galleg)/;

/** An extension requirement needs a quantity: "4-5 líneas", "150-180 palabras", "dos párrafos" (not "con tus palabras"). */
export function hasExtensionRequirement(text: string): boolean {
  return /(\d+(?:-\d+)?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(palabras?|lineas?|renglones|parrafos?)\b/.test(normalizeText(text));
}

/** Literal references written between «» (a connector, a quoted question): they must survive word for word. */
export function quotedReferences(text: string): string[] {
  return [...text.matchAll(/«([^»]{1,200})»/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

export function activityById(analysis: MaterialAnalysis, id: string): AnalysisActivity | undefined {
  return analysis.activities.find((a) => a.id === id);
}

export function textById(analysis: MaterialAnalysis, id: string): AnalysisText | undefined {
  return analysis.texts.find((t) => t.id === id);
}

/** Protected elements that concern a target: linked to it directly or through one of its resources. */
export function protectedFor(analysis: MaterialAnalysis, target: string): AnalysisProtected[] {
  return analysis.protected_elements.filter((p) => p.activity_ids.includes(target) || p.resource_ids.includes(target));
}

export function essentialProtectedFor(analysis: MaterialAnalysis, target: string): AnalysisProtected[] {
  return protectedFor(analysis, target).filter((p) => p.importance === "essential");
}

export function constraintsOf(analysis: MaterialAnalysis, activityId: string): AnalysisProtected[] {
  return analysis.protected_elements.filter((p) => p.activity_ids.includes(activityId) && (CONSTRAINT_TYPES as readonly string[]).includes(p.type));
}

export function isMathMaterial(analysis: MaterialAnalysis): boolean {
  const subject = normalizeText(analysis.identification.subject.value ?? "");
  return /matem/.test(subject) || analysis.activities.some((a) => a.type === "calculation" || a.response_format === "calculate" || a.response_format === "write_number");
}

/**
 * Whether written production is what an activity evaluates: a writing task, an extension requirement or a writing
 * objective. Then writing cannot be reduced or replaced by selection without changing what is assessed.
 */
export function evaluatesWriting(analysis: MaterialAnalysis, activity: AnalysisActivity): boolean {
  if (activity.type === "writing") return true;
  if (activity.response_format !== "write_text") return false;
  const constraintText = constraintsOf(analysis, activity.id).map((p) => p.value).join(" ");
  if (hasExtensionRequirement(constraintText) && /\b(redact|escrib|texto|conclusion|resum|argument)/.test(normalizeText(activity.instruction))) return true;
  const objectives = analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id));
  return objectives.some((o) => WRITING_OBJECTIVE.test(normalizeText(o.text)));
}

/** An open task (production): turning it into a closed format changes production into recognition. */
export function isOpenActivity(activity: AnalysisActivity): boolean {
  if ((CLOSED_ACTIVITY_TYPES as readonly string[]).includes(activity.type)) return false;
  return activity.response_format === "write_text" || activity.type === "open_question" || activity.type === "writing" || activity.type === "problem_solving";
}

/** The activity evaluates an operation (calculating, solving): recognising a result is not the same task. */
export function evaluatesOperation(analysis: MaterialAnalysis, activity: AnalysisActivity): boolean {
  if (activity.type === "calculation" || activity.response_format === "calculate") return true;
  return protectedFor(analysis, activity.id).some((p) => p.type === "target_operation" && p.importance === "essential");
}

/**
 * The activity asks the student for their OWN operation, reasoning or production (not just a recognition): then a support
 * that explains how to do it, or starts the answer, replaces part of what is assessed.
 */
export function evaluatesOwnWork(analysis: MaterialAnalysis, activity: AnalysisActivity): boolean {
  if (evaluatesOperation(analysis, activity) || evaluatesWriting(analysis, activity) || isOpenActivity(activity)) return true;
  return protectedFor(analysis, activity.id).some((p) => p.importance === "essential" && (p.type === "target_operation" || p.type === "reasoning_constraint"));
}

/**
 * A reading text that is itself the object of study (its words, structure or register are asked about, or the subject is a
 * language/literature): it may be segmented or glossed, never rewritten or summarised.
 */
export function isLiteralSourceText(analysis: MaterialAnalysis, text: AnalysisText): boolean {
  if (text.kind !== "reading_text" || text.activity_ids.length === 0) return false;
  if (LANGUAGE_SUBJECT.test(normalizeText(analysis.identification.subject.value ?? ""))) return true;
  return text.activity_ids.some((id) => {
    const activity = activityById(analysis, id);
    return activity !== undefined && TEXT_FORM_QUESTION.test(normalizeText(activity.instruction));
  });
}

/** Every number printed in the material (texts, visuals, statements). Labels are not content and are left out. */
export function materialNumbers(analysis: MaterialAnalysis): Set<string> {
  const parts: string[] = [];
  for (const t of analysis.texts) parts.push(t.text);
  for (const v of analysis.visuals) {
    parts.push(v.title ?? "", v.text ?? "");
    if (v.table) parts.push(...v.table.headers, ...v.table.rows.flat());
    if (v.chart) parts.push(...v.chart.categories, ...v.chart.series.flatMap((s) => s.values.map(String)));
  }
  for (const a of analysis.activities) parts.push(a.instruction, a.context ?? "");
  return new Set(numbersIn(parts.join(" \n ")));
}

/** Answers that exist only to check solvability (inferred) and answers stated by the sheet (source). */
export function answersOf(analysis: MaterialAnalysis): Array<{ activity: string; basis: "source" | "inferred"; value: string }> {
  return analysis.activities.flatMap((a) =>
    a.expected_answer.value && a.expected_answer.basis !== "not_inferable" ? [{ activity: a.id, basis: a.expected_answer.basis, value: a.expected_answer.value }] : [],
  );
}

export function ambiguousTargets(analysis: MaterialAnalysis): string[] {
  return [...new Set(analysis.uncertainties.filter((u) => u.kind !== "embedded_instructions").flatMap((u) => u.target_ids))].sort();
}
