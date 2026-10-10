import type { AdaptationStatusDto, ProgressStage } from "@/lib/adaptation/orchestration/status";
import type { CreationMode } from "@/lib/adaptation/orchestration/store";
import { STAGES, STATUS_COPY, checkCopy, failureCopy } from "./copy";

/**
 * What the screen shows for a status DTO. Every branch reads the server's own flags (`nextAction`, `canRetry`, `canCancel`,
 * `phase`); nothing here knows which transitions the state machine allows.
 */

export type ScreenKind = "start" | "working" | "review" | "generate" | "ready" | "blocked" | "failed" | "cancelled" | "automatic_incomplete";

/** `editing`: the teacher CHOSE «Revisar y editar» after «Hacer magia» stopped; the plan screen is never opened for them otherwise. */
export function screenFor(dto: AdaptationStatusDto, options: { editing?: boolean } = {}): ScreenKind {
  if (dto.phase === "automatic_incomplete") return options.editing && dto.status === "awaiting_plan_review" ? "review" : "automatic_incomplete";
  if (dto.phase === "cancelled") return "cancelled";
  if (dto.phase === "ready") return "ready";
  if (dto.phase === "blocked") return "blocked";
  if (dto.phase === "recoverable_failure" || dto.phase === "action_required") return "failed";
  if (dto.nextAction === "start_planning") return "start";
  if (dto.nextAction === "start_generation") return "generate";
  if (dto.nextAction === "review_plan" && dto.phase === "awaiting_review") return "review";
  return "working";
}

/** `organizing`: «Hacer magia» deciding how to apply each change: the real «validating» step of its planning job. */
const isOrganizing = (progress: ProgressStage, options: { mode?: CreationMode; step?: string | null }) => options.mode === "automatic" && progress === "planning" && options.step === "validating";

export function workingCopy(progress: ProgressStage, options: { mode?: CreationMode; step?: string | null } = {}): { title: string; body: string } {
  if (progress === "generating") return STATUS_COPY.generating;
  if (progress === "reviewing") return STATUS_COPY.reviewing;
  if (isOrganizing(progress, options)) return STATUS_COPY.organizing;
  return STATUS_COPY.planning;
}

export type StageState = "done" | "active" | "pending";

/** Where each progress value sits in `STAGES` (`preparing` = a stage is about to start: shown on the next one). */
const POSITION: Partial<Record<ProgressStage, string>> = { preparing: "planning", planning: "planning", awaiting_review: "awaiting_review", generating: "generating", reviewing: "reviewing", ready: "ready" };

export function stageStates(progress: ProgressStage, options: { mode?: CreationMode; generationQueued?: boolean; step?: string | null } = {}): Array<{ key: string; label: string; state: StageState }> {
  // «Tu revisión» only when the teacher chose to review; «Organizando las actividades» only in «Hacer magia», where it is automatic.
  const stages = STAGES.filter((s) => (s.key !== "awaiting_review" || options.mode === "review") && (s.key !== "organizing" || options.mode === "automatic"));
  // A queued generation is past the plan (and its review) even before its job starts.
  const at = progress === "preparing" && options.generationQueued ? "generating" : isOrganizing(progress, options) ? "organizing" : (POSITION[progress] ?? "planning");
  const current = Math.max(0, stages.findIndex((s) => s.key === at));
  return stages.map((stage, i) => ({ key: stage.key, label: stage.label, state: progress === "ready" || i < current ? "done" : i === current ? "active" : "pending" }));
}

/** Observations for the teacher, de-duplicated by wording; never a check name, an id or the reviewer's own text. */
export function warningLines(dto: Pick<AdaptationStatusDto, "review" | "execution">): string[] {
  const lines = (dto.review?.warnings ?? []).map((w) => checkCopy(w.check));
  if ((dto.execution?.deferredDecisions.length ?? 0) > 0) lines.push("Hay un cambio de presentación que se aplicará al preparar la presentación final.");
  return [...new Set(lines)];
}

export function failureView(dto: Pick<AdaptationStatusDto, "error" | "canRetry" | "ambiguousAttempt" | "canCancel">) {
  return {
    message: failureCopy(dto.error),
    ambiguous: dto.ambiguousAttempt && dto.error?.code === "ambiguous_attempt",
    canRetry: dto.canRetry,
    canCancel: dto.canCancel,
  };
}

export const readyTitle = (dto: Pick<AdaptationStatusDto, "review">) => (dto.review?.verdict === "approved_with_warnings" ? STATUS_COPY.readyWithWarnings : STATUS_COPY.ready);
