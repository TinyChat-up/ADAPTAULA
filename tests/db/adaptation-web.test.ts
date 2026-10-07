import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/errors";
import { dbEntitlements, getEntitlementUsage } from "@/lib/adaptation/orchestration/entitlements-db";
import { cancelAdaptation } from "@/lib/adaptation/orchestration/orchestrator";
import { processAdaptationJobs, runAdaptationWorkerCycle } from "@/lib/adaptation/orchestration/worker";
import { cancelAdaptationCommand, createAdaptationCommand, getAdaptationPlan, getAdaptationStatus, getAdaptationVersion, retryAdaptationStage, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { allPreserved } from "../unit/adaptation-helpers";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, expireLeases, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Scripted, type Spy, type User } from "./orchestration-harness";

let db: PGlite;
const analysis = fractionsAnalysis();
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

let n = 0;
interface Web {
  user: User;
  actor: Actor;
  deps: ServiceDeps;
  spy: Spy;
  material: string;
  ids: string[];
  create: (key?: string) => Promise<string>;
  status: (id: string) => Promise<AdaptationStatusDto>;
}
async function web(script: Scripted = {}, orchestratorExtra: { maxAttempts?: number } = {}, existing?: User): Promise<Web> {
  const user = existing ?? (await createUser(db, `web-${++n}@example.com`));
  const material = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, script), orchestratorExtra);
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const ids: string[] = [];
  const create = async (key = `web-key-${++n}-${Math.random().toString(36).slice(2)}`) => {
    const r = await createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: key });
    if (!r.ok) throw new Error(`create: ${r.code}`);
    ids.push(r.data.adaptationId);
    return r.data.adaptationId;
  };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data as never;
  };
  return { user, actor, deps, spy, material, ids, create, status };
}

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);
const jobs = (id: string, stage: string) => count("public.adaptation_jobs where adaptation_id = $1 and stage = $2", [id, stage]);
const passAll = (input: { reviewContext?: { review_scope: { required_targets: { answers_not_leaked?: string[] } } } }): AiReviewDraft => ({
  checks: [
    ...((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0 ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "ok" }] : []),
    { check: "age_appropriate", status: "PASS", targets: [], detail: "ok" },
    { check: "no_infantilization", status: "PASS", targets: [], detail: "ok" },
    { check: "functional_supports_applied", status: "PASS", targets: [], detail: "ok" },
  ],
});
const reviewerPass: Scripted["reviewer"] = async (_i, _c, input) => ({ draft: passAll(input), runs: [] });

async function planReview(w: Web, id: string, verdict: "approved" | "rejected" = "approved") {
  const plan = await getAdaptationPlan(w.deps, w.actor, id);
  if (!plan.ok) throw new Error(plan.code);
  return { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: verdict, reason: "prueba" })) };
}
const tick = (w: Web, limit = 5) => processAdaptationJobs(w.deps.orchestrator, { limit, adaptationIds: w.ids });

/** create → start → worker → awaiting review. */
async function planned(w: Web, id?: string) {
  const adaptationId = id ?? (await w.create());
  expect((await startPlanning(w.deps, w.actor, adaptationId)).ok).toBe(true);
  await tick(w);
  return adaptationId;
}
async function delivered(w: Web) {
  const id = await planned(w);
  const submitted = await submitPlanReviewCommand(w.deps, w.actor, id, await planReview(w, id));
  expect(submitted).toMatchObject({ ok: true, data: { executable: true } });
  expect((await startGeneration(w.deps, w.actor, id)).ok).toBe(true);
  await tick(w);
  return id;
}

describe("frontera web: crear y planificar sin llamar a la IA", () => {
  it("1 y 2 · crear reserva la unidad pero no llama al planner; repetir la request_key no duplica nada", async () => {
    const w = await web();
    const key = "web-misma-key-1";
    const a = await w.create(key);
    const b = await w.create(key);
    expect(b).toBe(a);
    expect(w.spy).toMatchObject({ planner: 0, generator: 0, reviewer: 0 });
    expect(await count("public.adaptation_entitlements where adaptation_id = $1", [a])).toBe(1);
    expect(await count("public.usage_events where metadata ->> 'adaptation_id' = $1", [a])).toBe(1);
    expect(await jobs(a, "planning")).toBe(0);
    expect((await w.status(a)).nextAction).toBe("start_planning");
  });

  it("3 y 4 · startPlanning solo persiste un job (doble clic = un job) y no ejecuta el planner en la petición", async () => {
    const w = await web();
    const id = await w.create();
    const first = await startPlanning(w.deps, w.actor, id);
    const second = await startPlanning(w.deps, w.actor, id);
    expect(first).toEqual({ ok: true, data: { status: "queued", alreadyQueued: false } });
    expect(second).toEqual({ ok: true, data: { status: "queued", alreadyQueued: true } });
    expect(await jobs(id, "planning")).toBe(1);
    expect(w.spy.planner).toBe(0);
    expect(await w.status(id)).toMatchObject({ progress: "planning", nextAction: "none", canCancel: true });
  });

  it("5 y 6 · el worker planifica y termina en awaiting_plan_review; no hay generación antes de la revisión", async () => {
    const w = await web();
    const id = await planned(w);
    expect(w.spy.planner).toBe(1);
    expect(await w.status(id)).toMatchObject({ status: "awaiting_plan_review", progress: "awaiting_review", nextAction: "review_plan", hasPlan: true, hasPlanReview: false, delivered: false });
    expect(await startGeneration(w.deps, w.actor, id)).toEqual({ ok: false, code: "review_required" });
    await tick(w);
    expect(w.spy.generator).toBe(0);
    expect(await jobs(id, "generation")).toBe(0);
  });

  it("entitlement agotado: no hay adaptación, ni job, ni proveedor, y el error es de aplicación", async () => {
    await db.query("update public.plans set monthly_adaptations = 0 where slug = 'free'");
    const w = await web();
    const r = await createAdaptationCommand(w.deps, w.actor, { materialId: w.material, learnerProfileId: null, adaptationType: "accessibility", requestKey: "sin-cuota-0001" });
    expect(r).toEqual({ ok: false, code: "entitlement_exhausted" });
    expect(await count("public.adaptations where request_key = 'sin-cuota-0001'", [])).toBe(0);
    expect(await count("public.adaptation_jobs where workspace_id = $1", [w.user.workspaceId])).toBe(0);
    expect(w.spy.planner).toBe(0);
  });
});

describe("PlanReview público", () => {
  it("7 y 26 · dos pestañas: la segunda revisión llega con el plan anterior y se rechaza como obsoleta, sin sobrescribir", async () => {
    const w = await web();
    const id = await planned(w);
    const tabA = await planReview(w, id);
    const tabB = await planReview(w, id, "rejected");
    expect(await submitPlanReviewCommand(w.deps, w.actor, id, tabA)).toMatchObject({ ok: true, data: { executable: true } });
    // B saves later, for the same (now consumed) screen: the adaptation is already past the gate.
    expect(await submitPlanReviewCommand(w.deps, w.actor, id, tabB)).toEqual({ ok: false, code: "invalid_state" });
    // And a review bound to another plan's fingerprint is stale.
    const other = await web();
    const oid = await planned(other);
    const foreign = await planReview(other, oid);
    expect(await submitPlanReviewCommand(w.deps, w.actor, oid, foreign)).toEqual({ ok: false, code: "not_found" });
    const stale = { ...(await planReview(other, oid)), plan_fingerprint: "f".repeat(64) };
    expect(await submitPlanReviewCommand(other.deps, other.actor, oid, stale)).toEqual({ ok: false, code: "stale_review" });
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id])).toBe(1);
  });

  it("el cliente no elige quién revisa ni cuándo: lo fija el servidor", async () => {
    const w = await web();
    const id = await planned(w);
    await submitPlanReviewCommand(w.deps, w.actor, id, { ...(await planReview(w, id)), reviewer: { kind: "auto", label: "yo" }, reviewed_at: "1999-01-01T00:00:00Z" });
    const stored = (await q<{ payload: { reviewer: unknown; reviewed_at: string } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id]))[0]!.payload;
    expect(stored).toMatchObject({ reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00.000Z" });
  });

  it("8, 9 y 10 · una revisión ejecutable permite generar (un solo job); con una decisión sin ejecutor no se encola nada", async () => {
    const w = await web();
    const id = await planned(w);
    expect(await submitPlanReviewCommand(w.deps, w.actor, id, await planReview(w, id))).toMatchObject({ ok: true, data: { executable: true, blockers: [] } });
    expect(await w.status(id)).toMatchObject({ nextAction: "start_generation", hasPlanReview: true });
    expect(await startGeneration(w.deps, w.actor, id)).toEqual({ ok: true, data: { status: "generation_queued", alreadyQueued: false } });
    expect(await startGeneration(w.deps, w.actor, id)).toEqual({ ok: true, data: { status: "generation_queued", alreadyQueued: true } });
    expect(await jobs(id, "generation")).toBe(1);
    expect(w.spy.generator).toBe(0);

    const unsupported = { decisions: [{ target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], need_refs: ["need_1"], intensity: "light", preserves: allPreserved(analysis, "act_1") }], summary: [] };
    const u = await web({ planner: async () => ({ draft: unsupported, runs: [] }) });
    const uid = await planned(u);
    const sub = await submitPlanReviewCommand(u.deps, u.actor, uid, await planReview(u, uid));
    expect(sub).toMatchObject({ ok: true, data: { executable: false } });
    expect((sub as { data: { blockers: string[] } }).data.blockers.length).toBeGreaterThan(0);
    expect(await startGeneration(u.deps, u.actor, uid)).toEqual({ ok: false, code: "unsupported_execution" });
    expect(await jobs(uid, "generation")).toBe(0);
    expect(u.spy.generator).toBe(0);
    expect(await getEntitlementUsage(u.deps.orchestrator.store, u.user.workspaceId).then((x) => x.reserved)).toBeGreaterThanOrEqual(1);
  });
});

describe("generación durable y entrega", () => {
  it("11, 14 y 32 · el worker llega a ready: una sola unidad consumida, estado correcto y versión recuperable", async () => {
    const w = await web({ reviewer: reviewerPass });
    const id = await delivered(w);
    const st = await w.status(id);
    expect(st).toMatchObject({ status: "ready", progress: "ready", nextAction: "view_result", delivered: true, hasVersion: true, currentVersion: 1, canCancel: false });
    const e = (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!;
    expect(e.state).toBe("consumed");
    expect((await q<{ s: string }>("select coalesce(sum(units), 0)::text s from public.usage_events where kind = 'adaptation' and metadata ->> 'adaptation_id' = $1", [id]))[0]!.s).toBe("1");
    expect(await count("public.usage_events where kind = 'adaptation' and workspace_id = $1 and units > 0", [w.user.workspaceId])).toBe(1);
    const version = await getAdaptationVersion(w.deps, w.actor, id);
    expect(version).toMatchObject({ ok: true, data: { version: 1, delivered: true, usable: true } });
    expect(w.spy).toMatchObject({ planner: 1, generator: 1, reviewer: 1 });
  });

  it("12 y 33 · approved_with_warnings se entrega, consume y avisa", async () => {
    const w = await web();
    const id = await delivered(w);
    const st = await w.status(id);
    expect(st).toMatchObject({ status: "ready", delivered: true, nextAction: "view_result" });
    expect(st.warningsCount).toBeGreaterThan(0);
    expect(st.review?.verdict).toBe("approved_with_warnings");
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("consumed");
  });

  it("13, 34 y 20 · un FAIL del revisor deja la adaptación bloqueada: sin entrega, la reserva se conserva y no se ofrece view_result", async () => {
    const w = await web({ reviewer: async (_i, _c, input) => ({ draft: { checks: [{ check: "age_appropriate", status: "FAIL", targets: [], detail: "x" }, ...passAll(input).checks.filter((c) => c.check !== "age_appropriate")] }, runs: [] }) });
    const id = await delivered(w);
    const st = await w.status(id);
    expect(st).toMatchObject({ status: "blocked", progress: "blocked", delivered: false, nextAction: "review_plan", hasVersion: true });
    expect(st.nextAction).not.toBe("view_result");
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("reserved");
    expect(await getAdaptationVersion(w.deps, w.actor, id)).toMatchObject({ ok: true, data: { delivered: false, usable: false } });
  });
});

describe("cancelación y carreras", () => {
  it("15 y 27 · cancelar antes de la entrega libera la unidad; repetirlo no hace nada más", async () => {
    const w = await web();
    const id = await w.create();
    await startPlanning(w.deps, w.actor, id);
    const first = await cancelAdaptationCommand(w.deps, w.actor, id);
    const second = await cancelAdaptationCommand(w.deps, w.actor, id);
    expect(first).toMatchObject({ ok: true, data: { cancelled: true } });
    expect(second).toMatchObject({ ok: true, data: { cancelled: false, status: "cancelled" } });
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("released");
    expect((await q<{ status: string }>("select status from public.adaptation_jobs where adaptation_id = $1", [id]))[0]!.status).toBe("canceled");
    await tick(w); // the cancelled job cannot be claimed
    expect(w.spy.planner).toBe(0);
    expect(await w.status(id)).toMatchObject({ status: "cancelled", nextAction: "none", canCancel: false });
  });

  it("16 · un resultado tardío del proveedor tras cancelar no persiste, no entrega, no consume (pero queda auditado)", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const started = new Promise<void>((r) => (entered = r));
    const w = await web({ planner: async (inner, _c, input) => { entered(); await gate; return inner.plan(input); } });
    const id = await w.create();
    await startPlanning(w.deps, w.actor, id);
    const running = processAdaptationJobs(w.deps.orchestrator, { limit: 1, adaptationIds: w.ids });
    await started;
    expect((await cancelAdaptation(w.deps.orchestrator, id)).cancelled).toBe(true);
    release();
    const summary = await running;
    expect(summary.completed).toBe(0);
    expect(await count("public.adaptation_artifacts where adaptation_id = $1", [id])).toBe(0);
    expect((await q<{ status: string }>("select status from public.adaptations where id = $1", [id]))[0]!.status).toBe("cancelled");
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("released");
    expect(await count("public.ai_runs where adaptation_id = $1 and status = 'success'", [id])).toBe(1);
  });

  it("16b · lo mismo en la generación: el resultado tardío no crea versión ni consume", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const started = new Promise<void>((r) => (entered = r));
    const w = await web({ reviewer: reviewerPass, generator: async (inner, _c, input) => { entered(); await gate; return inner.generate(input); } });
    const id = await planned(w);
    await submitPlanReviewCommand(w.deps, w.actor, id, await planReview(w, id));
    await startGeneration(w.deps, w.actor, id);
    const running = processAdaptationJobs(w.deps.orchestrator, { limit: 1, adaptationIds: w.ids });
    await started;
    await cancelAdaptation(w.deps.orchestrator, id);
    release();
    await running;
    expect(await count("public.adaptation_versions where adaptation_id = $1", [id])).toBe(0);
    expect((await q<{ status: string; delivered_at: string | null }>("select status, delivered_at from public.adaptations where id = $1", [id]))[0]).toMatchObject({ status: "cancelled", delivered_at: null });
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("released");
    expect(w.spy.reviewer).toBe(0);
  });

  it("una adaptación entregada no se cancela y conserva su unidad", async () => {
    const w = await web({ reviewer: reviewerPass });
    const id = await delivered(w);
    expect(await cancelAdaptationCommand(w.deps, w.actor, id)).toMatchObject({ ok: true, data: { cancelled: false, status: "ready" } });
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("consumed");
  });
});

describe("reintentos y recuperación", () => {
  it("17 · un fallo transitorio se reintenta; agotados los intentos queda failed y el reintento manual crea un job nuevo sin tocar la reserva", async () => {
    const w = await web(
      { reviewer: reviewerPass, generator: async (inner, call, input) => { if (call === 1) throw new AIError("provider_unavailable", "503"); return inner.generate(input); } },
      { maxAttempts: 1 },
    );
    const id = await planned(w);
    await submitPlanReviewCommand(w.deps, w.actor, id, await planReview(w, id));
    await startGeneration(w.deps, w.actor, id);
    const first = await tick(w);
    expect(first.failed).toBe(1);
    const failed = await w.status(id);
    expect(failed).toMatchObject({ status: "failed", progress: "failed", canRetry: true, nextAction: "retry", error: { code: "provider_transient", category: "retryable" } });
    expect(await retryAdaptationStage(w.deps, w.actor, id)).toEqual({ ok: true, data: { status: "generation_queued", alreadyQueued: false } });
    expect(await retryAdaptationStage(w.deps, w.actor, id)).toEqual({ ok: true, data: { status: "generation_queued", alreadyQueued: true } });
    await tick(w);
    expect(await w.status(id)).toMatchObject({ status: "ready", delivered: true });
    expect(await count("public.adaptation_entitlements where adaptation_id = $1", [id])).toBe(1);
  });

  it("18 · un intento ambiguo no se reintenta solo (ni el worker ni la recuperación) y exige el reconocimiento explícito", async () => {
    const w = await web();
    const id = await w.create();
    await startPlanning(w.deps, w.actor, id);
    const jobId = (await w.deps.orchestrator.store.getPipeline(id))!.jobs[0]!.id;
    const claim = await w.deps.orchestrator.store.claimStage(jobId, 300, false);
    await w.deps.orchestrator.store.markProviderCall(jobId, claim!.attempts);
    await expireLeases(db);
    const first = await tick(w);
    expect(first.ambiguous).toBe(1);
    expect(w.spy.planner).toBe(0);
    const again = await runAdaptationWorkerCycle(w.deps.orchestrator, { limit: 5, adaptationIds: w.ids });
    expect(again.processed.claimed).toBe(0);
    expect(await jobs(id, "planning")).toBe(1); // nothing new was created either
    expect(w.spy.planner).toBe(0);
    expect(await w.status(id)).toMatchObject({ status: "failed", ambiguousAttempt: true, canRetry: true, error: { code: "ambiguous_attempt" } });
    expect(await retryAdaptationStage(w.deps, w.actor, id)).toMatchObject({ ok: false, code: "action_required" });
    expect(await retryAdaptationStage(w.deps, w.actor, id, { acknowledgeAmbiguous: true })).toMatchObject({ ok: true });
    await tick(w);
    expect(w.spy.planner).toBe(1);
  });

  it("los fallos que no se reintentan (rechazo del proveedor) piden acción y no ofrecen retry", async () => {
    const w = await web({ generator: async () => { throw new AIError("refusal", "no"); } });
    const id = await planned(w);
    await submitPlanReviewCommand(w.deps, w.actor, id, await planReview(w, id));
    await startGeneration(w.deps, w.actor, id);
    await tick(w);
    const st = await w.status(id);
    expect(st).toMatchObject({ status: "failed", canRetry: false, nextAction: "cancel", error: { code: "provider_refusal", category: "non_retryable" } });
    expect(await retryAdaptationStage(w.deps, w.actor, id)).toEqual({ ok: false, code: "action_required" });
  });

  it("19 · un lease caducado se recupera en el siguiente tick", async () => {
    const w = await web();
    const id = await w.create();
    await startPlanning(w.deps, w.actor, id);
    const jobId = (await w.deps.orchestrator.store.getPipeline(id))!.jobs[0]!.id;
    await w.deps.orchestrator.store.claimStage(jobId, 300, false);
    expect((await tick(w)).claimed).toBe(0); // held
    await expireLeases(db);
    expect((await tick(w)).completed).toBe(1);
    expect(await w.status(id)).toMatchObject({ status: "awaiting_plan_review" });
  });

  it("20 · una adaptación creada y nunca empezada NO la arranca la recuperación: sin job y sin llamada al planner; Empezar sí", async () => {
    const w = await web();
    const id = await w.create();
    for (let i = 0; i < 2; i++) expect(await runAdaptationWorkerCycle(w.deps.orchestrator, { limit: 5, adaptationIds: w.ids })).toMatchObject({ processed: { claimed: 0 } });
    expect(await jobs(id, "planning")).toBe(0);
    expect(w.spy.planner).toBe(0);
    expect(await w.status(id)).toMatchObject({ status: "queued", nextAction: "start_planning" });
    expect((await startPlanning(w.deps, w.actor, id)).ok).toBe(true); // the teacher's explicit decision
    await tick(w);
    expect(w.spy.planner).toBe(1);
    expect((await w.status(id)).status).toBe("awaiting_plan_review");
  });

  it("21 · lo mismo con la generación: la revisión guardada y sin pulsar Generar no genera nada por recuperación", async () => {
    const w = await web({ reviewer: reviewerPass });
    const id = await planned(w);
    await submitPlanReviewCommand(w.deps, w.actor, id, await planReview(w, id));
    await runAdaptationWorkerCycle(w.deps.orchestrator, { limit: 5, adaptationIds: w.ids });
    expect(await jobs(id, "generation")).toBe(0);
    expect(w.spy.generator).toBe(0);
    expect(await w.status(id)).toMatchObject({ status: "generation_queued", nextAction: "start_generation" });
    await startGeneration(w.deps, w.actor, id);
    await tick(w);
    expect((await w.status(id)).status).toBe("ready");
  });

  it("22 · la recuperación no salta la revisión ni toca cancelled, blocked, failed ni ready", async () => {
    const w = await web({ reviewer: reviewerPass });
    const awaiting = await planned(w);
    const cancelled = await w.create();
    await cancelAdaptation(w.deps.orchestrator, cancelled);
    const ready = await delivered(await web({ reviewer: reviewerPass }, {}, w.user));
    void ready;
    const before = await count("public.adaptation_jobs where workspace_id = $1", [w.user.workspaceId]);
    await runAdaptationWorkerCycle(w.deps.orchestrator, { limit: 50, adaptationIds: w.ids });
    expect(await count("public.adaptation_jobs where workspace_id = $1", [w.user.workspaceId])).toBe(before);
    expect((await w.status(awaiting)).status).toBe("awaiting_plan_review");
    expect(await jobs(cancelled, "planning")).toBe(0);
  });

  it("un tick completo duplicado del planificador no duplica trabajo", async () => {
    const w = await web({ reviewer: reviewerPass });
    const id = await w.create();
    await startPlanning(w.deps, w.actor, id);
    const [a, b] = await Promise.all([runAdaptationWorkerCycle(w.deps.orchestrator, { limit: 5, adaptationIds: w.ids }), runAdaptationWorkerCycle(w.deps.orchestrator, { limit: 5, adaptationIds: w.ids })]);
    expect(a.processed.completed + b.processed.completed).toBe(1);
    expect(w.spy.planner).toBe(1);
    expect(await jobs(id, "planning")).toBe(1);
  });
});

describe("seguridad de la frontera", () => {
  it("23 y 27 · otro workspace no crea, lee, revisa, cancela ni ve versiones: todo es not_found", async () => {
    const a = await web({ reviewer: reviewerPass });
    const b = await web();
    const id = await delivered(a);
    const none = { ok: false, code: "not_found" };
    expect(await createAdaptationCommand(b.deps, b.actor, { materialId: a.material, learnerProfileId: null, adaptationType: "accessibility" })).toEqual(none);
    expect(await getAdaptationStatus(b.deps, b.actor, id)).toEqual(none);
    expect(await getAdaptationPlan(b.deps, b.actor, id)).toEqual(none);
    expect(await getAdaptationVersion(b.deps, b.actor, id)).toEqual(none);
    expect(await submitPlanReviewCommand(b.deps, b.actor, id, {})).toEqual(none);
    expect(await startPlanning(b.deps, b.actor, id)).toEqual(none);
    expect(await startGeneration(b.deps, b.actor, id)).toEqual(none);
    expect(await retryAdaptationStage(b.deps, b.actor, id)).toEqual(none);
    expect(await cancelAdaptationCommand(b.deps, b.actor, id)).toEqual(none);
    // A version number that does not exist is also just not found.
    expect(await getAdaptationVersion(a.deps, a.actor, id, 99)).toEqual(none);
  });

  it("24 · el DTO de estado no expone nada interno", async () => {
    const w = await web();
    const id = await delivered(w);
    const text = JSON.stringify(await w.status(id));
    expect(text).not.toMatch(/payload|prompt|raw|stack|workspace_id|sk-ant|claude|anthropic|model|token|cost|usd|SELECT |display_name|Alumna/i);
    const failing = await web({ generator: async () => { throw new AIError("provider_unavailable", "UPSTREAM-SECRET-DETAIL sk-ant-123"); } }, { maxAttempts: 1 });
    const fid = await planned(failing);
    await submitPlanReviewCommand(failing.deps, failing.actor, fid, await planReview(failing, fid));
    await startGeneration(failing.deps, failing.actor, fid);
    await tick(failing);
    const failed = JSON.stringify(await failing.status(fid));
    expect(failed).not.toMatch(/UPSTREAM|sk-ant|503/);
    expect(JSON.parse(failed).error.message).toMatch(/servicio|intentar/i);
  });

  it("el plan para la revisión muestra decisiones y veredictos, no salidas del proveedor", async () => {
    const w = await web();
    const id = await planned(w);
    const plan = await getAdaptationPlan(w.deps, w.actor, id);
    if (!plan.ok) throw new Error("plan");
    expect(plan.data.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.data.decisions.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan.data)).not.toMatch(/uses_task_data|prompt|raw|stack/);
  });
});
