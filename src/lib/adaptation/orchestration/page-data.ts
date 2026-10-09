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
import { listState, type ListState } from "@/lib/adaptation/presentation/list";
import type { AdaptationStatusDto } from "./status";
import { loadRenderInput, loadRenderInputWith } from "@/lib/render/load";
import { readinessOf } from "@/lib/render/readiness";
import { visualDeps } from "@/lib/materials/visuals/server";
import { resourceDeps } from "@/lib/adaptation/resources/server";

export interface AdaptationPageData {
  status: AdaptationStatusDto;
  /** Only while the teacher has to review it: the plan is not needed (nor sent to the browser) in any other state. */
  plan: AdaptationPlanDto | null;
  context: AdaptationContextView;
  /**
   * `printable`: what the PDF and the student view accept (`readinessOf`). `visualsPending`: essential visuals still to locate or to
   * provide. A delivered sheet that is not printable is never presented as «lista».
   */
  readyInfo: { version: number; createdAt: string; visualsPending: number; printable: boolean } | null;
  /** The teacher's alias for the profile, for the page header only. Null when the profile was deleted. */
  profileName: string | null;
  /** Read-only members see every state but no command (they would be refused on the server anyway). */
  canWrite: boolean;
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

  const [detail, catalog, subjects, planResult, version, profileName] = await Promise.all([
    getMaterialDetail(ctx.workspace.id, row.material_id),
    getCatalog(),
    getSubjects(),
    status.nextAction === "review_plan" && status.phase === "awaiting_review" ? getAdaptationPlan(deps, actor, id) : Promise.resolve(null),
    status.phase === "ready" && row.current_version > 0 ? deps.reader.getVersion(id, row.current_version) : Promise.resolve(null),
    profileNameOf(supabase, id),
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
    readyInfo: version ? { version: version.version, createdAt: version.created_at, ...(await readiness(ctx, id)) } : null,
    profileName,
    canWrite: actor.canWrite,
  };
}

async function profileNameOf(supabase: Awaited<ReturnType<typeof getSupabase>>, adaptationId: string): Promise<string | null> {
  const { data } = await supabase.from("adaptations").select("learner_profile_id").eq("id", adaptationId).maybeSingle();
  if (!data?.learner_profile_id) return null;
  const { data: profile } = await supabase.from("learner_profiles").select("display_name").eq("id", data.learner_profile_id).maybeSingle();
  return (profile?.display_name as string | undefined) ?? null;
}

export interface AdaptationListItem {
  id: string;
  materialTitle: string;
  /** The teacher's own alias for the profile (shown only to the workspace, never sent anywhere). Null when it was deleted. */
  profileName: string | null;
  createdAt: string;
  updatedAt: string;
  state: ListState;
}

/**
 * Adaptations of the workspace (optionally of one material or one profile), newest activity first, from the USER's client (RLS):
 * another workspace's rows are simply not there. Whether a stage is running comes from the visible jobs, so an adaptation waiting
 * for the teacher's «Empezar» or «Crear ficha» is never shown as in progress.
 */
export async function listAdaptations(filter: { materialId?: string; profileId?: string; limit?: number } = {}): Promise<AdaptationListItem[]> {
  const supabase = await getSupabase();
  let query = supabase.from("adaptations").select("id, status, created_at, updated_at, material_id, learner_profile_id, creation_mode");
  if (filter.materialId) query = query.eq("material_id", filter.materialId);
  if (filter.profileId) query = query.eq("learner_profile_id", filter.profileId);
  const { data: rows } = await query.order("updated_at", { ascending: false }).limit(filter.limit ?? 50);
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.id as string);
  const materialIds = [...new Set(rows.map((r) => r.material_id as string))];
  const profileIds = [...new Set(rows.map((r) => r.learner_profile_id as string | null).filter((v): v is string => Boolean(v)))];
  const automaticAwaiting = rows.filter((r) => r.creation_mode === "automatic" && r.status === "awaiting_plan_review").map((r) => r.id as string);
  const [jobs, materials, profiles, reviewed] = await Promise.all([
    supabase.from("adaptation_jobs").select("adaptation_id").in("adaptation_id", ids).in("status", ["queued", "processing"]),
    supabase.from("materials").select("id, title").in("id", materialIds),
    profileIds.length ? supabase.from("learner_profiles").select("id, display_name").in("id", profileIds) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
    automaticAwaiting.length ? supabase.from("adaptation_artifacts").select("adaptation_id").eq("kind", "plan_review").in("adaptation_id", automaticAwaiting) : Promise.resolve({ data: [] as Array<{ adaptation_id: string }> }),
  ]);
  const hasReview = new Set((reviewed.data ?? []).map((a) => a.adaptation_id as string));
  // A delivered sheet still waiting for an essential visual reads «casi lista» here too, like its own page and its PDF.
  const pendingIds = await pendingDelivered(supabase, rows.filter((r) => r.status === "ready").map((r) => r.id as string));
  const running = new Set((jobs.data ?? []).map((j) => j.adaptation_id as string));
  const titles = new Map((materials.data ?? []).map((m) => [m.id as string, m.title as string]));
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, p.display_name as string]));
  return rows.map((r) => ({
    id: r.id as string,
    materialTitle: titles.get(r.material_id as string) ?? "Material",
    profileName: r.learner_profile_id ? (names.get(r.learner_profile_id as string) ?? null) : null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    state: listState(r.status as string, running.has(r.id as string), automaticAwaiting.includes(r.id as string) && !hasReview.has(r.id as string), pendingIds.has(r.id as string)),
  }));
}

/** The same reading of the sheet the viewer and the PDF make (`readinessOf`): never a separate, divergent rule. */
async function readiness(ctx: WorkspaceContext, id: string): Promise<{ visualsPending: number; printable: boolean }> {
  const loaded = await loadRenderInput(ctx, id);
  if (loaded.kind !== "ok") return { visualsPending: 0, printable: false };
  const r = readinessOf(loaded);
  return { visualsPending: r.pendingResources, printable: r.printable };
}

/** Ready adaptations whose sheet cannot be printed yet (`readinessOf`, counted from rows: lists do not download every object). */
async function pendingDelivered(supabase: Awaited<ReturnType<typeof getSupabase>>, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data: auth } = await supabase.auth.getUser();
  const { data: rows } = await supabase.from("adaptations").select("id, workspace_id").in("id", ids);
  const deps = serviceDeps(supabase);
  const visuals = visualDeps(supabase);
  const resources = resourceDeps(supabase);
  const pending = await Promise.all(
    (rows ?? []).map(async (row) => {
      const actor: Actor = { userId: auth.user?.id ?? "", workspaceId: row.workspace_id as string, canWrite: false };
      const loaded = await loadRenderInputWith(deps, actor, row.id as string, visuals, { resources, verify: false });
      return loaded.kind === "ok" && !readinessOf(loaded).printable ? (row.id as string) : null;
    }),
  );
  return new Set(pending.filter((x): x is string => x !== null));
}
