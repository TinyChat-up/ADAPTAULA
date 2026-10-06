/**
 * Integration point for adaptation quotas (a later task). The orchestrator only says WHEN, never how much or for whom:
 *   reserve  → an adaptation is requested (before any cost is incurred)
 *   release  → it ended without a delivery (failed, blocked, cancelled): the reservation goes back
 *   consume  → it was delivered (`isDelivered`): the reservation becomes definitive
 * Each call is idempotent by adaptation id on the implementation's side. No plan, limit or price lives in the orchestrator.
 */
export interface AdaptationEntitlements {
  /** True when the reservation is made INSIDE `create_adaptation`'s transaction (no adaptation exists without its unit). */
  atomicWithCreation?: boolean;
  /** Whether the adaptation holds (or has consumed) its unit. Checked before any provider call; absent = not enforced. */
  assertReserved?(adaptation: { id: string; workspaceId: string }): Promise<boolean>;
  reserve(adaptation: { id: string; workspaceId: string }): Promise<void>;
  release(adaptation: { id: string; workspaceId: string }, reason: string): Promise<void>;
  consume(adaptation: { id: string; workspaceId: string }): Promise<void>;
}

export const NO_ENTITLEMENTS: AdaptationEntitlements = {
  reserve: async () => {},
  release: async () => {},
  consume: async () => {},
};
