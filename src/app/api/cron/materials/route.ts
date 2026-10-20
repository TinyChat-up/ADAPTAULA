import "server-only";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env.server";
import { logger } from "@/lib/logger";
import { recoverAnalysisJobs } from "@/lib/materials/analysis-job";
import { runUploadCleanups, uploadCleanupDeps } from "@/lib/materials/upload-cleanup";

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

  let cleanup: Awaited<ReturnType<typeof runUploadCleanups>>;
  try { cleanup = await runUploadCleanups(uploadCleanupDeps()); }
  catch {
    logger.error("upload_cleanup_claim_failed", {});
    return NextResponse.json({ error: { code: "cleanup_unavailable" } }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  logger.info("stale_uploads_cleaned", cleanup);

  const recovered = await recoverAnalysisJobs({ limit: RECOVERY_LIMIT, minAgeSeconds: RECOVERY_MIN_AGE_SECONDS });
  logger.info("analysis_jobs_recovered", { found: recovered.found, ...recovered.outcomes });
  return NextResponse.json({ removed: cleanup.removed, cleanup, recovered }, { headers: { "Cache-Control": "private, no-store" } });
}
