import type { AdaptationPlanDto, PlanDecisionDto } from "@/lib/adaptation/orchestration/service";
import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { buildContextView } from "@/lib/adaptation/presentation/context";
import { argumentationAnalysis } from "../../evals/adaptation/fixtures";

/**
 * Synthetic, Bachillerato-inspired fixtures for the adaptation UI (no private material). The analysis carries an INFERRED
 * expected answer and the plan a planner note on purpose: neither may ever reach the screen.
 */
export const INFERRED_ANSWER = "RESPUESTA_INFERIDA_SECRETA";
export const PLANNER_NOTE = "NOTA_INTERNA_DEL_PLANIFICADOR";

export function analysisWithInferredAnswer() {
  const analysis = argumentationAnalysis();
  return { ...analysis, activities: analysis.activities.map((a, i) => (i === 0 ? { ...a, expected_answer: { basis: "inferred" as const, value: INFERRED_ANSWER } } : a)) };
}

export const analysis = analysisWithInferredAnswer();
const act = (n: number) => analysis.activities[n - 1]!.id;

export const context = buildContextView({ materialId: "00000000-0000-4000-8000-000000000001", title: "Comprensión y argumentación", stage: "Bachillerato", grade: "1.º Bachillerato", subject: "Lengua Castellana y Literatura", analysis });

const base = { intensity: "moderate", strategies: [] as string[], needs: [] as string[], supports: [] as string[], note: PLANNER_NOTE, preserves: [] as PlanDecisionDto["preserves"], restrictions: [] as string[], issues: [] as PlanDecisionDto["issues"] };

export const decisions: PlanDecisionDto[] = [
  { ...base, id: "dec_1", target: act(1), action: "rephrase", intensity: "light", strategies: ["language_simplification"], needs: ["reading_level", "sentence_length"], status: "valid" },
  { ...base, id: "dec_2", target: act(5), action: "add_support", strategies: ["planning_support"], needs: ["planning_support", "checklist_support"], supports: ["checklist", "planner"], status: "valid", note: `${PLANNER_NOTE} ${INFERRED_ANSWER}`,
    preserves: [{ type: "response_constraint", value: "150-180 palabras con tesis, al menos dos argumentos y conclusión" }, { type: "reasoning_constraint", value: "Tesis con palabras propias y dos argumentos" }],
    restrictions: ["Puede organizar los pasos, pero no sugerir la tesis ni los argumentos."] },
  { ...base, id: "dec_3", target: act(2), action: "change_response_format", strategies: ["response_choice"], needs: ["expressive_language_support"], status: "review", preserves: [{ type: "target_operation", value: "Formular la tesis con palabras propias" }], issues: [{ flag: "open_task_closed", severity: "review", message: "MENSAJE_TECNICO_DEL_VALIDADOR dec_3 need_7" }] },
  { ...base, id: "dec_4", target: "document", action: "segment", strategies: ["text_segmentation"], needs: ["reading_chunk_size"], status: "valid" },
  { ...base, id: "dec_5", target: act(4), action: "remove", strategies: ["visual_load_reduction"], needs: ["visual_distraction_reduction"], status: "blocked", preserves: [{ type: "evaluation_criterion", value: "Justificar el registro con dos rasgos lingüísticos" }], restrictions: ["No debe indicar cuál es el registro correcto."], issues: [{ flag: "activity_removed", severity: "block", message: "Quitaría la actividad act_4" }] },
];

export const plan: AdaptationPlanDto = {
  planFingerprint: "a".repeat(64),
  decisions,
  summary: ["resumen interno"],
  counts: { valid: 3, review: 1, blocked: 1 },
  review: { submitted: false, executable: null, blockers: [] },
};

export function status(overrides: Partial<AdaptationStatusDto> = {}): AdaptationStatusDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "queued",
    phase: "working",
    progress: "preparing",
    step: null,
    nextAction: "start_planning",
    canRetry: false,
    canCancel: true,
    hasPlan: false,
    hasPlanReview: false,
    hasVersion: false,
    delivered: false,
    currentVersion: null,
    warningsCount: 0,
    error: null,
    plan: null,
    execution: null,
    review: null,
    ambiguousAttempt: false,
    ...overrides,
  };
}

export const awaitingReview = () => status({ status: "awaiting_plan_review", phase: "awaiting_review", progress: "awaiting_review", nextAction: "review_plan", hasPlan: true, plan: { valid: 3, review: 1, blocked: 1 } });
export const ready = (extra: Partial<AdaptationStatusDto> = {}) =>
  status({ status: "ready", phase: "ready", progress: "ready", nextAction: "view_result", canCancel: false, delivered: true, hasVersion: true, currentVersion: 1, ...extra });
