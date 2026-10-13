import { z } from "zod";
import type { AnalysisActivity } from "@/lib/schemas/material-analysis";
import { allBlocks, type MaterialDocument, type ResponseSpec } from "@/lib/schemas/material-document";
import { sameValue, type Fraction, type VisualSpec } from "@/lib/visuals/spec";
import { normalizeText } from "./text";

export const SubstituteChoiceSchema = z.object({
  kind: z.literal("choice"), multiple: z.boolean(),
  options: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().min(1).max(300) }).strict()).min(2).max(8),
}).strict();
export type SingleChoiceResponse = Extract<ResponseSpec, { kind: "choice" }>;

/** Analysis v3 has no options field. Only a complete, consecutive A)…H) list at the end is unambiguous enough to structure. */
export function sourceSingleChoice(activity: AnalysisActivity): { prompt: string; response: SingleChoiceResponse } | null {
  if (activity.response_format !== "select_option" || activity.type !== "multiple_choice") return null;
  const text = [activity.instruction, activity.context].filter(Boolean).join("\n");
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const start = lines.findIndex((s) => /^[Aa][).]\s+/.test(s));
  if (start < 1) return null;
  const options = lines.slice(start);
  if (options.length < 2 || options.length > 8) return null;
  if (options.some((s, i) => !new RegExp(`^[${String.fromCharCode(65 + i)}${String.fromCharCode(97 + i)}][).]\\s+\\S`).test(s) || s.length > 300)) return null;
  return { prompt: lines.slice(0, start).join("\n"), response: { kind: "choice", multiple: false, options: options.map((text, i) => ({ id: `option_${String.fromCharCode(97 + i)}`, text })) } };
}

const fractionOption = (text: string): Fraction | null => {
  const m = /^[a-h][).]\s+(\d{1,2})\s*\/\s*(\d{1,2})$/i.exec(text);
  return m && Number(m[2]) > 0 ? { n: Number(m[1]), d: Number(m[2]) } : null;
};

/** Exact stems bound what can be proved: reading the shaded fraction, not its complement, a sum, or an equivalent fraction. */
const SHADED_QUESTION = /^(?:observa (?:la barra|el circulo)\. )?¿que fraccion (?:de la barra|del circulo) esta (?:coloreada|sombreada)\? (?:elige|selecciona) (?:una|solo una) (?:opcion|respuesta)\.$/;

export function singleChoiceStructureViolations(source: NonNullable<ReturnType<typeof sourceSingleChoice>>, candidate: { prompt: string; steps: string[]; lines: number; choice: unknown }): string[] {
  const violations: string[] = [];
  const parsed = SubstituteChoiceSchema.safeParse(candidate.choice);
  if (!parsed.success || parsed.data.multiple || candidate.lines !== 0) violations.push("response_type_changed");
  if (parsed.success && JSON.stringify(parsed.data.options) !== JSON.stringify(source.response.options)) violations.push("choice_options_changed");
  if (candidate.prompt !== source.prompt || candidate.steps.length !== 0) violations.push("choice_task_changed");
  return violations;
}

/** A previous transformation must not leave a stale key, additional instructions, or a second activity sharing this source. */
export function singleChoiceDocumentCompatible(activity: AnalysisActivity, document: MaterialDocument): boolean {
  const source = sourceSingleChoice(activity);
  if (!source) return false;
  const blocks = allBlocks(document).filter((b) => b.type === "activity" && b.trace.source_refs.includes(activity.id));
  const block = blocks[0];
  if (blocks.length !== 1 || !block || block.type !== "activity" || block.trace.teacher_edited || block.steps?.length || block.requirements?.length) return false;
  if (block.response.kind === "choice" && JSON.stringify(block.response) !== JSON.stringify(source.response)) return false;
  const original = [activity.instruction, activity.context].filter(Boolean).join("\n");
  if (normalizeText(block.prompt) !== normalizeText(original) && normalizeText(block.prompt) !== normalizeText(source.prompt)) return false;
  const keys = document.answer_key.filter((k) => k.block_id === block.id);
  if (activity.expected_answer.basis !== "source") return keys.length === 0;
  // The assembler stores original answers as a value, not option ids. Do not overwrite an independently generated key.
  return keys.length === 1 && keys[0]!.basis === "source" && keys[0]!.value === activity.expected_answer.value && !keys[0]!.correct_option_ids && !keys[0]!.blanks;
}

/** The model never supplies a key. Truth is computed for every source option against the rendered figure and compared to the source key. */
export function singleChoiceViolations(activity: AnalysisActivity, candidate: { prompt: string; steps: string[]; lines: number; choice: unknown; figure: VisualSpec | null }): string[] {
  const source = sourceSingleChoice(activity);
  if (!source || !SHADED_QUESTION.test(normalizeText(source.prompt))) return ["choice_source_unverifiable"];
  const circle = normalizeText(source.prompt).includes("circulo");
  if (circle && normalizeText(source.prompt).includes("barra")) return ["choice_source_unverifiable"];
  const violations = singleChoiceStructureViolations(source, candidate);
  const values = source.response.options.map((o) => fractionOption(o.text));
  if (values.some((v) => !v || v.n <= 0 || v.n >= v.d)) return [...violations, "choice_source_unverifiable"];
  const fractions = values as Fraction[];
  const answer = activity.expected_answer;
  const key = normalizeText(answer.value ?? "");
  const letter = /^(?:opcion )?([a-h])[).]?$/.exec(key);
  const byText = fractions.flatMap((f, i) => key === `${f.n}/${f.d}` ? [i] : []);
  const correct = letter ? letter[1]!.charCodeAt(0) - 97 : byText.length === 1 ? byText[0]! : -1;
  if (answer.basis === "not_inferable" || !fractions[correct]) return [...violations, "choice_key_unverifiable"];
  const spec = candidate.figure;
  if (!spec || (circle ? spec.kind !== "part_whole" || spec.shape !== "circle" : spec.kind !== "fraction_bar")) return [...violations, "choice_figure_unverifiable"];
  if (spec.kind !== "fraction_bar" && spec.kind !== "part_whole") return [...violations, "choice_figure_unverifiable"];
  const matches = fractions.flatMap((f, i) => sameValue(f, { n: spec.shaded.length, d: spec.parts }) ? [i] : []);
  if (matches.length !== 1) violations.push("choice_correct_count");
  else if (matches[0] !== correct) violations.push("choice_answer_changed");
  // Doubling/simplifying the partition can change counting and distractor difficulty even if its numeric value is equal.
  if (spec.parts !== fractions[correct]!.d) violations.push("choice_demand_changed");
  return violations;
}
