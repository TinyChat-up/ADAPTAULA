import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { continueAutomatically, runPlanningStage } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, describeUnexpected, getAdaptationPlan, getAdaptationStatus, reopenReview, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { PUBLIC_SERVICE_ERRORS, toPublic } from "@/lib/adaptation/orchestration/public";
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

describe("«Hacer magia» when the reviewer blocks with no safe correction: never delivered, no loop, an honest stop", () => {
  it("a finding about the whole sheet (its tone) has no safe correction: not delivered, «could not finish automatically», editing only offered", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: blockingReview(input), runs: [] }) });
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await t.runAll(id);
    const blocked = await t.status(id);
    expect(blocked).toMatchObject({ status: "blocked", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, delivered: false, nextAction: "review_plan", regenerationAvailable: true });
    expect(await entitlement(id)).toBe("reserved");
    // Further run requests, the recovery cron, an explicit continuation: nothing runs again.
    await t.runAll(id);
    await runAdaptationWorkerCycle(t.orchestrator, { limit: 5, adaptationIds: [id] });
    expect(await continueAutomatically(t.orchestrator, id)).toBeNull();
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
  });

  it("«Revisar y editar» (the teacher's choice) reopens the plan: still the honest stop, never a mandatory review, and the automatic path never submits for the teacher", async () => {
    const t = await teacher({ reviewer: async (_i, _c, input) => ({ draft: blockingReview(input), runs: [] }) });
    const created = await t.start("automatic");
    const id = created.ok ? created.data.adaptationId : "";
    await t.runAll(id);
    expect(await reopenReview(t.deps, t.actor, id)).toMatchObject({ ok: true, data: { status: "awaiting_plan_review" } });
    // Editing is offered (`review_plan` → «Revisar y editar», `?editar=1`), the screen is not the plan gate.
    expect(await t.status(id)).toMatchObject({ phase: "automatic_incomplete", automaticStop: { reason: "quality" }, nextAction: "review_plan", creationMode: "automatic", generationsUsed: 1 });
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
  it("a generation the budget refuses is not a crash: nothing generates, and the teacher is told it could not finish automatically (no «Crear ficha» to accept)", async () => {
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
    expect(await t.status(id)).toMatchObject({ status: "generation_queued", phase: "automatic_incomplete", automaticStop: { reason: "generation_refused" }, nextAction: "none" });
    expect(await startGeneration(t.deps, t.actor, id)).toMatchObject({ ok: false, code: "failure_budget" });
    // The refusal is recorded: refreshing the page does not try again and again.
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
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

/** The structured lines the logger wrote to console.error while `work` ran (the console itself stays quiet). */
async function errorLog<T>(work: () => Promise<T>): Promise<{ result: T; lines: Array<Record<string, string>> }> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await work();
    return { result, lines: spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, string>) };
  } finally {
    spy.mockRestore();
  }
}

describe("«Hacer magia» when the database fails: a clear refusal, never an opaque HTTP 500, nothing left half done", () => {
  it("a database without migration 019: «unavailable» in plain words, logged as a schema mismatch; nothing created or reserved", async () => {
    const old = await createTestDb({ through: "20261001001800" });
    await old.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'");
    const u = await createUser(old, "magic-old@example.com");
    const material = await seedMaterial(old, u, fractionsAnalysis());
    const learner = await seedLearner(old, u);
    const orchestrator = makeDeps(old, scriptedServices(newSpy(), {}));
    orchestrator.entitlements = dbEntitlements(orchestrator.store);
    const deps: ServiceDeps = { orchestrator, reader: readerFor(old, u), resolveVersions: versions };
    const { result, lines } = await errorLog(() => createAndStartAdaptation(deps, { userId: u.id, workspaceId: u.workspaceId, canWrite: true }, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: "old-schema-key", creationMode: "automatic" }));
    expect(result).toEqual({ ok: false, code: "unavailable" });
    // What the screen shows: the public copy, a 503, no SQL.
    const shown = toPublic(result);
    expect(shown.ok ? "" : shown.message).toBe(PUBLIC_SERVICE_ERRORS.unavailable.message);
    expect(PUBLIC_SERVICE_ERRORS.unavailable.status).toBe(503);
    expect(PUBLIC_SERVICE_ERRORS.unavailable.message).not.toMatch(/sql|database|function|error|50\d/i);
    expect(lines.at(-1)).toMatchObject({ level: "error", event: "adaptation_create_failed", reason: "schema_mismatch", mode: "automatic", materialId: material, workspaceId: u.workspaceId });
    expect(lines.at(-1)!.detail).toMatch(/create_adaptation/);
    expect(Number((await old.query<{ c: string }>("select count(*)::text c from public.adaptations")).rows[0]!.c)).toBe(0);
    expect(Number((await old.query<{ c: string }>("select count(*)::text c from public.adaptation_entitlements")).rows[0]!.c)).toBe(0);
    await old.close();
  }, 120_000);

  it("the connection drops while creating: «unavailable», and no adaptation, reservation or job exists", async () => {
    const t = await teacher();
    t.orchestrator.store.createAdaptation = async () => {
      throw new Error("database: connection reset by peer");
    };
    const { result, lines } = await errorLog(() => t.start("automatic"));
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(lines.at(-1)).toMatchObject({ event: "adaptation_create_failed", reason: "Error", workspaceId: t.user.workspaceId });
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(0);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(0);
    expect(await count("public.adaptation_jobs j join public.adaptations a on a.id = j.adaptation_id where a.workspace_id = $1", [t.user.workspaceId])).toBe(0);
  });

  it("the database created it but the answer was lost: the teacher sees «unavailable»; the same click again finds it, one reservation, one job", async () => {
    const t = await teacher();
    const create = t.orchestrator.store.createAdaptation.bind(t.orchestrator.store);
    let lose = true;
    t.orchestrator.store.createAdaptation = async (a) => {
      const id = await create(a);
      if (lose) {
        lose = false;
        throw new Error("database: fetch failed");
      }
      return id;
    };
    const key = `lost-answer-${n}`;
    const { result: first } = await errorLog(() => t.start("automatic", key));
    expect(first).toEqual({ ok: false, code: "unavailable" });
    // Committed, with its single reservation and no job yet (the start never ran).
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    const second = await t.start("automatic", key);
    expect(second.ok).toBe(true);
    const id = second.ok ? second.data.adaptationId : "";
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(1);
  });

  it("created but the start fails: the adaptation is kept and returned (its page offers «Empezar»); retrying never duplicates work or quota", async () => {
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
    const key = `magic-retry-${n}`;
    const { result: first, lines } = await errorLog(() => t.start("automatic", key));
    expect(first.ok).toBe(true);
    const id = first.ok ? first.data.adaptationId : "";
    expect(lines.at(-1)).toMatchObject({ event: "adaptation_start_failed", adaptationId: id, reason: "Error", detail: "connection reset" });
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(0);
    // Its page: nothing is running, so it offers to start it.
    expect((await t.status(id)).nextAction).toBe("start_planning");
    // The same click again (same request key) and then «Empezar» on the page, twice: the same adaptation, one reservation, one job.
    const again = await t.start("automatic", key);
    expect(again.ok && again.data.adaptationId === id).toBe(true);
    const button = await startPlanning(t.deps, t.actor, id);
    const twice = await startPlanning(t.deps, t.actor, id);
    expect(button.ok && twice.ok && twice.data.alreadyQueued).toBe(true);
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(1);
    // And it still completes as «Hacer magia» does: delivered, the quota consumed once.
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    expect(await entitlement(id)).toBe("consumed");
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
  });

  it("«Empezar» on the page while the database fails: «unavailable» (never a throw), the adaptation untouched, and it can be pressed again", async () => {
    const t = await teacher();
    const getAdaptation = t.deps.reader.getAdaptation.bind(t.deps.reader);
    // The adaptation exists without its job (the start of «Hacer magia» failed earlier).
    let down = true;
    t.deps.reader.getAdaptation = async (id) => {
      if (down) throw new Error("database: canceling statement due to statement timeout");
      return getAdaptation(id);
    };
    const { result: created } = await errorLog(() => t.start("automatic"));
    const id = created.ok ? created.data.adaptationId : "";
    const { result, lines } = await errorLog(() => startPlanning(t.deps, t.actor, id));
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(lines.at(-1)).toMatchObject({ event: "adaptation_start_failed", adaptationId: id, workspaceId: t.user.workspaceId });
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(0);
    down = false;
    const retried = await startPlanning(t.deps, t.actor, id);
    expect(retried.ok).toBe(true);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [id])).toBe(1);
  });
});

describe("what the log keeps of an unexpected error", () => {
  it("SQL names stay, values never: quoted literals are blanked, schema drift is named, length is bounded", () => {
    expect(describeUnexpected(new Error("database: function public.create_adaptation(uuid, text) does not exist"))).toEqual({ reason: "schema_mismatch", detail: "database: function public.create_adaptation(uuid, text) does not exist" });
    expect(describeUnexpected(new Error('database: Could not find the function public.create_adaptation(p_creation_mode) in the schema cache')).reason).toBe("schema_mismatch");
    // Truncated at 160 characters by the store: the call with named arguments is still recognised; a mere mention is not.
    expect(describeUnexpected(new Error("database: function public.create_adaptation(p_workspace => unknown, p_material => unknown, p_user => unknown, p_learner => unknown, p_type =")).reason).toBe("schema_mismatch");
    expect(describeUnexpected(new Error("database: permission denied for function create_adaptation")).reason).toBe("Error");
    const value = describeUnexpected(new Error('database: invalid input syntax for type uuid: "Ficha de Marta 3ºB"'));
    expect(value.detail).toBe('database: invalid input syntax for type uuid: "…"');
    expect(describeUnexpected(new Error("database: value 'Marta García' is not allowed")).detail).not.toContain("Marta");
    expect(describeUnexpected(new Error('database: duplicate key value violates unique constraint "adaptations_request_key_key"')).detail).toContain('"adaptations_request_key_key"');
    expect(describeUnexpected(new Error("x".repeat(400))).detail).toHaveLength(160);
    expect(describeUnexpected("plain string")).toEqual({ reason: "unknown", detail: "plain string" });
  });
});
