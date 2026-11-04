import type { Decision } from "@/lib/schemas/adaptation-plan";
import { HINT_QUESTIONS, type HintCheck, type HintCoverage, type HintQuestion } from "@/lib/schemas/decision-ledger";

/**
 * How much of each V2.2 hint question the platform can check by itself (docs/AGENTE_V22.md). No question is fully automatic
 * except P8, and P8 only about the answer spaces of the assembled sheet. A `teacher_judgment` question is never answered here.
 */
export const HINT_COVERAGE: Record<HintQuestion, HintCoverage> = {
  P1: "teacher_judgment",
  P2: "partial",
  P3: "partial",
  P4: "partial",
  P5: "teacher_judgment",
  P6: "teacher_judgment",
  P7: "partial",
  P8: "deterministic",
};

/** Actions that add or change a presentation, visual or answer-space resource: the ones the hint test is about. */
const RESOURCE_ACTIONS: ReadonlySet<Decision["action"]> = new Set(["segment", "reorganize", "add_support", "change_response_format"]);

export const addsResource = (d: Pick<Decision, "action" | "visual">): boolean => RESOURCE_ACTIONS.has(d.action) || d.visual !== undefined;

/** A check result from one of the deterministic or partial checks. Absent = nothing was checked for that question. */
export type HintFinding = Pick<HintCheck, "question" | "result" | "detail">;

/**
 * The hint test of one decision. Questions without a finding stay `pending_review`; a decision that adds no resource is
 * `not_applicable` everywhere. A finding can never upgrade a teacher-judgment question.
 */
export function hintTest(decision: Pick<Decision, "action" | "visual">, findings: readonly HintFinding[] = [], declaredYes?: readonly HintQuestion[] | null): HintCheck[] {
  const applies = addsResource(decision);
  // undefined: the planner declares nothing (v1, v2). null: a v3 planner that did not answer. A list: its «yes» answers.
  const declared = (question: HintQuestion): HintCheck["declared"] => (declaredYes === undefined ? null : declaredYes === null ? "not_answered" : declaredYes.includes(question) ? "yes" : "no");
  return HINT_QUESTIONS.map((question) => {
    const coverage = HINT_COVERAGE[question];
    if (!applies) return { question, coverage, result: "not_applicable", detail: null, declared: declared(question) };
    const found = coverage === "teacher_judgment" ? undefined : findings.find((f) => f.question === question);
    if (!found) return { question, coverage, result: "pending_review", detail: null, declared: declared(question) };
    // A partial check that finds nothing has not shown that there is no hint.
    const result = found.result === "clear" && coverage === "partial" ? "not_detected" : found.result;
    return { question, coverage, result, detail: found.detail, declared: declared(question) };
  });
}
