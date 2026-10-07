import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/errors";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import type { OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import { createAdaptationCommand, getAdaptationPlan, getAdaptationStatus, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationJobs, processAdaptationStage, runAdaptationWorkerCycle } from "@/lib/adaptation/orchestration/worker";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, expireLeases, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Scripted, type Spy } from "./orchestration-harness";

/**
 * User-triggered stages run IMMEDIATELY, in the teacher's own request (`processAdaptationStage`), never waiting for a scheduler;
 * the cron only recovers. One processor for both, and the atomic claim makes every race (double click, two tabs, the cron) a single
 * execution: one provider call, one set of `ai_runs`, one unit consumed.
 */

let db: PGlite;
const analysis = fractionsAnalysis();
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

let n = 0;
const passAll = (input: { reviewContext?: { review_scope: { required_targets: { answers_not_leaked?: string[] } } } }): AiReviewDraft => ({
  checks: [
    ...((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0 ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "ok" }] : []),
    { check: "age_appropriate", status: "PASS", targets: [], detail: "ok" },
    { check: "no_infantilization", status: "PASS", targets: [], detail: "ok" },
    { check: "functional_supports_applied", status: "PASS", targets: [], detail: "ok" },
  ],
});
const reviewerPass: Scripted["reviewer"] = async (_i, _c, input) => ({ draft: passAll(input), runs: [] });

async function setup(script: Scripted = {}, extra: Partial<OrchestratorDeps> = {}) {
  const user = await createUser(db, `now-${++n}@example.com`);
  const material = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const spy: Spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { reviewer: reviewerPass, ...script }), extra);
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const created = await createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `now-${n}-${Math.random().toString(36).slice(2)}` });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  const status = async () => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const approve = async () => {
    const plan = await getAdaptationPlan(deps, actor, id);
    if (!plan.ok) throw new Error(plan.code);
    const review = { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "prueba" })) };
    expect(await submitPlanReviewCommand(deps, actor, id, review)).toMatchObject({ ok: true, data: { executable: true } });
  };
  return { id, deps, actor, spy, orchestrator, status, approve, workspaceId: user.workspaceId };
}

const count = async (sql: string, params: unknown[]) => Number((await db.query<{ c: string }>(`select count(*)::text c from ${sql}`, params)).rows[0]!.c);
const runs = (id: string, purpose: string) => count("public.ai_runs where adaptation_id = $1 and purpose = $2", [id, purpose]);
const consumed = (id: string) => count("public.adaptation_entitlements where adaptation_id = $1 and state = 'consumed'", [id]);

describe("immediate execution: the teacher's request runs the stage, no scheduler involved", () => {
  it("Adaptar → the planning stage runs inside the request and ends awaiting the teacher's review", async () => {
    const t = await setup();
    expect((await startPlanning(t.deps, t.actor, t.id)).ok).toBe(true);
    expect(t.spy.planner).toBe(0); // the command itself only persists the job
    const outcome = await processAdaptationStage(t.orchestrator, t.id);
    expect(outcome).toMatchObject({ outcome: "completed" });
    expect(t.spy.planner).toBe(1);
    expect(await t.status()).toMatchObject({ status: "awaiting_plan_review" });
  });

  it("the whole flow reaches a delivered adaptation without any cron: one call per stage, one set of ai_runs, one unit consumed", async () => {
    const t = await setup();
    await startPlanning(t.deps, t.actor, t.id);
    await processAdaptationStage(t.orchestrator, t.id);
    await t.approve();
    expect((await startGeneration(t.deps, t.actor, t.id)).ok).toBe(true);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "completed", status: "ready" });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true });
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
    expect([await runs(t.id, "plan"), await runs(t.id, "generate"), await runs(t.id, "review")]).toEqual([1, 1, 1]);
    expect(await consumed(t.id)).toBe(1);
  });
});

describe("idempotency and concurrency", () => {
  it("two simultaneous requests (double click, two tabs) → one execution", async () => {
    const t = await setup();
    await startPlanning(t.deps, t.actor, t.id);
    const outcomes = await Promise.all([processAdaptationStage(t.orchestrator, t.id), processAdaptationStage(t.orchestrator, t.id)]);
    expect(outcomes.map((o) => o?.outcome).sort()).toEqual(["completed", "skipped"]);
    expect(t.spy.planner).toBe(1);
    expect(await runs(t.id, "plan")).toBe(1);
  });

  it("the recovery cron racing the teacher's request → one execution, one consumption", async () => {
    const t = await setup();
    await startPlanning(t.deps, t.actor, t.id);
    await processAdaptationStage(t.orchestrator, t.id);
    await t.approve();
    await startGeneration(t.deps, t.actor, t.id);
    const [mine, cron] = await Promise.all([processAdaptationStage(t.orchestrator, t.id), runAdaptationWorkerCycle(t.orchestrator, { limit: 5, minAgeSeconds: 0, adaptationIds: [t.id] })]);
    expect((mine?.outcome === "completed" ? 1 : 0) + cron.processed.completed).toBe(1);
    expect([t.spy.generator, t.spy.reviewer]).toEqual([1, 1]);
    expect(await consumed(t.id)).toBe(1);
  });

  it("a finished job is never run again: repeated requests make zero calls and no new ai_runs", async () => {
    const t = await setup();
    await startPlanning(t.deps, t.actor, t.id);
    await processAdaptationStage(t.orchestrator, t.id);
    const before = await count("public.ai_runs where adaptation_id = $1", [t.id]);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toBeNull();
    expect(await processAdaptationStage(t.orchestrator, t.id)).toBeNull();
    expect(t.spy.planner).toBe(1);
    expect(await count("public.ai_runs where adaptation_id = $1", [t.id])).toBe(before);
    expect(await t.status()).toMatchObject({ status: "awaiting_plan_review" });
  });

  it("a job held by another run (live lease) is not touched: no call", async () => {
    const t = await setup();
    await startPlanning(t.deps, t.actor, t.id);
    const jobId = (await t.orchestrator.store.getPipeline(t.id))!.jobs[0]!.id;
    await t.orchestrator.store.claimStage(jobId, 300, false);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "skipped" });
    expect(t.spy.planner).toBe(0);
  });
});

describe("failures and retries keep their semantics", () => {
  it("a transient failure leaves a recoverable job (backoff): an immediate repeat makes no call; once the backoff passes, it runs", async () => {
    const t = await setup({ generator: async (inner, call, input) => { if (call === 1) throw new AIError("provider_unavailable", "503"); return inner.generate(input); } }, { retryBackoffSeconds: 600 });
    await startPlanning(t.deps, t.actor, t.id);
    await processAdaptationStage(t.orchestrator, t.id);
    await t.approve();
    await startGeneration(t.deps, t.actor, t.id);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "retry" });
    const job = (await t.orchestrator.store.getPipeline(t.id))!.jobs.find((j) => j.stage === "generation")!;
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "skipped" });
    expect(t.spy.generator).toBe(1);
    expect(await runs(t.id, "generate")).toBe(1); // the failed call is recorded once
    await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where id = $1", [job.id]);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "completed", status: "ready" });
    expect(t.spy.generator).toBe(2);
    expect(await consumed(t.id)).toBe(1);
  });

  it("a non-retryable failure is final: requests run nothing more and call no provider", async () => {
    const t = await setup({ generator: async () => { throw new AIError("refusal", "no"); } });
    await startPlanning(t.deps, t.actor, t.id);
    await processAdaptationStage(t.orchestrator, t.id);
    await t.approve();
    await startGeneration(t.deps, t.actor, t.id);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "failed" });
    expect(await processAdaptationStage(t.orchestrator, t.id)).toBeNull();
    expect((await runAdaptationWorkerCycle(t.orchestrator, { limit: 5, minAgeSeconds: 0, adaptationIds: [t.id] })).processed.claimed).toBe(0);
    expect(t.spy.generator).toBe(1);
    expect(await t.status()).toMatchObject({ status: "failed", canRetry: false });
    expect(await consumed(t.id)).toBe(0);
  });

  it("a request killed mid-stage (lease left behind) is recovered by the next request or by the cron, with the same processor", async () => {
    const t = await setup();
    await startPlanning(t.deps, t.actor, t.id);
    const jobId = (await t.orchestrator.store.getPipeline(t.id))!.jobs[0]!.id;
    await t.orchestrator.store.claimStage(jobId, 300, false); // the function died here, before calling the provider
    await expireLeases(db);
    expect(await processAdaptationStage(t.orchestrator, t.id)).toMatchObject({ outcome: "completed" });
    expect(t.spy.planner).toBe(1);
  });
});

describe("recovery cron", () => {
  it("recovers an abandoned job; ignores completed ones and ones a live run holds", async () => {
    const abandoned = await setup();
    await startPlanning(abandoned.deps, abandoned.actor, abandoned.id);
    const jobId = (await abandoned.orchestrator.store.getPipeline(abandoned.id))!.jobs[0]!.id;
    await abandoned.orchestrator.store.claimStage(jobId, 300, false);
    await expireLeases(db);

    const done = await setup();
    await startPlanning(done.deps, done.actor, done.id);
    await processAdaptationStage(done.orchestrator, done.id);

    const held = await setup();
    await startPlanning(held.deps, held.actor, held.id);
    const heldJob = (await held.orchestrator.store.getPipeline(held.id))!.jobs[0]!.id;
    await held.orchestrator.store.claimStage(heldJob, 300, false);

    const summary = await processAdaptationJobs(abandoned.orchestrator, { limit: 10, adaptationIds: [abandoned.id, done.id, held.id] });
    expect(summary).toMatchObject({ claimed: 1, completed: 1 });
    expect([abandoned.spy.planner, done.spy.planner, held.spy.planner]).toEqual([1, 1, 0]); // recovered once; the finished and the held ones untouched
    expect((await getAdaptationStatus(abandoned.deps, abandoned.actor, abandoned.id))).toMatchObject({ ok: true, data: { status: "awaiting_plan_review" } });
  });
});
