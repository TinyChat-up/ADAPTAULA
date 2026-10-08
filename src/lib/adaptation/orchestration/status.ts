import type { PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { ADAPTATION_ERROR_CODES, FAILURE_KIND, type AdaptationErrorCode, type FailureKind } from "./errors";
import type { CreationMode, PipelineSnapshot } from "./store";
import { isDelivered, type AdaptationStatus } from "./state-machine";

/**
 * Stable status DTO for the web layer's polling. The server is the authority: the client never infers rules from status strings,
 * it reads `nextAction`, `canRetry` and `canCancel`. Nothing internal leaves here: no prompts, raw provider output, stack traces,
 * model names, tokens, costs, SQL, ids of other workspaces or learner data. `progress` is a semantic stage, never a percentage.
 */

export type ProgressStage = "preparing" | "planning" | "awaiting_review" | "generating" | "reviewing" | "ready" | "blocked" | "failed" | "cancelled";
export type NextAction = "none" | "start_planning" | "review_plan" | "start_generation" | "retry" | "cancel" | "view_result";
export type StatusPhase = "working" | "awaiting_review" | "ready" | "blocked" | "recoverable_failure" | "action_required" | "cancelled";

export interface StatusArtifacts {
  planValidation?: { counts: { valid: number; review: number; blocked: number } } | null;
  execution?: { ai: string[]; deferred: Array<{ id: string }>; blockers: string[] } | null;
  review?: Pick<PedagogicalReview, "verdict" | "checks"> | null;
  pending?: string[];
  hasPlan?: boolean;
  hasPlanReview?: boolean;
  hasVersion?: boolean;
}

export interface AdaptationStatusDto {
  id: string;
  status: AdaptationStatus;
  /** How the teacher chose to create it: `automatic` («Hacer magia») or `review` («Revisar antes de crear»). */
  creationMode: CreationMode;
  phase: StatusPhase;
  progress: ProgressStage;
  step: string | null;
  nextAction: NextAction;
  canRetry: boolean;
  canCancel: boolean;
  hasPlan: boolean;
  hasPlanReview: boolean;
  hasVersion: boolean;
  delivered: boolean;
  currentVersion: number | null;
  warningsCount: number;
  error: { code: AdaptationErrorCode; category: FailureKind; message: string } | null;
  plan: { valid: number; review: number; blocked: number } | null;
  execution: { aiDecisions: number; deferredDecisions: string[]; blockers: string[] } | null;
  review: { verdict: PedagogicalReview["verdict"]; warnings: Array<{ check: string; status: string; detail: string; method: string }>; pendingJudgments: string[] } | null;
  /** The last attempt may have been billed without being saved: a person must decide whether to try again. */
  ambiguousAttempt: boolean;
  /** Product generations used (distinct generation inputs; a technical retry of the same one does not count) and whether another one is still possible. */
  generationsUsed: number;
  regenerationAvailable: boolean;
}

/**
 * Product generations an adaptation may have: the first one plus two more after a blocked quality review. Enforced by the
 * database (`enqueue_adaptation_stage`, migration 018); here only so the screens never offer what would be refused.
 */
export const MAX_GENERATION_CYCLES = 3;

/** Distinct generation inputs among the adaptation's jobs: a retry re-queues the same input and is not a new generation. */
export const generationCyclesOf = (jobs: ReadonlyArray<{ stage: string; input_fingerprint: string | null }>) =>
  new Set(jobs.filter((j) => j.stage === "generation" && j.input_fingerprint).map((j) => j.input_fingerprint)).size;

/** What the user is told, per code. Generic on purpose: no vendor, model, token, SQL or other workspace's information. */
export const PUBLIC_ERROR_MESSAGES: Readonly<Record<AdaptationErrorCode, string>> = {
  invalid_input: "No hemos podido preparar esta adaptación con los datos actuales.",
  stale_analysis: "El análisis del material ha cambiado. Vuelve a crear la adaptación.",
  planner_schema: "No hemos podido preparar la propuesta de adaptación. Puedes volver a intentarlo.",
  planner_validation: "La propuesta de adaptación necesita tu revisión.",
  plan_review_required: "Falta tu revisión de la propuesta antes de continuar.",
  stale_review: "Tu revisión corresponde a una propuesta anterior. Revísala de nuevo.",
  invalid_review: "La revisión no es válida. Corrígela y vuelve a enviarla.",
  execution_unsupported: "Alguna de las decisiones aprobadas no se puede aplicar todavía. Revisa la propuesta.",
  entitlement_exhausted: "Has alcanzado el límite de adaptaciones de tu plan.",
  entitlement_unavailable: "No podemos comprobar ahora el límite de tu plan. Inténtalo más tarde.",
  entitlement_not_reserved: "Esta adaptación no tiene una unidad de tu plan reservada.",
  generator_schema: "No hemos podido generar la ficha. Puedes volver a intentarlo.",
  generator_validation: "La ficha generada no superó las comprobaciones. Puedes volver a intentarlo.",
  deterministic_review_failed: "La ficha no superó las comprobaciones automáticas y necesita tu revisión.",
  reviewer_schema: "No hemos podido completar la revisión de la ficha. Puedes volver a intentarlo.",
  reviewer_blocked: "La revisión pedagógica ha encontrado un problema que necesita tu atención.",
  ambiguous_attempt: "El último intento no terminó de forma segura. Confirma si quieres intentarlo de nuevo.",
  provider_transient: "El servicio no está disponible ahora mismo. Se reintentará automáticamente.",
  provider_refusal: "El servicio no ha podido procesar este material.",
  provider_credentials: "El servicio no está disponible ahora mismo. No es culpa de tu material.",
  cancelled: "La adaptación se canceló.",
  internal: "Algo ha fallado por nuestra parte. Puedes volver a intentarlo.",
};

const knownCode = (code: string | null): AdaptationErrorCode | null => ((ADAPTATION_ERROR_CODES as readonly string[]).includes(code ?? "") ? (code as AdaptationErrorCode) : code ? "internal" : null);

export function failureOf(snapshot: PipelineSnapshot): { code: AdaptationErrorCode; kind: FailureKind; stage: "planning" | "generation" | null } | null {
  const row = snapshot.adaptation;
  if (row.status !== "failed") return null;
  const last = snapshot.jobs.at(-1) ?? null;
  const code = knownCode(row.failure_code) ?? knownCode(last?.error?.code ?? null);
  return code ? { code, kind: FAILURE_KIND[code], stage: last?.stage ?? null } : null;
}

/** Retry is for failures the system classed as retryable, plus an ambiguous attempt (which also needs the explicit acknowledgement). */
export const isRetryable = (failure: { code: AdaptationErrorCode; kind: FailureKind } | null) => failure !== null && (failure.kind === "retryable" || failure.code === "ambiguous_attempt");

export function buildStatusDto(snapshot: PipelineSnapshot, artifacts: StatusArtifacts = {}): AdaptationStatusDto {
  const row = snapshot.adaptation;
  const status = row.status as AdaptationStatus;
  const active = snapshot.jobs.filter((j) => j.status === "queued" || j.status === "processing");
  const activeStage = (stage: "planning" | "generation") => active.some((j) => j.stage === stage);
  const failure = failureOf(snapshot);
  const delivered = isDelivered(row);

  let phase: StatusPhase;
  let progress: ProgressStage;
  let nextAction: NextAction = "none";
  switch (status) {
    case "queued":
      phase = "working";
      progress = activeStage("planning") ? "planning" : "preparing";
      nextAction = activeStage("planning") ? "none" : "start_planning";
      break;
    case "planning":
      phase = "working";
      progress = "planning";
      break;
    case "awaiting_plan_review":
      if (row.creation_mode === "automatic" && artifacts.hasPlanReview !== true) {
        // «Hacer magia» with a fresh plan: the server crosses the gate itself (the run request resumes it), nobody has to review.
        phase = "working";
        progress = "planning";
        break;
      }
      phase = "awaiting_review";
      progress = "awaiting_review";
      nextAction = "review_plan";
      break;
    case "generation_queued":
      phase = "working";
      progress = activeStage("generation") ? "generating" : "preparing";
      nextAction = activeStage("generation") ? "none" : "start_generation";
      break;
    case "generating":
      phase = "working";
      progress = "generating";
      break;
    case "reviewing_deterministic":
    case "reviewing_ai":
      phase = "working";
      progress = "reviewing";
      break;
    case "ready":
      phase = "ready";
      progress = "ready";
      nextAction = delivered ? "view_result" : "none";
      break;
    case "blocked":
      phase = "blocked";
      progress = "blocked";
      // A blocked adaptation is recoverable (reopen the review, correct, generate again) while it has generations left.
      nextAction = generationCyclesOf(snapshot.jobs) < MAX_GENERATION_CYCLES ? "review_plan" : "none";
      break;
    case "cancelled":
      phase = "cancelled";
      progress = "cancelled";
      break;
    default:
      phase = failure?.kind === "retryable" ? "recoverable_failure" : "action_required";
      progress = "failed";
      nextAction = isRetryable(failure) ? "retry" : "cancel";
  }

  const warnings = artifacts.review ? artifacts.review.checks.filter((c) => c.status === "WARN" || c.status === "FAIL") : [];
  return {
    id: row.id,
    status,
    creationMode: row.creation_mode,
    phase,
    progress,
    step: active.at(-1)?.step ?? null,
    nextAction,
    canRetry: isRetryable(failure),
    canCancel: status !== "ready" && status !== "cancelled",
    hasPlan: artifacts.hasPlan ?? artifacts.planValidation != null,
    hasPlanReview: artifacts.hasPlanReview ?? false,
    hasVersion: row.current_version > 0 || artifacts.hasVersion === true,
    delivered,
    currentVersion: row.current_version > 0 ? row.current_version : null,
    warningsCount: warnings.length,
    error: failure ? { code: failure.code, category: failure.kind, message: PUBLIC_ERROR_MESSAGES[failure.code] } : null,
    plan: artifacts.planValidation ? { ...artifacts.planValidation.counts } : null,
    execution: artifacts.execution ? { aiDecisions: artifacts.execution.ai.length, deferredDecisions: artifacts.execution.deferred.map((d) => d.id), blockers: artifacts.execution.blockers } : null,
    review: artifacts.review
      ? {
          verdict: artifacts.review.verdict,
          // Every non-PASS finding is kept, R1-type warnings included: nothing is filtered before the teacher sees it.
          warnings: warnings.map((c) => ({ check: c.check, status: c.status, detail: c.detail, method: c.method })),
          pendingJudgments: artifacts.pending ?? [],
        }
      : null,
    ambiguousAttempt: snapshot.jobs.some((j) => j.ambiguous && (j.status === "processing" || j.status === "queued")) || failure?.code === "ambiguous_attempt",
    generationsUsed: generationCyclesOf(snapshot.jobs),
    regenerationAvailable: generationCyclesOf(snapshot.jobs) < MAX_GENERATION_CYCLES,
  };
}
