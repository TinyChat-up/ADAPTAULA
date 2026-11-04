import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { HintCoverage, HintQuestion } from "@/lib/schemas/decision-ledger";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { requestedResults } from "../answer-space";
import { activitiesOf } from "../decision-ledger";
import { studentText } from "../document-text";
import { answersOf } from "../facts";
import { containsTerm, instructionPieces } from "../review-checks";
import { approximateLeak, numbersIn, wordCount } from "../text";
import { HINT_COVERAGE, addsResource, type HintFinding } from "./hint-test";

/**
 * Deterministic checks taken from the V2.2 method (ADR-044, docs/AGENTE_V22.md). Each one declares what it covers: a passed
 * `partial` check is not evidence that there is no hint, and P1, P5 and P6 are never checked here. They produce warnings for the
 * teacher only: nothing is blocked, removed or rewritten, so the generator, the visual supports and «Hacer magia» behave as before.
 */

export const V22_CHECKS = ["answer_space_homogeneity", "added_terms", "option_format", "slot_count", "ambiguous_target", "word_limit", "conditional_means", "approximate_leak"] as const;
export type V22CheckId = (typeof V22_CHECKS)[number];

export interface V22Finding {
  check: V22CheckId;
  question: HintQuestion | null;
  coverage: HintCoverage;
  /** flagged: the indicator was found. clear: checked, nothing found (for a partial check this is NOT «no hint»). */
  result: "flagged" | "clear";
  targets: string[];
  decision_ids: string[];
  detail: string;
}

export interface V22Audit {
  findings: V22Finding[];
  /** Checks that could not run (no document yet) and questions that are always the teacher's. */
  not_checked: string[];
  /** Per decision, what the ledger's hint test receives. */
  hintFindings: Map<string, HintFinding[]>;
  /** Activities whose instruction is still over the profile's word limit in the sheet. */
  overLimit: string[];
}

export interface V22Input {
  plan: AdaptationPlan;
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  /** The assembled sheet. Without it, the checks on the sheet are reported as not checked. */
  document?: MaterialDocument;
}

type ActivityBlock = Extract<Block, { type: "activity" }>;

/** Everything the original material says, for «is this already in the original?». */
export function materialText(analysis: MaterialAnalysis): string {
  return [
    ...analysis.texts.map((t) => t.text),
    ...analysis.activities.flatMap((a) => [a.instruction, a.context ?? ""]),
    ...analysis.visuals.flatMap((v) => [v.title ?? "", v.description ?? "", v.text ?? ""]),
  ].join("\n");
}

const activityBlocks = (doc: MaterialDocument, act: string): ActivityBlock[] => allBlocks(doc).filter((b): b is ActivityBlock => b.type === "activity" && b.trace.source_refs.includes(act));

const ORIGINAL_FAMILY: Partial<Record<MaterialAnalysis["activities"][number]["answer_area"]["type"], string>> = { line: "lines", lines: "lines", box: "box", large_space: "box", grid: "grid" };
const ADAPTED_FAMILY: Partial<Record<ActivityBlock["response"]["kind"], string>> = { lines: "lines", box: "box", grid: "grid", fields: "fields" };
const FAMILY_LABEL: Record<string, string> = { lines: "renglones", box: "recuadro", grid: "cuadrícula", fields: "campos" };

/**
 * P8: differences of answer-space type or proportion that the sheet introduces between activities the original treated alike
 * (same kind of space and same product asked for). Whether a flagged difference really works as a hint is the teacher's call.
 */
function answerSpaces(analysis: MaterialAnalysis, doc: MaterialDocument): V22Finding[] {
  const rows = analysis.activities.flatMap((a) => {
    const original = ORIGINAL_FAMILY[a.answer_area.type];
    const block = activityBlocks(doc, a.id).find((b) => ADAPTED_FAMILY[b.response.kind]);
    const adapted = block ? ADAPTED_FAMILY[block.response.kind] : undefined;
    if (!original || !block || !adapted) return [];
    const lines = block.response.kind === "lines" ? block.response.lines : null;
    // The room the statement itself asks for («escribe dos…») is not a hint: it is the baseline the proportion is measured against.
    const baseline = Math.max(a.answer_area.lines ?? 1, requestedResults(a));
    return [{ id: a.id, product: a.response_format, original, adapted, baseline, lines, decisions: block.trace.decision_ids }];
  });
  const out: V22Finding[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (const b of rows.slice(i + 1)) {
      const a = rows[i]!;
      // Same original space, but the statements already ask for different products (calculate vs write): a different space is allowed.
      if (a.original !== b.original || a.product !== b.product) continue;
      const decision_ids = [...new Set([...a.decisions, ...b.decisions])];
      if (a.adapted !== b.adapted) {
        out.push({ check: "answer_space_homogeneity", question: "P8", coverage: "deterministic", result: "flagged", targets: [a.id, b.id], decision_ids, detail: `${a.id} y ${b.id} tenían el mismo tipo de espacio (${FAMILY_LABEL[a.original]}); la ficha les da ${FAMILY_LABEL[a.adapted]} y ${FAMILY_LABEL[b.adapted]}. Puede sugerir el tipo de respuesta: confirmar si el enunciado ya distingue los productos.` });
      } else if (a.lines !== null && b.lines !== null && Math.abs(a.lines / b.lines / (a.baseline / b.baseline) - 1) > 0.1) {
        out.push({ check: "answer_space_homogeneity", question: "P8", coverage: "deterministic", result: "flagged", targets: [a.id, b.id], decision_ids, detail: `${a.id} y ${b.id}: ${a.lines} y ${b.lines} renglones no conservan la proporción del original (${a.baseline} y ${b.baseline}). Puede sugerir la extensión esperada.` });
      }
    }
  }
  if (out.length === 0 && rows.length > 1) out.push({ check: "answer_space_homogeneity", question: "P8", coverage: "deterministic", result: "clear", targets: rows.map((r) => r.id), decision_ids: [], detail: "La ficha no introduce diferencias de tipo ni de proporción entre espacios que el original trataba igual." });
  return out;
}

/** P2 (partial): vocabulary terms that the original never uses. Information added by a help box is not judged here. */
function addedTerms(analysis: MaterialAnalysis, doc: MaterialDocument): V22Finding[] {
  const source = materialText(analysis);
  return allBlocks(doc).flatMap((b): V22Finding[] => {
    if (b.type !== "vocabulary") return [];
    const added = b.items.map((i) => i.term).filter((t) => !containsTerm(source, t));
    return [{ check: "added_terms", question: "P2", coverage: "partial", result: added.length > 0 ? "flagged" : "clear", targets: [...b.trace.source_refs], decision_ids: [...b.trace.decision_ids], detail: added.length > 0 ? `${b.id}: ${added.length} término(s) que el original no da` : `${b.id}: los términos aparecen en el original` }];
  });
}

/** P3 (partial): options of one question with different emphasis (some marked, some not). */
function optionFormat(doc: MaterialDocument): V22Finding[] {
  return allBlocks(doc).flatMap((b): V22Finding[] => {
    if (b.type !== "activity") return [];
    const r = b.response;
    const options = r.kind === "choice" ? r.options : r.kind === "order" ? r.items : r.kind === "true_false" ? r.statements : null;
    if (!options) return [];
    const marked = options.map((o) => /\*\*|_[^_]+_/.test(o.text));
    const uneven = marked.some(Boolean) && !marked.every(Boolean);
    return [{ check: "option_format", question: "P3", coverage: "partial", result: uneven ? "flagged" : "clear", targets: [...b.trace.source_refs], decision_ids: [...b.trace.decision_ids], detail: uneven ? `${b.id}: las opciones no tienen el mismo formato` : `${b.id}: opciones con el mismo formato` }];
  });
}

/** P4 (partial): the sheet offers exactly as many slots as the inferred answer has parts, more than the original and than the statement asks for. */
function slotCount(analysis: MaterialAnalysis, doc: MaterialDocument): V22Finding[] {
  const out: V22Finding[] = [];
  for (const a of analysis.activities) {
    if (a.expected_answer.basis !== "inferred" || !a.expected_answer.value) continue;
    const parts = a.expected_answer.value.split(/\s*(?:,|;|\by\b)\s*/).filter(Boolean).length;
    for (const b of activityBlocks(doc, a.id)) {
      const r = b.response;
      const slots = r.kind === "lines" ? r.lines : r.kind === "fields" ? r.fields.length : r.kind === "sequence" ? r.items.length : null;
      if (slots === null || parts < 2) continue;
      const flagged = slots === parts && slots !== (a.answer_area.lines ?? 1) && requestedResults(a) !== parts;
      out.push({ check: "slot_count", question: "P4", coverage: "partial", result: flagged ? "flagged" : "clear", targets: [a.id], decision_ids: [...b.trace.decision_ids], detail: flagged ? `${a.id}: ${slots} espacios, tantos como partes tiene la respuesta y más de los que pide el enunciado` : `${a.id}: el número de espacios no coincide con la respuesta o lo pide el enunciado` });
    }
  }
  return out;
}

/** P7 (partial): a resource added on a point the analysis marked as doubtful makes the doubt more visible. */
function ambiguousTargets(plan: AdaptationPlan, context: AdaptationContext): V22Finding[] {
  return plan.decisions
    .filter((d) => addsResource(d) && context.material.ambiguous_targets.includes(d.target))
    .map((d) => ({ check: "ambiguous_target" as const, question: "P7" as const, coverage: "partial" as const, result: "flagged" as const, targets: [d.target], decision_ids: [d.id], detail: `${d.id}: añade un recurso sobre un punto dudoso del original; registrar el riesgo y preguntar` }));
}

/** Word limit of the profile on every piece the student reads as one instruction. */
function wordLimit(context: AdaptationContext, doc: MaterialDocument): { findings: V22Finding[]; overLimit: string[] } {
  const max = context.limits.max_instruction_words;
  if (max === null) return { findings: [], overLimit: [] };
  const over = new Set<string>();
  for (const b of allBlocks(doc)) {
    if (b.type !== "activity") continue;
    if (instructionPieces(b).some((p) => wordCount(p) > max)) for (const ref of b.trace.source_refs) if (ref.startsWith("act_")) over.add(ref);
  }
  const overLimit = [...over].sort();
  const finding: V22Finding = { check: "word_limit", question: null, coverage: "deterministic", result: overLimit.length > 0 ? "flagged" : "clear", targets: overLimit, decision_ids: [], detail: overLimit.length > 0 ? `${overLimit.join(", ")}: alguna instrucción supera ${max} palabras` : `Todas las instrucciones caben en ${max} palabras` };
  return { findings: [finding], overLimit };
}

/** Response alternatives that need a person, a device or a permission the context does not grant are conditional. */
function conditionalMeans(plan: AdaptationPlan, context: AdaptationContext, doc?: MaterialDocument): V22Finding[] {
  const out: V22Finding[] = [];
  for (const d of plan.decisions) {
    const keyboard = d.response_target === "keyboard" && !context.allowances.keyboard;
    if (keyboard || d.response_target === "oral_or_alternative") out.push({ check: "conditional_means", question: null, coverage: "deterministic", result: "flagged", targets: [d.target], decision_ids: [d.id], detail: keyboard ? `${d.id}: respuesta con teclado sin que el perfil lo permita; queda condicionada` : `${d.id}: respuesta oral o alternativa; requiere a alguien o algún medio que no consta` });
  }
  for (const b of doc ? allBlocks(doc) : []) {
    if (b.type !== "activity" || b.response.kind !== "oral_or_alternative") continue;
    if (b.response.mode === "keyboard" && context.allowances.keyboard) continue;
    if (out.some((f) => b.trace.decision_ids.some((id) => f.decision_ids.includes(id)))) continue;
    out.push({ check: "conditional_means", question: null, coverage: "deterministic", result: "flagged", targets: [...b.trace.source_refs], decision_ids: [...b.trace.decision_ids], detail: `${b.id}: respuesta ${b.response.mode} sin medios que consten` });
  }
  return out;
}

/** Inferred textual answers that reappear, reworded or reordered, in what the planner wrote or in the student's sheet. */
function approximateLeaks(plan: AdaptationPlan, analysis: MaterialAnalysis, doc?: MaterialDocument): V22Finding[] {
  const source = materialText(analysis);
  const answers = answersOf(analysis).filter((a) => a.basis === "inferred" && numbersIn(a.value).length === 0);
  const out: V22Finding[] = [];
  for (const a of answers) {
    for (const d of plan.decisions) {
      if (approximateLeak(`${d.note ?? ""}\n${d.visual?.purpose ?? ""}`, a.value, source)) out.push({ check: "approximate_leak", question: null, coverage: "partial", result: "flagged", targets: [a.activity], decision_ids: [d.id], detail: `${d.id}: el texto de la decisión podría contener, reformulada, la respuesta de ${a.activity}` });
    }
    for (const b of doc ? allBlocks(doc) : []) {
      if (approximateLeak(studentText(b), a.value, source)) out.push({ check: "approximate_leak", question: null, coverage: "partial", result: "flagged", targets: [a.activity], decision_ids: [...b.trace.decision_ids], detail: `${b.id}: podría contener, reformulada, la respuesta de ${a.activity}` });
    }
  }
  return out;
}

export function runV22Checks({ plan, analysis, context, document }: V22Input): V22Audit {
  const words = document ? wordLimit(context, document) : { findings: [], overLimit: [] };
  const findings = [
    ...(document ? [...answerSpaces(analysis, document), ...addedTerms(analysis, document), ...optionFormat(document), ...slotCount(analysis, document)] : []),
    ...ambiguousTargets(plan, context),
    ...words.findings,
    ...conditionalMeans(plan, context, document),
    ...approximateLeaks(plan, analysis, document),
  ];
  const not_checked = [
    "P1, P5 y P6: requieren juicio docente; no se comprueban automáticamente.",
    "P2: solo términos de glosario nuevos; la información que añade un recuadro la valora el docente.",
    "Fugas por paráfrasis lejana o por imágenes.",
    ...(document ? [] : ["P2, P3, P4, P8 y límite de palabras: sin ficha ensamblada todavía."]),
  ];

  // Per decision: a flagged finding wins; a clear sheet-level check counts for every decision that reaches those activities.
  const hintFindings = new Map<string, HintFinding[]>();
  for (const d of plan.decisions) {
    if (!addsResource(d)) continue;
    const reach = new Set(activitiesOf(analysis, d.target));
    const list: HintFinding[] = [];
    for (const question of Object.keys(HINT_COVERAGE) as HintQuestion[]) {
      const relevant = findings.filter((f) => f.question === question && (f.decision_ids.includes(d.id) || f.targets.some((t) => reach.has(t) || t === d.target)));
      const flagged = relevant.find((f) => f.result === "flagged");
      if (flagged) list.push({ question, result: "flagged", detail: flagged.detail });
      else if (relevant.length > 0) list.push({ question, result: "clear", detail: null });
    }
    hintFindings.set(d.id, list);
  }
  return { findings, not_checked, hintFindings, overLimit: words.overLimit };
}
