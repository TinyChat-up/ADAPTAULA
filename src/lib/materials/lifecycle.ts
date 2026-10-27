import "server-only";
import { z } from "zod";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES, type WorkspaceContext } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { SOURCE_BUCKET } from "./config";

/**
 * A material's life with adaptations (migration 033, docs/ADAPTATION.md § Material con adaptaciones):
 *   · before an analysis is replaced, an immutable copy is kept under its fingerprint, the one every earlier adaptation pinned;
 *   · «Retirar de la biblioteca» only hides it (reversible; adaptations, files and quotas untouched);
 *   · «Eliminar definitivamente» marks it, removes its stored files, then its rows. Each step can be repeated after a failure.
 */

/** Keeps the current analysis before a new one replaces it. Fails closed: without the copy, no re-analysis starts. */
export async function snapshotCurrentAnalysis(workspaceId: string, materialId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("materials").select("analysis, analysis_prompt_version").eq("workspace_id", workspaceId).eq("id", materialId).maybeSingle();
  if (error || !data) return false;
  const parsed = parseStoredAnalysis(data.analysis);
  // Nothing an adaptation could have pinned (no analysis, or one of an older contract): nothing to keep.
  if (!parsed.analysis || parsed.outdated) return true;
  const { error: insertError } = await admin.from("material_analysis_snapshots").upsert(
    { workspace_id: workspaceId, material_id: materialId, fingerprint: fingerprint(parsed.analysis), analysis: data.analysis, prompt_version: data.analysis_prompt_version ?? null },
    { onConflict: "material_id,fingerprint", ignoreDuplicates: true },
  );
  if (insertError) logger.error("analysis_snapshot_failed", { workspaceId, materialId });
  return !insertError;
}

export type LifecycleError = "forbidden" | "not_found" | "unexpected";

export async function setMaterialArchived(ctx: WorkspaceContext, materialId: string, archived: boolean): Promise<{ ok: true } | { ok: false; code: LifecycleError }> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };
  if (!z.uuid().safeParse(materialId).success) return { ok: false, code: "not_found" };
  const { error } = await (await getSupabase()).rpc("set_material_archived", { p_material: materialId, p_archived: archived });
  if (error) return { ok: false, code: error.message.includes("material_not_found") ? "not_found" : "unexpected" };
  return { ok: true };
}

/** What a definitive deletion would take with it, so the teacher sees it before confirming. Read with the teacher's rights. */
export async function deletionImpact(workspaceId: string, materialId: string): Promise<{ adaptations: number; delivered: number; versions: number; images: number } | null> {
  const supabase = await getSupabase();
  const { data: adaptations, error } = await supabase.from("adaptations").select("id, delivered_at").eq("workspace_id", workspaceId).eq("material_id", materialId);
  if (error) return null;
  const ids = (adaptations ?? []).map((a) => a.id as string);
  if (ids.length === 0) return { adaptations: 0, delivered: 0, versions: 0, images: 0 };
  const [versions, images] = await Promise.all([
    supabase.from("adaptation_versions").select("id", { count: "exact", head: true }).in("adaptation_id", ids),
    supabase.from("generated_assets").select("id", { count: "exact", head: true }).in("adaptation_id", ids),
  ]);
  return { adaptations: ids.length, delivered: (adaptations ?? []).filter((a) => a.delivered_at).length, versions: versions.count ?? 0, images: images.count ?? 0 };
}

const FilesSchema = z.object({
  adaptations: z.number().int().min(0),
  // Every bucket Adaptaula writes (migration 006): originals, generated images and crops, and persisted PDF exports (none today).
  files: z.array(z.object({ bucket: z.enum([SOURCE_BUCKET, "generated-assets", "exports"]), path: z.string().min(1) })),
});

export type PurgeError = LifecycleError | "confirmation_stale" | "busy" | "storage";

/**
 * «Eliminar definitivamente», material and adaptations. `expectedAdaptations` is the number the teacher saw and confirmed: if it
 * changed, nothing is deleted. Every stored path must belong to this workspace (built by the server under `<workspace>/…`).
 * A Storage failure leaves the material marked (hidden, nothing new starts on it) and the teacher can simply try again.
 */
export async function purgeMaterial(ctx: WorkspaceContext, materialId: string, expectedAdaptations: number): Promise<{ ok: true } | { ok: false; code: PurgeError }> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };
  if (!z.uuid().safeParse(materialId).success || !Number.isInteger(expectedAdaptations) || expectedAdaptations < 0) return { ok: false, code: "not_found" };
  const admin = createAdminClient();
  const begun = await admin.rpc("begin_material_deletion", { p_material: materialId, p_workspace: ctx.workspace.id, p_user: ctx.user.id, p_adaptations: expectedAdaptations });
  if (begun.error) {
    const m = begun.error.message;
    return { ok: false, code: m.includes("confirmation_stale") ? "confirmation_stale" : m.includes("material_busy") ? "busy" : m.includes("material_not_found") ? "not_found" : "unexpected" };
  }
  const plan = FilesSchema.safeParse(begun.data);
  if (!plan.success || plan.data.files.some((f) => f.path.split("/")[0] !== ctx.workspace.id || f.path.split("/").some((p) => !p || p === "." || p === ".."))) {
    logger.error("material_purge_paths_rejected", { workspaceId: ctx.workspace.id, materialId });
    return { ok: false, code: "unexpected" };
  }
  for (const bucket of [SOURCE_BUCKET, "generated-assets", "exports"] as const) {
    const paths = plan.data.files.filter((f) => f.bucket === bucket).map((f) => f.path);
    for (let i = 0; i < paths.length; i += 100) {
      // Removing an object that is already gone is not an error: a repeated deletion goes on from where it stopped.
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) {
        logger.warn("material_purge_storage_failed", { workspaceId: ctx.workspace.id, materialId, bucket });
        return { ok: false, code: "storage" };
      }
    }
  }
  const finished = await admin.rpc("finish_material_deletion", { p_material: materialId, p_workspace: ctx.workspace.id, p_user: ctx.user.id });
  if (finished.error) {
    logger.error("material_purge_rows_failed", { workspaceId: ctx.workspace.id, materialId });
    return { ok: false, code: "unexpected" };
  }
  logger.info("material_purged", { workspaceId: ctx.workspace.id, materialId, adaptations: plan.data.adaptations, files: plan.data.files.length });
  return { ok: true };
}
