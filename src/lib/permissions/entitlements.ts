import type { WorkspaceRole } from "@/lib/auth/workspace-select";
import type { WorkspaceUsage } from "@/lib/schemas/plan";

export type EntitlementAction = "profile.create" | "class.create" | "analysis.start";

export type EntitlementResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "limit_reached" | "role"; limit: number; used: number; upgradeTo: string | null };

const WRITE_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "teacher"];

export interface EntitlementInput {
  action: EntitlementAction;
  role: WorkspaceRole;
  usage: Pick<WorkspaceUsage, "max_profiles" | "max_classes" | "analyses">;
  counts: { profiles: number; classes: number };
  /** Slug of the next plan on sale, from `nextPlan()`; null when there is none. */
  upgradeTo: string | null;
}

function meterFor({ action, usage, counts }: Pick<EntitlementInput, "action" | "usage" | "counts">): { limit: number; used: number } {
  switch (action) {
    case "profile.create":
      return { limit: usage.max_profiles, used: counts.profiles };
    case "class.create":
      return { limit: usage.max_classes, used: counts.classes };
    case "analysis.start":
      return { limit: usage.analyses.limit, used: usage.analyses.used };
  }
}

/**
 * Pure decision. Limits always come from the plan row, never from constants.
 * For `analysis.start` this is the early, friendly answer: the authoritative and race-free reservation is
 * `consume_quota` inside `enqueue_analysis_job`, which still refuses if two requests arrive at once.
 */
export function evaluateEntitlement({ action, role, usage, counts, upgradeTo }: EntitlementInput): EntitlementResult {
  const { limit, used } = meterFor({ action, usage, counts });

  if (!WRITE_ROLES.includes(role)) return { allowed: false, reason: "role", limit, used, upgradeTo: null };
  if (used >= limit) return { allowed: false, reason: "limit_reached", limit, used, upgradeTo };
  return { allowed: true, remaining: limit - used };
}
