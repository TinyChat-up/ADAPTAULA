import "server-only";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES, type WorkspaceContext } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { getMaterialDetail, getSubjects } from "@/lib/materials/repository";
import { labelsFor } from "@/lib/profiles/catalog";
import { getCatalog } from "@/lib/profiles/repository";
import { buildContextView, type AdaptationContextView } from "@/lib/adaptation/presentation/context";
import { getAdaptationPlan, getAdaptationStatus, type Actor, type AdaptationPlanDto } from "./service";
import { serviceDeps } from "./server";
import type { AdaptationStatusDto } from "./status";

export interface AdaptationPageData {
  status: AdaptationStatusDto;
  /** Only while the teacher has to review it: the plan is not needed (nor sent to the browser) in any other state. */
  plan: AdaptationPlanDto | null;
  context: AdaptationContextView;
  readyInfo: { version: number; createdAt: string } | null;
}

/**
 * First render of `/app/adaptaciones/[id]`, from the USER's client (RLS): another workspace's adaptation, a malformed id and a
 * missing one are all `null` (a 404). The browser receives plain data: the status DTO, the plan for the review and labels
 * derived from the stored analysis; never the generated document, prompts, model data or learner data.
 */
export async function loadAdaptationPage(ctx: WorkspaceContext, id: string): Promise<AdaptationPageData | null> {
  const supabase = await getSupabase();
  const deps = serviceDeps(supabase);
  const actor: Actor = { userId: ctx.user.id, workspaceId: ctx.workspace.id, canWrite: hasRole(ctx.role, WRITE_ROLES) };

  const statusResult = await getAdaptationStatus(deps, actor, id);
  if (!statusResult.ok) return null;
  const status = statusResult.data;
  const row = await deps.reader.getAdaptation(id);
  if (!row) return null;

  const [detail, catalog, subjects, planResult, version] = await Promise.all([
    getMaterialDetail(ctx.workspace.id, row.material_id),
    getCatalog(),
    getSubjects(),
    status.nextAction === "review_plan" && status.phase === "awaiting_review" ? getAdaptationPlan(deps, actor, id) : Promise.resolve(null),
    status.phase === "ready" && row.current_version > 0 ? deps.reader.getVersion(id, row.current_version) : Promise.resolve(null),
  ]);
  if (!detail) return null;

  const { material, analysis } = detail;
  const labels = labelsFor(catalog, material.stage_slug, material.grade_slug);
  return {
    status,
    plan: planResult?.ok ? planResult.data : null,
    context: buildContextView({
      materialId: material.id,
      title: material.title,
      stage: labels.stage,
      grade: labels.grade,
      subject: subjects.find((s) => s.slug === material.subject_slug)?.name ?? null,
      analysis,
    }),
    readyInfo: version ? { version: version.version, createdAt: version.created_at } : null,
  };
}

export interface AdaptationListItem {
  id: string;
  status: string;
  createdAt: string;
}

/** The adaptations of one material, newest first, from the user's client (RLS). Gives every adaptation a way back after a reload. */
export async function listMaterialAdaptations(materialId: string, limit = 10): Promise<AdaptationListItem[]> {
  const supabase = await getSupabase();
  const { data } = await supabase.from("adaptations").select("id, status, created_at").eq("material_id", materialId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((row) => ({ id: row.id, status: row.status, createdAt: row.created_at }));
}
