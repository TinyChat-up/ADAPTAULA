import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import {
  CLOSED_RESPONSES,
  MODIFYING_ACTIONS,
  type AdaptationPlan,
  type Decision,
  type FlagSeverity,
  type PlanIssue,
  type PlanValidation,
  type ReviewFlag,
} from "@/lib/schemas/adaptation-plan";
import { OBJECTIVES_MAY_CHANGE } from "@/lib/schemas/adaptation-type";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { activityById, answersOf, constraintsOf, evaluatesOperation, evaluatesOwnWork, evaluatesWriting, hasExtensionRequirement, isLiteralSourceText, isOpenActivity, materialNumbers, protectedFor, textById } from "./facts";
import { contextFingerprint } from "./context";
import { fingerprint } from "./fingerprint";
import { actionFitsStrategies } from "./strategies";
import { answerSignatures, leakedSignature } from "./text";

/**
 * Deterministic pedagogical invariants of a plan (docs/ADAPTATION.md § Invariantes). Every rule reads ids and typed
 * fields of the analysis, the plan and the context; none needs a model. A `block` issue makes the plan invalid: the
 * decision is either repaired by the planner (one attempt) or dropped, never applied. `review` issues travel to the teacher.
 */

/** Supports that, built on the task's own data, can resolve it or steer the answer. Worked examples and sentence starters have their own rules. */
const RISKY_ON_TASK_DATA = ["step_list", "guiding_questions", "reminder", "key_idea"] as const;
const isModifying = (d: Decision) => (MODIFYING_ACTIONS as readonly string[]).includes(d.action);

export function validatePlan(plan: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): PlanValidation {
  const issues: PlanIssue[] = [];
  const add = (flag: ReviewFlag, severity: FlagSeverity, d: Decision | null, message: string, target?: string) =>
    issues.push({ flag, severity, decision_id: d?.id ?? null, target: target ?? d?.target ?? null, message });

  // A plan only means something for the exact analysis and context it was made for.
  if (plan.analysis.fingerprint !== fingerprint(analysis) || plan.context_fingerprint !== contextFingerprint(context)) add("unknown_reference", "block", null, "El plan no corresponde al análisis o al contexto actuales (huella distinta)", "document");

  // Free text of the plan (notes, visual purposes, summary) is never student content, but it travels to the teacher and to the
  // generator: an inferred answer must not appear there either.
  const signatures = answersOf(analysis)
    .filter((a) => a.basis === "inferred")
    .map((a) => ({ activity: a.activity, signatures: answerSignatures(a.value, materialNumbers(analysis)) }));
  const leakIn = (text: string) => signatures.find((s) => leakedSignature(text, s.signatures) !== null)?.activity ?? null;
  for (const d of plan.decisions) {
    const leaked = leakIn(`${d.note ?? ""}\n${d.visual?.purpose ?? ""}`);
    if (leaked) add("answer_revealed", "block", d, `El texto de la decisión revela la respuesta de ${leaked}`);
  }
  const leakedSummary = leakIn(plan.summary.join("\n"));
  if (leakedSummary) add("answer_revealed", "block", null, `El resumen del plan revela la respuesta de ${leakedSummary}`, "document");

  const curricular = OBJECTIVES_MAY_CHANGE[plan.adaptation_type];
  const needs = new Set(context.needs.map((n) => n.dimension));
  const prtIds = new Set(analysis.protected_elements.map((p) => p.id));
  const known = new Set<string>(["document", ...analysis.activities.map((a) => a.id), ...analysis.texts.map((t) => t.id), ...analysis.visuals.map((v) => v.id), ...analysis.sections.map((s) => s.id)]);

  for (const d of plan.decisions) {
    // References: a decision can only talk about things the analysis contains.
    if (!known.has(d.target)) add("unknown_reference", "block", d, `El destino ${d.target} no existe en el análisis`);
    for (const p of d.preserves) if (!prtIds.has(p)) add("unknown_reference", "block", d, `El elemento protegido ${p} no existe`);
    if (d.visual?.source_visual && !analysis.visuals.some((v) => v.id === d.visual?.source_visual)) add("unknown_reference", "block", d, `El visual ${d.visual.source_visual} no existe`);

    // A change needs a functional reason from this context. A diagnosis can never be one: the profile has none.
    if (d.action !== "keep") {
      if (d.dimensions.length === 0) add("unjustified_change", "block", d, "Un cambio necesita al menos una necesidad funcional del perfil");
      for (const dim of d.dimensions) if (!needs.has(dim)) add("unjustified_change", "block", d, `La dimensión ${dim} no es una necesidad activa en este contexto`);
      if (d.strategies.length === 0) add("unjustified_change", "block", d, "Un cambio necesita una estrategia");
      else if (!actionFitsStrategies(d.action, d.strategies)) add("unjustified_change", "review", d, `La acción ${d.action} no corresponde a las estrategias elegidas`);
    }

    const activity = activityById(analysis, d.target);
    const text = textById(analysis, d.target);
    const visual = analysis.visuals.find((v) => v.id === d.target);

    // Protected elements: every essential one that concerns the target must be carried by a decision that modifies it.
    if (isModifying(d) && d.action !== "remove") {
      for (const p of protectedFor(analysis, d.target)) {
        if (d.preserves.includes(p.id)) continue;
        if (p.importance === "essential") add("protected_element_modified", "block", d, `La decisión no conserva el elemento esencial ${p.id} («${p.value}»)`);
        else if (p.importance === "important") add("protected_element_modified", "review", d, `La decisión no declara el elemento ${p.id} («${p.value}»)`);
      }
    }

    // Removing: activities are what is assessed; required data and visuals are what makes them solvable.
    if (d.action === "remove") {
      if (activity) add("activity_removed", curricular ? "review" : "block", d, "Eliminar una actividad cambia lo que se evalúa");
      const essential = protectedFor(analysis, d.target).filter((p) => p.importance === "essential");
      if (visual?.role === "required" || essential.length > 0 || (text && text.activity_ids.length > 0)) {
        add("required_data_removed", "block", d, "Se eliminaría un recurso necesario para resolver o un elemento esencial");
      }
    }
    if (d.action === "reduce" && visual?.role === "required") add("required_data_removed", "block", d, "Reducir un visual necesario elimina datos");

    // Visuals: a required visual is data. It may be reorganised or accompanied, never replaced.
    if (visual?.role === "required" && (d.action === "rephrase" || d.action === "change_response_format")) {
      add("essential_visual_replaced", "block", d, "Un visual necesario no se sustituye");
    }
    if (d.visual && d.visual.source_visual) {
      const source = analysis.visuals.find((v) => v.id === d.visual?.source_visual);
      if (source?.role === "required" && d.visual.mode === "transform_original") add("essential_visual_replaced", "review", d, "Se transforma un visual necesario: sus datos deben quedar intactos");
      if (source?.role === "required" && d.visual.mode === "new_representation") add("essential_visual_replaced", "block", d, "Un visual necesario no se sustituye por una representación nueva");
    }

    // Literal source text: segmentable and glossable, never rewritten or summarised.
    if (text && isLiteralSourceText(analysis, text) && (d.action === "rephrase" || d.action === "reduce" || d.action === "remove")) {
      add("source_text_altered", "block", d, "El texto fuente es objeto de análisis: no se reescribe ni se resume");
    }

    if (activity) {
      const writing = evaluatesWriting(analysis, activity);
      const closed = d.response_target !== undefined && (CLOSED_RESPONSES as readonly string[]).includes(d.response_target);
      const replacesWriting = d.strategies.includes("writing_load_reduction") || d.strategies.includes("response_choice") || (d.action === "change_response_format" && d.response_target !== "write_text" && d.response_target !== "keyboard");

      if (writing && replacesWriting && (isModifying(d) || d.action === "change_response_format")) {
        add("written_expression_replaced", "block", d, "La actividad evalúa la expresión escrita: no se reduce ni se sustituye");
      }
      if (closed && evaluatesOperation(analysis, activity)) add("target_operation_replaced", "block", d, "Reconocer un resultado no es realizar la operación que se evalúa");
      if (closed && isOpenActivity(activity) && !writing) add("open_task_closed", "review", d, "Una tarea abierta pasa a ser cerrada");

      const extension = constraintsOf(analysis, activity.id).some((p) => hasExtensionRequirement(p.value));
      if (extension && !writing && (d.strategies.includes("writing_load_reduction") || d.action === "reduce")) {
        add("extension_changed", "review", d, "Se modifica la extensión pedida: el docente debe confirmarlo");
      }

      const demanding = protectedFor(analysis, activity.id).some((p) => p.importance === "essential" && (p.type === "target_operation" || p.type === "reasoning_constraint"));
      if (demanding && d.intensity === "substantial" && (d.action === "reduce" || d.strategies.includes("task_sequencing") || d.strategies.includes("pacing"))) {
        add("cognitive_demand_reduced", "review", d, "Un cambio sustancial sobre una operación o un razonamiento esencial puede rebajar la demanda");
      }

      // Supports that can carry the content of the answer or teach the evaluated procedure. `uses_task_data` is the model's own
      // declaration and never makes a support safe: these barriers do not depend on it being honest or false.
      const evaluated = evaluatesOwnWork(analysis, activity);
      const production = isOpenActivity(activity) || writing;
      for (const s of d.supports) {
        if (s.kind === "worked_example") {
          if (s.uses_task_data) add("answer_revealed", "block", d, "Un ejemplo con los datos de la tarea es su respuesta: debe ser análogo");
          else if (evaluated && !d.dimensions.includes("worked_examples")) add("cognitive_demand_reduced", "review", d, "Un ejemplo resuelto, aunque use otros datos, enseña el procedimiento que se evalúa y ninguna necesidad activa lo pide");
        } else if (s.kind === "sentence_starters") {
          if (s.uses_task_data) add("answer_revealed", production ? "block" : "review", d, "Unos comienzos de frase con datos de la tarea ya escriben parte de la respuesta");
          else if (production && !d.dimensions.includes("expressive_language_support")) add("cognitive_demand_reduced", "review", d, "Comienzos de frase sobre una respuesta que es producción propia: ninguna necesidad activa los pide");
        } else if (s.uses_task_data && (RISKY_ON_TASK_DATA as readonly string[]).includes(s.kind)) {
          add("answer_revealed", "review", d, `Un apoyo (${s.kind}) construido sobre los datos de la tarea puede resolverla o dirigir la respuesta`);
        }
      }
    }

    if (context.material.ambiguous_targets.includes(d.target) && d.action !== "keep") add("ambiguous_source", "review", d, "El original es dudoso en este punto: revisar antes de adaptarlo");
    const conflict = context.conflicts.find((c) => c.targets.includes(d.target) && c.dimensions.some((dim) => d.dimensions.includes(dim)));
    if (conflict) add("needs_conflict", "review", d, conflict.guidance);
    if (context.audience.infantilization_guard && d.strategies.includes("visual_support") && d.visual?.mode === "new_representation") {
      add("infantilization_risk", "info", d, "Apoyo visual nuevo en Secundaria: informativo y sobrio, solo si aporta una función");
    }
  }

  // Objectives: each one keeps at least one activity (unless the adaptation is curricular and the teacher confirmed it).
  const removed = new Set(plan.decisions.filter((d) => d.action === "remove").map((d) => d.target));
  for (const objective of analysis.pedagogical_intent.objectives) {
    const activities = analysis.activities.filter((a) => a.objective_ids.includes(objective.id));
    if (activities.length > 0 && activities.every((a) => removed.has(a.id))) {
      add("objective_changed", curricular ? "review" : "block", null, `El objetivo ${objective.id} se queda sin actividades`, objective.id);
    }
  }

  // Two decisions that contradict each other on the same target.
  const byTarget = new Map<string, Decision[]>();
  for (const d of plan.decisions) byTarget.set(d.target, [...(byTarget.get(d.target) ?? []), d]);
  for (const [target, decisions] of byTarget) {
    const actions = new Set(decisions.map((d) => d.action));
    if (actions.has("keep") && decisions.some(isModifying)) add("needs_conflict", "review", null, "Hay decisiones contradictorias sobre el mismo destino", target);
    if (actions.has("remove") && actions.size > 1) add("needs_conflict", "review", null, "Se elimina un destino que otra decisión modifica", target);
  }

  return { valid: !issues.some((i) => i.severity === "block"), issues };
}

/** Decisions that cannot be applied. They are dropped (or sent back to the planner once), never silently executed. */
export function blockedDecisionIds(validation: PlanValidation): Set<string> {
  return new Set(validation.issues.filter((i) => i.severity === "block" && i.decision_id).map((i) => i.decision_id!));
}

export type DecisionStatus = "valid" | "review" | "blocked";

export interface PlanClassification {
  decisions: Array<{ id: string; status: DecisionStatus; issues: PlanIssue[] }>;
  /** Issues not tied to one decision (stale fingerprints, a summary that leaks, an objective left without activities…). */
  planLevel: PlanIssue[];
  counts: Record<DecisionStatus, number>;
}

/** Each decision as valid (no issue), review (needs the teacher) or blocked (cannot be applied). */
export function classifyPlan(plan: AdaptationPlan, validation: PlanValidation): PlanClassification {
  const decisions = plan.decisions.map((d) => {
    const issues = validation.issues.filter((i) => i.decision_id === d.id);
    const status: DecisionStatus = issues.some((i) => i.severity === "block") ? "blocked" : issues.some((i) => i.severity === "review") ? "review" : "valid";
    return { id: d.id, status, issues };
  });
  const counts = { valid: 0, review: 0, blocked: 0 };
  for (const d of decisions) counts[d.status] += 1;
  return { decisions, planLevel: validation.issues.filter((i) => i.decision_id === null), counts };
}
