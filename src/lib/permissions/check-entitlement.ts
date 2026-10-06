import "server-only";
import { getSupabase } from "@/lib/auth/session";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { nextPlan } from "@/lib/plans/next-plan";
import { getPublicPlans } from "@/lib/plans/public-plans";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { evaluateEntitlement, type EntitlementAction, type EntitlementResult } from "./entitlements";

async function countActive(table: "learner_profiles" | "classes", workspaceId: string): Promise<number> {
  const supabase = await getSupabase();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  if (error) throw new Error("No se ha podido comprobar el límite de tu plan.");
  return count ?? 0;
}

/**
 * Server-side gate for every action whose availability depends on the plan.
 * The database enforces the same limits with triggers (defense in depth).
 */
export async function checkEntitlement(ctx: WorkspaceContext, action: EntitlementAction): Promise<EntitlementResult> {
  const usage = await getWorkspaceUsage(ctx.workspace.id);
  const [profiles, classes] = await Promise.all([
    action === "profile.create" ? countActive("learner_profiles", ctx.workspace.id) : 0,
    action === "class.create" ? countActive("classes", ctx.workspace.id) : 0,
  ]);
  const upgradeTo = nextPlan(await getPublicPlans(), usage.plan.slug)?.slug ?? null;
  return evaluateEntitlement({ action, role: ctx.role, usage, counts: { profiles, classes }, upgradeTo });
}
