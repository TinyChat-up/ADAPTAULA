import type { PublicResult } from "@/lib/adaptation/orchestration/public";
import type { AdaptationPlanDto, PlanDecisionDto, SubmitReviewDto } from "@/lib/adaptation/orchestration/service";
import { actionErrorCopy } from "./copy";
import { ADAPTATION_ACTIONS, INTENSITIES, RESPONSE_TARGETS, STRATEGY_KEYS, SUPPORT_KINDS, type AdaptationAction, type Intensity, type ResponseTarget, type StrategyKey, type SupportKind } from "@/lib/schemas/adaptation-plan";

/**
 * Pure state of the plan-review form. It holds the teacher's choices and builds the payload of the EXISTING review contract
 * (`PlanReview v1` entries); it owns no domain rule: the server validates, classifies and decides what is executable.
 * The only guards here are the ones the form needs to be usable: every decision has a choice (the recommendation, until the
 * teacher changes it), a blocked one is never approved (the server refuses it anyway), and an adjustment actually changes something.
 */

export type Choice = "approve" | "reject" | "edit";

/** Only the fields of the edit payload that the teacher touched; `undefined` means "leave as proposed". */
export interface EditDraft {
  action?: AdaptationAction;
  intensity?: Intensity;
  strategies?: StrategyKey[];
  supports?: SupportKind[];
  responseTarget?: ResponseTarget | "";
  note?: string;
}

export type Confirmation = "yes" | "no" | "unknown";

export interface DecisionDraft {
  choice: Choice | null;
  edit: EditDraft;
  /** Planner V2.2: the answer to the question of a decision the method withheld. */
  confirmation?: Confirmation;
}

export type FormState = Record<string, DecisionDraft>;

export type FormAction =
  | { type: "choose"; id: string; choice: Choice }
  | { type: "edit"; id: string; patch: EditDraft }
  | { type: "confirm"; id: string; answer: Confirmation }
  | { type: "reset"; plan: AdaptationPlanDto };

/**
 * The recommendation, which is also where the form starts: every decision that can be applied is applied, a blocked one is left
 * out (it cannot be applied as it is). The same policy «Hacer magia» applies on the server (`autoReview`), so «Crear ficha»
 * without touching anything creates the same sheet. The teacher only changes what they want to change.
 */
export function initialFormState(plan: AdaptationPlanDto): FormState {
  // A decision the V2.2 method withholds (ADR-046) starts unchecked too: it is applied only if the teacher chooses it.
  return Object.fromEntries(plan.decisions.map((d) => [d.id, { choice: d.status === "blocked" || d.method?.withheld === true ? ("reject" as const) : ("approve" as const), edit: {} }]));
}

/** The notice of a decision the V2.2 method withholds: why, and the question it depends on (teacher language, ADR-046). */
export function methodNotice(decision: AdaptationPlanDto["decisions"][number]): string | undefined {
  const m = decision.method;
  if (!m?.withheld) return undefined;
  const reasons = m.reasons.length > 0 ? ` ${m.reasons.join(" ")}` : "";
  return `Espera tu decisión: no se aplicará si no la eliges.${reasons}${m.question ? ` Pregunta: ${m.question}` : ""}`;
}

/** True while every decision is still as recommended («Restaurar recomendación» has nothing to restore). */
export function isRecommended(plan: AdaptationPlanDto, state: FormState): boolean {
  const recommended = initialFormState(plan);
  return plan.decisions.every((d) => state[d.id]?.choice === recommended[d.id]!.choice);
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "choose": {
      const current = state[action.id];
      if (!current) return state;
      return { ...state, [action.id]: { ...current, choice: action.choice } };
    }
    case "edit": {
      const current = state[action.id];
      if (!current) return state;
      return { ...state, [action.id]: { choice: "edit", edit: { ...current.edit, ...action.patch } } };
    }
    case "confirm": {
      const current = state[action.id];
      if (!current) return state;
      // Anything but a «yes» leaves a withheld decision out: the answer decides, the teacher does not have to remember to discard it.
      return { ...state, [action.id]: { ...current, confirmation: action.answer, choice: action.answer === "yes" ? current.choice : "reject" } };
    }
    case "reset":
      return initialFormState(action.plan);
  }
}

const sameSet = <T extends string>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The edit payload: only what differs from the proposal. Empty when nothing was really changed. */
export function editsFor(decision: PlanDecisionDto, draft: EditDraft): Record<string, unknown> {
  const edits: Record<string, unknown> = {};
  if (draft.action && draft.action !== decision.action && (ADAPTATION_ACTIONS as readonly string[]).includes(draft.action)) edits.action = draft.action;
  if (draft.intensity && draft.intensity !== decision.intensity && (INTENSITIES as readonly string[]).includes(draft.intensity)) edits.intensity = draft.intensity;
  if (draft.strategies && !sameSet(draft.strategies, decision.strategies as StrategyKey[]) && draft.strategies.every((s) => (STRATEGY_KEYS as readonly string[]).includes(s))) edits.strategies = draft.strategies.slice(0, 3);
  if (draft.supports && !sameSet(draft.supports, decision.supports as SupportKind[]) && draft.supports.every((s) => (SUPPORT_KINDS as readonly string[]).includes(s))) {
    // Only kinds: whether a help is built on the task's data is derived on the server, never declared by the browser.
    edits.supports = draft.supports.slice(0, 4).map((kind) => ({ kind }));
  }
  if (draft.responseTarget && (RESPONSE_TARGETS as readonly string[]).includes(draft.responseTarget)) edits.response_target = draft.responseTarget;
  const note = draft.note?.trim();
  if (note) edits.note = note.slice(0, 160);
  return edits;
}

export type DecisionProblem = "missing_choice" | "blocked_approved" | "no_changes" | "needs_confirmation";

export const PROBLEM_COPY: Record<DecisionProblem, string> = {
  missing_choice: "Elige qué hacer con este cambio.",
  blocked_approved: "Este cambio no se puede aplicar tal cual. Descártalo o ajústalo.",
  no_changes: "Cambia algún ajuste o elige otra opción.",
  needs_confirmation: "Responde a la pregunta para poder aplicar este cambio, o descártalo.",
};

export function problemsOf(plan: AdaptationPlanDto, state: FormState): Record<string, DecisionProblem> {
  const problems: Record<string, DecisionProblem> = {};
  for (const d of plan.decisions) {
    const draft = state[d.id];
    if (!draft || draft.choice === null) problems[d.id] = "missing_choice";
    else if (draft.choice === "approve" && d.status === "blocked") problems[d.id] = "blocked_approved";
    else if ((draft.choice === "approve" || draft.choice === "edit") && d.method?.withheld === true && draft.confirmation !== "yes") problems[d.id] = "needs_confirmation";
    else if (draft.choice === "edit" && Object.keys(editsFor(d, draft.edit)).length === 0) problems[d.id] = "no_changes";
  }
  return problems;
}

const REASONS = { approve: "Aprobada por la docente", reject: "Descartada por la docente", edit: "Ajustada por la docente" } as const;

/** The answers to the questions of withheld decisions, only where the teacher gave one. */
function confirmationsOf(plan: AdaptationPlanDto, state: FormState) {
  const confirmations = plan.decisions.flatMap((d) => (d.method?.withheld && state[d.id]?.confirmation ? [{ decision_id: d.id, answer: state[d.id]!.confirmation! }] : []));
  return confirmations.length > 0 ? { confirmations } : {};
}

/** The body for `submitPlanReviewAction`: decisions and edits only; reviewer identity and time are set by the server. */
export function buildReview(plan: AdaptationPlanDto, state: FormState) {
  return {
    schema_version: 1 as const,
    plan_fingerprint: plan.planFingerprint,
    ...confirmationsOf(plan, state),
    entries: plan.decisions.map((d) => {
      const draft = state[d.id]!;
      if (draft.choice === "edit") return { decision_id: d.id, action: "edited" as const, reason: REASONS.edit, edits: editsFor(d, draft.edit) };
      return { decision_id: d.id, action: draft.choice === "reject" ? ("rejected" as const) : ("approved" as const), reason: draft.choice === "reject" ? REASONS.reject : REASONS.approve };
    }),
  };
}

export const countChanges = (plan: AdaptationPlanDto) => plan.decisions.length;

/** Which decisions a blocker line refers to (`dec_4: …`). The line itself is technical and never shown. */
export function decisionsInBlockers(blockers: readonly string[]): string[] {
  return [...new Set(blockers.map((b) => /^(dec_[0-9]{1,4})\b/.exec(b)?.[1]).filter((id): id is string => Boolean(id)))];
}

export type SubmitOutcome =
  | { kind: "saved"; result: SubmitReviewDto }
  | { kind: "stale"; message: string }
  | { kind: "unsupported"; message: string; affected: string[] }
  | { kind: "error"; code: string; message: string };

/**
 * What the screen does with the server's answer to "Guardar revisión". The server decides executability: a saved review with
 * blockers means "return to the review" (the affected decisions are named), a stale one means "refresh the proposal".
 */
export function interpretSubmit(result: PublicResult<SubmitReviewDto>): SubmitOutcome {
  if (!result.ok) {
    if (result.code === "stale_review") return { kind: "stale", message: actionErrorCopy("stale_review", result.message) };
    if (result.code === "unsupported_execution") return { kind: "unsupported", message: actionErrorCopy("unsupported_execution", ""), affected: [] };
    return { kind: "error", code: result.code, message: actionErrorCopy(result.code, result.message) };
  }
  if (!result.data.executable) return { kind: "unsupported", message: actionErrorCopy("unsupported_execution", ""), affected: decisionsInBlockers(result.data.blockers) };
  return { kind: "saved", result: result.data };
}
