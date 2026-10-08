import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import {
  cancelAdaptationCommand,
  createAdaptationCommand,
  getAdaptationPlan,
  getAdaptationStatus,
  reopenReview,
  startGeneration,
  startPlanning,
  submitPlanReviewCommand,
  type Actor,
  type ServiceDeps,
} from "@/lib/adaptation/orchestration/service";
import { MAX_GENERATION_CYCLES } from "@/lib/adaptation/orchestration/status";
import { processAdaptationJobs } from "@/lib/adaptation/orchestration/worker";
import { RejectedStageOutput } from "@/lib/adaptation/services";
import { AIError } from "@/lib/ai/errors";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { fetchAiSpendSummary } from "@/lib/usage/ai-spend";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, pgRpc, readerFor, scriptedServices, seedLearner, seedMaterial, stageRun, versions, type Scripted, type User } from "./orchestration-harness";

/**
 * Quota and AI spend are different things (migration 018): a quota unit can be given back, the cost of a call already made
 * cannot. Over the real migrations (PGlite) with scripted providers: 0 real model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const spend = (workspaceId: string, from = new Date(Date.now() - 3_600_000), to = new Date(Date.now() + 3_600_000)) => fetchAiSpendSummary(pgRpc(db), workspaceId, { from, to });

async function aiRun(ws: string, row: { purpose: string; status?: string; cost?: number | null; input?: number; output?: number; cacheWrite?: number; jobId?: string | null; adaptationId?: string | null; at?: string }) {
  await as(db, "service_role", null, () =>
    db.query(
      `insert into public.ai_runs (workspace_id, job_id, adaptation_id, purpose, model_alias, provider, model, input_tokens, output_tokens, cache_creation_input_tokens, estimated_cost_usd, status, created_at)
       values ($1, $2, $3, $4, 'STANDARD', 'anthropic', 'claude-sonnet-5-5', $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))`,
      [ws, row.jobId ?? null, row.adaptationId ?? null, row.purpose, row.input ?? 1000, row.output ?? 300, row.cacheWrite ?? 0, row.cost === undefined ? 0.01 : row.cost, row.status ?? "success", row.at ?? null],
    ),
  );
}

let n = 0;
const failReview = (input: { reviewContext?: { review_scope: { required_targets: { answers_not_leaked?: string[] } } } }): AiReviewDraft => ({
  checks: [
    ...((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0 ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "ok" }] : []),
    { check: "age_appropriate", status: "FAIL", targets: [], detail: "Tono inadecuado" },
    { check: "no_infantilization", status: "PASS", targets: [], detail: "ok" },
    { check: "functional_supports_applied", status: "PASS", targets: [], detail: "ok" },
  ],
});

async function teacher(script: Scripted = {}, user?: User) {
  const u = user ?? (await createUser(db, `cost-${++n}@example.com`));
  const material = await seedMaterial(db, u, fractionsAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, script));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  let clock = 0;
  // Every review gets its own time: a new review is a new generation input (what a teacher's second review is).
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions, now: () => new Date(Date.UTC(2026, 9, 5, 12, 0, clock++)) };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const ids: string[] = [];
  const create = async () => {
    const r = await createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `cost-${n}-${Math.random()}` });
    if (!r.ok) throw new Error(r.code);
    ids.push(r.data.adaptationId);
    return r.data.adaptationId;
  };
  const tick = () => processAdaptationJobs(orchestrator, { limit: 5, adaptationIds: ids });
  const review = async (id: string) => {
    const plan = await getAdaptationPlan(deps, actor, id);
    if (!plan.ok) throw new Error(plan.code);
    const saved = await submitPlanReviewCommand(deps, actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" })) });
    if (!saved.ok) throw new Error(saved.code);
  };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  /** create → plan → teacher review → generation (one product cycle). */
  const toFirstGeneration = async () => {
    const id = await create();
    expect((await startPlanning(deps, actor, id)).ok).toBe(true);
    await tick();
    await review(id);
    expect((await startGeneration(deps, actor, id)).ok).toBe(true);
    await tick();
    return id;
  };
  return { user: u, deps, actor, spy, create, tick, review, status, toFirstGeneration };
}

describe("AI spend · aggregation (ai_spend_summary)", () => {
  it("counts successful AND failed calls, separates analyze/plan/generate/review, and isolates workspaces and periods", async () => {
    const a = await createUser(db, `spend-a-${++n}@example.com`);
    const b = await createUser(db, `spend-b-${++n}@example.com`);
    const job = "00000000-0000-4000-8000-0000000000a1";
    await db.query("insert into public.adaptation_jobs (id, workspace_id, material_id, kind, input, status) values ($1, $2, $3, 'analyze', '{}', 'failed')", [job, a.workspaceId, await seedMaterial(db, a, fractionsAnalysis())]);
    await aiRun(a.workspaceId, { purpose: "analyze", cost: 0.05, jobId: job });
    await aiRun(a.workspaceId, { purpose: "analyze", status: "invalid_output", cost: 0.03, jobId: job }); // a paid repair that failed
    await aiRun(a.workspaceId, { purpose: "plan", cost: 0.02 });
    await aiRun(a.workspaceId, { purpose: "generate", status: "invalid_output", cost: 0.015 });
    await aiRun(a.workspaceId, { purpose: "review", cost: 0.02 });
    await aiRun(a.workspaceId, { purpose: "generate", status: "error", cost: null, input: 0, output: 0 }); // outage: no usage, no price
    await aiRun(a.workspaceId, { purpose: "plan", cost: 0.5, at: "2020-01-01T00:00:00Z" }); // outside the period
    await aiRun(b.workspaceId, { purpose: "analyze", cost: 9 });

    const s = await spend(a.workspaceId);
    expect(s.ai_cost_total).toBeCloseTo(0.135, 6);
    expect(s).toMatchObject({ analysis_cost: 0.08, planner_cost: 0.02, generator_cost: 0.015, reviewer_cost: 0.02, successful_ai_runs: 3, failed_ai_runs: 3, unpriced_ai_runs: 0, analysis_count: 1 });
    expect(s.by_purpose.generate).toMatchObject({ runs: 2, successful: 0, failed: 2 });
    expect(s.input_tokens).toBe(5000);
    expect(s.avg_cost_per_analysis).toBeCloseTo(0.08, 6);
    expect((await spend(b.workspaceId)).ai_cost_total).toBe(9);
    expect((await spend(a.workspaceId, new Date("2019-12-31T00:00:00Z"), new Date("2020-01-02T00:00:00Z"))).planner_cost).toBe(0.5);
  });

  it("is internal: an authenticated user cannot call it (service role only)", async () => {
    const u = await createUser(db, `spend-auth-${++n}@example.com`);
    await expect(as(db, "authenticated", u.id, () => db.query("select public.ai_spend_summary($1, now() - interval '1 day', now())", [u.workspaceId]))).rejects.toThrow(/permission denied/);
    await expect(as(db, "authenticated", u.id, () => db.query("select public.ai_failure_budget($1)", [u.workspaceId]))).rejects.toThrow(/permission denied/);
  });

  it("carries ids, purposes, tokens, costs and counts only: nothing about learners, content or prompts", async () => {
    const u = await createUser(db, `spend-priv-${++n}@example.com`);
    await aiRun(u.workspaceId, { purpose: "plan", cost: 0.02 });
    const keys = JSON.stringify(Object.keys(await spend(u.workspaceId)));
    expect(keys).not.toMatch(/name|alias|display|content|prompt|text|document|learner|profile|email|answer/i);
  });
});

describe("AI spend · quota is not cost", () => {
  it("a rejected (paid) generator answer keeps its real tokens and cost; giving the quota unit back does not erase them", async () => {
    const cost = 0.021;
    const t = await teacher({
      generator: async () => {
        throw new RejectedStageOutput("refusal", "refused", { ...stageRun("generate", versions().generator, "material_generator"), status: "refused", errorCode: "refusal", inputTokens: 1200, outputTokens: 50, estimatedCostUsd: cost });
      },
    });
    const id = await t.toFirstGeneration();
    const row = (await q<{ status: string; input_tokens: number; estimated_cost_usd: string }>("select status, input_tokens, estimated_cost_usd from public.ai_runs where adaptation_id = $1 and purpose = 'generate'", [id]))[0]!;
    expect(row).toMatchObject({ status: "refused", input_tokens: 1200 });
    expect(Number(row.estimated_cost_usd)).toBe(cost); // before 7B this row had 0 tokens and no cost

    expect((await cancelAdaptationCommand(t.deps, t.actor, id)).ok).toBe(true);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("released");
    const usage = await as(db, "authenticated", t.user.id, () => db.query<{ u: { adaptations: { used: number } } }>("select public.workspace_usage($1) as u", [t.user.workspaceId]));
    expect(usage.rows[0]!.u.adaptations.used).toBe(0); // the teacher is not charged a unit…
    const s = await spend(t.user.workspaceId);
    expect(s.generator_cost).toBeCloseTo(cost, 6); // …but the money spent is still there
    expect(s.failed_ai_runs).toBeGreaterThanOrEqual(1);
  });

  it("a technical retry (transient provider failure → the job's own retry) records both calls, each with its real cost", async () => {
    let call = 0;
    const t = await teacher({
      generator: async (inner, _c, input) => {
        call += 1;
        if (call === 1) throw new AIError("provider_unavailable", "overloaded"); // nothing came back: nothing billed
        return inner.generate(input);
      },
      reviewer: async (_i, _c, input) => ({ draft: { checks: failReview(input).checks.map((c) => ({ ...c, status: "PASS" as const })) }, runs: [] }),
    });
    const id = await t.toFirstGeneration();
    await t.tick(); // the job's own retry (same input): not a new product generation
    const rows = await q<{ status: string; estimated_cost_usd: string }>("select status, estimated_cost_usd from public.ai_runs where adaptation_id = $1 and purpose = 'generate' order by created_at", [id]);
    expect(rows.map((r) => r.status)).toEqual(["error", "success"]);
    expect(rows[0]!.estimated_cost_usd).toBeNull(); // unknown, never an invented 0 or price
    const s = await spend(t.user.workspaceId);
    expect(s.generator_cost).toBeCloseTo(0.02, 6);
    expect(s.by_purpose.generate).toMatchObject({ runs: 2, successful: 1, failed: 1 });
    expect((await t.status(id)).generationsUsed).toBe(1);
  });
});

describe("generation cycles per adaptation (max 3 product generations)", () => {
  it(`initial + 2 new generations are allowed; the ${MAX_GENERATION_CYCLES + 1}th is refused, nothing runs and the last version is kept`, async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: failReview(input), runs: [] }) });
    const id = await t.toFirstGeneration();
    expect(await t.status(id)).toMatchObject({ status: "blocked", generationsUsed: 1, regenerationAvailable: true, nextAction: "review_plan" });
    for (let cycle = 2; cycle <= MAX_GENERATION_CYCLES; cycle++) {
      expect((await reopenReview(t.deps, t.actor, id)).ok).toBe(true);
      await t.review(id);
      expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
      await t.tick();
      expect(await t.status(id)).toMatchObject({ status: "blocked", generationsUsed: cycle });
    }
    const exhausted = await t.status(id);
    expect(exhausted).toMatchObject({ regenerationAvailable: false, nextAction: "none" });
    const versionsBefore = await q("select version, review from public.adaptation_versions where adaptation_id = $1 order by version", [id]);
    expect(versionsBefore).toHaveLength(MAX_GENERATION_CYCLES);

    expect(await reopenReview(t.deps, t.actor, id)).toEqual({ ok: false, code: "generation_limit" });
    expect((await t.status(id)).status).toBe("blocked");
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(await q("select version, review from public.adaptation_versions where adaptation_id = $1 order by version", [id])).toEqual(versionsBefore);

    // The database is the authority even if a caller skips the service: a NEW generation input is refused.
    await db.query("update public.adaptations set status = 'generation_queued' where id = $1", [id]);
    await expect(as(db, "service_role", null, () => db.query("select public.enqueue_adaptation_stage($1, 'generation', $2, 3)", [id, "f".repeat(64)]))).rejects.toThrow(/generation_cycles_exhausted/);
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
  }, 60_000);

  it("re-queuing the SAME generation input (a technical retry) is not a new cycle, even at the limit", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: failReview(input), runs: [] }) });
    const id = await t.toFirstGeneration();
    const [first] = await q<{ input_fingerprint: string }>("select input_fingerprint from public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [id]);
    await db.query("insert into public.adaptation_jobs (workspace_id, material_id, kind, input, status, adaptation_id, stage, input_fingerprint) select workspace_id, material_id, 'adapt', '{}', 'failed', id, 'generation', repeat('b', 64) from public.adaptations where id = $1", [id]);
    await db.query("insert into public.adaptation_jobs (workspace_id, material_id, kind, input, status, adaptation_id, stage, input_fingerprint) select workspace_id, material_id, 'adapt', '{}', 'failed', id, 'generation', repeat('c', 64) from public.adaptations where id = $1", [id]);
    expect((await t.status(id)).generationsUsed).toBe(3);
    await db.query("update public.adaptations set status = 'failed' where id = $1", [id]);
    // Retrying an input that already exists (here a failed one) is allowed: it is the same generation, not a new one.
    const retried = await as(db, "service_role", null, () => db.query<{ r: { reused: boolean } }>("select public.enqueue_adaptation_stage($1, 'generation', $2, 3) as r", [id, "c".repeat(64)]));
    expect(retried.rows[0]!.r.reused).toBe(false);
    expect((await t.status(id)).generationsUsed).toBe(3);
    expect(first!.input_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a double submit and concurrent requests cannot jump over the limit", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: failReview(input), runs: [] }) });
    const id = await t.toFirstGeneration();
    for (let cycle = 2; cycle <= MAX_GENERATION_CYCLES; cycle++) {
      await reopenReview(t.deps, t.actor, id);
      await t.review(id);
      const both = await Promise.all([startGeneration(t.deps, t.actor, id), startGeneration(t.deps, t.actor, id)]);
      expect(both.every((r) => r.ok)).toBe(true);
      await t.tick();
    }
    expect(Number((await q<{ c: string }>("select count(distinct input_fingerprint)::text c from public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [id]))[0]!.c)).toBe(MAX_GENERATION_CYCLES);
    const again = await Promise.all([reopenReview(t.deps, t.actor, id), reopenReview(t.deps, t.actor, id)]);
    expect(again).toEqual([{ ok: false, code: "generation_limit" }, { ok: false, code: "generation_limit" }]);
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
  }, 60_000);
});

describe("failure budget (failed paid AI calls per workspace, 24 h)", () => {
  const fail = (ws: string, times: number, extra: { input?: number; output?: number; at?: string } = {}) => Promise.all(Array.from({ length: times }, () => aiRun(ws, { purpose: "generate", status: "invalid_output", cost: 0.01, ...extra })));

  it("blocks NEW adaptation jobs once 40 paid calls failed in 24 h; outages (no tokens), old failures and other workspaces do not count", async () => {
    const t = await teacher();
    const id = await t.create();
    await fail(t.user.workspaceId, 39);
    await fail(t.user.workspaceId, 20, { input: 0, output: 0 }); // provider outage: nothing was paid
    await fail(t.user.workspaceId, 20, { at: new Date(Date.now() - 25 * 3_600_000).toISOString() }); // outside the window
    const other = await teacher();
    await fail(other.user.workspaceId, 50);
    expect((await startPlanning(t.deps, t.actor, id)).ok).toBe(true); // 39 < 40
    await t.tick();
    await fail(t.user.workspaceId, 1);
    const blocked = await t.create();
    expect(await startPlanning(t.deps, t.actor, blocked)).toEqual({ ok: false, code: "failure_budget" });
    expect(await q("select 1 from public.adaptation_jobs where adaptation_id = $1", [blocked])).toHaveLength(0);
    expect((await t.status(blocked)).status).toBe("queued"); // nothing was started, nothing is corrupted
  });

  it("an analysis is not admitted either, and its quota unit is not taken", async () => {
    const u = await createUser(db, `budget-an-${++n}@example.com`);
    const material = await seedMaterial(db, u, fractionsAnalysis(), "uploaded");
    await fail(u.workspaceId, 40);
    await expect(as(db, "service_role", null, () => db.query("select public.enqueue_analysis_job($1, $2, '{}'::jsonb, 3)", [material, u.id]))).rejects.toThrow(/ai_failure_budget_exhausted/);
    expect(await q("select 1 from public.usage_events where workspace_id = $1 and kind = 'analysis'", [u.workspaceId])).toHaveLength(0);
  });

  it("does not stop a job that was already admitted: its own technical retries keep running", async () => {
    let call = 0;
    const t = await teacher({
      planner: async (inner, _c, input) => {
        call += 1;
        if (call === 1) throw new AIError("timeout", "slow"); // transient: the admitted job retries by itself
        return inner.plan(input);
      },
    });
    const id = await t.create();
    expect((await startPlanning(t.deps, t.actor, id)).ok).toBe(true);
    await fail(t.user.workspaceId, 60);
    await t.tick();
    await t.tick();
    expect((await t.status(id)).status).toBe("awaiting_plan_review");
  });
});
