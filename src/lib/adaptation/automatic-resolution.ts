import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { CLOSED_RESPONSES, type AdaptationPlan, type Decision, type StrategyKey, type SupportKind } from "@/lib/schemas/adaptation-plan";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { PLAN_REVIEW_SCHEMA_VERSION, type DecisionEdits, type PlanReview, type PlanReviewEntry } from "@/lib/schemas/plan-review";
import { isResolvedByPresentation } from "./context";
import { classifyDecisionExecution } from "./execution";
import { fingerprint } from "./fingerprint";
import { classifyPlan, validatePlan } from "./invariants";
import { instructionNeedsRewrite } from "./proportion";

/**
 * «Hacer magia» decides the plan by itself, knowing what the executors can really do (docs/ADAPTATION.md § Hacer magia).
 * Every decision ends in exactly one outcome, recorded with its reason:
 *   · applied       the decision as the planner wrote it can be executed;
 *   · alternative   it cannot, and an EXISTING capability does the same job for the same needs on the same target (the edit is
 *                   re-validated by the invariants and must have an executor): never a cosmetic stand-in;
 *   · left out      it cannot be executed (or is unsafe) and leaving it out loses nothing important: its needs are covered by
 *                   another executable decision or the presentation, the material already meets it, or the need is not a high one;
 *   · unresolved    it cannot be executed, has no alternative, and answers a HIGH need nothing else covers: the sheet is not
 *                   finished automatically (an honest stop, never a sheet that silently ignores the need).
 * Deterministic and free: no model call, the same plan always gives the same review (and fingerprint).
 */

export type AutomaticOutcomeKind = "applied" | "alternative" | "left_out_blocked" | "left_out_covered" | "left_out_satisfied" | "left_out_minor" | "unresolved";

export interface AutomaticDecisionOutcome {
  decision_id: string;
  kind: AutomaticOutcomeKind;
  reason: string;
  /** The needs (dimensions) left without any executable decision, when the decision is left out or unresolved. */
  uncovered: DimensionKey[];
}

export interface AutomaticResolution {
  review: PlanReview;
  outcomes: AutomaticDecisionOutcome[];
  /** Decisions that keep the sheet from being finished automatically. Empty: the plan can go on by itself. */
  unresolved: AutomaticDecisionOutcome[];
}

/**
 * A support the generator really writes that does the SAME job as a strategy (one each, by function, never by appearance). Only
 * strategies whose own actions include adding a support (`STRATEGIES`): the alternative stays inside what the strategy means.
 */
const SUPPORT_FOR_STRATEGY: Partial<Record<StrategyKey, SupportKind>> = {
  instruction_clarification: "step_list",
  task_sequencing: "step_list",
  comprehension_support: "key_idea",
  working_memory_support: "reminder",
  planning_support: "planner",
  vocabulary_support: "glossary",
  self_regulation: "self_check",
};

/** Strategies a short instruction already satisfies: there is nothing to shorten or simplify. */
const LENGTH_STRATEGIES = new Set<StrategyKey>(["language_simplification", "text_segmentation"]);

const isClosed = (d: Pick<Decision, "response_target">) => d.response_target !== undefined && (CLOSED_RESPONSES as readonly string[]).includes(d.response_target);

/** Alternatives to try, in order: each one is a reviewer edit (target, needs and protected elements cannot change). */
function candidates(d: Decision, analysis: MaterialAnalysis): Array<{ edits: DecisionEdits; reason: string }> {
  const out: Array<{ edits: DecisionEdits; reason: string }> = [];
  const activity = analysis.activities.some((a) => a.id === d.target);
  const text = analysis.texts.find((t) => t.id === d.target);
  // A closed format (choose, mark, match…) needs an answer key nobody produces. Less writing is still less writing with a short
  // open answer, which keeps the student producing: only when the decision is about the writing load, never about choosing.
  if (activity && isClosed(d) && (d.strategies.includes("writing_load_reduction") || d.strategies.includes("response_format"))) {
    out.push({ edits: { response_target: "write_text_short", ...(d.action === "change_response_format" ? {} : { action: "change_response_format" as const }) }, reason: "Respuesta breve en lugar de un formato cerrado (que necesitaría una clave de respuestas): menos escritura, misma tarea" });
  }
  // Reorganising a reading text has no executor; its paragraphs can be labelled in parts, word for word.
  if (text?.kind === "reading_text" && (d.action === "reorganize" || d.action === "segment") && d.strategies.some((s) => s === "text_segmentation" || s === "visual_load_reduction" || s === "spatial_organization")) {
    out.push({ edits: { action: "segment" }, reason: "El texto se divide en partes numeradas, sin cambiar ni una palabra" });
  }
  // A rewrite or rearrangement that cannot be done: the support that does the same job for the same strategy.
  const kinds = [...new Set(d.strategies.flatMap((s) => (SUPPORT_FOR_STRATEGY[s] ? [SUPPORT_FOR_STRATEGY[s]!] : [])))].slice(0, 2);
  if (kinds.length > 0 && d.action !== "add_support" && d.action !== "remove") {
    out.push({ edits: { action: "add_support", supports: kinds.map((kind) => ({ kind, uses_task_data: false })) }, reason: `Un apoyo escrito hace la misma función (${kinds.join(", ")})` });
  }
  return out;
}

/** The candidate edit is applied only if the invariants accept it and something can execute it. */
function viable(raw: AdaptationPlan, d: Decision, edits: DecisionEdits, analysis: MaterialAnalysis, context: AdaptationContext): boolean {
  const edited: Decision = { ...d, ...edits };
  const check = validatePlan({ ...raw, decisions: raw.decisions.map((x) => (x.id === d.id ? edited : x)) }, analysis, context);
  if (check.issues.some((i) => i.severity === "block" && i.decision_id === d.id)) return false;
  return classifyDecisionExecution(edited, analysis, context).route !== "unsupported";
}

/** The material already does what the decision asks: a short instruction needs no shortening or simpler wording. */
function alreadySatisfied(d: Decision, analysis: MaterialAnalysis, context: AdaptationContext): boolean {
  const activity = analysis.activities.find((a) => a.id === d.target);
  if (!activity || (d.action !== "rephrase" && d.action !== "reduce" && d.action !== "segment")) return false;
  if (d.supports.length > 0 || d.response_target !== undefined) return false;
  return d.strategies.length > 0 && d.strategies.every((s) => LENGTH_STRATEGIES.has(s)) && !instructionNeedsRewrite(activity, context.limits.max_instruction_words);
}

export function resolveAutomatically(raw: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): AutomaticResolution {
  const classification = classifyPlan(raw, validatePlan(raw, analysis, context));
  const statusOf = new Map(classification.decisions.map((c) => [c.id, c.status]));

  // 1. Per decision: does it execute as written, or with an alternative?
  const plan = new Map<string, { entry: Omit<PlanReviewEntry, "decision_id">; kind: "applied" | "alternative"; reason: string } | { kind: "open"; why: string; blocked: boolean }>();
  for (const d of raw.decisions) {
    const blocked = statusOf.get(d.id) === "blocked";
    if (!blocked) {
      const route = classifyDecisionExecution(d, analysis, context);
      if (route.route !== "unsupported") {
        plan.set(d.id, { kind: "applied", entry: { action: "approved", reason: statusOf.get(d.id) === "review" ? "Aplicada con aviso de revisión" : "Sin avisos" }, reason: route.reason });
        continue;
      }
    }
    const alternative = candidates(d, analysis).find((c) => viable(raw, d, c.edits, analysis, context));
    if (alternative) {
      plan.set(d.id, { kind: "alternative", entry: { action: "edited", reason: alternative.reason.slice(0, 160), edits: alternative.edits }, reason: alternative.reason });
      continue;
    }
    const why = blocked ? "Bloqueada por las invariantes deterministas" : classifyDecisionExecution(d, analysis, context).reason;
    plan.set(d.id, { kind: "open", why, blocked });
  }

  // 2. What each left-out decision would leave uncovered, against what WILL be executed.
  const executing = raw.decisions.filter((d) => plan.get(d.id)?.kind !== "open");
  const covered = (d: Decision, dim: DimensionKey) => isResolvedByPresentation(dim, context.presentation) || executing.some((o) => o.id !== d.id && o.dimensions.includes(dim));
  const level = (dim: DimensionKey) => context.needs.find((n) => n.dimension === dim)?.level ?? null;

  const outcomes: AutomaticDecisionOutcome[] = [];
  const entries: PlanReviewEntry[] = [];
  for (const d of raw.decisions) {
    const step = plan.get(d.id)!;
    if (step.kind !== "open") {
      outcomes.push({ decision_id: d.id, kind: step.kind, reason: step.reason, uncovered: [] });
      entries.push({ decision_id: d.id, ...step.entry });
      continue;
    }
    const uncovered = d.dimensions.filter((dim) => !covered(d, dim));
    const important = uncovered.filter((dim) => level(dim) === "high");
    let kind: AutomaticOutcomeKind;
    let reason: string;
    if (!step.blocked && alreadySatisfied(d, analysis, context)) {
      kind = "left_out_satisfied";
      reason = "La consigna original ya es breve: cumple lo que pedía la decisión";
    } else if (important.length > 0) {
      kind = "unresolved";
      reason = `Ningún ejecutor puede aplicarla, no hay alternativa válida y deja sin atender una necesidad importante del perfil (${step.why})`;
    } else if (step.blocked) {
      kind = "left_out_blocked";
      reason = uncovered.length === 0 ? "Bloqueada por las invariantes; su necesidad la cubren otras decisiones o la presentación" : "Bloqueada por las invariantes; la necesidad que atendía no es de intensidad alta";
    } else if (uncovered.length === 0 && d.dimensions.length > 0) {
      kind = "left_out_covered";
      reason = "Ningún ejecutor puede aplicarla a este elemento; su necesidad ya la cubren otras decisiones o la presentación";
    } else {
      kind = "left_out_minor";
      reason = "Ningún ejecutor puede aplicarla y no hay alternativa válida; la necesidad que atendía no es de intensidad alta";
    }
    outcomes.push({ decision_id: d.id, kind, reason: reason.slice(0, 240), uncovered });
    // An unresolved decision that is not blocked stays approved: if anyone submits this review, the preflight stops it (never
    // silently dropped). A blocked one cannot be approved: it is rejected, and `unresolved` keeps the stop.
    entries.push(
      kind === "unresolved" && !step.blocked
        ? { decision_id: d.id, action: "approved", reason: "Sin ejecutor ni alternativa: decide una persona" }
        : { decision_id: d.id, action: "rejected", reason: reason.slice(0, 160) },
    );
  }

  return {
    review: { schema_version: PLAN_REVIEW_SCHEMA_VERSION, plan_fingerprint: fingerprint(raw), reviewer: { kind: "auto" }, reviewed_at: "auto", entries },
    outcomes,
    unresolved: outcomes.filter((o) => o.kind === "unresolved"),
  };
}
