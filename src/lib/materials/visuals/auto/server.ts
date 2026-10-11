import "server-only";
import { toAiRunRow } from "@/lib/ai/run-record";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { providerFor } from "@/lib/ai/runtime";
import { serverEnv } from "@/lib/config/env.server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { visualAdmin } from "../server";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { prepareVisuals, type AutoRunDeps, type AutoRunSummary } from "./service";
import { createVisionLocator, type VisionLocator } from "./vision";

/**
 * Production `AutoRunDeps`: service role only, used by a server job (an adaptation's generation, or the teacher's explicit
 * request through an authorised route) AFTER the material was authorised by its adaptation. Nothing here is reachable from the
 * browser.
 */
export function autoRunDeps(): AutoRunDeps {
  const admin = createAdminClient();
  return {
    admin: visualAdmin(admin),
    runs: {
      async claim(k) {
        const { data, error } = await admin.rpc("claim_visual_autolocation", { p_workspace: k.workspaceId, p_material: k.materialId, p_analysis: k.analysisFingerprint, p_source: k.sourceSha256, p_engine: k.engine });
        if (error || !data) throw new Error("claim_failed");
        return data as { id: string; claimed: boolean; status: "running" | "completed" | "failed"; result: unknown };
      },
      async complete(id, status, result, visionCalls) {
        await admin.from("material_visual_autolocations").update({ status, result, vision_calls: visionCalls, completed_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
      },
    },
    specs: {
      async exists(locatorId, extractor) {
        const { data } = await admin.from("material_visual_specs").select("id").eq("locator_id", locatorId).eq("extractor_version", extractor).limit(1);
        return (data?.length ?? 0) > 0;
      },
      async insert(row) {
        const { error } = await admin.from("material_visual_specs").insert(row);
        // A concurrent producer stored the same reconstruction: the expected outcome.
        if (error && error.code !== "23505") throw new Error("spec_insert_failed");
      },
    },
    vision: productionVision(),
    async recordAiRun(run, ids) {
      const { error } = await admin.from("ai_runs").insert({ ...toAiRunRow(run, { workspaceId: ids.workspaceId, jobId: null, materialId: ids.materialId }), adaptation_id: ids.adaptationId });
      if (error) logger.warn("ai_run_record_failed", { purpose: run.purpose, code: error.code ?? null });
    },
  };
}

/**
 * The automatic preparation for one adaptation's material (its pinned analysis and the material's current original). The
 * material is read with the service role and checked against the adaptation's workspace. Logs counts and codes only.
 */
export async function prepareAdaptationVisuals(input: { workspaceId: string; materialId: string; adaptationId: string; analysis: MaterialAnalysis; analysisFingerprint: string }): Promise<AutoRunSummary> {
  const { data: material } = await createAdminClient().from("materials").select("workspace_id, content_hash").eq("id", input.materialId).maybeSingle();
  if (!material || material.workspace_id !== input.workspaceId) return { status: "nothing_to_locate" };
  const summary = await prepareVisuals(autoRunDeps(), { ...input, sourceSha256: material.content_hash });
  const outcomes = "result" in summary && summary.result ? Object.values(summary.result.visuals) : [];
  const count = (choice: string) => outcomes.filter((o) => o.choice === choice).length;
  logger.info("automatic_visuals", { adaptationId: input.adaptationId, status: summary.status, kept: count("A"), located: count("B"), reconstructed: count("C"), unresolved: count("D"), visionPages: "result" in summary && summary.result ? summary.result.vision_pages : 0 });
  return summary;
}

/** The vision fallback through the STANDARD alias, or none (no real provider configured: geometry only). */
function productionVision(): VisionLocator | null {
  try {
    const env = serverEnv();
    const selection = resolveModel("STANDARD", env as ModelEnv);
    if (selection.provider === "mock") return null;
    return createVisionLocator(selection, providerFor(selection));
  } catch {
    return null;
  }
}
