import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { runGenerationStage, latestReviewFingerprint } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, getAdaptationStatus, startGeneration, submitPlanReviewCommand, getAdaptationPlan, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { MAX_GENERATION_CYCLES, type AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import type { AdaptationPlanner, PedagogicalReviewer } from "@/lib/adaptation/services";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";

/**
 * «Hacer magia» is really automatic (docs/ADAPTATION.md § Hacer magia): material + profile → finished sheet, with no plan approval
 * at any point. What the executors cannot do is resolved with real capabilities, a failed quality review is corrected when that is
 * safe, and when the sheet cannot be finished the teacher is told so honestly (editing is offered, never imposed). Real migrations
 * (PGlite), scripted planner and reviewer: 0 real model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);
const entitlement = async (id: string) => (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]?.state;
const planReviews = (id: string) => q<{ payload: { reviewer: { kind: string }; entries: Array<{ decision_id: string; action: string; reason: string; edits?: Record<string, unknown> }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review' order by created_at", [id]);

/** A planner decision for a need of the profile, by dimension (the draft refers to needs by position). */
type Need = "planning_support" | "working_memory_support" | "instruction_chunking";
type DraftDecision = { need: Need } & Record<string, unknown>;
const checklistDoc: DraftDecision = { target: "document", action: "add_support", strategies: ["planning_support"], need: "planning_support", intensity: "light", supports: [{ kind: "checklist", uses_task_data: false }] };
const plannerAct5: DraftDecision = { target: "act_5", action: "add_support", strategies: ["planning_support"], need: "planning_support", intensity: "light", supports: [{ kind: "planner", uses_task_data: false }] };
const stepsAct3: DraftDecision = { target: "act_3", action: "add_support", strategies: ["planning_support"], need: "planning_support", intensity: "light", supports: [{ kind: "planner", uses_task_data: false }] };
/** No executor: a short instruction cannot be rewritten. Alternative: a list of steps (instruction clarification). */
const clarifyAct1: DraftDecision = { target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], need: "instruction_chunking", intensity: "light" };
/** No executor and NO alternative: choosing between options needs an answer key; it is not «less writing». */
const chooseAct4: DraftDecision = { target: "act_4", action: "change_response_format", strategies: ["response_choice"], need: "working_memory_support", intensity: "light", response_target: "select_option" };

const plannerOf = (decisions: DraftDecision[]) => async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const ref = (dim: Need) => `need_${input.context.needs.findIndex((n) => n.dimension === dim) + 1}`;
  return { draft: { decisions: decisions.map(({ need, ...d }) => ({ ...d, need_refs: [ref(need)] })), summary: ["Plan de prueba"] }, runs: [] } as never;
};

/** The mock reviewer's draft with one finding replaced: what a real reviewer could say. */
type ReviewInput = Parameters<PedagogicalReviewer["review"]>[0];
const reviewWith = async (inner: PedagogicalReviewer, input: ReviewInput, finding: AiReviewDraft["checks"][number] | null) => {
  const base = (await inner.review(input)).draft as AiReviewDraft;
  return { draft: finding ? { checks: [...base.checks.filter((c) => c.check !== finding.check), finding] } : base, runs: [] };
};
/** The first applied decision that produced a block in the reviewed sheet: the one a finding points at. */
const firstAdapted = (input: ReviewInput) => input.document.pages.flatMap((p) => p.blocks).find((b) => b.trace.origin !== "original" && b.trace.origin !== "structure" && b.trace.decision_ids.length > 0)!.trace.decision_ids[0]!;

let n = 0;
async function teacher(script: Parameters<typeof scriptedServices>[1] = {}) {
  const u = await createUser(db, `auto-${++n}@example.com`);
  const material = await seedMaterial(db, u, fractionsAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, script));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const seen: AdaptationStatusDto[] = [];
  /** What the screen does: run requests until nothing is left to run (bounded), watching every state the teacher could see. */
  const runAll = async (id: string) => {
    for (let i = 0; i < 12; i++) {
      seen.push(await status(id));
      if (!(await processAdaptationStage(orchestrator, id))) break;
    }
    seen.push(await status(id));
  };
  const magic = async () => {
    const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `auto-${n}-${Math.random()}`, creationMode: "automatic" });
    if (!created.ok) throw new Error(created.code);
    return created.data.adaptationId;
  };
  return { user: u, deps, actor, spy, orchestrator, status, runAll, magic, seen };
}

/** The plan screen is never shown in «Hacer magia» unless the teacher chooses it. */
const neverAskedToApprove = (seen: AdaptationStatusDto[]) => expect(seen.filter((s) => s.phase === "awaiting_review" || s.nextAction === "start_generation")).toEqual([]);

describe("«Hacer magia» finishes the sheet by itself", () => {
  it("an executable plan goes straight to the finished sheet: no plan approval, no click after it, one unit consumed", async () => {
    const t = await teacher({ planner: plannerOf([checklistDoc]) });
    const id = await t.magic();
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", phase: "ready", delivered: true, automaticStop: null });
    neverAskedToApprove(t.seen);
    expect((await planReviews(id)).map((r) => r.payload.reviewer.kind)).toEqual(["auto"]);
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 1, 1]);
    expect(await entitlement(id)).toBe("consumed");
  });

  it("a decision no executor can run, with a valid alternative, is resolved without asking anyone (and the alternative is what is generated)", async () => {
    const t = await teacher({ planner: plannerOf([checklistDoc, clarifyAct1]) });
    const id = await t.magic();
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    neverAskedToApprove(t.seen);
    const entry = (await planReviews(id))[0]!.payload.entries.find((e) => e.decision_id === "dec_2")!;
    expect(entry).toMatchObject({ action: "edited", edits: { action: "add_support", supports: [{ kind: "step_list", uses_task_data: false }] } });
    expect(t.spy.generatorInputs[0]!.decisions.sort()).toEqual(["dec_1", "dec_2"]);
  });

  it("WARN: delivered with its observations, nobody approves each one", async () => {
    const t = await teacher({ planner: plannerOf([checklistDoc]), reviewer: (inner, _c, input) => reviewWith(inner, input, { check: "age_appropriate", status: "WARN", targets: [], detail: "Algún término puede resultar técnico" }) });
    const id = await t.magic();
    await t.runAll(id);
    const done = await t.status(id);
    expect(done).toMatchObject({ status: "ready", delivered: true, review: { verdict: "approved_with_warnings" } });
    expect(done.review!.warnings.map((w) => w.check)).toContain("age_appropriate");
    neverAskedToApprove(t.seen);
  });
});

describe("«Hacer magia» never drops an important need to finish, and says so", () => {
  it("a decision for a high need with no executor and no alternative: no sheet, an honest stop, nothing generated, the unit kept", async () => {
    const t = await teacher({ planner: plannerOf([checklistDoc, chooseAct4]) });
    const id = await t.magic();
    await t.runAll(id);
    const stopped = await t.status(id);
    expect(stopped).toMatchObject({ status: "awaiting_plan_review", phase: "automatic_incomplete", automaticStop: { reason: "needs_decision", needs: ["working_memory_support"] }, nextAction: "review_plan", delivered: false });
    neverAskedToApprove(t.seen);
    expect([t.spy.generator, t.spy.reviewer]).toEqual([0, 0]);
    expect(await entitlement(id)).toBe("reserved");
    // No loop: more run requests (a refresh, another tab) do nothing.
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect(await planReviews(id)).toHaveLength(1);
  });

  it("editing stays the teacher's CHOICE: their review takes over, and from there the manual rules apply (same adaptation, same unit)", async () => {
    const t = await teacher({ planner: plannerOf([checklistDoc, chooseAct4]) });
    const id = await t.magic();
    await t.runAll(id);
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    const saved = await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: [{ decision_id: "dec_1", action: "approved", reason: "ok" }, { decision_id: "dec_2", action: "rejected", reason: "Lo trabajo en clase" }] });
    expect(saved).toMatchObject({ ok: true, data: { executable: true } });
    expect(await t.status(id)).toMatchObject({ phase: "working", nextAction: "start_generation", automaticStop: null });
    expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await entitlement(id)).toBe("consumed");
  });
});

describe("«Hacer magia» after a quality review that fails", () => {
  it("FAIL caused by one decision's blocks: corrected automatically (that part goes back to the original) and delivered; one unit, one adaptation", async () => {
    const t = await teacher({
      planner: plannerOf([checklistDoc, plannerAct5]),
      reviewer: (inner, call, input) => reviewWith(inner, input, call === 1 ? { check: "no_infantilization", status: "FAIL", targets: [firstAdapted(input)], detail: "Tono infantil en el apoyo" } : null),
    });
    const id = await t.magic();
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    neverAskedToApprove(t.seen);
    expect(t.seen.some((s) => s.phase === "ready" && s.review?.verdict === "needs_revision")).toBe(false);
    const reviews = await planReviews(id);
    expect(reviews.map((r) => r.payload.reviewer.kind)).toEqual(["auto", "auto"]);
    expect(reviews[1]!.payload.entries.find((e) => e.decision_id === "dec_1")).toMatchObject({ action: "rejected", reason: expect.stringMatching(/se mantiene el original/) });
    expect([t.spy.planner, t.spy.generator, t.spy.reviewer]).toEqual([1, 2, 2]);
    expect(await entitlement(id)).toBe("consumed");
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
  });

  it("FAIL whose only correction would leave a high need without any support: not corrected, never delivered, an honest stop", async () => {
    const t = await teacher({ planner: plannerOf([checklistDoc]), reviewer: (inner, _c, input) => reviewWith(inner, input, { check: "no_infantilization", status: "FAIL", targets: [firstAdapted(input)], detail: "Tono infantil" }) });
    const id = await t.magic();
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "blocked", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, delivered: false });
    expect(t.spy.generator).toBe(1);
    expect(await entitlement(id)).toBe("reserved");
  });

  it("the generation limit holds: at most three generations, then an honest stop (no more regenerations, no new unit)", async () => {
    const t = await teacher({
      planner: plannerOf([checklistDoc, plannerAct5, stepsAct3]),
      reviewer: (inner, _c, input) => reviewWith(inner, input, { check: "no_infantilization", status: "FAIL", targets: [firstAdapted(input)], detail: "Tono infantil" }),
    });
    const id = await t.magic();
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "blocked", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, regenerationAvailable: false, nextAction: "none", generationsUsed: MAX_GENERATION_CYCLES });
    expect([t.spy.generator, t.spy.reviewer]).toEqual([MAX_GENERATION_CYCLES, MAX_GENERATION_CYCLES]);
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(await entitlement(id)).toBe("reserved");
  });

  it("refresh after a crash between the failed review and its correction: the next run request corrects it, once", async () => {
    const t = await teacher({
      planner: plannerOf([checklistDoc, plannerAct5]),
      reviewer: (inner, call, input) => reviewWith(inner, input, call === 1 ? { check: "no_infantilization", status: "FAIL", targets: [firstAdapted(input)], detail: "Tono infantil" } : null),
    });
    const id = await t.magic();
    await processAdaptationStage(t.orchestrator, id); // planning → generation queued
    // The generation ran, but the process died before the correction (no worker continuation).
    await runGenerationStage(t.orchestrator, id, (await latestReviewFingerprint(t.orchestrator.store, id))!);
    expect((await t.status(id)).status).toBe("blocked");
    await t.runAll(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    expect(t.spy.generator).toBe(2);
  });
});
