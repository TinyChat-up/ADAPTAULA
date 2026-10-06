import "server-only";
import { logger } from "@/lib/logger";
import { enqueueGeneration, enqueuePlanning, latestReviewFingerprint, runGenerationStage, runPlanningStage, type OrchestratorDeps, type StageOutcome } from "./orchestrator";

/**
 * The durable worker. It adds NO domain logic: the stages are `runPlanningStage` / `runGenerationStage` (which claim the
 * job with its lease, fence every write by attempt, record `ai_runs`, and complete or fail the job). This module only
 *   · finds work   — jobs a worker may claim (queued past their backoff, or with an expired lease),
 *   · repairs      — adaptations in a state that needs a job and have none (the reconciler),
 *   · reports      — a summary of what happened, with opaque ids only in the logs.
 * Nothing here relies on the process staying alive after a response: whatever is not finished is a durable job that the next
 * invocation (cron, a status poll, a developer script) finds again.
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

export async function processAdaptationJobs(deps: OrchestratorDeps, options: ProcessOptions): Promise<WorkerSummary> {
  const summary = emptySummary();
  const scope = options.adaptationIds ? new Set(options.adaptationIds) : null;
  const listed = await deps.store.listClaimableJobs(scope ? 200 : options.limit);
  const jobs = (scope ? listed.filter((j) => scope.has(j.adaptationId)) : listed).slice(0, options.limit);
  for (const job of jobs) {
    summary.claimed += 1;
    const ids = { jobId: job.jobId, adaptationId: job.adaptationId, stage: job.stage };
    try {
      let outcome: StageOutcome;
      if (job.stage === "planning") outcome = await runPlanningStage(deps, job.adaptationId);
      else {
        const review = await latestReviewFingerprint(deps.store, job.adaptationId);
        outcome = review ? await runGenerationStage(deps, job.adaptationId, review) : { outcome: "rejected", status: "generation_queued", code: "plan_review_required" };
      }
      tally(summary, outcome);
      logger.info("adaptation_job_processed", { ...ids, outcome: outcome.outcome, code: outcome.code ?? null, status: outcome.status });
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

/** One scheduler tick: repair first, then work. Safe to invoke concurrently or twice in a row (leases + idempotent enqueue). */
export async function runAdaptationWorkerCycle(deps: OrchestratorDeps, options: { limit: number; minAgeSeconds: number; adaptationIds?: readonly string[] }) {
  const reconciled = await reconcileAdaptationJobs(deps, { minAgeSeconds: options.minAgeSeconds, limit: options.limit * 2, ...(options.adaptationIds ? { adaptationIds: options.adaptationIds } : {}) });
  const processed = await processAdaptationJobs(deps, { limit: options.limit, ...(options.adaptationIds ? { adaptationIds: options.adaptationIds } : {}) });
  return { reconciled, processed };
}
