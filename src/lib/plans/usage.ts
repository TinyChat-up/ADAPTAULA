import "server-only";
import { cache } from "react";
import { getSupabase } from "@/lib/auth/session";
import { WorkspaceUsageSchema, type WorkspaceUsage } from "@/lib/schemas/plan";

/** Plan and usage of the active workspace, computed by the database (single source of truth). */
export const getWorkspaceUsage = cache(async (workspaceId: string): Promise<WorkspaceUsage> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("workspace_usage", { ws: workspaceId });
  if (error) throw new Error("No se ha podido cargar el uso de tu plan.");
  return WorkspaceUsageSchema.parse(data);
});
