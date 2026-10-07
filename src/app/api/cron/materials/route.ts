import "server-only";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env.server";
import { logger } from "@/lib/logger";
import { recoverAnalysisJobs } from "@/lib/materials/analysis-job";
import { ANALYSIS_LIMITS, SOURCE_BUCKET } from "@/lib/materials/config";
import { createAdminClient } from "@/lib/supabase/admin";

// A recovered analysis runs inside this request (its own deadline is 270 s).
export const maxDuration = 300;

/** Analyses that nobody finished for this long are recovered; younger ones belong to the teacher's own request. */
const RECOVERY_MIN_AGE_SECONDS = 600;
const RECOVERY_LIMIT = 1;

/**
 * Daily RECOVERY and housekeeping, never the normal path (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). User-triggered
 * analyses run immediately in the teacher's own request; this only:
 *   · recovers analysis jobs nobody finished (the function died, the tab closed before the run started, a backoff ended unseen),
 *     with the same processor (`runAnalysisJob`): atomic claim, attempts and refunds unchanged;
 *   · removes uploads that never completed (file and rows), so nothing stays orphaned in private storage.
 */
export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - ANALYSIS_LIMITS.staleUploadMinutes * 60_000).toISOString();
  const { data: stale, error } = await admin.from("materials").select("id").eq("status", "uploading").lt("created_at", cutoff).limit(200);
  if (error) return NextResponse.json({ error: { code: "query_failed" } }, { status: 500 });

  let removed = 0;
  for (const material of stale ?? []) {
    const { data: files } = await admin.from("material_files").select("storage_path").eq("material_id", material.id);
    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from(SOURCE_BUCKET).remove(paths);
      if (removeError) {
        logger.error("stale_upload_file_not_removed", { materialId: material.id });
        continue;
      }
    }
    await admin.from("materials").delete().eq("id", material.id).eq("status", "uploading");
    removed += 1;
  }
  logger.info("stale_uploads_cleaned", { removed });

  const recovered = await recoverAnalysisJobs({ limit: RECOVERY_LIMIT, minAgeSeconds: RECOVERY_MIN_AGE_SECONDS });
  logger.info("analysis_jobs_recovered", { found: recovered.found, ...recovered.outcomes });
  return NextResponse.json({ removed, recovered });
}
