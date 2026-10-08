import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { continueAutomatically, runPlanningStage } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, getAdaptationPlan, getAdaptationStatus, reopenReview, startGeneration, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { MAX_GENERATION_CYCLES } from "@/lib/adaptation/orchestration/status";
import { processAdaptationStage, runAdaptationWorkerCycle } from "@/lib/adaptation/orchestration/worker";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { fetchAiSpendSummary } from "@/lib/usage/ai-spend";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, pgRpc, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Scripted } from "./orchestration-harness";

/**
 * «Hacer magia» (migration 019): the SAME pipeline, crossing the plan gate with the server's recommendation instead of a person's
 * review. Over the real migrations (PGlite) with scripted providers: 0 real model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);

const blockingReview = (input: { reviewContext?: { review_scope: { required_targets: { answers_not_leaked?: string[] } } } }): AiReviewDraft => ({
  checks: [
    ...((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0 ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "ok" }] : []),
    { check: "age_appropriate", status: "FAIL", targets: [], detail: "Tono inadecuado" },
    { check: "no_infantilization", status: "PASS", targets: [], detail: "ok" },
    { check: "functional_supports_applied", status: "PASS", targets: [], detail: "ok" },
  ],
});

let n = 0;
async function teacher(script: Scripted = {}, options: { canWrite?: boolean } = {}) {
  const u = await createUser(db, `magic-${++n}@example.com`);
  const material = await seedMaterial(db, u, fractionsAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, script));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  let clock = 0;
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions, now: () => new Date(Date.UTC(2026, 9, 8, 12, 0, clock++)) };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: options.canWrite ?? true };
  const start = async (mode: "automatic" | "review", key = `magic-${n}-${Math.random()}`) =>
    createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: key, creationMode: mode });
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  /** What the screen's run requests do, until nothing is left to run (bounded). */
  const runAll = async (id: string) => {
    for (let i = 0; i < 6; i++) if (!(await processAdaptationStage(orchestrator, id))) return;
  };
  return { user: u, material, deps, actor, spy, orchestrator, start, status, runAll };
}

const mode = async (id: string) => (await q<{ creation_mode: string }>("select creation_mode from public.adaptations where id = $1", [id]))[0]!.creation_mode;
const entitlement = async (id: string) => (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]?.state;
const planReviews = (id: string) => q<{ payload: { reviewer: { kind: string } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review' order by created_at", [id]);

describe("«Hacer magia»: material + perfil → ficha final, sin aprobación humana del plan", () => {
  it("one click creates and starts; the run requests plan, apply the recommendation, generate and review; the sheet is delivered", async () => {
    const t = await teacher();
    const created = await t.start("automatic");
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data.adaptationId : "";
    expect(await mode(id)).toBe("automatic");
    expect(await count("public.adaptation_jobs where adaptation_id = $1 and stage = 'planning'", [id])).toBe(1);
    expect(t.spy.planner).toBe(0); // the command only persists the job

    // First run request: planning, then the server crosses the gate and queues generation (nobody is asked to review).
    expect(await processAdaptationStage(t.orchestrator, id)).toMatchObject({ outcome: "completed", status: "generation_queued" });
    const queued = await t.status(id);
    expect(queued).toMatchObject({ creationMode: "automatic", phase: "working", nextAction: "none", status: "generation_queued" });
    expect(t.spy.generator).toBe(0);

    // Second run request: generation + the mandatory pedagogical review.
    expect(await processAdaptationStage(t.orchestrator, id)).toMatchObject({ outcome: "completed", status: "ready", delivered: true });
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
    expect(await t.status(id)).toMatchObject({ status: "ready", phase: "ready", delivered: true, creationMode: "automatic" });

    // Same pipeline artefacts as the reviewed path; the review is the server's recommendation, never a teacher's.
    const reviews = await planReviews(id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.payload.reviewer.kind).toBe("auto");
    for (const kind of ["plan", "plan_validation", "execution_report", "generation", "deterministic_review", "pedagogical_review"]) {
      expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = $2", [id, kind])).toBe(1);
    }
    // Quota: one unit, consumed once, exactly like the reviewed path.
    expect(await entitlement(id)).toBe("consumed");
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
  });

  it("the recommendation applies what can be applied and leaves out what is blocked (the same policy the review screen starts from)", async () => {
    const t = await teacher();
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await t.runAll(id);
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    const entries = (await planReviews(id))[0]!.payload as unknown as { entries: Array<{ decision_id: string; action: string }> };
    for (const d of plan.data.decisions) expect(entries.entries.find((e) => e.decision_id === d.id)?.action).toBe(d.status === "blocked" ? "rejected" : "approved");
  });

  it("«Revisar antes de crear» keeps the human gate: planning stops at the review, nothing is generated", async () => {
    const t = await teacher();
    const created = await t.start("review");
    const id = created.ok ? created.data.adaptationId : "";
    expect(await mode(id)).toBe("review");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "awaiting_plan_review", phase: "awaiting_review", nextAction: "review_plan", creationMode: "review" });
    expect(await planReviews(id)).toHaveLength(0);
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 0, 0]);
    expect(await continueAutomatically(t.orchestrator, id)).toBeNull();
    expect(await entitlement(id)).toBe("reserved");
  });

  it("double click / back and click again with the same key: one adaptation, one reservation, one planning job", async () => {
    const t = await teacher();
    const key = `same-key-${n}`;
    const first = await t.start("automatic", key);
    const second = await t.start("automatic", key);
    expect(first.ok && second.ok && first.data.adaptationId === second.data.adaptationId).toBe(true);
    const id = first.ok ? first.data.adaptationId : "";
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(1);
  });

  it("two run requests racing (two tabs, a refresh): one planner, one generator, one reviewer, one review, one consumption", async () => {
    const t = await teacher();
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await Promise.all([processAdaptationStage(t.orchestrator, id), processAdaptationStage(t.orchestrator, id)]);
    await Promise.all([processAdaptationStage(t.orchestrator, id), runAdaptationWorkerCycle(t.orchestrator, { limit: 5, adaptationIds: [id] })]);
    await t.runAll(id);
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
    expect(await planReviews(id)).toHaveLength(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [id])).toBe(1);
    expect(await entitlement(id)).toBe("consumed");
  });

  it("refresh / reopen resumes: a plan finished without its continuation is continued by the next run request, once", async () => {
    const t = await teacher();
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    // The process died right after planning (the plan is saved, the gate was never crossed).
    await runPlanningStage(t.orchestrator, id);
    const stuck = await t.status(id);
    expect(stuck).toMatchObject({ status: "awaiting_plan_review", phase: "working", nextAction: "none" });
    expect(await continueAutomatically(t.orchestrator, id)).toMatchObject({ outcome: "enqueued" });
    expect(await continueAutomatically(t.orchestrator, id)).toBeNull();
    expect(await planReviews(id)).toHaveLength(1);
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
  });

  it("the same resumption from the run request alone (what reopening the page triggers)", async () => {
    const t = await teacher();
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await runPlanningStage(t.orchestrator, id);
    expect(await processAdaptationStage(t.orchestrator, id)).toMatchObject({ outcome: "completed", status: "ready" });
  });
});

describe("«Hacer magia» when the reviewer blocks: never delivered, no loop, the person decides", () => {
  it("a blocked review is not delivered; the unit stays reserved; nothing generates again by itself", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: blockingReview(input), runs: [] }) });
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await t.runAll(id);
    const blocked = await t.status(id);
    expect(blocked).toMatchObject({ status: "blocked", phase: "blocked", delivered: false, nextAction: "review_plan", regenerationAvailable: true });
    expect(await entitlement(id)).toBe("reserved");
    // Further run requests, the recovery cron, an explicit continuation: nothing runs again.
    await t.runAll(id);
    await runAdaptationWorkerCycle(t.orchestrator, { limit: 5, adaptationIds: [id] });
    expect(await continueAutomatically(t.orchestrator, id)).toBeNull();
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
  });

  it("«Revisar adaptación» reopens the human review: the automatic path never submits for the teacher again", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: blockingReview(input), runs: [] }) });
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await t.runAll(id);
    expect(await reopenReview(t.deps, t.actor, id)).toMatchObject({ ok: true, data: { status: "awaiting_plan_review" } });
    expect(await t.status(id)).toMatchObject({ phase: "awaiting_review", nextAction: "review_plan", creationMode: "automatic", generationsUsed: 1 });
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect(await planReviews(id)).toHaveLength(1);
    expect(t.spy.generator).toBe(1);
  });

  it("the 7B limit still holds: after three blocked generations nothing else can be generated", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: blockingReview(input), runs: [] }) });
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await t.runAll(id);
    for (let cycle = 2; cycle <= MAX_GENERATION_CYCLES; cycle++) {
      expect((await reopenReview(t.deps, t.actor, id)).ok).toBe(true);
      const plan = await getAdaptationPlan(t.deps, t.actor, id);
      if (!plan.ok) throw new Error(plan.code);
      const saved = await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" })) });
      expect(saved.ok).toBe(true);
      expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
      await t.runAll(id);
    }
    expect(await t.status(id)).toMatchObject({ status: "blocked", regenerationAvailable: false, nextAction: "none", generationsUsed: MAX_GENERATION_CYCLES });
    expect(await reopenReview(t.deps, t.actor, id)).toMatchObject({ ok: false, code: "generation_limit" });
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
  });
});

describe("«Hacer magia» under the 7B failure budget", () => {
  it("a generation the budget refuses is not a crash: the plan is reviewed, nothing generates, the screen offers «Crear ficha»", async () => {
    const t = await teacher();
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    // The planning job was admitted; then the workspace spends its budget of failed paid calls.
    for (let i = 0; i < 40; i++) {
      await as(db, "service_role", null, () =>
        db.query("insert into public.ai_runs (workspace_id, purpose, model_alias, provider, model, input_tokens, output_tokens, status) values ($1, 'plan', 'STANDARD', 'mock', 'mock', 100, 10, 'error')", [t.user.workspaceId]),
      );
    }
    expect(await processAdaptationStage(t.orchestrator, id)).toMatchObject({ outcome: "completed", status: "generation_queued" });
    expect(await t.status(id)).toMatchObject({ status: "generation_queued", nextAction: "start_generation" });
    expect(await startGeneration(t.deps, t.actor, id)).toMatchObject({ ok: false, code: "failure_budget" });
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 0, 0]);
    expect(await entitlement(id)).toBe("reserved");
  });
});

describe("permissions, persistence and telemetry", () => {
  it("a read-only member cannot do magic (or create at all): refused before anything exists", async () => {
    const t = await teacher({}, { canWrite: false });
    expect(await t.start("automatic")).toMatchObject({ ok: false, code: "forbidden" });
    expect(await t.start("review")).toMatchObject({ ok: false, code: "forbidden" });
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(0);
  });

  it("the mode is server-written: the browser cannot set or change it, and the database refuses an unknown one", async () => {
    const t = await teacher();
    const created = await t.start("review");
    const id = created.ok ? created.data.adaptationId : "";
    await expect(as(db, "authenticated", t.user.id, () => db.query("update public.adaptations set creation_mode = 'automatic' where id = $1", [id]))).rejects.toThrow(/permission denied/);
    expect(await mode(id)).toBe("review");
    await expect(db.query("update public.adaptations set creation_mode = 'magic' where id = $1", [id])).rejects.toThrow(/adaptations_creation_mode_check/);
    await expect(
      db.query("select public.create_adaptation($1, $2, $3, null, 'accessibility', 't', 'k-bad', '{}', '{}', $4, $4, false, 'magic')", [t.user.workspaceId, t.material, t.user.id, "a".repeat(64)]),
    ).rejects.toThrow(/invalid_creation_mode/);
  });

  it("existing adaptations (created before 019) keep the human gate: the default mode is 'review'", async () => {
    const column = await q<{ column_default: string; is_nullable: string }>("select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'adaptations' and column_name = 'creation_mode'");
    expect(column[0]).toMatchObject({ is_nullable: "NO" });
    expect(column[0]!.column_default).toContain("review");
  });

  it("ai_spend_summary distinguishes the creation mode with counts and costs only", async () => {
    const t = await teacher();
    const magic = await t.start("automatic");
    const reviewed = await t.start("review");
    await t.runAll(magic.ok ? magic.data.adaptationId : "");
    await t.runAll(reviewed.ok ? reviewed.data.adaptationId : "");
    const summary = await fetchAiSpendSummary(pgRpc(db), t.user.workspaceId, { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) });
    expect(summary.by_creation_mode).toEqual({ automatic: { adaptations: 1, ready: 1, blocked: 0 }, review: { adaptations: 1, ready: 0, blocked: 0 } });
    expect(Object.keys(summary.cost_by_creation_mode).sort()).toEqual(["automatic", "review"]);
    expect(summary.cost_by_creation_mode.automatic!.adaptations).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/Marta|fracci|display_name|prompt/i);
  });
});

describe("hotfix · «Hacer magia» never answers with an opaque HTTP 500", () => {
  it("a database without migration 019 is a safe refusal (logged as a schema mismatch); nothing is created or reserved", async () => {
    const old = await createTestDb({ through: "20261001001800" });
    await old.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'");
    const u = await createUser(old, "magic-old@example.com");
    const material = await seedMaterial(old, u, fractionsAnalysis());
    const learner = await seedLearner(old, u);
    const orchestrator = makeDeps(old, scriptedServices(newSpy(), {}));
    orchestrator.entitlements = dbEntitlements(orchestrator.store);
    const deps: ServiceDeps = { orchestrator, reader: readerFor(old, u), resolveVersions: versions };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await createAndStartAdaptation(deps, { userId: u.id, workspaceId: u.workspaceId, canWrite: true }, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: "old-schema-key", creationMode: "automatic" });
      expect(result).toEqual({ ok: false, code: "unavailable" });
      const line = JSON.parse(String(errors.mock.calls.at(-1)![0])) as Record<string, string>;
      expect(line).toMatchObject({ level: "error", event: "adaptation_create_failed", reason: "schema_mismatch", mode: "automatic", materialId: material });
      expect(line.detail).toMatch(/create_adaptation/);
    } finally {
      errors.mockRestore();
    }
    expect(Number((await old.query<{ c: string }>("select count(*)::text c from public.adaptations")).rows[0]!.c)).toBe(0);
    expect(Number((await old.query<{ c: string }>("select count(*)::text c from public.adaptation_entitlements")).rows[0]!.c)).toBe(0);
    await old.close();
  }, 120_000);

  it("created but the start fails unexpectedly: the adaptation is returned (its page offers to start it); retrying reuses it, one job", async () => {
    const t = await teacher();
    const getAdaptation = t.deps.reader.getAdaptation.bind(t.deps.reader);
    let fail = true;
    t.deps.reader.getAdaptation = async (id) => {
      if (fail) {
        fail = false;
        throw new Error("connection reset");
      }
      return getAdaptation(id);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = `magic-retry-${n}`;
    try {
      const first = await t.start("automatic", key);
      expect(first.ok).toBe(true);
      const id = first.ok ? first.data.adaptationId : "";
      expect(JSON.parse(String(errors.mock.calls.at(-1)![0]))).toMatchObject({ event: "adaptation_start_failed", adaptationId: id, reason: "Error" });
      expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(0);
      // The same click again (same request key): the same adaptation, its single reservation, and now its one planning job.
      const again = await t.start("automatic", key);
      expect(again).toEqual(first);
      expect(await count("public.adaptations where request_key = $1", [key])).toBe(1);
      expect(await count("public.adaptation_jobs where adaptation_id = $1 and stage = 'planning'", [id])).toBe(1);
      expect(await entitlement(id)).toBe("reserved");
    } finally {
      errors.mockRestore();
    }
  });
});
