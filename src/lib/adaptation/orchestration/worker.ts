import "server-only";
import { logger } from "@/lib/logger";
import { enqueueGeneration, enqueuePlanning, latestReviewFingerprint, runGenerationStage, runPlanningStage, type OrchestratorDeps, type StageOutcome } from "./orchestrator";
import type { StageName } from "./store";

/**
 * Running the durable stage jobs. It adds NO domain logic: the stages are `runPlanningStage` / `runGenerationStage` (which claim the
 * job atomically with its lease, fence every write by attempt, record `ai_runs`, and complete or fail the job). Two callers, ONE
 * processor (`runStageJob`):
 *   · `processAdaptationStage` — the normal path: the teacher's own request runs its adaptation's pending stage right away, awaited
 *     (`POST /api/adaptations/[id]/run`). A second request, another tab or the cron racing it cannot run it twice: only one claim wins.
 *   · `runAdaptationWorkerCycle` — recovery only (daily cron, developer script): jobs nobody is running (queued past their backoff,
 *     or with an expired lease) and adaptations in a state that needs a job and have none (the reconciler).
 * Nothing here relies on the process staying alive after a response: whatever is not finished is a durable job found again later.
 */

export interface WorkerSummary {
  claimed: number;
  completed: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
  /** Attempts whose outcome is unknown: never retried automatically. */
  ambiguous: number;
  /** Waiting for a person (stale review, unsupported execution, …). */
  humanActionRequired: number;
  rejected: number;
  errors: number;
}

const emptySummary = (): WorkerSummary => ({ claimed: 0, completed: 0, retryScheduled: 0, failed: 0, skipped: 0, ambiguous: 0, humanActionRequired: 0, rejected: 0, errors: 0 });

function tally(summary: WorkerSummary, outcome: StageOutcome) {
  switch (outcome.outcome) {
    case "completed":
      summary.completed += 1;
      break;
    case "retry":
      summary.retryScheduled += 1;
      break;
    case "failed":
      summary.failed += 1;
      break;
    case "human_action_required":
      if (outcome.code === "ambiguous_attempt") summary.ambiguous += 1;
      else summary.humanActionRequired += 1;
      break;
    case "rejected":
      summary.rejected += 1;
      break;
    default:
      summary.skipped += 1;
  }
}

export interface ProcessOptions {
  /** Jobs claimed per invocation. Small on purpose: each one can be a long model call. */
  limit: number;
  /** Restrict the batch to these adaptations (a developer running one adaptation, tests). Absent = any claimable job. */
  adaptationIds?: readonly string[];
}

/** The one processor of a stage job, whoever calls it. The stage functions claim the job themselves: a held job is `skipped`. */
async function runStageJob(deps: OrchestratorDeps, adaptationId: string, stage: StageName): Promise<StageOutcome> {
  if (stage === "planning") return runPlanningStage(deps, adaptationId);
  const review = await latestReviewFingerprint(deps.store, adaptationId);
  return review ? runGenerationStage(deps, adaptationId, review) : { outcome: "rejected", status: "generation_queued", code: "plan_review_required" };
}

/**
 * Runs the pending stage of ONE adaptation now and waits for it (the teacher's request). Null: there is no pending job (nothing was
 * enqueued, or it already finished). Waiting out a retry backoff, held by another run, or with no attempts left → `skipped`, and
 * no provider is called.
 */
export async function processAdaptationStage(deps: OrchestratorDeps, adaptationId: string): Promise<StageOutcome | null> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  const job = snapshot?.jobs.find((j) => j.status === "queued" || j.status === "processing");
  if (!job) return null;
  const outcome = await runStageJob(deps, adaptationId, job.stage);
  logger.info("adaptation_job_processed", { jobId: job.id, adaptationId, stage: job.stage, outcome: outcome.outcome, code: outcome.code ?? null, status: outcome.status, trigger: "request" });
  return outcome;
}

export async function processAdaptationJobs(deps: OrchestratorDeps, options: ProcessOptions): Promise<WorkerSummary> {
  const summary = emptySummary();
  const scope = options.adaptationIds ? new Set(options.adaptationIds) : null;
  const listed = await deps.store.listClaimableJobs(scope ? 200 : options.limit);
  const jobs = (scope ? listed.filter((j) => scope.has(j.adaptationId)) : listed).slice(0, options.limit);
  for (const job of jobs) {
    summary.claimed += 1;
    const ids = { jobId: job.jobId, adaptationId: job.adaptationId, stage: job.stage };
    try {
      const outcome = await runStageJob(deps, job.adaptationId, job.stage);
      tally(summary, outcome);
      logger.info("adaptation_job_processed", { ...ids, outcome: outcome.outcome, code: outcome.code ?? null, status: outcome.status, trigger: "recovery" });
    } catch (error) {
      summary.errors += 1;
      logger.error("adaptation_job_error", { ...ids, reason: error instanceof Error ? error.name : "unknown" });
    }
  }
  return summary;
}

export interface ReconcileSummary {
  planningEnqueued: number;
  generationEnqueued: number;
  alreadyHadJob: number;
  rejected: number;
}

/**
 * Finds adaptations whose state needs a durable job and that have none: `queued` (planning) and `generation_queued` (generation).
 * It never touches `awaiting_plan_review`, `blocked`, `failed`, `cancelled` or `ready` (they wait for a person or are over),
 * so it cannot skip the human gate, revive a cancelled adaptation or retry a failure that must not be retried. Idempotent.
 */
export async function reconcileAdaptationJobs(deps: OrchestratorDeps, options: { minAgeSeconds: number; limit: number; adaptationIds?: readonly string[] }): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { planningEnqueued: 0, generationEnqueued: 0, alreadyHadJob: 0, rejected: 0 };
  const scope = options.adaptationIds ? new Set(options.adaptationIds) : null;
  const listed = await deps.store.listAdaptationsNeedingJob(options.minAgeSeconds, scope ? 200 : options.limit);
  const candidates = (scope ? listed.filter((c) => scope.has(c.adaptationId)) : listed).slice(0, options.limit);
  for (const candidate of candidates) {
    try {
      const outcome = candidate.stage === "planning" ? await enqueuePlanning(deps, candidate.adaptationId) : await enqueueGeneration(deps, candidate.adaptationId);
      if (outcome.outcome === "enqueued" && !outcome.reusedJob) summary[candidate.stage === "planning" ? "planningEnqueued" : "generationEnqueued"] += 1;
      else if (outcome.outcome === "enqueued" || outcome.outcome === "reused") summary.alreadyHadJob += 1;
      else summary.rejected += 1;
      logger.info("adaptation_job_reconciled", { adaptationId: candidate.adaptationId, stage: candidate.stage, outcome: outcome.outcome, code: outcome.code ?? null });
    } catch (error) {
      summary.rejected += 1;
      logger.error("adaptation_reconcile_error", { adaptationId: candidate.adaptationId, reason: error instanceof Error ? error.name : "unknown" });
    }
  }
  return summary;
}

/** One recovery tick (daily cron): repair first, then work. Safe to invoke concurrently or twice in a row (leases + idempotent enqueue). */
export async function runAdaptationWorkerCycle(deps: OrchestratorDeps, options: { limit: number; minAgeSeconds: number; adaptationIds?: readonly string[] }) {
  const reconciled = await reconcileAdaptationJobs(deps, { minAgeSeconds: options.minAgeSeconds, limit: options.limit * 2, ...(options.adaptationIds ? { adaptationIds: options.adaptationIds } : {}) });
  const processed = await processAdaptationJobs(deps, { limit: options.limit, ...(options.adaptationIds ? { adaptationIds: options.adaptationIds } : {}) });
  return { reconciled, processed };
}
