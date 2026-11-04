import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, DraftAdaptationPlan } from "@/lib/schemas/adaptation-plan";
import { DraftAdaptationPlanV3Schema } from "@/lib/schemas/adaptation-plan-draft-v3";
import type { HintQuestion } from "@/lib/schemas/decision-ledger";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { PlanReview } from "@/lib/schemas/plan-review";
import { answersOf, materialNumbers } from "./facts";
import { normalizePlan } from "./plan";
import { PlanDraftError, needRefTable, resolvePlanDraftV2 } from "./plan-v2";
import { answerSignatures, approximateLeak, leakedSignature } from "./text";
import { materialText } from "./v22/checks";

/**
 * `DraftAdaptationPlan v3` → `AdaptationPlan v1` + `PlannerDeclarations` (ADR-045). The plan is exactly what v2 would produce from
 * the same decisions; what the method made the planner declare travels beside it and is screened here:
 *  - teacher questions and barrier notes are free text that a teacher reads: one that reveals an inferred answer is withheld;
 *  - a cited precedent that was not sent with the request is reported (the planner cannot have read it);
 *  - a decision is WITHHELD from any automatic application when it is conditional or when the planner itself answered «yes» to a
 *    hint question that rules the resource out (all but P7, which is registered as a risk and asked).
 */

/** P7 makes something of the original more visible: usable, but registered and asked. Every other «yes» rules the resource out. */
const BLOCKING_HINTS: ReadonlySet<HintQuestion> = new Set(["P1", "P2", "P3", "P4", "P5", "P6", "P8"]);

export interface RulesUse {
  version: string;
  package_sha256: string;
  block_sha256: string;
  /** Precedent ids that travelled with the request. */
  included: string[];
}

export type DeclarationIssueCode = "precedent_not_sent" | "question_withheld" | "barrier_note_withheld" | "blocking_hint" | "conditional";

export interface PlannerDeclarations {
  rules: RulesUse | null;
  decisions: Record<string, { status: "active" | "conditional"; question: string | null; hint_yes: HintQuestion[] | null; precedents: string[]; withheld: boolean }>;
  teacher_questions: Array<{ id: string; text: string | null; decision_ids: string[] }>;
  residual_barriers: Array<{ activity: string; dimensions: DimensionKey[]; note: string | null }>;
  issues: Array<{ decision_id: string | null; code: DeclarationIssueCode; message: string }>;
}

function leakScreen(analysis: MaterialAnalysis) {
  const numbers = materialNumbers(analysis);
  const source = materialText(analysis);
  const inferred = answersOf(analysis).filter((a) => a.basis === "inferred");
  const signatures = inferred.map((a) => answerSignatures(a.value, numbers));
  return (text: string) => signatures.some((s) => leakedSignature(text, s) !== null) || inferred.some((a) => approximateLeak(text, a.value, source));
}

/** The v2 form of a v3 decision: the same decision without what the method made the planner declare. */
export function withoutDeclarations<T extends { status?: unknown; question?: unknown; hint_yes?: unknown; precedents?: unknown }>(d: T): Omit<T, "status" | "question" | "hint_yes" | "precedents"> {
  const rest = { ...d };
  delete rest.status;
  delete rest.question;
  delete rest.hint_yes;
  delete rest.precedents;
  return rest;
}

export function resolvePlanDraftV3(draftInput: unknown, analysis: MaterialAnalysis, context: AdaptationContext, rules: RulesUse | null): { draft: DraftAdaptationPlan; declarations: PlannerDeclarations } {
  const parsed = DraftAdaptationPlanV3Schema.parse(draftInput);
  const draft = resolvePlanDraftV2({ decisions: parsed.decisions.map(withoutDeclarations), summary: parsed.summary }, context);
  const leaks = leakScreen(analysis);
  const refs = new Map(needRefTable(context).map((n) => [n.ref, n.dimension]));
  const sent = new Set(rules?.included ?? []);
  const issues: PlannerDeclarations["issues"] = [];

  const decisions: PlannerDeclarations["decisions"] = {};
  parsed.decisions.forEach((d, i) => {
    const id = `dec_${i + 1}`;
    const blocking = (d.hint_yes ?? []).filter((q) => BLOCKING_HINTS.has(q));
    for (const p of d.precedents ?? []) if (!sent.has(p)) issues.push({ decision_id: id, code: "precedent_not_sent", message: `${id} cita ${p}, que no iba en la petición` });
    if (blocking.length > 0) issues.push({ decision_id: id, code: "blocking_hint", message: `${id}: el planificador responde «sí» a ${blocking.join(", ")}; queda para el docente` });
    if (d.status === "conditional") issues.push({ decision_id: id, code: "conditional", message: `${id} depende de la respuesta del docente (${d.question})` });
    decisions[id] = { status: d.status, question: d.question ?? null, hint_yes: d.hint_yes ?? null, precedents: d.precedents ?? [], withheld: d.status === "conditional" || blocking.length > 0 };
  });

  const teacher_questions = (parsed.teacher_questions ?? []).map((q) => {
    const withheld = leaks(q.text);
    if (withheld) issues.push({ decision_id: null, code: "question_withheld", message: `${q.id}: la pregunta podría revelar una respuesta y no se muestra` });
    return { id: q.id, text: withheld ? null : q.text, decision_ids: Object.entries(decisions).filter(([, v]) => v.question === q.id).map(([k]) => k) };
  });
  const residual_barriers = (parsed.residual_barriers ?? []).map((b) => {
    const dimensions = b.need_refs.map((r) => {
      const dim = refs.get(r);
      if (!dim) throw new PlanDraftError("unknown_need_ref", `Una barrera residual cita ${r}, que no existe en el contexto`);
      return dim;
    });
    const withheld = leaks(b.note);
    if (withheld) issues.push({ decision_id: null, code: "barrier_note_withheld", message: `La nota de una barrera de ${b.target} podría revelar una respuesta y no se muestra` });
    return { activity: b.target, dimensions: [...new Set(dimensions)], note: withheld ? null : b.note };
  });
  return { draft, declarations: { rules, decisions, teacher_questions, residual_barriers, issues } };
}

export function normalizePlanV3(draftInput: unknown, analysis: MaterialAnalysis, context: AdaptationContext, rules: RulesUse | null): { plan: AdaptationPlan; declarations: PlannerDeclarations } {
  const { draft, declarations } = resolvePlanDraftV3(draftInput, analysis, context, rules);
  return { plan: normalizePlan(draft, analysis, context), declarations };
}

const WITHHELD_REASON = "Condicionada por el método V2.2: requiere la decisión del docente";

/**
 * An automatic review (no teacher) never applies a withheld decision: it is rejected with its reason, and the teacher sees it with
 * its question. A teacher's review is the teacher's: it is returned unchanged.
 */
export function withholdForTeacher(review: PlanReview, declarations: PlannerDeclarations): PlanReview {
  if (review.reviewer.kind === "teacher") return review;
  const withheld = new Set(Object.entries(declarations.decisions).filter(([, v]) => v.withheld).map(([k]) => k));
  if (withheld.size === 0) return review;
  const entries = review.entries.map((e) => (withheld.has(e.decision_id) ? { decision_id: e.decision_id, action: "rejected" as const, reason: WITHHELD_REASON } : e));
  for (const id of withheld) if (!entries.some((e) => e.decision_id === id)) entries.push({ decision_id: id, action: "rejected", reason: WITHHELD_REASON });
  return { ...review, entries };
}
