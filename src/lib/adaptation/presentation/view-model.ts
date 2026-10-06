import type { AdaptationStatusDto, ProgressStage } from "@/lib/adaptation/orchestration/status";
import { STAGES, STATUS_COPY, checkCopy, failureCopy } from "./copy";

/**
 * What the screen shows for a status DTO. Every branch reads the server's own flags (`nextAction`, `canRetry`, `canCancel`,
 * `phase`); nothing here knows which transitions the state machine allows.
 */

export type ScreenKind = "start" | "working" | "review" | "generate" | "ready" | "blocked" | "failed" | "cancelled";

export function screenFor(dto: AdaptationStatusDto): ScreenKind {
  if (dto.phase === "cancelled") return "cancelled";
  if (dto.phase === "ready") return "ready";
  if (dto.phase === "blocked") return "blocked";
  if (dto.phase === "recoverable_failure" || dto.phase === "action_required") return "failed";
  if (dto.nextAction === "start_planning") return "start";
  if (dto.nextAction === "start_generation") return "generate";
  if (dto.nextAction === "review_plan" && dto.phase === "awaiting_review") return "review";
  return "working";
}

export function workingCopy(progress: ProgressStage): { title: string; body: string } {
  if (progress === "planning") return STATUS_COPY.planning;
  if (progress === "generating") return STATUS_COPY.generating;
  if (progress === "reviewing") return STATUS_COPY.reviewing;
  return { title: "Preparando", body: "Estamos preparando la adaptación." };
}

export type StageState = "done" | "active" | "pending";

const ORDER = ["preparing", "planning", "awaiting_review", "generating", "reviewing", "ready"] as const;

export function stageStates(progress: ProgressStage): Array<{ key: string; label: string; state: StageState }> {
  const index = (ORDER as readonly string[]).indexOf(progress);
  const current = index < 0 ? 0 : index;
  return STAGES.map((stage, i) => ({ key: stage.key, label: stage.label, state: progress === "ready" || i < current ? "done" : i === current ? "active" : "pending" }));
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
