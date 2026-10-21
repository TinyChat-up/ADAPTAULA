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

/** The real plan (or a variant of it), as the planner draft v2 the server normalises (needs by position). */
const plannerWith = (decisions: ReturnType<typeof realDecisions>) => async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const ref = (dim: string) => `need_${input.context.needs.findIndex((n) => n.dimension === dim) + 1}`;
  return { draft: { decisions: decisions.map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map(ref) })), summary: ["Plan de prueba"] }, runs: [] } as never;
};
const planner = plannerWith(realDecisions());
/** Restrictions the generation carries for a decision (what a repair asked it to fix). */
const restrictionsOf = (input: GenInput, id: string) => input.reviewed.decisions.find((d) => d.id === id)?.restrictions ?? [];
const longChecklist = { kind: "checklist" as const, items: ["Cuento con cuidado todas las partes iguales en que está dividida la figura", "Miro el número de abajo para saber en cuántas partes iguales se divide", "Miro el número de arriba para saber cuántas de esas partes debo colorear", "Coloreo con un solo color y repaso que no me sobra ni me falta ninguna"] };

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
async function teacher(gen: ReturnType<typeof generator>, plan = planner) {
  const u = await createUser(db, `repair-${++n}@example.com`);
  const material = await seedMaterial(db, u, mathAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner: plan, generator: gen }));
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
  it("content first: the failing decision is regenerated with a restriction that names the fix — kept, not removed — and delivered", async () => {
    // The model gets dec_4 wrong until it is told precisely what to fix.
    const t = await teacher(generator((d, _call, input) => (restrictionsOf(input, "dec_4").length === 0 ? unauthorizedOn("dec_4")(d) : d)));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    expect(t.seen.some((s) => s.phase === "awaiting_review" || s.phase === "action_required" || s.phase === "automatic_incomplete")).toBe(false);
    const reviews = await planReviews(id);
    expect(reviews.map((r) => r.payload.reviewer.kind)).toEqual(["auto", "auto"]);
    const repaired = reviews[1]!.payload.entries;
    expect(repaired.find((e) => e.decision_id === "dec_4")).toMatchObject({ action: "approved", restrictions: [expect.stringMatching(/solo los apoyos que autoriza/)] });
    expect(repaired.every((e) => e.action !== "rejected")).toBe(true); // nothing of the plan was left out
    // Localized: the repair asks the model ONLY for the decision that failed; the five valid ones are kept from the first draft.
    expect(t.spy.generatorInputs[1]!.decisions).toEqual(["dec_4"]);
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 2, 1]);
    const generations = await q<{ payload: { reused_from?: string; regenerated?: string[] } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'generation' order by created_at", [id]);
    expect(generations.at(-1)!.payload).toMatchObject({ reused_from: expect.any(String), regenerated: ["dec_4"] });
    // Same adaptation, one reservation, one consumption.
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await entitlement(id)).toBe("consumed");
  });

  it("a support out of budget is regenerated with an explicit word limit (never cut, never accepted as is) and delivered", async () => {
    const t = await teacher(generator((d, _call, input) => (restrictionsOf(input, "dec_1").some((r) => /como máximo 40 palabras/.test(r)) ? d : { ...d, segments: d.segments.map((s) => (s.decision_id === "dec_1" ? { ...s, supports: [longChecklist] } : s)) })));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    const entry = (await planReviews(id))[1]!.payload.entries.find((e) => e.decision_id === "dec_1");
    expect(entry).toMatchObject({ action: "approved", restrictions: [expect.stringMatching(/como máximo 40 palabras visibles/)] });
    expect(t.spy.generator).toBe(2);
    expect(await entitlement(id)).toBe("consumed");
  });

  it("a decision that fails again after its repair is NOT dropped when a need it attends (here a MEDIUM one) has no other support: honest stop", async () => {
    // dec_1 alone attends «checklist_support» (medium in this profile); the model never fixes it.
    const variant = realDecisions().map((d, i) => (i === 0 ? { ...d, dimensions: ["checklist_support" as const] } : d));
    const t = await teacher(generator(unauthorizedOn("dec_1")), plannerWith(variant));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "failed", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, delivered: false });
    const reviews = await planReviews(id);
    expect(reviews).toHaveLength(2); // the content repair was tried once
    expect(reviews.flatMap((r) => r.payload.entries).some((e) => e.decision_id === "dec_1" && e.action === "rejected")).toBe(false);
    expect(t.spy.generator).toBe(2);
    expect(await entitlement(id)).toBe("reserved");
  });

  it("only after its repair failed again, and only with every need still covered, is a decision left out (its part keeps the original)", async () => {
    // dec_4 (working memory) also covered by dec_2: the model never fixes dec_4.
    const t = await teacher(generator(unauthorizedOn("dec_4")));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 3 });
    const reviews = await planReviews(id);
    expect(reviews[1]!.payload.entries.find((e) => e.decision_id === "dec_4")).toMatchObject({ action: "approved" });
    expect(reviews[2]!.payload.entries.find((e) => e.decision_id === "dec_4")).toMatchObject({ action: "rejected", reason: expect.stringMatching(/volvió a fallar tras corregirlo.*siguen cubiertas/) });
    // Hacer magia 2.0: the third generation only leaves dec_4 out, so nothing is asked of the model: the valid output is reused.
    expect(t.spy.generator).toBe(2);
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

  it("no progress: the same failures on the same decisions stop after two generations (never a third identical one), diagnosed", async () => {
    // Every decision the model is asked for comes back with an unauthorised support, again and again (dec_2, dec_3 and dec_5 are
    // the only cover of their needs, so leaving them out is never allowed).
    const breakAll = (d: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...d, segments: d.segments.map((s) => ({ ...s, supports: [...s.supports, { kind: "glossary" as const, items: [{ term: "fracción", definition: "Partes iguales de un todo." }] }] })) });
    const t = await teacher(generator(breakAll));
    const id = await t.start("automatic");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "failed", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, delivered: false });
    expect((await t.status(id)).generationsUsed).toBeLessThanOrEqual(MAX_GENERATION_CYCLES);
    expect(t.spy.generator).toBe(2);
    // The stop is explained by rule and decision (never only «generator_validation»).
    const diagnosis = (await q<{ payload: { diagnosis?: { failures: Array<{ category: string; rule: string; decisions: string[]; repair: string }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' and payload ? 'diagnosis'", [id])).at(-1)?.payload.diagnosis;
    expect(diagnosis?.failures.some((f) => f.category === "unauthorized_block" && f.decisions.length > 0)).toBe(true);
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect(t.spy.generator).toBe(2);
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
