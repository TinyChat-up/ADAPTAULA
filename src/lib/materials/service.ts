import "server-only";
import { randomUUID } from "node:crypto";
import { activeAnalyzer } from "@/lib/ai/runtime";
import { detectedContextUpdate } from "@/lib/analysis/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES, type WorkspaceContext } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { logger } from "@/lib/logger";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { ANALYSIS_PROMPT_VERSION } from "./analysis-job";
import { pickReusableAnalysis } from "./cache";
import { ANALYSIS_LIMITS, FILE_TYPES, SOURCE_BUCKET, buildStoragePath, effectiveLimits, sanitizeOriginalName, titleFromFileName, type FileFormat } from "./config";
import { validateDeclaredFile, validateFileContent } from "./file-validation";
import type { ServiceError } from "./service-errors";
import { sha256Hex } from "./hash";
import { inspectPdf } from "./pdf";
import { createSignedUpload, downloadSource, removeSources } from "./storage";
import { getMaterialDetail } from "./repository";

export type { ServiceError };

export type InitResult =
  | { ok: true; materialId: string; path: string; token: string }
  | { ok: false; code: ServiceError };

export type CompleteResult =
  | { ok: true; status: "queued" | "analyzed" | "uploaded"; reused: boolean; jobId: string | null }
  | { ok: false; code: ServiceError };

const FORMAT_BY_MIME = Object.fromEntries(
  (Object.entries(FILE_TYPES) as [FileFormat, (typeof FILE_TYPES)[FileFormat]][]).map(([format, t]) => [t.mime, format]),
) as Record<string, FileFormat>;

async function rateAllowed(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rate_limit_allowed", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (error) {
    logger.error("rate_limit_check_failed", { key: key.split(":")[0] });
    return true; // fail open: abuse protection must not take the product down
  }
  return data === true;
}

/** Step 1: validate what the browser declares, create the records and hand out a one-time signed upload. */
export async function initUpload(ctx: WorkspaceContext, file: { name: string; size: number; mime: string }): Promise<InitResult> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };

  const usage = await getWorkspaceUsage(ctx.workspace.id);
  const declared = validateDeclaredFile(file, effectiveLimits(usage.features));
  if (!declared.ok) return declared;

  if (!(await rateAllowed(`upload:${ctx.user.id}`, 3600, ANALYSIS_LIMITS.uploadsPerUserPerHour))) return { ok: false, code: "rate_limited" };

  const type = FILE_TYPES[declared.format];
  const supabase = await getSupabase();
  const { data: material, error } = await supabase
    .from("materials")
    .insert({
      workspace_id: ctx.workspace.id,
      created_by: ctx.user.id,
      title: titleFromFileName(file.name),
      source_type: type.kind === "pdf" ? "pdf" : "image",
      status: "uploading",
    })
    .select("id")
    .single();
  if (error || !material) return { ok: false, code: "unexpected" };

  const path = buildStoragePath({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    materialId: material.id,
    fileId: randomUUID(),
    extension: type.extensions[0],
  });
  try {
    const { error: fileError } = await createAdminClient().from("material_files").insert({
      material_id: material.id,
      workspace_id: ctx.workspace.id,
      bucket: SOURCE_BUCKET,
      storage_path: path,
      mime_type: type.mime,
      size_bytes: Math.max(1, Math.floor(file.size)),
      original_name: sanitizeOriginalName(file.name),
      kind: "source",
    });
    if (fileError) throw new Error("file row");
    const { token } = await createSignedUpload(path);
    return { ok: true, materialId: material.id, path, token };
  } catch {
    await supabase.from("materials").delete().eq("id", material.id);
    return { ok: false, code: "unexpected" };
  }
}

/** Removes a rejected upload completely: stored object and records. */
async function discardUpload(materialId: string, path: string | null) {
  if (path) await removeSources([path]);
  const supabase = await getSupabase();
  await supabase.from("materials").delete().eq("id", materialId);
}

/**
 * Step 2, after the browser has uploaded: validate the BYTES (never the declared type or size), hash them,
 * and either reuse an earlier analysis of the same file in this workspace or queue a new one.
 */
export async function completeUpload(ctx: WorkspaceContext, materialId: string): Promise<CompleteResult> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };
  const detail = await getMaterialDetail(ctx.workspace.id, materialId);
  if (!detail || !detail.file) return { ok: false, code: "not_found" };

  // Idempotent: a repeated call (double click, reload) reports where the material already is.
  if (detail.material.status !== "uploading") {
    const status = detail.material.status;
    return { ok: true, status: status === "analyzed" ? "analyzed" : status === "uploaded" ? "uploaded" : "queued", reused: false, jobId: null };
  }

  const usage = await getWorkspaceUsage(ctx.workspace.id);
  const limits = effectiveLimits(usage.features);
  const { file } = detail;

  const bytes = await downloadSource(file.storage_path);
  if (!bytes) {
    await discardUpload(materialId, null);
    return { ok: false, code: "not_found" };
  }

  const declaredFormat = FORMAT_BY_MIME[file.mime_type];
  const content = declaredFormat ? validateFileContent(bytes, declaredFormat, limits) : ({ ok: false, code: "unsupported_type" } as const);
  if (!content.ok) {
    await discardUpload(materialId, file.storage_path);
    return content;
  }

  let pages = 1;
  if (content.kind === "pdf") {
    const inspection = await inspectPdf(bytes);
    if (!inspection.ok) {
      await discardUpload(materialId, file.storage_path);
      return inspection;
    }
    if (inspection.pages > limits.maxPages) {
      await discardUpload(materialId, file.storage_path);
      return { ok: false, code: "too_many_pages" };
    }
    pages = inspection.pages;
  }

  const hash = sha256Hex(bytes);
  const admin = createAdminClient();
  await admin.from("material_files").update({ size_bytes: bytes.length, page_count: pages }).eq("id", file.id);
  const { error: markError } = await admin
    .from("materials")
    .update({ status: "uploaded", content_hash: hash, page_count: pages })
    .eq("id", materialId)
    .eq("status", "uploading");
  if (markError) return { ok: false, code: "unexpected" };

  const requested = await requestAnalysis(ctx, materialId, { force: false, contentHash: hash });
  if (requested.ok) {
    return requested.kind === "reused"
      ? { ok: true, status: "analyzed", reused: true, jobId: null }
      : { ok: true, status: "queued", reused: false, jobId: requested.jobId };
  }
  // The file is valid and stored: running out of quota or capacity only postpones the analysis.
  const postponable: ServiceError[] = ["rate_limited", "too_many_active", "quota_exceeded"];
  return postponable.includes(requested.code) ? { ok: true, status: "uploaded", reused: false, jobId: null } : requested;
}

/**
 * Reuses an earlier analysis of byte-identical content ONLY from the same workspace (so the existence of
 * other users' files can never be inferred) and only when produced by the current prompt and schema.
 */
async function tryReuseAnalysis(ctx: WorkspaceContext, materialId: string, hash: string): Promise<boolean> {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("materials")
    .select("id, status, analysis_prompt_version, analysis, analysis_meta")
    .eq("workspace_id", ctx.workspace.id)
    .eq("content_hash", hash)
    .neq("id", materialId)
    .order("created_at", { ascending: false })
    .limit(10);
  const reusable = pickReusableAnalysis(data ?? [], { promptVersion: ANALYSIS_PROMPT_VERSION(), schemaVersion: activeAnalyzer().schemaVersion });
  if (!reusable) return false;
  const source = { id: reusable.sourceId };
  const analysis = { data: reusable.analysis };
  const meta = { data: reusable.meta };

  const admin = createAdminClient();
  const [stages, grades, subjects] = await Promise.all([
    admin.from("stages").select("slug"),
    admin.from("grades").select("slug"),
    admin.from("subjects").select("slug").eq("active", true),
  ]);
  const detected = detectedContextUpdate(analysis.data, [], {
    stages: new Set((stages.data ?? []).map((s) => s.slug)),
    grades: new Set((grades.data ?? []).map((g) => g.slug)),
    subjects: new Set((subjects.data ?? []).map((s) => s.slug)),
  });

  const { error } = await admin
    .from("materials")
    .update({
      analysis: reusable.stored,
      analysis_prompt_version: ANALYSIS_PROMPT_VERSION(),
      analysis_meta: { ...meta.data, source: "reused", cache_hit: true, forced_reanalysis: false, reused_from_material_id: source.id, cost_usd: 0, attempts: 0 },
      status: "analyzed",
      failure_code: null,
      ...(detected.title ? { title: detected.title } : {}),
      ...(detected.stage ? { stage_slug: detected.stage } : {}),
      ...(detected.grade ? { grade_slug: detected.grade } : {}),
      ...(detected.subject ? { subject_slug: detected.subject } : {}),
      ...(detected.topic ? { topic: detected.topic } : {}),
    })
    .eq("id", materialId)
    .in("status", ["uploaded", "failed"]);
  if (error) return false;
  logger.info("analysis_reused", { workspaceId: ctx.workspace.id, materialId, sourceMaterialId: source.id });
  return true;
}

export type QueueResult = { ok: true; jobId: string } | { ok: false; code: ServiceError };

export type RequestResult = { ok: true; kind: "reused" } | { ok: true; kind: "queued"; jobId: string } | { ok: false; code: ServiceError };

/**
 * The single server-side entry point to get a material analyzed.
 * - `force: false`: an earlier analysis of byte-identical content in this workspace, made by the current prompt and schema,
 *   is reused (cache hit: no model call, no quota). Otherwise a new analysis is queued.
 * - `force: true` (forceReanalysis): the cache is ignored on purpose and a new analysis is queued. It spends one unit of
 *   the monthly analysis quota like any other model call.
 * The unit is reserved atomically by the database when the job is created and returned if the job ends without a result.
 */
export async function requestAnalysis(ctx: WorkspaceContext, materialId: string, input: { force: boolean; contentHash?: string }): Promise<RequestResult> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };

  if (!input.force) {
    let hash = input.contentHash;
    if (!hash) {
      const supabase = await getSupabase();
      const { data } = await supabase.from("materials").select("content_hash").eq("workspace_id", ctx.workspace.id).eq("id", materialId).maybeSingle();
      hash = data?.content_hash ?? undefined;
    }
    if (hash && (await tryReuseAnalysis(ctx, materialId, hash))) return { ok: true, kind: "reused" };
  }

  const queued = await queueAnalysis(ctx, materialId, { force: input.force });
  return queued.ok ? { ok: true, kind: "queued", jobId: queued.jobId } : queued;
}

/** Queues an analysis (new, retry or explicit re-analysis). The database makes this idempotent. */
export async function queueAnalysis(ctx: WorkspaceContext, materialId: string, input: { force?: boolean }): Promise<QueueResult> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };
  if (!(await rateAllowed(`analyze:${ctx.workspace.id}`, 3600, ANALYSIS_LIMITS.analysesPerWorkspacePerHour))) return { ok: false, code: "rate_limited" };

  const { data, error } = await createAdminClient().rpc("enqueue_analysis_job", {
    p_material: materialId,
    p_requested_by: ctx.user.id,
    p_input: { force: input.force === true, prompt_version: activeAnalyzer().version },
    p_max_active: ANALYSIS_LIMITS.maxActivePerWorkspace,
  });
  if (error) {
    if (error.message.includes("analysis_limit_reached")) return { ok: false, code: "too_many_active" };
    if (error.message.includes("analysis_quota_exceeded")) return { ok: false, code: "quota_exceeded" };
    if (error.message.includes("material_not_found")) return { ok: false, code: "not_found" };
    logger.error("enqueue_failed", { workspaceId: ctx.workspace.id, materialId });
    return { ok: false, code: "unexpected" };
  }
  return { ok: true, jobId: String(data) };
}

export type DeleteResult = { ok: true } | { ok: false; code: "forbidden" | "not_found" | "has_adaptations" | "unexpected" };

/**
 * Deletes a material and its stored file. The order matters for privacy: authorize, remove the file,
 * then the row (its jobs cascade). A material that already has adaptations is NOT deleted silently:
 * the database refuses (ON DELETE RESTRICT) and the teacher is told to remove those first.
 */
export async function deleteMaterial(ctx: WorkspaceContext, materialId: string): Promise<DeleteResult> {
  if (!hasRole(ctx.role, WRITE_ROLES)) return { ok: false, code: "forbidden" };
  const detail = await getMaterialDetail(ctx.workspace.id, materialId);
  if (!detail) return { ok: false, code: "not_found" };

  const supabase = await getSupabase();
  const { count } = await supabase.from("adaptations").select("id", { count: "exact", head: true }).eq("material_id", materialId);
  if ((count ?? 0) > 0) return { ok: false, code: "has_adaptations" };

  if (detail.file && !(await removeSources([detail.file.storage_path]))) {
    logger.error("material_file_not_removed", { workspaceId: ctx.workspace.id, materialId });
    return { ok: false, code: "unexpected" };
  }
  const { data, error } = await supabase.from("materials").delete().eq("workspace_id", ctx.workspace.id).eq("id", materialId).select("id");
  if (error) return { ok: false, code: error.code === "23503" ? "has_adaptations" : "unexpected" };
  return (data?.length ?? 0) > 0 ? { ok: true } : { ok: false, code: "not_found" };
}
