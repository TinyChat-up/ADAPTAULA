import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/errors";
import { AdaptationError } from "@/lib/adaptation/orchestration/errors";
import { checkAdaptationEntitlement, dbEntitlements, getEntitlementUsage } from "@/lib/adaptation/orchestration/entitlements-db";
import { cancelAdaptation, createAdaptation, reopenPlanReview, runGenerationStage, runPlanningStage, submitPlanReview, type OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import { AdaptationStore } from "@/lib/adaptation/orchestration/store";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { allPreserved } from "../unit/adaptation-helpers";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, expireLeases, newSpy, scriptedServices, seedMaterial, versions, type Scripted, type Spy, type User } from "./orchestration-harness";

let db: PGlite;
const analysis = fractionsAnalysis();
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

/** Explicit TEST fixtures: no commercial number is assumed anywhere. */
async function setPlan(limit: number | null, features: Record<string, unknown> = {}) {
  await db.query("update public.plans set monthly_adaptations = coalesce($1, monthly_adaptations), features = (features - 'unlimited_adaptations') || $2::jsonb where slug = 'free'", [limit, JSON.stringify(features)]);
}
beforeEach(() => setPlan(50));

let n = 0;
interface World {
  user: User;
  d: OrchestratorDeps & { store: AdaptationStore };
  spy: Spy;
  material: string;
  create: (key?: string, material?: string) => Promise<string>;
}
async function world(script: Scripted = {}, user?: User): Promise<World> {
  const u = user ?? (await createUser(db, `ent-${++n}@example.com`));
  const material = await seedMaterial(db, u, analysis);
  const spy = newSpy();
  const d = makeDeps(db, scriptedServices(spy, script));
  d.entitlements = dbEntitlements(d.store);
  const create = async (key = `ent-key-${++n}-${Math.random().toString(36).slice(2)}`, m = material) =>
    (await createAdaptation(d, { workspaceId: u.workspaceId, userId: u.id, materialId: m, storedAnalysis: analysis, learnerProfileId: null, profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, adaptationType: "accessibility", title: "Prueba", requestKey: key, versions: versions() })).adaptationId;
  return { user: u, d, spy, material, create };
}

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const ledger = async (id: string) => (await q<{ units: number; idempotency_key: string }>("select units, idempotency_key from public.usage_events where metadata ->> 'adaptation_id' = $1 or idempotency_key = 'refund:adaptation:' || $1 || ':reserve' order by created_at, units desc", [id]));
const state = async (id: string) => (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]?.state ?? null;
const net = async (id: string) => (await ledger(id)).reduce((a, r) => a + r.units, 0);
const passAll = (input: { reviewContext?: { review_scope: { required_targets: { answers_not_leaked?: string[] } } } }): AiReviewDraft => ({
  checks: [
    ...((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0 ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "ok" }] : []),
    { check: "age_appropriate", status: "PASS", targets: [], detail: "ok" },
    { check: "no_infantilization", status: "PASS", targets: [], detail: "ok" },
    { check: "functional_supports_applied", status: "PASS", targets: [], detail: "ok" },
  ],
});
const reviewerPass: Scripted["reviewer"] = async (_i, _c, input) => ({ draft: passAll(input), runs: [] });

async function reviewAll(w: World, id: string, verdict: "approved" | "rejected" = "approved") {
  const plan = (await w.d.store.listArtifacts(id, "plan")).at(-1)!;
  const ids = (plan.payload as { decisions: Array<{ id: string }> }).decisions.map((x) => x.id);
  return submitPlanReview(w.d, id, { schema_version: 1, plan_fingerprint: plan.fingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T10:00:00Z", entries: ids.map((x) => ({ decision_id: x, action: verdict, reason: "prueba" })) });
}
async function deliver(w: World, id: string) {
  await runPlanningStage(w.d, id);
  const r = await reviewAll(w, id);
  if (!r.ok) throw new Error(r.code);
  return { review: r.reviewFingerprint, out: await runGenerationStage(w.d, id, r.reviewFingerprint) };
}

describe("reserva", () => {
  it("1 · con disponibilidad reserva una unidad por adaptación, atómica con la creación", async () => {
    await setPlan(2);
    const w = await world();
    const id = await w.create();
    expect(await state(id)).toBe("reserved");
    expect(await net(id)).toBe(1);
    const e = await w.d.store.getEntitlement(id);
    expect(e).toMatchObject({ state: "reserved", reserve_key: `adaptation:${id}:reserve`, availability_at_reserve: "finite", limit_at_reserve: 2, consumed_at: null, released_at: null });
  });

  it("2 · sin disponibilidad no hay adaptación, ni reserva, ni planner, y el error es de aplicación", async () => {
    await setPlan(0);
    const w = await world();
    const key = "agotada-0001";
    await expect(w.create(key)).rejects.toMatchObject({ code: "entitlement_exhausted", kind: "human_action_required" });
    expect((await q("select 1 from public.adaptations where request_key = $1", [key])).length).toBe(0);
    expect((await q("select 1 from public.usage_events where kind = 'adaptation' and metadata ? 'adaptation_id' and workspace_id = $1", [w.user.workspaceId])).length).toBe(0);
    expect(w.spy.planner).toBe(0);
    const error = await w.create("agotada-0002").catch((e) => e);
    expect(error).toBeInstanceOf(AdaptationError);
    expect(error).not.toBeInstanceOf(AIError);
  });

  it("3 · dos peticiones paralelas no reservan la última unidad las dos", async () => {
    await setPlan(1);
    const w = await world();
    const m2 = await seedMaterial(db, w.user, analysis);
    const results = await Promise.allSettled([w.create("ultima-a-0001"), w.create("ultima-b-0002", m2)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const usage = await getEntitlementUsage(w.d.store, w.user.workspaceId);
    expect(usage).toMatchObject({ reserved: 1, available: 0, ledger_used: 1 });
  });

  it("4 y 22 · la misma adaptación (o la misma request_key) no reserva dos veces", async () => {
    await setPlan(5);
    const w = await world();
    const a = await w.create("misma-key-00001");
    const b = await w.create("misma-key-00001");
    expect(b).toBe(a);
    await w.d.store.reserveEntitlement(a, w.user.id);
    await w.d.store.reserveEntitlement(a, w.user.id);
    expect(await net(a)).toBe(1);
    expect((await q("select 1 from public.adaptation_entitlements where adaptation_id = $1", [a])).length).toBe(1);
  });

  it("5 · sin reserva no se llama al planner", async () => {
    const w = await world();
    const bare = makeDeps(db, scriptedServices(w.spy)); // legacy creation: no reservation
    const { adaptationId } = await createAdaptation(bare, { workspaceId: w.user.workspaceId, userId: w.user.id, materialId: w.material, storedAnalysis: analysis, learnerProfileId: null, profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, adaptationType: "accessibility", title: "x", requestKey: "sin-reserva-0001", versions: versions() });
    expect(await state(adaptationId)).toBeNull();
    const out = await runPlanningStage({ ...bare, entitlements: dbEntitlements(bare.store) }, adaptationId);
    expect(out).toMatchObject({ outcome: "rejected", code: "entitlement_not_reserved" });
    expect(w.spy.planner).toBe(0);
  });
});

describe("la reserva se mantiene mientras la adaptación siga abierta", () => {
  const stillReserved = async (id: string) => {
    expect(await state(id)).toBe("reserved");
    expect(await net(id)).toBe(1);
  };

  it("6, 7 y 10 · awaiting_plan_review, unsupported y blocked recuperable conservan la reserva", async () => {
    const unsupported = { decisions: [{ target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], need_refs: ["need_1"], intensity: "light", preserves: allPreserved(analysis, "act_1") }], summary: [] };
    const w = await world({ planner: async () => ({ draft: unsupported, runs: [] }) });
    const id = await w.create();
    await runPlanningStage(w.d, id);
    await stillReserved(id); // awaiting_plan_review
    const plan = (await w.d.store.listArtifacts(id, "plan")).at(-1)!;
    const r = await submitPlanReview(w.d, id, { schema_version: 1, plan_fingerprint: plan.fingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T10:00:00Z", entries: [{ decision_id: "dec_1", action: "approved", reason: "x" }] });
    expect(r).toMatchObject({ ok: true, executable: false });
    await stillReserved(id); // unsupported

    const b = await world({ reviewer: async (_i, _c, input) => ({ draft: { checks: [{ check: "age_appropriate", status: "FAIL", targets: [], detail: "x" }, ...passAll(input).checks.filter((c) => c.check !== "age_appropriate")] }, runs: [] }) });
    const bid = await b.create();
    const delivered = await deliver(b, bid);
    expect(delivered.out).toMatchObject({ status: "blocked", delivered: false });
    await stillReserved(bid); // 20 · a reviewer FAIL that stays recoverable consumes nothing
    expect(await reopenPlanReview(b.d, bid)).toBe("awaiting_plan_review");
    await stillReserved(bid); // reopen keeps the same unit
    const again = await reviewAll(b, bid, "rejected");
    expect(again.ok).toBe(true);
  });

  it("8, 9 y 19 · un fallo transitorio, un intento ambiguo y una generación inválida no liberan ni consumen", async () => {
    const t = await world({ generator: async (inner, call, input) => { if (call === 1) throw new AIError("provider_unavailable", "503"); return inner.generate(input); }, reviewer: reviewerPass });
    const tid = await t.create();
    await runPlanningStage(t.d, tid);
    const rv = await reviewAll(t, tid);
    if (!rv.ok) throw new Error("review");
    expect((await runGenerationStage(t.d, tid, rv.reviewFingerprint)).outcome).toBe("retry");
    await stillReserved(tid);

    const a = await world();
    const aid = await a.create();
    const q2 = await a.d.store.enqueueStage(aid, "planning", "c".repeat(64), 3);
    const claim = await a.d.store.claimStage(q2.jobId, 300, false);
    await a.d.store.markProviderCall(q2.jobId, claim!.attempts);
    await expireLeases(db);
    expect((await runPlanningStage(a.d, aid)).code).toBe("ambiguous_attempt");
    expect(await state(aid)).toBe("reserved");
    expect(await net(aid)).toBe(1);

    const g = await world({ generator: async () => { throw new AIError("invalid_output", "schema"); } });
    const gid = await g.create();
    await runPlanningStage(g.d, gid);
    const rg = await reviewAll(g, gid);
    if (!rg.ok) throw new Error("review");
    expect((await runGenerationStage(g.d, gid, rg.reviewFingerprint)).status).toBe("failed");
    await stillReserved(gid);
  });
});

describe("liberación", () => {
  it("11, 12 y 27 · cancelar una adaptación no entregada devuelve la unidad; repetirlo no la devuelve dos veces", async () => {
    await setPlan(3);
    const w = await world();
    const id = await w.create();
    expect((await getEntitlementUsage(w.d.store, w.user.workspaceId)).reserved).toBe(1);
    expect(await cancelAdaptation(w.d, id)).toMatchObject({ cancelled: true });
    expect(await state(id)).toBe("released");
    expect(await net(id)).toBe(0);
    expect(await cancelAdaptation(w.d, id)).toMatchObject({ cancelled: false, status: "cancelled" });
    expect(await w.d.store.releaseEntitlement(id, "otra vez")).toMatchObject({ released: true, duplicate: true });
    expect(await net(id)).toBe(0);
    expect((await ledger(id)).map((r) => r.units)).toEqual([1, -1]);
    expect((await w.d.store.getEntitlement(id))).toMatchObject({ state: "released", release_key: `refund:adaptation:${id}:reserve`, release_reason: "cancelled" });
    expect((await getEntitlementUsage(w.d.store, w.user.workspaceId)).reserved).toBe(0);
  });

  it("solo se libera una adaptación cerrada: una abierta no se libera, aunque alguien lo pida", async () => {
    const w = await world();
    const id = await w.create();
    expect(await w.d.store.releaseEntitlement(id, "intento")).toMatchObject({ released: false, reason: "not_closed" });
    expect(await state(id)).toBe("reserved");
  });
});

describe("consumo ligado a la entrega", () => {
  it("13 y 14 · ready consume exactamente una vez, en la misma transacción; consumir de nuevo no hace nada", async () => {
    const w = await world({ reviewer: reviewerPass });
    const id = await w.create();
    const { out } = await deliver(w, id);
    expect(out).toMatchObject({ status: "ready", delivered: true });
    expect(await state(id)).toBe("consumed");
    expect(await net(id)).toBe(1);
    expect(await w.d.store.consumeEntitlement(id)).toMatchObject({ consumed: true, duplicate: true });
    expect(await w.d.store.consumeEntitlement(id)).toMatchObject({ consumed: true, duplicate: true });
    expect(await net(id)).toBe(1);
    const e = (await w.d.store.getEntitlement(id))!;
    expect(e.consumed_at).not.toBeNull();
  });

  it("18 · no se puede consumir sin una entrega válida, ni con una revisión no utilizable", async () => {
    const w = await world();
    const id = await w.create();
    expect(await w.d.store.consumeEntitlement(id)).toMatchObject({ consumed: false, reason: "not_delivered" });
    // Forged "ready": delivered_at and version pointing at a review that is not usable.
    await db.query("insert into public.adaptation_versions (adaptation_id, workspace_id, version, document, review, source) values ($1, $2, 1, '{}'::jsonb, '{\"verdict\":\"blocked\"}'::jsonb, 'ai_generated')", [id, w.user.workspaceId]);
    await db.query("update public.adaptations set status = 'ready', current_version = 1, delivered_at = now() where id = $1", [id]);
    expect(await w.d.store.consumeEntitlement(id)).toMatchObject({ consumed: false, reason: "not_delivered" });
    expect(await state(id)).toBe("reserved");
  });

  it("23 · si el proceso muere justo tras entregar, la unidad ya está consumida (atómico) y reanudar no la consume otra vez", async () => {
    const w = await world({ reviewer: reviewerPass });
    const id = await w.create();
    await runPlanningStage(w.d, id);
    const rv = await reviewAll(w, id);
    if (!rv.ok) throw new Error("review");
    let dead = false;
    const guarded = new Proxy(w.d.store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          if (dead) throw new Error("process died");
          const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          if (prop === "finalize") dead = true; // delivered in the database; the process dies before anything else
          return out;
        };
      },
    }) as AdaptationStore;
    await expect(runGenerationStage({ ...w.d, store: guarded }, id, rv.reviewFingerprint)).rejects.toThrow("process died");
    expect(await state(id)).toBe("consumed");
    expect((await q<{ status: string }>("select status from public.adaptations where id = $1", [id]))[0]!.status).toBe("ready");
    expect(await net(id)).toBe(1);
    await expireLeases(db);
    expect((await runGenerationStage(w.d, id, rv.reviewFingerprint)).outcome).toBe("reused");
    expect(await net(id)).toBe(1);
  });

  it("si el consumo no es posible, la entrega se revierte entera (nunca ready con la cuota sin consumir)", async () => {
    const w = await world({ reviewer: reviewerPass });
    const id = await w.create();
    await runPlanningStage(w.d, id);
    const rv = await reviewAll(w, id);
    if (!rv.ok) throw new Error("review");
    // The unit was released behind our back (it must not happen, but the DB refuses to deliver without it).
    await db.query("update public.adaptation_entitlements set state = 'released', released_at = now() where adaptation_id = $1", [id]);
    const out = await runGenerationStage(w.d, id, rv.reviewFingerprint);
    expect(out.outcome).not.toBe("completed");
    expect((await q<{ status: string; delivered_at: string | null }>("select status, delivered_at from public.adaptations where id = $1", [id]))[0]).toMatchObject({ delivered_at: null });
    expect((await q<{ status: string }>("select status from public.adaptations where id = $1", [id]))[0]!.status).not.toBe("ready");
  });
});

describe("una adaptación entregada es una sola unidad, hagas lo que hagas después", () => {
  it("15, 16 y 17 · otra versión o una edición docente no consumen otra unidad; cancelar tras la entrega no devuelve nada", async () => {
    await setPlan(10);
    const w = await world({ reviewer: reviewerPass });
    const id = await w.create();
    await deliver(w, id);
    expect(await net(id)).toBe(1);
    // A second AI version and a later teacher edit (as the teacher, under RLS): same unit.
    const v2 = await w.d.store.persistVersion(id, null, { n: 2 }, { plan: "a".repeat(64), review: "b".repeat(64), generation: "d".repeat(64) });
    await db.query("update public.adaptations set current_version = $2 where id = $1", [id, v2.version]);
    expect(await w.d.store.consumeEntitlement(id)).toMatchObject({ consumed: true, duplicate: true });
    await as(db, "authenticated", w.user.id, () => db.query("insert into public.adaptation_versions (adaptation_id, workspace_id, version, document, review, source, created_by) values ($1, $2, 3, '{}'::jsonb, null, 'teacher_edit', $3)", [id, w.user.workspaceId, w.user.id]));
    expect(await net(id)).toBe(1);
    expect(await state(id)).toBe("consumed");
    expect((await cancelAdaptation(w.d, id)).cancelled).toBe(false);
    expect(await w.d.store.releaseEntitlement(id, "intento")).toMatchObject({ released: false, reason: "delivered" });
    expect(await net(id)).toBe(1);
    expect((await q("select 1 from public.adaptation_entitlements where adaptation_id = $1", [id])).length).toBe(1);
  });

  it("una adaptación NUEVA sí es otra unidad", async () => {
    await setPlan(10);
    const w = await world({ reviewer: reviewerPass });
    const a = await w.create();
    const b = await w.create();
    expect(a).not.toBe(b);
    expect((await getEntitlementUsage(w.d.store, w.user.workspaceId)).reserved).toBe(2);
  });
});

describe("límite sin número mágico ni saldo inventado", () => {
  it("24 · sin límite funciona de forma explícita y no devuelve un «disponible» inventado", async () => {
    await setPlan(0, { unlimited_adaptations: true });
    const w = await world();
    for (let i = 0; i < 3; i++) await w.create();
    const usage = await getEntitlementUsage(w.d.store, w.user.workspaceId);
    expect(usage).toMatchObject({ availability: "unlimited", limit: null, available: null });
    expect(usage.reserved).toBeGreaterThanOrEqual(3);
    expect(await checkAdaptationEntitlement(w.d.store, w.user.workspaceId)).toMatchObject({ allowed: true, availability: "unlimited" });
  });

  it("25 · sin configuración válida no hay saldo: ni cero ni infinito, y no se reserva", async () => {
    await setPlan(5, { unlimited_adaptations: "quizá" });
    const w = await world();
    const usage = await getEntitlementUsage(w.d.store, w.user.workspaceId);
    expect(usage).toMatchObject({ availability: "unavailable", limit: null, available: null });
    await expect(w.create()).rejects.toMatchObject({ code: "entitlement_unavailable" });
    expect(await checkAdaptationEntitlement(w.d.store, w.user.workspaceId)).toMatchObject({ allowed: false, availability: "unavailable" });
    await setPlan(5);
    await db.query("update public.plans set slug = 'free-off' where slug = 'free'");
    try {
      expect((await getEntitlementUsage(w.d.store, w.user.workspaceId)).availability).toBe("unavailable");
      await expect(w.create()).rejects.toMatchObject({ code: "entitlement_unavailable" });
    } finally {
      await db.query("update public.plans set slug = 'free' where slug = 'free-off'");
    }
  });

  it("26 · el uso informa de límite, reservadas, consumidas y disponibles", async () => {
    await setPlan(4);
    const w = await world({ reviewer: reviewerPass });
    const base = await getEntitlementUsage(w.d.store, w.user.workspaceId);
    expect(base).toMatchObject({ availability: "finite", limit: 4, reserved: 0, consumed: 0, available: 4 });
    const a = await w.create();
    const b = await w.create();
    await w.create();
    await deliver(w, a);
    await cancelAdaptation(w.d, b);
    expect(await getEntitlementUsage(w.d.store, w.user.workspaceId)).toMatchObject({ limit: 4, reserved: 1, consumed: 1, available: 2, ledger_used: 2 });
    // The limit changes later: the existing unit keeps its identity, only what is available changes.
    await setPlan(2);
    expect((await w.d.store.getEntitlement(a))).toMatchObject({ state: "consumed", limit_at_reserve: 4 });
    expect(await getEntitlementUsage(w.d.store, w.user.workspaceId)).toMatchObject({ limit: 2, available: 0, ledger_used: 2 });
  });
});

describe("aislamiento y análisis", () => {
  it("21 · otro workspace no ve la reserva ni usa su saldo", async () => {
    await setPlan(1);
    const a = await world();
    const b = await world();
    const id = await a.create();
    const theirs = await as(db, "authenticated", b.user.id, () => db.query("select 1 from public.adaptation_entitlements where adaptation_id = $1", [id]));
    expect(theirs.rows).toEqual([]);
    const mine = await as(db, "authenticated", a.user.id, () => db.query("select 1 from public.adaptation_entitlements where adaptation_id = $1", [id]));
    expect(mine.rows).toHaveLength(1);
    // B still has its own unit: A's reservation consumed nothing of B's.
    await expect(b.create()).resolves.toBeTruthy();
    await expect(as(db, "authenticated", b.user.id, () => db.query("select public.reserve_adaptation_entitlement($1, $2)", [id, b.user.id]))).rejects.toThrow();
  });

  it("27 · la cuota de análisis no cambia: las adaptaciones no la tocan y su función sigue reservando como antes", async () => {
    await setPlan(5);
    const w = await world();
    await w.create();
    const analysisBefore = (await q<{ n: string }>("select count(*)::text n from public.usage_events where workspace_id = $1 and kind = 'analysis'", [w.user.workspaceId]))[0]!.n;
    expect(analysisBefore).toBe("0");
    const res = await as(db, "service_role", null, () => db.query<{ r: { allowed: boolean } }>("select public.consume_quota($1, 'analysis', 1, $2, null, $3) as r", [w.user.workspaceId, w.user.id, `analysis:test-${n}`]));
    expect(res.rows[0]!.r.allowed).toBe(true);
    expect((await getEntitlementUsage(w.d.store, w.user.workspaceId)).ledger_used).toBe(1);
  });

  it("28 · el orquestador no conoce planes ni precios", () => {
    const dir = path.resolve(import.meta.dirname, "../../src/lib/adaptation/orchestration");
    for (const file of ["orchestrator.ts", "entitlements.ts", "entitlements-db.ts", "service.ts"]) {
      const text = readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/plan\s*===|\bfree\b|\bpro\b|\bmax\b|stripe|price_id|monthly_adaptations/i);
    }
  });
});
