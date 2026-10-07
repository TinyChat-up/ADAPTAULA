"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { stageOfGrade } from "@/lib/analysis/context";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { formatDay } from "@/lib/format/date";
import { analysisQuotaMessage, describeServiceError } from "@/lib/materials/messages";
import { getMaterialDetail, getSubjects, updateMaterialContext } from "@/lib/materials/repository";
import { deleteMaterial, requestAnalysis } from "@/lib/materials/service";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { getCatalog } from "@/lib/profiles/repository";
import { fieldErrorsFrom } from "@/lib/schemas/auth";
import { MaterialContextInputSchema } from "@/lib/schemas/material";

export type MaterialActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Partial<Record<string, string>> };

const GENERIC = "No hemos podido guardar los cambios. Inténtalo de nuevo.";

export async function updateContextAction(materialId: string, input: unknown): Promise<MaterialActionResult> {
  const ctx = await requireWorkspace();
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, message: describeServiceError("forbidden") };

  const parsed = MaterialContextInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const value = parsed.data;

  const [detail, catalog, subjects] = await Promise.all([getMaterialDetail(ctx.workspace.id, materialId), getCatalog(), getSubjects()]);
  if (!detail) return { ok: false, message: describeServiceError("not_found") };

  const fieldErrors: Record<string, string> = {};
  if (value.stage_slug && !catalog.stages.some((s) => s.slug === value.stage_slug)) fieldErrors.stage_slug = "Elige una etapa de la lista.";
  if (value.grade_slug) {
    if (!catalog.grades.some((g) => g.slug === value.grade_slug)) fieldErrors.grade_slug = "Elige un curso de la lista.";
    else if (value.stage_slug && stageOfGrade(value.grade_slug) !== value.stage_slug) fieldErrors.grade_slug = "Elige un curso que pertenezca a la etapa.";
  }
  if (value.subject_slug && !subjects.some((s) => s.slug === value.subject_slug)) fieldErrors.subject_slug = "Elige una asignatura de la lista.";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, message: "Revisa los campos marcados.", fieldErrors };

  // A field counts as confirmed by the teacher as soon as they change it; untouched fields keep their provenance.
  const current = detail.material;
  const next = {
    title: value.title,
    stage: value.stage_slug || null,
    grade: value.grade_slug || null,
    subject: value.subject_slug || null,
    topic: value.topic || null,
  };
  const before = { title: current.title, stage: current.stage_slug, grade: current.grade_slug, subject: current.subject_slug, topic: current.topic };
  const confirmed = new Set(current.confirmed_fields);
  for (const field of Object.keys(next) as Array<keyof typeof next>) if (next[field] !== before[field]) confirmed.add(field);

  const saved = await updateMaterialContext(ctx.workspace.id, materialId, {
    title: next.title,
    stage_slug: next.stage,
    grade_slug: next.grade,
    subject_slug: next.subject,
    topic: next.topic,
    confirmed_fields: [...confirmed],
  });
  if (!saved) return { ok: false, message: GENERIC };
  revalidatePath(`/app/materiales/${materialId}`);
  revalidatePath("/app/materiales");
  return { ok: true };
}

/**
 * "Analizar", "Reintentar" and "Volver a analizar". Re-analyzing a material that already has an analysis is an explicit
 * request to ignore the cache (forceReanalysis); analyzing a pending or failed one may reuse an identical earlier analysis.
 * It only queues the job (fast): the progress screen this revalidation shows runs it at once (`/api/materials/[id]/analysis/run`).
 */
export async function retryAnalysisAction(materialId: string): Promise<MaterialActionResult> {
  const ctx = await requireWorkspace();
  const detail = await getMaterialDetail(ctx.workspace.id, materialId);
  if (!detail) return { ok: false, message: describeServiceError("not_found") };

  const requested = await requestAnalysis(ctx, materialId, { force: detail.material.status === "analyzed" });
  if (!requested.ok) {
    if (requested.code === "quota_exceeded") {
      const usage = await getWorkspaceUsage(ctx.workspace.id).catch(() => null);
      if (usage) return { ok: false, message: analysisQuotaMessage(usage.analyses.limit, formatDay(usage.period_end)) };
    }
    return { ok: false, message: describeServiceError(requested.code) };
  }
  revalidatePath(`/app/materiales/${materialId}`);
  revalidatePath("/app/materiales");
  return { ok: true };
}

export async function deleteMaterialAction(materialId: string): Promise<MaterialActionResult> {
  const ctx = await requireWorkspace();
  const result = await deleteMaterial(ctx, materialId);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === "has_adaptations"
          ? "Este material tiene adaptaciones. Elimínalas antes de borrar el material."
          : describeServiceError(result.code === "unexpected" ? "unexpected" : result.code),
    };
  }
  revalidatePath("/app/materiales");
  redirect("/app/materiales?aviso=eliminado");
}
