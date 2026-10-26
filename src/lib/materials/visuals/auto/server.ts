import "server-only";
import { toAiRunRow } from "@/lib/ai/run-record";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { providerFor } from "@/lib/ai/runtime";
import { serverEnv } from "@/lib/config/env.server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveVisuals } from "../service";
import { visualAdmin, visualDeps } from "../server";
import type { VisualResolutionPlan } from "@/lib/adaptation/visual-policy";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { createVisualAssistants, type VisualAssistants } from "./assistants";
import { illustrate, type IllustrationRequest } from "../illustrate/service";
import { illustrationAvailability } from "../illustrate/server";
import { resolveMagicVisuals, type MagicVisualDeps } from "./policy";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { corroborateSpec, prepareVisuals, type AutoRunDeps, type AutoRunSummary } from "./service";
import { corroborateTable } from "./table";
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
      async retry(id) {
        const { data, error } = await admin.from("material_visual_autolocations").update({ status: "running", started_at: new Date().toISOString(), completed_at: null }).eq("id", id).eq("status", "completed").select("id");
        return !error && (data?.length ?? 0) > 0;
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

/**
 * The visual policy of «Hacer magia» for one assembled sheet: the automatic locator first (cached per material version), then the
 * rungs of `policy.ts`. Server job only (service role), after the adaptation authorised its material.
 */
export async function resolveAdaptationVisuals(input: { workspaceId: string; materialId: string; adaptationId: string; analysis: MaterialAnalysis; analysisFingerprint: string; document: MaterialDocument; requiredVisuals: readonly string[]; stage: string | null; grade: string | null; subject: string | null; functionalNeeds: readonly string[]; visualSupports?: boolean; deadline?: number | null }): Promise<VisualResolutionPlan> {
  const summary = await prepareAdaptationVisuals(input);
  const admin = createAdminClient();
  const { data: material } = await admin.from("materials").select("workspace_id, content_hash").eq("id", input.materialId).maybeSingle();
  const owned = material !== null && material.workspace_id === input.workspaceId;
  const deps = visualDeps(admin);
  // An automatic crop counts only if THIS engine accepted it in this material version (a busy or failed run trusts none).
  const accepted = "result" in summary && summary.result ? summary.result.visuals : {};
  const plan = await resolveMagicVisuals(
    {
      readyOriginals: async (ids) => {
        if (!owned || ids.length === 0) return new Set();
        const resolved = await resolveVisuals(deps, { materialId: input.materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256: material.content_hash, visualIds: ids });
        const trusted = (id: string) => resolved.states[id]?.provenance?.method === "human" || ["B", "C"].includes(accepted[id]?.choice ?? "");
        return new Set(ids.filter((id) => resolved.states[id]?.status === "ready" && trusted(id)));
      },
      corroborate: async (visual, activityTexts) => (owned ? corroborateSpec({ admin: visualAdmin(admin) }, { materialId: input.materialId, sourceSha256: material.content_hash, visual, activityTexts }) : null),
      corroborateTable: async (visual) => owned ? corroborateTable({ admin: visualAdmin(admin) }, { materialId: input.materialId, sourceSha256: material.content_hash, visual }) : null,
      assistants: productionAssistants(),
      ...(await productionIllustrate(input)),
      recordAiRun: async (run) => {
        const { error } = await admin.from("ai_runs").insert({ ...toAiRunRow(run, { workspaceId: input.workspaceId, jobId: null, materialId: input.materialId }), adaptation_id: input.adaptationId });
        if (error) logger.warn("ai_run_record_failed", { purpose: run.purpose, code: error.code ?? null });
      },
    },
    { analysis: input.analysis, document: input.document, requiredVisuals: input.requiredVisuals, stage: input.stage, grade: input.grade, subject: input.subject, functionalNeeds: input.functionalNeeds, visualSupports: input.visualSupports === true },
  );
  const count = (category: string) => plan.needs.filter((n) => n.category === category).length;
  logger.info("magic_visual_policy", { adaptationId: input.adaptationId, needs: plan.needs.length, located: count("exact_original_visual"), reconstructed: count("reconstructable_structured_visual"), generated: count("generatable_support_visual"), illustrated: count("generated_illustration"), rewritten: count("rewritable_without_visual"), substituted: count("substituted_activity"), unresolved: count("unresolved_visual") });
  return plan;
}

/**
 * Illustrations for this adaptation, when its workspace may have them (plan, quota, flag, credentials); otherwise why not, so an
 * honest stop can say «your plan does not include them». Each one must finish within the run (`deadline`): past it,
 * `IllustrationDeferred` retries the stage later, which keeps what was approved.
 */
async function productionIllustrate(input: { workspaceId: string; adaptationId: string; materialId: string; deadline?: number | null }): Promise<Pick<MagicVisualDeps, "illustrate" | "illustrationsWithheld" | "maxIllustrations">> {
  const availability = await illustrationAvailability({ workspaceId: input.workspaceId, adaptationId: input.adaptationId, materialId: input.materialId }).catch(() => ({ available: false as const, reason: "service" as const }));
  if (!availability.available) return { illustrate: null, illustrationsWithheld: availability.reason };
  const deps = availability.deps;
  return { ...(availability.perAdaptation !== null ? { maxIllustrations: availability.perAdaptation } : {}), illustrate: async (request: Omit<IllustrationRequest, "workspaceId" | "adaptationId" | "deadline">) => {
    const outcome = await illustrate(deps, { ...request, workspaceId: input.workspaceId, adaptationId: input.adaptationId, deadline: input.deadline ?? null });
    logger.info("illustration", { adaptationId: input.adaptationId, need: request.needKey, ok: outcome.ok, cached: outcome.ok ? outcome.cached : null, attempts: outcome.ok ? outcome.attempts : null, reason: outcome.ok ? null : outcome.reason });
    return outcome;
  } };
}

function productionAssistants(): VisualAssistants | null {
  try {
    const selection = resolveModel("STANDARD", serverEnv() as ModelEnv);
    if (selection.provider === "mock") return null;
    return createVisualAssistants(selection, providerFor(selection));
  } catch {
    return null;
  }
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
