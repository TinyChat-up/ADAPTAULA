/**
 * The adaptation's state machine. The database enforces the same table (`adaptation_transition_allowed`, one test compares them
 * pair by pair); this copy lets the application reject an impossible command before touching it. Transitions are made on the
 * server only: a client request can never skip `awaiting_plan_review`.
 */

export const ADAPTATION_STATUSES = [
  "queued",
  "planning",
  "awaiting_plan_review",
  "generation_queued",
  "generating",
  "reviewing_deterministic",
  "reviewing_ai",
  "ready",
  "blocked",
  "failed",
  "cancelled",
] as const;
export type AdaptationStatus = (typeof ADAPTATION_STATUSES)[number];

export const TRANSITIONS: Readonly<Record<AdaptationStatus, readonly AdaptationStatus[]>> = {
  queued: ["planning", "cancelled", "failed"],
  planning: ["awaiting_plan_review", "failed", "cancelled"],
  // The mandatory human gate: from here the ONLY way forward is a teacher's review (generation_queued), a re-plan or a cancel.
  awaiting_plan_review: ["generation_queued", "queued", "cancelled"],
  generation_queued: ["generating", "awaiting_plan_review", "cancelled", "failed"],
  generating: ["reviewing_deterministic", "awaiting_plan_review", "failed", "cancelled"],
  reviewing_deterministic: ["reviewing_ai", "blocked", "failed", "cancelled"],
  reviewing_ai: ["ready", "blocked", "failed", "cancelled"],
  failed: ["queued", "generation_queued", "cancelled"],
  blocked: ["awaiting_plan_review", "cancelled"],
  ready: [],
  cancelled: [],
};

export const canTransition = (from: AdaptationStatus, to: AdaptationStatus): boolean => TRANSITIONS[from].includes(to);

export class InvalidTransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`Transición no permitida: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: AdaptationStatus, to: AdaptationStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const TERMINAL_STATUSES: readonly AdaptationStatus[] = ["ready", "cancelled"];
export const WORKING_STATUSES: readonly AdaptationStatus[] = ["queued", "planning", "generation_queued", "generating", "reviewing_deterministic", "reviewing_ai"];

/**
 * DELIVERED ADAPTATION (the definition quotas and refunds will rely on). An adaptation is delivered when, and only when:
 *   · its status is `ready`,
 *   · `current_version` points to a persisted version with a usable MaterialDocument,
 *   · that version carries its merged PedagogicalReview (`approved` or `approved_with_warnings`), warnings included.
 * A plan, a draft, an invalid generation, or a document whose review is `blocked` / `needs_revision` is NOT a delivery: the
 * version is kept for audit but the adaptation is `blocked` and `delivered_at` stays null.
 */
export function isDelivered(row: { status: string; current_version: number; delivered_at: string | null }): boolean {
  return row.status === "ready" && row.current_version > 0 && row.delivered_at !== null;
}
