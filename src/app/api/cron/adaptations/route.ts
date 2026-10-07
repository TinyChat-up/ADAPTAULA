import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env.server";
import { logger } from "@/lib/logger";
import { orchestratorDeps } from "@/lib/adaptation/orchestration/server";
import { runAdaptationWorkerCycle } from "@/lib/adaptation/orchestration/worker";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily RECOVERY entry, never the normal path (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; a developer may POST the
 * same). User-triggered stages run immediately in the teacher's own request (`POST /api/adaptations/[id]/run`); this only finds
 * what nobody finished: adaptations in a state that needs a job and have none (the reconciler), and jobs nobody is running (past
 * their backoff, or with an expired lease), with the same processor. Completed, held, ambiguous or non-retryable jobs are never
 * re-run. It uses no user session and answers 401 to anyone without the secret, which is never logged. Safe to call twice or
 * concurrently (atomic claim + idempotent enqueue). The response carries counts only, no content.
 */
async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const env = serverEnv();
  const result = await runAdaptationWorkerCycle(orchestratorDeps(), { limit: env.ADAPTATION_JOBS_PER_RUN, minAgeSeconds: env.ADAPTATION_RECONCILE_MIN_AGE_SECONDS });
  logger.info("adaptation_worker_cycle", { ...result.processed, planningEnqueued: result.reconciled.planningEnqueued, generationEnqueued: result.reconciled.generationEnqueued });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
