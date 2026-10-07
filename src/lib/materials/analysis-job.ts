import "server-only";
import { z } from "zod";
import { ANALYSIS_DEFAULTS } from "@/lib/ai/config";
import { activeAnalyzer, getAnalysisRuntime } from "@/lib/ai/runtime";
import { analyzeMaterialFile, type AnalyzeFile } from "@/lib/ai/pipeline/analyze";
import { AIError, jobFailureDecision, type FailureCode } from "@/lib/ai/errors";
import { toAiRunRow } from "@/lib/ai/run-record";
import type { AIRunRecord, ImageMediaType } from "@/lib/ai/types";
import { detectedContextUpdate } from "@/lib/analysis/context";
import { serverEnv } from "@/lib/config/env.server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { ANALYSIS_LIMITS } from "./config";
import { downloadSource } from "./storage";

const ClaimedJobSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  material_id: z.uuid(),
  attempts: z.number().int(),
  /** `force` is set when the teacher explicitly asked to ignore the cache. */
  input: z.object({ force: z.boolean().optional() }).passthrough().catch({}),
});

export const ANALYSIS_PROMPT_VERSION = () => {
  const analyzer = activeAnalyzer();
  return `${analyzer.key}@v${analyzer.version}`;
};

export type JobOutcome = "completed" | "failed" | "retry" | "skipped";

const IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * THE processor of an analysis job: runs it to a terminal or retry state. Safe to call from anywhere, any number of times: the
 * database lets exactly one caller claim a job at a time (lease), and a worker that lost its lease cannot overwrite the result of
 * the one that took over (attempt fencing). Callers: `processMaterialAnalysis` (the teacher's request, awaited) and
 * `recoverAnalysisJobs` (the daily recovery cron). The unit of quota was reserved when the job was enqueued, never here.
 */
export async function runAnalysisJob(jobId: string): Promise<JobOutcome> {
  const admin = createAdminClient();

  const { data: claimedRaw, error: claimError } = await admin.rpc("claim_analysis_job", {
    p_job: jobId,
    p_lease_seconds: ANALYSIS_LIMITS.leaseSeconds,
  });
  if (claimError) {
    logger.error("analysis_claim_failed", { jobId });
    return "skipped";
  }
  const claimed = ClaimedJobSchema.safeParse(claimedRaw);
  if (!claimed.success) return "skipped";
  const job = claimed.data;
  const ids = { jobId: job.id, workspaceId: job.workspace_id, materialId: job.material_id, attempt: job.attempts };

  const fail = async (code: FailureCode, retryable: boolean): Promise<JobOutcome> => {
    const { data } = await admin.rpc("fail_analysis_job", {
      p_job: job.id,
      p_attempt: job.attempts,
      p_code: code,
      p_retryable: retryable,
      p_backoff_seconds: ANALYSIS_LIMITS.retryBackoffSeconds,
    });
    logger.warn("analysis_job_failed", { ...ids, code, retryable, result: typeof data === "string" ? data : "unknown" });
    return data === "retry" ? "retry" : "failed";
  };

  try {
    const [materialRes, fileRes, subjectsRes, stagesRes, gradesRes] = await Promise.all([
      admin.from("materials").select("confirmed_fields, stage_slug, grade_slug, subject_slug, topic").eq("id", job.material_id).single(),
      admin.from("material_files").select("storage_path, mime_type, page_count").eq("material_id", job.material_id).eq("kind", "source").limit(1),
      admin.from("subjects").select("slug, name").eq("active", true),
      admin.from("stages").select("slug, name"),
      admin.from("grades").select("slug, name"),
    ]);
    const file = fileRes.data?.[0];
    if (materialRes.error || !materialRes.data) return await fail("unexpected", true);
    if (!file) return await fail("file_missing", false);

    const bytes = await downloadSource(file.storage_path);
    if (!bytes) return await fail("file_missing", false);

    const subjects = subjectsRes.data ?? [];
    const label = (rows: Array<{ slug: string; name: string }> | null, slug: string | null) => rows?.find((r) => r.slug === slug)?.name;
    const material = materialRes.data;
    const confirmed: string[] = material.confirmed_fields ?? [];
    // Only what the teacher has confirmed is passed on as trusted context.
    const teacherContext = {
      stage: confirmed.includes("stage") ? label(stagesRes.data, material.stage_slug) : undefined,
      grade: confirmed.includes("grade") ? label(gradesRes.data, material.grade_slug) : undefined,
      subject: confirmed.includes("subject") ? label(subjects, material.subject_slug) : undefined,
      topic: confirmed.includes("topic") ? (material.topic ?? undefined) : undefined,
    };

    const analyzeFile: AnalyzeFile =
      file.mime_type === "application/pdf"
        ? { kind: "pdf", data: bytes }
        : IMAGE_TYPES.includes(file.mime_type)
          ? { kind: "image", mediaType: file.mime_type as ImageMediaType, data: bytes }
          : (() => {
              throw new AIError("bad_request", "unsupported stored file type");
            })();

    const runtime = getAnalysisRuntime();
    const setStep = async (step: "analyzing" | "validating" | "saving", progress: number) => {
      await admin.from("adaptation_jobs").update({ step, progress }).eq("id", job.id).eq("attempts", job.attempts).eq("status", "processing");
    };

    const record = async (run: AIRunRecord) => {
      const { error } = await admin.from("ai_runs").insert(toAiRunRow(run, { workspaceId: job.workspace_id, jobId: job.id, materialId: job.material_id }));
      if (error) logger.error("ai_run_not_recorded", ids);
      if (run.issues?.length) logger.warn("analysis_output_invalid", { ...ids, attempt: run.attempt, kind: run.errorCode, issues: run.issues.slice(0, 6).join(" | ") });
    };

    const outcome = await analyzeMaterialFile({
      analyzer: runtime.analyzer,
      file: analyzeFile,
      pageCount: file.page_count ?? (analyzeFile.kind === "image" ? 1 : null),
      teacherContext,
      subjects,
      selection: runtime.selection,
      provider: runtime.provider,
      maxRepairAttempts: runtime.maxRepairAttempts,
      maxOutputTokens: runtime.maxOutputTokens,
      forcedReanalysis: job.input.force === true,
      deadlineAt: Date.now() + ANALYSIS_DEFAULTS.jobDeadlineMs,
      onRun: record,
      onStep: async (step) => setStep(step, step === "analyzing" ? 30 : 75),
    });

    await setStep("saving", 90);
    const catalog = {
      stages: new Set((stagesRes.data ?? []).map((s) => s.slug)),
      grades: new Set((gradesRes.data ?? []).map((g) => g.slug)),
      subjects: new Set(subjects.map((s) => s.slug)),
    };
    const { data: saved, error: saveError } = await admin.rpc("complete_analysis_job", {
      p_job: job.id,
      p_attempt: job.attempts,
      p_analysis: outcome.analysis as Record<string, unknown>,
      p_prompt_version: `${runtime.analyzer.key}@v${runtime.analyzer.version}`,
      p_meta: outcome.meta,
      p_context: detectedContextUpdate(outcome.canonical, confirmed, catalog),
    });
    if (saveError) return await fail("unexpected", true);
    if (saved !== true) {
      logger.warn("analysis_lease_lost", ids);
      return "skipped";
    }

    const threshold = serverEnv().MAX_SINGLE_JOB_COST_USD;
    if (outcome.meta.cost_usd !== null && outcome.meta.cost_usd > threshold) {
      logger.warn("analysis_cost_above_threshold", { ...ids, costUsd: outcome.meta.cost_usd, thresholdUsd: threshold });
    }
    logger.info("analysis_job_completed", { ...ids, costUsd: outcome.meta.cost_usd, attempts: outcome.meta.attempts });
    return "completed";
  } catch (error) {
    const decision = jobFailureDecision(error);
    logger.error("analysis_job_error", { ...ids, code: decision.code, retryable: decision.retryable });
    return await fail(decision.code, decision.retryable);
  }
}

/**
 * Runs the pending analysis of ONE material now and waits for it (`POST /api/materials/[id]/analysis/run`). `skipped` when there
 * is nothing to run: no pending job, another run holds it, or it is waiting out a retry backoff.
 */
export async function processMaterialAnalysis(materialId: string): Promise<JobOutcome> {
  const jobId = await findRecoverableJob(materialId);
  return jobId ? runAnalysisJob(jobId) : "skipped";
}

/**
 * Recovery only (daily cron): analysis jobs that nobody is running and that the teacher's own request did not finish (the
 * function died, the tab closed before it started, a retry backoff passed). Older than `minAgeSeconds`, so a job that a request
 * is about to run is left to it. A job with no attempts left is closed by the claim (and its unit refunded), never re-run.
 */
export async function recoverAnalysisJobs(options: { limit: number; minAgeSeconds: number }): Promise<{ found: number; outcomes: Record<JobOutcome, number> }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - options.minAgeSeconds * 1000).toISOString();
  const { data } = await admin
    .from("adaptation_jobs")
    .select("id, locked_until")
    .eq("kind", "analyze")
    .in("status", ["queued", "processing"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(options.limit * 5);
  const free = (data ?? []).filter((j) => (j.locked_until ? new Date(j.locked_until).getTime() : 0) <= Date.now()).slice(0, options.limit);
  const outcomes: Record<JobOutcome, number> = { completed: 0, failed: 0, retry: 0, skipped: 0 };
  for (const job of free) outcomes[await runAnalysisJob(job.id)] += 1;
  return { found: free.length, outcomes };
}

/** A job nobody is working on: waiting past its backoff, or whose lease expired (the worker died). */
export async function findRecoverableJob(materialId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("adaptation_jobs")
    .select("id, status, locked_until, attempts, max_attempts")
    .eq("material_id", materialId)
    .eq("kind", "analyze")
    .in("status", ["queued", "processing"])
    .limit(1);
  const job = data?.[0];
  if (!job) return null;
  const lockedUntil = job.locked_until ? new Date(job.locked_until).getTime() : 0;
  return lockedUntil <= Date.now() ? job.id : null;
}
