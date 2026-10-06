import type { AdaptationEntitlements } from "./entitlements";
import type { AdaptationStore, EntitlementRecord, EntitlementUsage } from "./store";

/**
 * Database-backed entitlements. The orchestrator only says WHEN (resource + workspace + adaptation); every rule —the limit,
 * who holds a unit, what counts as a delivery— lives in SQL (migration 014) and in plan data, never here. There is no plan name,
 * price or interval in this file.
 *
 *  reserve   inside `create_adaptation` (atomic with the row); idempotent by adaptation.
 *  consume   inside `finalize_adaptation(ready)` (atomic with the delivery); this hook only repeats it idempotently.
 *  release   inside `transition_adaptation(cancelled)` (atomic with the cancellation); this hook only repeats it idempotently.
 * An adaptation keeps its unit through planning, review, failures, blocks and new versions: the unit is the adaptation_id.
 */
export function dbEntitlements(store: AdaptationStore): AdaptationEntitlements {
  return {
    atomicWithCreation: true,
    reserve: async (a) => void (await store.reserveEntitlement(a.id, null)),
    consume: async (a) => void (await store.consumeEntitlement(a.id)),
    release: async (a, reason) => void (await store.releaseEntitlement(a.id, reason)),
    assertReserved: async (a) => {
      const record = await store.getEntitlement(a.id);
      return record !== null && record.state !== "released";
    },
  };
}

export type EntitlementAvailability = EntitlementUsage["availability"];

/** Early, friendly answer (the authoritative, race-free decision is the reservation itself). */
export async function checkAdaptationEntitlement(store: AdaptationStore, workspaceId: string): Promise<{ allowed: boolean; availability: EntitlementAvailability; available: number | null }> {
  const usage = await store.entitlementUsage(workspaceId);
  const allowed = usage.availability === "unlimited" || (usage.availability === "finite" && (usage.available ?? 0) > 0);
  return { allowed, availability: usage.availability, available: usage.available };
}

export const reserveEntitlement = (store: AdaptationStore, adaptationId: string, userId: string | null) => store.reserveEntitlement(adaptationId, userId);
export const consumeEntitlement = (store: AdaptationStore, adaptationId: string) => store.consumeEntitlement(adaptationId);
export const releaseEntitlement = (store: AdaptationStore, adaptationId: string, reason: string) => store.releaseEntitlement(adaptationId, reason);
export const getEntitlementUsage = (store: AdaptationStore, workspaceId: string): Promise<EntitlementUsage> => store.entitlementUsage(workspaceId);
export const getAdaptationEntitlement = (store: AdaptationStore, adaptationId: string): Promise<EntitlementRecord | null> => store.getEntitlement(adaptationId);
