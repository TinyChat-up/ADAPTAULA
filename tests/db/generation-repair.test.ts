import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationPlan, getAdaptationStatus, startGeneration, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { MAX_GENERATION_CYCLES, type AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import type { AdaptationPlanner, MaterialGenerator } from "@/lib/adaptation/services";
import type { DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";
import { mathAnalysis, realDecisions, realDraft } from "../support/math-generation-case";

/**
 * «Hacer magia» and a generation that does not pass its audit (the real Matemáticas 4.º case and what a bounded automatic repair
 * may do). Real migrations (PGlite), scripted planner and generator replaying the case: 0 real model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);
const entitlement = async (id: string) => (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]?.state;
const planReviews = (id: string) => q<{ payload: { reviewer: { kind: string }; entries: Array<{ decision_id: string; action: string; reason: string }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review' order by created_at", [id]);

/** The real plan, as the planner draft v2 the server normalises (needs by position). */
const planner = async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const ref = (dim: string) => `need_${input.context.needs.findIndex((n) => n.dimension === dim) + 1}`;
  const decisions = realDecisions().map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map(ref) }));
  return { draft: { decisions, summary: ["Plan de prueba"] }, runs: [] } as never;
};

type GenInput = Parameters<MaterialGenerator["generate"]>[0];
/** The real answer, restricted to the decisions this generation carries; `tweak` plays what the model got wrong this time. */
const generator = (tweak: (draft: DraftGeneratedSegmentsV2, call: number, input: GenInput) => DraftGeneratedSegmentsV2 = (d) => d) => async (_inner: MaterialGenerator, call: number, input: GenInput) => {
  const applied = new Set(input.reviewed.effective.decisions.map((d) => d.id));
  const draft = { ...realDraft, segments: realDraft.segments.filter((s) => applied.has(s.decision_id)) };
  return { draft: tweak(draft, call, input), runs: [] } as never;
};
/** A support kind the decision does not authorise (a glossary on a checklist decision): the server drops it; the audit fails. */
const unauthorizedOn = (id: string) => (draft: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({
  ...draft,
  segments: draft.segments.map((s) => (s.decision_id === id ? { ...s, supports: [...s.supports, { kind: "glossary" as const, items: [{ term: "numerador", definition: "El número de arriba de una fracción." }] }] } : s)),
});

let n = 0;
async function teacher(gen: ReturnType<typeof generator>) {
  const u = await createUser(db, `repair-${++n}@example.com`);
  const material = await seedMaterial(db, u, mathAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner, generator: gen }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const seen: AdaptationStatusDto[] = [];
  const runAll = async (id: string) => {
    for (let i = 0; i < 12; i++) {
      seen.push(await status(id));
      if (!(await processAdaptationStage(orchestrator, id))) break;
    }
    seen.push(await status(id));
  };
  const start = async (mode: "automatic" | "review") => {
    const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `repair-${n}-${Math.random()}`, creationMode: mode });
    if (!created.ok) throw new Error(created.code);
    return created.data.adaptationId;
  };
  return { user: u, deps, actor, spy, orchestrator, status, runAll, start, seen };
}

describe("the real case (Matemáticas 4.º Primaria) now finishes by itself", () => {
  it("the same six decisions and the same answer (44/40, 68/64, a rewrite dec_2 was not asked for): delivered, one generation, one unit", async () => {
    const t = await teacher(generator());
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(t.seen.some((s) => s.phase === "awaiting_review" || s.phase === "action_required")).toBe(false);
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
    // dec_2 was told to keep the instruction (only dec_3 rewrites it), and nothing of the plan was left out.
    expect(t.spy.generatorInputs[0]!.decisions.sort()).toEqual(["dec_1", "dec_2", "dec_3", "dec_4", "dec_5", "dec_6"]);
    expect((await planReviews(id))[0]!.payload.entries.every((e) => e.action === "approved")).toBe(true);
    expect(await entitlement(id)).toBe("consumed");
  });
});

describe("«Hacer magia»: bounded automatic repair of a generation that fails its audit", () => {
  it("a defect pinned on one decision whose need another decision covers: that part keeps the original, generated again, delivered", async () => {
    const t = await teacher(generator((d, call) => (call === 1 ? unauthorizedOn("dec_4")(d) : d)));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    expect(t.seen.some((s) => s.phase === "awaiting_review" || s.phase === "action_required" || s.phase === "automatic_incomplete")).toBe(false);
    const reviews = await planReviews(id);
    expect(reviews.map((r) => r.payload.reviewer.kind)).toEqual(["auto", "auto"]);
    expect(reviews[1]!.payload.entries.find((e) => e.decision_id === "dec_4")).toMatchObject({ action: "rejected", reason: expect.stringMatching(/no superó las comprobaciones/) });
    // The worked example and the checklist of dec_2 were never touched.
    expect(reviews[1]!.payload.entries.find((e) => e.decision_id === "dec_2")).toMatchObject({ action: "approved" });
    expect(t.spy.generatorInputs[1]!.decisions).not.toContain("dec_4");
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 2, 1]);
    // Same adaptation, one reservation, one consumption.
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await entitlement(id)).toBe("consumed");
  });

  it("a genuine failure that no decision explains is NOT repaired silently: no sheet, an honest stop, the unit kept", async () => {
    // A segment for a decision that does not exist: nothing can be left out to fix it.
    const t = await teacher(generator((d) => ({ ...d, segments: [...d.segments, { decision_id: "dec_99", target: "act_1", supports: [{ kind: "reminder", text: "Recuerda contar las partes." }] }] })));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "failed", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, delivered: false, nextAction: "none", canCancel: true });
    expect(t.spy.generator).toBe(1);
    expect(await count("public.adaptation_versions where adaptation_id = $1", [id])).toBe(0);
    expect(await entitlement(id)).toBe("reserved");
  });

  it("the limit holds: at most three generations, then an honest stop; refreshing never generates again", async () => {
    // Each generation gets one decision wrong (the first one it carries); every need stays covered by another decision.
    const t = await teacher(generator((d, _call, input) => unauthorizedOn([...input.reviewed.effective.decisions].sort((a, b) => a.id.localeCompare(b.id)).find((x) => ["dec_1", "dec_4", "dec_6"].includes(x.id))!.id)(d)));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "failed", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, generationsUsed: MAX_GENERATION_CYCLES, delivered: false });
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(await entitlement(id)).toBe("reserved");
  });

  it("idempotent: two run requests racing through the repair make one generation per cycle and one consumption", async () => {
    const t = await teacher(generator((d, call) => (call === 1 ? unauthorizedOn("dec_4")(d) : d)));
    const id = await t.start("automatic");
    await processAdaptationStage(t.orchestrator, id); // planning
    await Promise.all([processAdaptationStage(t.orchestrator, id), processAdaptationStage(t.orchestrator, id)]);
    await Promise.all([processAdaptationStage(t.orchestrator, id), processAdaptationStage(t.orchestrator, id)]);
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", generationsUsed: 2 });
    expect(t.spy.generator).toBe(2);
    expect(await count("public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [id])).toBe(2);
    expect(await entitlement(id)).toBe("consumed");
  });
});

describe("«Revisar antes de crear» keeps its human approval: nothing is repaired behind the teacher's back", () => {
  it("the same failing generation in review mode is not repaired automatically (the teacher decides)", async () => {
    const t = await teacher(generator((d, call) => (call === 1 ? unauthorizedOn("dec_4")(d) : d)));
    const id = await t.start("review");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "awaiting_plan_review", phase: "awaiting_review", nextAction: "review_plan" });
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    expect((await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "ok" })) })).ok).toBe(true);
    expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "failed", phase: "action_required", automaticStop: null });
    expect(t.spy.generator).toBe(1);
    expect(await planReviews(id)).toHaveLength(1);
    expect(await entitlement(id)).toBe("reserved");
  });
});
