import type { AnalysisActivity } from "@/lib/schemas/material-analysis";

/**
 * The structure of the original that must survive an adaptation, read from the analysis's own words (never invented): lines that
 * are units of their own (numbered sentences, list items, dialogue, labelled answer fields), the paragraphs of a reading, the
 * labelled fields where the student answers («Sujeto:», «Operaciones y unidades:») and the items of an ordering task. Pure and
 * deterministic: the literal copy and every adaptation read the same structure, so the audit compares like with like.
 *
 * Evidence rule: a single line break is structural only when the text itself marks it (a numbered or bulleted line, a dialogue
 * dash, a label, or a run of lines that each close a sentence). A break in the middle of a sentence is a hard wrap of the PDF and is
 * joined. Without line breaks there is no evidence: the text stays as it is.
 */

const TERMINAL = /[.!?:;»"”)\]…]$/;
/** A line that is a unit by its first characters: «1.», «2)», «a)», «—», «-», «•», «□», «___», «( )». */
const MARKER = /^\s*(?:\d{1,2}\s*[.)º]|[a-hA-H]\s*\)|[—–\-•·▸□☐■]|_{2,}|\(\s*\))\s*/;
const DIALOGUE = /^\s*[—–]/;

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

/**
 * The lines of a paragraph that are units of their own, joined where the break was only a wrap. A paragraph whose lines mostly
 * close a sentence (a list of sentences, an exercise of statements) keeps every break.
 */
export function structuralLines(paragraph: string): string[] {
  const all = lines(paragraph);
  if (all.length <= 1) return all;
  const closing = all.filter((l) => TERMINAL.test(l)).length;
  const sentenceList = all.length >= 2 && closing >= Math.ceil(all.length * 0.6);
  const out: string[] = [];
  for (const line of all) {
    const previous = out.at(-1);
    const breaks = previous === undefined || MARKER.test(line) || isFieldLine(line) || (sentenceList && TERMINAL.test(previous) && /^[\p{Lu}¿¡«"0-9]/u.test(line));
    if (breaks) out.push(line);
    else out[out.length - 1] = `${previous} ${line}`;
  }
  return out;
}

/**
 * The paragraphs of a reading text: blank lines first (the usual evidence); a text the analysis wrote without blank lines keeps a
 * paragraph per line that closes a sentence, and a dialogue line always starts its own paragraph. Wrapped lines are joined.
 */
export function readingParagraphs(text: string): string[] {
  const blocks = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks.map((p) => lines(p).join(" "));
  const all = lines(text);
  if (all.length <= 1) return all;
  const out: string[] = [];
  for (const line of all) {
    const previous = out.at(-1);
    if (previous === undefined || DIALOGUE.test(line) || DIALOGUE.test(previous) || (TERMINAL.test(previous) && /^[\p{Lu}¿¡«"—–]/u.test(line))) out.push(line);
    else out[out.length - 1] = `${previous} ${line}`;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Answer fields and ordering items
// ---------------------------------------------------------------------------------------------------------------------

/** «Etiqueta:» optionally followed by a blank (underscores, dots), several per line («Escuela: ____ Hospital: ____»). */
const FIELD = /([\p{L}\p{N}][\p{L}\p{N} ]{0,38}?)\s*:\s*(?:_{2,}|\.{3,}|…+)?/gu;
const MAX_FIELD_WORDS = 4;

/** The labels of a line made only of answer fields, or null when the line says anything else. */
function fieldLabels(line: string): string[] | null {
  const labels: string[] = [];
  let rest = line;
  for (const m of line.matchAll(FIELD)) {
    const label = m[1]!.trim();
    if (label.split(/\s+/).length > MAX_FIELD_WORDS) return null;
    labels.push(label);
    rest = rest.replace(m[0], " ");
  }
  return labels.length > 0 && rest.trim() === "" ? labels : null;
}
const isFieldLine = (line: string) => fieldLabels(line) !== null;

export type FieldSpace = "lines" | "box" | "grid";
export interface AnswerField {
  label: string;
  space: FieldSpace;
  lines: number;
  /** An empty slot for the unit next to the answer (answer_space@v1). */
  unit?: boolean;
}

/** Where calculations go (a box to work in), where an explanation goes (several lines), and a short answer (one line). */
function fieldOf(label: string, totalLines: number | null): AnswerField {
  if (/operaci|c[aá]lcul|cuentas|procedimiento/i.test(label)) return { label, space: "box", lines: 5 };
  if (/explica|justific|raz[oó]n|por qu[eé]|c[oó]mo lo sabes/i.test(label)) return { label, space: "lines", lines: Math.max(3, Math.min(6, totalLines ?? 3)) };
  if (/^respuesta$/i.test(label)) return { label, space: "lines", lines: 2 };
  return { label, space: "lines", lines: 1 };
}

const SEQUENCING = /\bordena\b|\bordenar\b|\bnumera\b[^.]*\borden\b|del\s+1\s+al\s+\d/i;
const ITEM_PREFIX = /^\s*(?:_{2,}|[□☐■]|\(\s*\)|\d{1,2}\s*[.)]\s*_{2,})\s*/;

export interface ActivityStructure {
  /** The instruction without the answer fields printed right after it (when the activity has no context). */
  instruction: string;
  /** The context that stays in the prompt: everything but the answer fields and the ordering items, which the answer area draws. */
  context: string | null;
  fields: AnswerField[] | null;
  sequence: string[] | null;
}

/**
 * The answer structure the original prints, from the analysis's words: trailing lines made only of labelled fields become a
 * labelled answer area («Sujeto:» / «Predicado:», «Operaciones y unidades:» / «Respuesta:»); the items of an ordering task
 * become one box per item, in their PRINTED order (the order is the task: never sorted). Nothing found → the context unchanged.
 */
export function activityStructure(activity: Pick<AnalysisActivity, "instruction" | "context" | "type" | "answer_area">): ActivityStructure {
  const none: ActivityStructure = { instruction: activity.instruction, context: activity.context, fields: null, sequence: null };
  if (!activity.context) {
    const tail = lines(activity.instruction);
    // «Escribe qué parte indica cada letra.\nA:\nB:» — the fields printed right after the instruction (never the whole instruction).
    const fields = trailingFields(tail);
    if (!fields || fields.from === 0) return none;
    return { instruction: tail.slice(0, fields.from).join("\n"), context: null, fields: fields.fields.map((l) => fieldOf(l, activity.answer_area.lines)), sequence: null };
  }
  const body = lines(activity.context);
  const trailing = trailingFields(body);
  const rest = trailing ? body.slice(0, trailing.from) : body;
  const fields = trailing ? trailing.fields.map((l) => fieldOf(l, activity.answer_area.lines)) : null;
  const sequence = activity.type === "sequencing" || SEQUENCING.test(activity.instruction) ? sequenceItems(rest) : null;
  if (!fields && !sequence) return none;
  const kept = sequence ? [] : rest;
  return { instruction: activity.instruction, context: kept.length > 0 ? kept.join("\n") : null, fields, sequence };
}

function trailingFields(body: readonly string[]): { from: number; fields: string[] } | null {
  let from = body.length;
  while (from > 0 && (isFieldLine(body[from - 1]!) || inlineFieldLabels(body[from - 1]!) !== null)) from -= 1;
  if (from === body.length) return null;
  const fields = body.slice(from).flatMap((l) => fieldLabels(l) ?? inlineFieldLabels(l) ?? []);
  return fields.length > 0 && fields.length <= 12 ? { from, fields } : null;
}

/** A single label of a figure («A», «D») or a numbered element («Flecha 1», «Paso 3», «Proceso 2»). */
const MARK_LABEL = /^(?:[A-H]|[\p{L}]{3,12}\s+\d{1,2})$/u;

/**
 * Fields an analysis writes inline, separated by commas or semicolons, with or without colons: «A:, B:, C:, D:», «Flecha 1, Flecha 2,
 * Flecha 3, Flecha 4». Only when the WHOLE line is such labels, at least two, and the numbered ones share their word and run from
 * their first number upwards: a sentence that happens to contain commas is never read as fields.
 */
export function inlineFieldLabels(line: string): string[] | null {
  const parts = line.split(/\s*[,;]\s*/).map((p) => p.replace(/[:_.…\s]+$/u, "").trim()).filter((p) => p.length > 0);
  if (parts.length < 2 || parts.length > 12 || !parts.every((p) => MARK_LABEL.test(p))) return null;
  if (parts.every((p) => /^[A-H]$/.test(p))) return new Set(parts).size === parts.length ? parts : null;
  const words = new Set(parts.map((p) => p.replace(/\s*\d+$/, "").toLowerCase()));
  const numbers = parts.map((p) => Number(/(\d+)$/.exec(p)?.[1] ?? Number.NaN));
  if (words.size !== 1 || numbers.some((n, i) => n !== numbers[0]! + i)) return null;
  return parts;
}

/** The items to order: one per line, or the « / » separated sentences of a single line. Each item keeps its words. */
function sequenceItems(body: readonly string[]): string[] | null {
  let items = body.map((l) => l.replace(ITEM_PREFIX, "").trim()).filter(Boolean);
  if (items.length === 1) {
    const parts = items[0]!.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => TERMINAL.test(p))) items = parts;
  }
  if (items.length < 2 || items.length > 12 || items.some((i) => i.length > 300)) return null;
  return items;
}
