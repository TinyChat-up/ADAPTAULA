import type { AnalysisActivity } from "@/lib/schemas/material-analysis";
import type { DirectorActivity, DirectorObligation } from "@/lib/schemas/pedagogical-direction";

/**
 * Fase 4.1 · supports of the director's pilot built only from what the original says (no model, no new information):
 *   · the explicit requirements of HOW to answer (length, terms, units, method, form, reasoning to give) are emphasised in the prompt;
 *   · the same requirements become a short «Antes de entregar» checklist, only when it adds something over the prompt;
 *   · the answer space follows the production the activity demands.
 * Data are never emphasised or listed, nor anything the student has to select, infer, classify or interpret: pointing at it would
 * tell the student which information matters. A requirement that contains the expected answer is left alone.
 */

/** Conditions about the form of the answer (never `required_data`: data stay as the original prints them). */
const FORM_CONDITIONS = new Set(["units", "method", "reasoning", "response_length", "response_format", "required_terms", "representation"]);
/** Evaluated requirements that say what the answer must contain as reasoning, not what it must conclude. */
const FORM_EVALUATIONS = new Set(["reasoning", "argumentation", "procedure", "response_format"]);
/** Where the student's own decision lies: a requirement touching these words is not emphasised. */
const STUDENT_FINDS = new Set(["select_data", "select_evidence", "infer_conclusion", "interpret_relation", "classify_items", "choose_criterion"]);
const MAX_HIGHLIGHTS = 3;
const MAX_QUOTE = 80;

const plain = (text: string) => text.replace(/\*\*/gu, "");
const words = (text: string) => text.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The literal, verified requirements of an activity, in prompt order, that may be pointed at without giving anything away. */
export function explicitRequirements(prompt: string, row: Pick<DirectorActivity, "obligations">, activity: Pick<AnalysisActivity, "id" | "expected_answer">): string[] {
  const text = plain(prompt);
  const quoteOf = (o: DirectorObligation) => (o.evidence?.source_ref === activity.id ? o.evidence.quote : null);
  const span = (quote: string) => {
    const at = text.indexOf(quote);
    return at < 0 ? null : ([at, at + quote.length] as const);
  };
  const guarded = row.obligations
    .filter((o) => o.kind === "information" || (o.kind === "student_decision" && STUDENT_FINDS.has(o.value ?? "")))
    .flatMap((o) => { const q = quoteOf(o); const s = q ? span(q) : null; return s ? [s] : []; });
  const answer = activity.expected_answer.value ? words(activity.expected_answer.value) : "";
  const candidates = row.obligations
    .filter((o) => (o.kind === "condition" && FORM_CONDITIONS.has(o.value ?? "")) || (o.kind === "evaluation" && FORM_EVALUATIONS.has(o.value ?? "")))
    .flatMap((o) => { const q = quoteOf(o)?.trim(); return q ? [q] : []; })
    .filter((q) => q.length <= MAX_QUOTE && q.length <= text.length * 0.6 && !/[*_]/u.test(q))
    .filter((q) => !answer || !words(q).includes(answer));
  const chosen: Array<readonly [number, number]> = [];
  const out: string[] = [];
  // Shorter requirements first: «con dos argumentos» says more than the whole sentence around it.
  for (const quote of [...new Set(candidates)].sort((a, b) => a.length - b.length)) {
    const s = span(quote);
    const overlaps = (r: readonly [number, number]) => s && s[0] < r[1] && r[0] < s[1];
    if (!s || chosen.some(overlaps) || guarded.some(overlaps) || out.length >= MAX_HIGHLIGHTS) continue;
    chosen.push(s);
    out.push(quote);
  }
  return out.sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

/** The prompt with each requirement in bold. Its text is otherwise unchanged (the checks compare it without the marks). */
export function emphasise(prompt: string, requirements: readonly string[]): string {
  let out = plain(prompt);
  for (const quote of requirements) out = out.replace(quote, `**${quote}**`);
  return out;
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);

/**
 * «Antes de entregar»: the requirements to check at the end, literally. It only repeats the prompt when that helps: two or more
 * requirements, or one in an activity whose answer is an extended text (easy to forget halfway). Otherwise nothing is added.
 */
export function finalChecklist(requirements: readonly string[], extended: boolean): string[] | null {
  if (requirements.length === 0 || (requirements.length === 1 && !extended)) return null;
  return requirements.map(capital);
}

/** Whether the activity asks for an extended written production (an argued or composed text). */
export function extendedWriting(row: Pick<DirectorActivity, "obligations">): boolean {
  return row.obligations.some((o) => (o.kind === "evaluation" && (o.value === "written_production" || o.value === "argumentation")) ||
    (o.kind === "student_decision" && (o.value === "formulate_argument" || o.value === "compose_text")));
}

/** Lines for a written answer with unlabelled extra space: room for an extended text, two more lines otherwise. */
export const EXTENDED_MIN_LINES = 8;
export function workspaceLines(current: number, extended: boolean): number {
  return Math.min(40, Math.max(current + 2, extended ? EXTENDED_MIN_LINES : 0));
}
