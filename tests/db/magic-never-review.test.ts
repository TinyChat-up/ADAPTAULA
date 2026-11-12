import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { latestReviewFingerprint, reopenPlanReview, runGenerationStage } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, getAdaptationPlan, getAdaptationStatus, getAdaptationVersion, startGeneration, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { MAX_GENERATION_CYCLES, type AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { screenFor } from "@/lib/adaptation/presentation/view-model";
import type { AdaptationPlanner, MaterialGenerator, PedagogicalReviewer } from "@/lib/adaptation/services";
import type { DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { AiReviewDraft, PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";
import { protectedFor } from "@/lib/adaptation/facts";
import { cellDecisions, cellLeaking, cellPilotAnalysis, cellSafe } from "../support/cell-pilot";
import { coverDecision, coverSegment, dec3Rewrite, mathAnalysis, realDecisions, realDraft } from "../support/math-generation-case";

/** The real plan plus a working-memory decision on act_3 itself: leaving dec_2 out keeps that need covered ON THAT ACTIVITY. */
const withCover = [...realDecisions(), coverDecision(mathAnalysis(), "act_3")];

/**
 * HOTFIX «Hacer magia sigue obligando al docente a revisar» (Matemáticas 4.º de Primaria, fracciones). A magic adaptation whose
 * sheet fails the protected-content or the revealed-answer check is REPAIRED by itself (the original put back, or only the
 * offending support regenerated), within the 3 generations and with the same unit; one that cannot be repaired stops honestly. It
 * never lands on the plan gate or on «Revisar adaptación». «Revisar antes de crear» keeps both. Real migrations (PGlite), scripted
 * planner, generator and reviewer: 0 real model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);
const entitlement = async (id: string) => (await q<{ state: string; consumed_at: string | null }>("select state, consumed_at from public.adaptation_entitlements where adaptation_id = $1", [id]))[0];
const planReviews = (id: string) => q<{ payload: { reviewer: { kind: string }; entries: Array<{ decision_id: string; action: string; restrictions?: string[] }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review' order by created_at", [id]);
const stops = (id: string) => q<{ payload: { automatic_stop: string } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' and payload ? 'automatic_stop' order by created_at", [id]);
const reviewsOf = (id: string) => q<{ review: PedagogicalReview }>("select review from public.adaptation_versions where adaptation_id = $1 order by version", [id]);

type Decisions = ReturnType<typeof realDecisions>;
const plannerWith = (decisions: Decisions) => async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const ref = (dim: string) => `need_${input.context.needs.findIndex((n) => n.dimension === dim) + 1}`;
  return { draft: { decisions: decisions.map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map(ref) })), summary: ["Plan de prueba"] }, runs: [] } as never;
};

type GenInput = Parameters<MaterialGenerator["generate"]>[0];
const restrictionsOf = (input: GenInput, id: string) => input.reviewed.decisions.find((d) => d.id === id)?.restrictions ?? [];
/** The real answer restricted to the applied decisions; `tweak` plays what the model got wrong this time. */
const generator = (tweak: (draft: DraftGeneratedSegmentsV2, call: number, input: GenInput) => DraftGeneratedSegmentsV2 = (d) => d) => async (_inner: MaterialGenerator, call: number, input: GenInput) => {
  const applied = new Set(input.reviewed.effective.decisions.map((d) => d.id));
  const draft = { ...realDraft, segments: [...realDraft.segments, coverSegment("act_3")].filter((s) => applied.has(s.decision_id)) };
  return { draft: tweak(draft, call, input), runs: [] } as never;
};

/** A rewrite of act_3 that loses its data («2/5 + 1/5»): protected content lost. */
const lossyRewrite = { lead: "Vas a sumar dos fracciones con el mismo denominador.", steps: ["Suma las dos fracciones del ejercicio.", "Simplifica el resultado si se puede.", "Escribe el resultado como fracción.", "Comprueba tu cálculo con las tiras de fracciones que tienes arriba en la ficha."] };
/** A rewrite of act_3 that keeps every datum and condition, but not the word «cálculo». */
const dataKeepingRewrite = { lead: "Vas a sumar dos fracciones con el mismo denominador.", steps: ["Calcula 2/5 + 1/5 y simplifica el resultado si se puede.", "Escribe el resultado como fracción.", "Usa las tiras de fracciones que tienes arriba en la ficha."] };
/** The material with one more protected element: the vocabulary «cálculo» of act_3, essential. */
function withProtectedVocabulary(): MaterialAnalysis {
  const a = mathAnalysis();
  a.protected_elements = [...a.protected_elements, { id: `prt_${a.protected_elements.length + 1}`, type: "required_vocabulary", importance: "essential", value: "cálculo", activity_ids: ["act_3"], resource_ids: [] }];
  return a;
}
const withRewrite = (rewrite: typeof dec3Rewrite) => (draft: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...draft, segments: draft.segments.map((s) => (s.rewrite ? { ...s, rewrite } : s)) });

/** A worked example that solves the student's own task (act_3: 2/5 + 1/5 = 3/5): the answer revealed. */
const revealing = { kind: "worked_example" as const, problem: "Calcula 2/5 + 1/5 y simplifica si se puede.", steps: ["Los denominadores son iguales: los dos son 5.", "Sumo solo los numeradores: 2 + 1 = 3.", "Mantengo el denominador 5.", "3 y 5 no tienen divisores comunes."], result: "2/5 + 1/5 = 3/5" };
const leakOn = (id: string) => (draft: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({
  ...draft,
  segments: draft.segments.map((s) => (s.decision_id === id ? { ...s, supports: s.supports.map((x) => (x.kind === "worked_example" ? revealing : x)) } : s)),
});

/** A finding about the whole sheet, pinned on nothing the system can repair (no target). */
const wholeSheetFail = async (inner: PedagogicalReviewer, _call: number, input: Parameters<PedagogicalReviewer["review"]>[0]) => {
  const out = await inner.review(input);
  const draft = out.draft as AiReviewDraft;
  return { ...out, draft: { checks: [...draft.checks.filter((c) => c.check !== "age_appropriate"), { check: "age_appropriate" as const, status: "FAIL" as const, targets: [], detail: "Tono inadecuado" }] } } as never;
};

let n = 0;
async function teacher(script: { generator?: ReturnType<typeof generator>; reviewer?: typeof wholeSheetFail; decisions?: Decisions; analysis?: MaterialAnalysis } = {}) {
  const u = await createUser(db, `never-review-${++n}@example.com`);
  const material = await seedMaterial(db, u, script.analysis ?? mathAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner: plannerWith(script.decisions ?? realDecisions()), generator: script.generator ?? generator(), ...(script.reviewer ? { reviewer: script.reviewer } : {}) }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const seen: AdaptationStatusDto[] = [];
  /** What the teacher's open page does: run the pending stage while the screen says «working» (the run route's own rule). */
  const visit = async (id: string) => {
    for (let i = 0; i < 16; i++) {
      const now = await status(id);
      seen.push(now);
      if (now.phase !== "working" || !(await processAdaptationStage(orchestrator, id))) break;
    }
    seen.push(await status(id));
  };
  const start = async (mode: "automatic" | "review") => {
    const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `never-review-${n}-${Math.random()}`, creationMode: mode });
    if (!created.ok) throw new Error(created.code);
    return created.data.adaptationId;
  };
  return { user: u, deps, actor, spy, orchestrator, status, visit, start, seen };
}

/** Nothing the magic screen showed was the plan gate or the blocked review, and no screen was «review» / «blocked». */
const neverMandatory = (seen: AdaptationStatusDto[]) => {
  expect(seen.filter((s) => s.phase === "awaiting_review" || s.phase === "blocked" || s.phase === "action_required").map((s) => `${s.status}/${s.phase}`)).toEqual([]);
  expect(seen.map((s) => screenFor(s)).filter((x) => x === "review" || x === "blocked")).toEqual([]);
};
const documentOf = async (t: Awaited<ReturnType<typeof teacher>>, id: string) => {
  const v = await getAdaptationVersion(t.deps, t.actor, id);
  if (!v.ok) throw new Error(v.code);
  return v.data.document as MaterialDocument;
};
const textOf = (doc: MaterialDocument) => JSON.stringify(allBlocks(doc));

describe("magic + protected content lost: repaired by itself and delivered", () => {
  it("a rewrite that drops «2/5 + 1/5» is caught (the original kept), and its decision regenerated with the preservation restriction: delivered, one unit", async () => {
    const t = await teacher({ generator: generator((d, call) => (call === 1 ? withRewrite(lossyRewrite)(d) : d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", phase: "ready", delivered: true, generationsUsed: 2 });
    neverMandatory(t.seen);
    // The loss was real (recorded on the first generation) and nothing was softened: the delivered sheet passes the checks.
    const generations = await q<{ g: { issues: Array<{ code: string; decision_id: string }> } }>("select payload->'generation' g from public.adaptation_artifacts where adaptation_id = $1 and kind = 'generation' order by created_at", [id]);
    expect(generations[0]!.g.issues).toContainEqual(expect.objectContaining({ code: "rewrite_lost_requirements", decision_id: "dec_3" }));
    const [delivered] = await reviewsOf(id);
    expect(delivered!.review.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(delivered!.review.checks.find((c) => c.check === "protected_elements_preserved")?.status).toBe("PASS");
    expect(textOf(await documentOf(t, id))).toContain("2/5 + 1/5");
    // Only the decision that rewrites act_3 was asked again; every decision is still applied (no need lost).
    const reviews = await planReviews(id);
    expect(reviews.map((r) => r.payload.reviewer.kind)).toEqual(["auto", "auto"]);
    expect(reviews[1]!.payload.entries.filter((e) => (e.restrictions ?? []).length > 0).map((e) => e.decision_id)).toEqual(["dec_3"]);
    expect(reviews[1]!.payload.entries.every((e) => e.action !== "rejected")).toBe(true);
    // Same adaptation, same unit, consumed once at delivery.
    expect(await entitlement(id)).toMatchObject({ state: "consumed" });
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
  });

  it("a protected element only the review detects (essential vocabulary dropped by a rewrite): the ORIGINAL is put back, its supports kept, delivered with ONE generation", async () => {
    // The statement keeps its data (it passes the rewrite guard) but loses «cálculo», which the analysis protects as essential.
    const analysis = withProtectedVocabulary();
    const decisions = realDecisions(analysis).map((d) => (d.target === "act_3" && d.action === "segment" ? { ...d, supports: [{ kind: "step_list" as const, uses_task_data: false }] } : d));
    const steps = { kind: "step_list" as const, items: ["Mira si los denominadores son iguales.", "Suma los numeradores.", "Simplifica si se puede."] };
    const t = await teacher({
      analysis,
      decisions,
      generator: generator((d) => ({ ...d, segments: withRewrite(dataKeepingRewrite)(d).segments.map((s) => (s.decision_id === "dec_3" ? { ...s, supports: [steps] } : s)) })),
    });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    neverMandatory(t.seen);
    expect([t.spy.generator, t.spy.reviewer]).toEqual([1, 1]);
    const doc = await documentOf(t, id);
    // The original statement, word for word, and the support of the same decision (its need still attended).
    expect(textOf(doc)).toContain("comprueba tu cálculo");
    expect(textOf(doc)).not.toContain(dataKeepingRewrite.steps[2]);
    expect(allBlocks(doc).some((b) => b.trace.decision_ids.includes("dec_3") && b.type === "list")).toBe(true);
    const [delivered] = await reviewsOf(id);
    expect(delivered!.review.checks.find((c) => c.check === "protected_elements_preserved")?.status).toBe("PASS");
    const restored = await q<{ restored: string[] }>("select payload->'restored_originals' restored from public.adaptation_artifacts where adaptation_id = $1 and kind = 'deterministic_review'", [id]);
    expect(restored[0]!.restored).toEqual(["act_3"]);
    expect(await entitlement(id)).toMatchObject({ state: "consumed" });
  });

  it("the restoration is never applied outside «Hacer magia»: in «Revisar antes de crear» the same sheet is blocked for the teacher", async () => {
    const analysis = withProtectedVocabulary();
    const decisions = realDecisions(analysis).map((d) => (d.target === "act_3" && d.action === "segment" ? { ...d, supports: [{ kind: "step_list" as const, uses_task_data: false }] } : d));
    const steps = { kind: "step_list" as const, items: ["Mira si los denominadores son iguales.", "Suma los numeradores.", "Simplifica si se puede."] };
    const t = await teacher({ analysis, decisions, generator: generator((d) => ({ ...d, segments: withRewrite(dataKeepingRewrite)(d).segments.map((s) => (s.decision_id === "dec_3" ? { ...s, supports: [steps] } : s)) })) });
    const id = await t.start("review");
    await t.visit(id);
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" })) });
    expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "blocked", phase: "blocked" });
    expect((await reviewsOf(id))[0]!.review.checks.find((c) => c.check === "protected_elements_preserved")?.status).toBe("FAIL");
  });
});

describe("magic + revealed answer: only the offending support is regenerated", () => {
  it("the worked example that solves act_3 is redone with other data (restriction on dec_2 only): delivered, two generations, one unit", async () => {
    const seenRestrictions: Array<Record<string, string[]>> = [];
    const t = await teacher({
      generator: generator((d, call, input) => {
        seenRestrictions.push(Object.fromEntries(input.reviewed.decisions.map((x) => [x.id, restrictionsOf(input, x.id)])));
        return call === 1 ? leakOn("dec_2")(d) : d;
      }),
    });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    neverMandatory(t.seen);
    const [first, second] = await reviewsOf(id);
    expect(first!.review.checks.find((c) => c.check === "answers_not_leaked")?.status).toBe("FAIL");
    expect(second!.review.checks.find((c) => c.check === "answers_not_leaked")?.status).not.toBe("FAIL");
    // The second generation carried the restriction for dec_2 ONLY; the student's reasoning stays theirs (no «= 3/5» on the sheet).
    expect(Object.entries(seenRestrictions[1]!).filter(([, r]) => r.length > 0).map(([id]) => id)).toEqual(["dec_2"]);
    expect(seenRestrictions[1]!.dec_2!.join(" ")).toMatch(/respuesta/);
    expect(textOf(await documentOf(t, id))).not.toContain("= 3/5");
    expect((await planReviews(id))[1]!.payload.entries.every((e) => e.action !== "rejected")).toBe(true);
    expect(await entitlement(id)).toMatchObject({ state: "consumed" });
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
  });

  it("the 3-generation limit holds: repairs stop at the third generation (honest stop), never a fourth, and more visits do nothing", async () => {
    // Rounds 1-2: the reviewer finds the worked example of dec_2 revealing the answer (restricted, then left out: its need stays
    // covered on the same activity by dec_7). Round 3: a finding about the whole sheet. Three generations, then the stop.
    const reviewer = async (inner: PedagogicalReviewer, call: number, input: Parameters<PedagogicalReviewer["review"]>[0]) => {
      if (call >= 3) return wholeSheetFail(inner, call, input);
      const out = await inner.review(input);
      const example = allBlocks(input.document).find((b) => b.type === "worked_example" && b.trace.decision_ids.includes("dec_2"));
      const draft = out.draft as AiReviewDraft;
      return { ...out, draft: { checks: [...draft.checks.filter((c) => c.check !== "answers_not_leaked"), { check: "answers_not_leaked" as const, status: "FAIL" as const, targets: [...(example ? [example.id] : []), "act_3"], detail: "El ejemplo resuelve la actividad" }] } } as never;
    };
    const t = await teacher({ reviewer, decisions: withCover });
    const id = await t.start("automatic");
    await t.visit(id);
    const end = await t.status(id);
    expect(end).toMatchObject({ status: "blocked", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, delivered: false, generationsUsed: MAX_GENERATION_CYCLES, regenerationAvailable: false, nextAction: "none" });
    // Round 3 only leaves dec_2 out: the valid output of round 2 is reused (no generator call), and the sheet is reviewed again.
    expect([t.spy.generator, t.spy.reviewer]).toEqual([MAX_GENERATION_CYCLES - 1, MAX_GENERATION_CYCLES]);
    neverMandatory(t.seen);
    const calls = [t.spy.generator, t.spy.reviewer];
    await t.visit(id);
    await t.visit(id);
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect([t.spy.generator, t.spy.reviewer]).toEqual(calls);
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null });
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
  });

  it("an answer revealed again after the restriction: that support is left out only because its need stays covered, and the sheet is delivered", async () => {
    const t = await teacher({ decisions: withCover, generator: generator((d) => ({ ...d, segments: d.segments.map((s) => (s.target === "act_3" && s.decision_id === "dec_2" ? { ...s, supports: s.supports.map((x) => (x.kind === "worked_example" ? revealing : x)) } : s)) })) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 3 });
    neverMandatory(t.seen);
    const last = (await planReviews(id)).at(-1)!.payload.entries;
    expect(last.filter((e) => e.action === "rejected").map((e) => e.decision_id)).toEqual(["dec_2"]);
    // dec_2 attended working memory on act_3: dec_7 still does, on the same activity.
    const doc = await documentOf(t, id);
    expect(allBlocks(doc).some((b) => b.trace.decision_ids.includes("dec_7"))).toBe(true);
    expect(textOf(doc)).not.toContain("= 3/5");
  });
});

describe("magic + a failure with no safe repair: the honest stop, never a mandatory review", () => {
  it("a finding about the whole sheet: «No hemos podido completar automáticamente», editing only offered, recorded once, no loop", async () => {
    const t = await teacher({ reviewer: wholeSheetFail });
    const id = await t.start("automatic");
    await t.visit(id);
    const end = await t.status(id);
    expect(end).toMatchObject({ status: "blocked", phase: "automatic_incomplete", automaticStop: { reason: "quality" }, nextAction: "review_plan", delivered: false });
    expect(screenFor(end)).toBe("automatic_incomplete");
    neverMandatory(t.seen);
    expect([t.spy.generator, t.spy.reviewer]).toEqual([1, 1]);
    expect((await stops(id)).map((s) => s.payload.automatic_stop)).toEqual(["quality"]);
    // A refresh, a second tab: nothing is retried, nothing is charged.
    await t.visit(id);
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect([t.spy.generator, t.spy.reviewer]).toEqual([1, 1]);
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null });
    // The check is still there, as found: nothing was marked PASS.
    expect((await reviewsOf(id))[0]!.review.checks.find((c) => c.check === "age_appropriate")?.status).toBe("FAIL");
  });

  it("a teacher who chose to edit and then got a blocked sheet still sees the honest stop, never «Revisar adaptación»", async () => {
    const t = await teacher({ reviewer: wholeSheetFail });
    const id = await t.start("automatic");
    await t.visit(id);
    // The voluntary path: reopen, submit their own review, generate.
    expect(await reopenPlanReview(t.orchestrator, id)).toBe("awaiting_plan_review");
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    expect((await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "prueba" })) })).ok).toBe(true);
    // Their own «Crear ficha» (the last click of the path they chose).
    expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
    await t.visit(id);
    const end = await t.status(id);
    expect(end).toMatchObject({ status: "blocked", phase: "automatic_incomplete", creationMode: "automatic", nextAction: "review_plan" });
    expect(screenFor(end)).toBe("automatic_incomplete");
  });
});

describe("the read-only diagnosis SQL (docs/qa/hotfix-magic-never-review/diagnose.sql) runs on the real schema", () => {
  it("only SELECTs, every statement valid, and it tells mode, reviewer, stop and the exact FAIL", async () => {
    const t = await teacher({ reviewer: wholeSheetFail });
    const id = await t.start("automatic");
    await t.visit(id);
    const sql = readFileSync("docs/qa/hotfix-magic-never-review/diagnose.sql", "utf8").replaceAll("757c2370-936e-4d03-8b9a-54defb91afae", id);
    const statements = sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThanOrEqual(10);
    expect(statements.every((x) => /^select\b/i.test(x))).toBe(true);
    const results = [];
    for (const statement of statements) results.push((await db.query<Record<string, unknown>>(statement)).rows);
    expect(results[0]![0]).toMatchObject({ status: "blocked", creation_mode: "automatic" });
    expect(results[4]!.map((r) => r.generations_used)).toEqual([1]);
    expect(results[5]!.map((r) => r.reviewer_kind)).toEqual(["auto"]);
    expect(results[6]!.map((r) => r.automatic_stop).filter(Boolean)).toEqual(["quality"]);
    expect(results[7]!.filter((r) => r.check_status === "FAIL").map((r) => r.check_name)).toEqual(["age_appropriate"]);
  });
});

describe("resuming: an interrupted correction is picked up once, never twice", () => {
  it("the process died after reopening for the correction: the next visit finishes it (one new generation), a second visit adds nothing", async () => {
    const t = await teacher({ generator: generator((d, call) => (call === 1 ? leakOn("dec_2")(d) : d)) });
    const id = await t.start("automatic");
    // Planning and the automatic gate (one run), then the generation stage on its own, WITHOUT the in-request correction: the
    // process "dies" right after the sheet is blocked and the plan is reopened for the correction, before anything is submitted.
    expect(await processAdaptationStage(t.orchestrator, id)).not.toBeNull();
    expect((await t.status(id)).status).toBe("generation_queued");
    const review = await latestReviewFingerprint(t.orchestrator.store, id);
    expect((await runGenerationStage(t.orchestrator, id, review!)).status).toBe("blocked");
    expect(await t.status(id)).toMatchObject({ status: "blocked", phase: "working" });
    expect(await reopenPlanReview(t.orchestrator, id)).toBe("awaiting_plan_review");
    const mid = await t.status(id);
    expect(mid.phase).toBe("working");
    expect(screenFor(mid)).toBe("working");
    // The next visit, then a refresh and a second tab (one PGlite connection: visits run one after another). The first sheet
    // failed a deterministic check, so only the second one reached the AI reviewer.
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    expect([t.spy.generator, t.spy.reviewer]).toEqual([2, 1]);
    await t.visit(id);
    await t.visit(id);
    expect([t.spy.generator, t.spy.reviewer]).toEqual([2, 1]);
    expect((await planReviews(id)).length).toBe(2);
    expect(await entitlement(id)).toMatchObject({ state: "consumed" });
  });
});

describe("«Revisar antes de crear» keeps the human gate", () => {
  it("the plan waits for the teacher, and a blocked sheet is «Revisar adaptación» (phase blocked)", async () => {
    const t = await teacher({ reviewer: wholeSheetFail });
    const id = await t.start("review");
    await t.visit(id);
    const waiting = await t.status(id);
    expect(waiting).toMatchObject({ status: "awaiting_plan_review", phase: "awaiting_review", nextAction: "review_plan", creationMode: "review" });
    expect(screenFor(waiting)).toBe("review");
    expect(t.spy.generator).toBe(0);
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "prueba" })) });
    expect((await startGeneration(t.deps, t.actor, id)).ok).toBe(true);
    await t.visit(id);
    const blocked = await t.status(id);
    expect(blocked).toMatchObject({ status: "blocked", phase: "blocked", nextAction: "review_plan" });
    expect(screenFor(blocked)).toBe("blocked");
    // No automatic correction in this mode.
    expect(t.spy.generator).toBe(1);
    expect(await stops(id)).toEqual([]);
  });
});

describe("bloque 1 · auditoría de apoyos en modo sombra", () => {
  it("la ficha se entrega igual y la auditoría queda registrada junto a la revisión determinista: solo códigos e ids, sin texto del material", async () => {
    const t = await teacher({ generator: generator() });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", phase: "ready", delivered: true });
    neverMandatory(t.seen);
    const [row] = await q<{ audit: { version: string; mode: string; supports_checked: number; warnings: Array<Record<string, unknown>> } | null }>(
      "select payload->'support_audit' audit from public.adaptation_artifacts where adaptation_id = $1 and kind = 'deterministic_review' order by created_at desc limit 1",
      [id],
    );
    expect(row!.audit).toMatchObject({ version: "support_audit@v2", mode: "shadow" });
    expect(row!.audit!.supports_checked).toBeGreaterThan(0);
    for (const warning of row!.audit!.warnings) expect(Object.keys(warning).sort()).toEqual(["action", "activity_id", "block_id", "code", "decision_ids", "evidence", "low_need_only"]);
    expect(JSON.stringify(row!.audit)).not.toMatch(/fracci|denominador|calcul/i);
  });
});

describe("etapa 2.2 · sustitución funcional de un apoyo que revela la respuesta (generador simulado: 0 llamadas reales)", () => {
  /** La hoja de fracciones con una respuesta dada para act_2 («mitad; tercio»): un apoyo que nombre una de ellas la entrega. */
  const withStatedAnswer = (basis: "source" | "inferred" = "source"): MaterialAnalysis => {
    const a = mathAnalysis();
    a.activities.find((x) => x.id === "act_2")!.expected_answer = { basis, value: "mitad; tercio" };
    return a;
  };
  const LEAK = "Recuerda: la mitad se escribe 1/2.";
  const leak = (d: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...d, segments: d.segments.map((s) => (s.decision_id === "dec_4" ? { ...s, supports: [{ kind: "reminder" as const, text: LEAK }] } : s)) });
  const declineDec4 = (d: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...d, segments: d.segments.filter((s) => s.decision_id !== "dec_4"), skipped: [...d.skipped, { decision_id: "dec_4", support: "reminder" as const, reason: "would_reveal_answer" as const }] });
  /** The planner of dec_5 (planning, a high need) declined as revealing the answer: no kind of support has an alternative for it. */
  const declinePlanner = (d: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...d, segments: d.segments.filter((s) => s.decision_id !== "dec_5"), skipped: [...d.skipped, { decision_id: "dec_5", support: "planner" as const, reason: "would_reveal_answer" as const }] });
  /** A second planning decision ON THE SAME activity (act_5): its need stays served when dec_5 is left out. */
  const planningCover = { ...coverDecision(mathAnalysis(), "act_3"), target: "act_5", strategies: ["planning_support" as const], dimensions: ["planning_support" as const], preserves: protectedFor(mathAnalysis(), "act_5").map((p) => p.id), supports: [{ kind: "checklist" as const, uses_task_data: false }] };
  const withPlanningCover = (d: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...d, segments: [...d.segments.filter((s) => s.decision_id !== "dec_7"), { decision_id: "dec_7", target: "act_5", supports: [{ kind: "checklist" as const, items: ["Leo el problema", "Compruebo mi resultado"] }] }] });

  type Trace = { decision_id: string; action: string; trigger: string; coverage: string; to: string[] | null; option: string | null; dimensions: string[]; semantic_review: string; mode: string };
  const trace = async (id: string): Promise<Trace[]> =>
    (await q<{ payload: { support_resolution?: Trace[]; automatic?: { support_resolution?: Trace[] } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' order by created_at", [id])).flatMap((r) => [...(r.payload.support_resolution ?? []), ...(r.payload.automatic?.support_resolution ?? [])]);
  const deterministic = async (id: string) => (await q<{ payload: { support_audit?: { warnings: Array<{ code: string; literal?: boolean }> }; support_resolution_outcome?: Array<{ decision_id: string; result: string }>; support_resolution_dry_run?: Trace[] } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'deterministic_review' order by created_at desc limit 1", [id]))[0]!.payload;
  const textOfSheet = async (t: Awaited<ReturnType<typeof teacher>>, id: string) => textOf(await documentOf(t, id));

  it("cuando el generador acierta tras la restricción: una sola regeneración, sin sustitución, ficha limpia y registro «restringido»", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d, call) => (call === 1 ? leak(d) : d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    neverMandatory(t.seen);
    expect(await textOfSheet(t, id)).not.toContain(LEAK);
    expect(await trace(id)).toEqual([expect.objectContaining({ decision_id: "dec_4", action: "restricted", trigger: "literal_answer", coverage: "same_activity", semantic_review: "pending_2_3" })]);
    expect((await deterministic(id)).support_resolution_outcome).toEqual([expect.objectContaining({ decision_id: "dec_4", result: "clean" })]);
    expect(t.spy.generator).toBe(2);
  });

  it("si repite la entrega tras la restricción: UNA sustitución por un recordatorio del procedimiento (misma necesidad), en la tercera y última generación", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d, call) => (call <= 2 ? leak(d) : d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: MAX_GENERATION_CYCLES });
    neverMandatory(t.seen);
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(await textOfSheet(t, id)).not.toContain(LEAK);
    const records = await trace(id);
    expect(records.map((r) => r.action)).toEqual(["restricted", "substituted"]);
    expect(records[1]).toMatchObject({ decision_id: "dec_4", option: "method_reminder", to: ["reminder"], coverage: "same_activity", dimensions: ["working_memory_support"] });
    // La decisión sigue siendo la misma y su necesidad no cambió: solo el apoyo (revisión editada con el motivo de la sustitución).
    const last = (await planReviews(id)).at(-1)!.payload.entries.find((e) => e.decision_id === "dec_4")!;
    expect(last.action).toBe("edited");
    expect(Object.keys((last as unknown as { edits: object }).edits)).toEqual(["supports"]);
    expect((await deterministic(id)).support_resolution_outcome?.map((r) => r.result)).toEqual(["clean", "clean"]);
  });

  it("nunca pasa de tres generaciones: si todo vuelve a entregar la respuesta, parada honesta y sin cuarta llamada al generador", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d) => leak(d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ delivered: false, generationsUsed: MAX_GENERATION_CYCLES });
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    const calls = t.spy.generator;
    await t.visit(id);
    await t.visit(id);
    expect(t.spy.generator).toBe(calls);
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null });
  });

  it("el generador declina el recordatorio por revelar la respuesta: se prueba UNA alternativa (otro apoyo de la misma necesidad) y se entrega", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d, call) => (call === 1 ? declineDec4(d) : d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    expect(await trace(id)).toEqual([expect.objectContaining({ decision_id: "dec_4", action: "substituted", trigger: "declined_reveal", option: "method_reminder", coverage: "same_activity" })]);
    // El apoyo está en la ficha (no se da por aplicada una necesidad sin apoyo).
    expect(allBlocks(await documentOf(t, id)).some((b) => b.trace.decision_ids.includes("dec_4"))).toBe(true);
  });

  it("necesidad ESENCIAL sin alternativa que la cubra: parada honesta, registrada como «stopped / none», jamás como aplicada", async () => {
    // dec_5 (planificador) atiende la planificación de act_5; ningún tipo de apoyo lo sustituye y ninguna otra decisión la atiende allí.
    const t = await teacher({ generator: generator((d, call) => (call === 1 ? declinePlanner(d) : d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    const end = await t.status(id);
    expect(end).toMatchObject({ delivered: false });
    expect(await trace(id)).toEqual([expect.objectContaining({ decision_id: "dec_5", action: "stopped", coverage: "none", trigger: "declined_reveal" })]);
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null });
    expect(t.spy.generator).toBeLessThanOrEqual(MAX_GENERATION_CYCLES);
  });

  it("…y si otra decisión cubre esa necesidad EN LA MISMA actividad, el apoyo se omite, se registra «omitted / elsewhere» y se entrega", async () => {
    const t = await teacher({ decisions: [...realDecisions(), planningCover], generator: generator((d, call) => (call === 1 ? declinePlanner(withPlanningCover(d)) : withPlanningCover(d))) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    expect(await trace(id)).toEqual([expect.objectContaining({ decision_id: "dec_5", action: "omitted", coverage: "elsewhere" })]);
    const doc = await documentOf(t, id);
    // El planificador omitido NO está en la ficha ni figura como aplicado; la necesidad la sirve la otra decisión.
    expect(allBlocks(doc).some((b) => b.trace.decision_ids.includes("dec_5"))).toBe(false);
    expect(allBlocks(doc).some((b) => b.trace.decision_ids.includes("dec_7") && b.type === "checklist")).toBe(true);
  });

  it("los apoyos legítimos no se tocan: una sola generación, sin registro de sustitución, y el aviso interno sigue siendo solo un aviso", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator() });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(t.spy.generator).toBe(1);
    expect(await trace(id)).toEqual([]);
    expect((await deterministic(id)).support_resolution_outcome).toBeUndefined();
  });

  it("ante la duda se conserva: una respuesta solo DEDUCIDA y sin apoyo en el material no provoca ninguna reparación (queda el aviso)", async () => {
    const t = await teacher({ analysis: withStatedAnswer("inferred"), generator: generator((d) => leak(d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(await textOfSheet(t, id)).toContain(LEAK);
    expect(await trace(id)).toEqual([]);
    expect((await deterministic(id)).support_audit!.warnings).toContainEqual(expect.objectContaining({ code: "direct_answer_part" }));
    expect((await deterministic(id)).support_audit!.warnings.every((w) => w.literal !== true)).toBe(true);
  });

  it("modo de ensayo: no cambia nada (una generación, el apoyo sigue en la ficha) y registra qué haría", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d) => leak(d)) });
    t.orchestrator.supportSubstitution = "dry_run";
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(await textOfSheet(t, id)).toContain(LEAK);
    expect(await trace(id)).toEqual([]);
    expect((await deterministic(id)).support_resolution_dry_run).toEqual([expect.objectContaining({ decision_id: "dec_4", mode: "dry_run", action: "would_substitute", option: "method_reminder" })]);
  });

  it("interruptor apagado: nada cambia y no se registra nada", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d) => leak(d)) });
    t.orchestrator.supportSubstitution = "off";
    const id = await t.start("automatic");
    await t.visit(id);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(await trace(id)).toEqual([]);
    expect((await deterministic(id)).support_resolution_dry_run).toBeUndefined();
  });

  it("la trazabilidad guarda solo códigos e identificadores: ni el texto del apoyo ni la respuesta", async () => {
    const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d, call) => (call === 1 ? leak(d) : d)) });
    const id = await t.start("automatic");
    await t.visit(id);
    const stored = JSON.stringify(await q<{ payload: unknown }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind in ('execution_report','deterministic_review') order by created_at", [id])).toLowerCase();
    const support = JSON.stringify(await trace(id)).toLowerCase();
    expect(support).not.toMatch(/mitad|tercio|recuerda/);
    expect(stored).not.toContain("la mitad se escribe");
  });

  describe("la célula: el ejemplo «… → Núcleo» entrega la respuesta del apartado a)", () => {
    const cellGenerator = (script: (call: number) => ReturnType<typeof cellLeaking>) => async (_inner: MaterialGenerator, call: number) => ({ draft: script(call), runs: [] }) as never;

    it("tras la restricción el ejemplo es de otro ámbito: una regeneración, ficha limpia, registro «restringido» y la competencia evaluada intacta", async () => {
      const t = await teacher({ analysis: cellPilotAnalysis(), decisions: cellDecisions() as never, generator: cellGenerator((call) => (call === 1 ? cellLeaking() : cellSafe())) as never });
      const id = await t.start("automatic");
      await t.visit(id);
      expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
      const text = await textOfSheet(t, id);
      expect(text).not.toContain("Núcleo.");
      expect(text).toContain("Escribe la estructura celular que corresponde a cada pista.");
      expect(await trace(id)).toEqual([expect.objectContaining({ decision_id: "dec_1", action: "restricted", trigger: "literal_answer", codes: ["example_solves_item"] })]);
    });

    it("si repite el ejemplo: UNA sustitución (un ejemplo de otro ámbito más un recordatorio del procedimiento: la memoria de trabajo no la sirve un ejemplo solo); si aun así lo entrega, parada honesta en la tercera generación, sin cuarta", async () => {
      const t = await teacher({ analysis: cellPilotAnalysis(), decisions: cellDecisions() as never, generator: cellGenerator(() => cellLeaking()) as never });
      const id = await t.start("automatic");
      await t.visit(id);
      expect(await t.status(id)).toMatchObject({ delivered: false, generationsUsed: MAX_GENERATION_CYCLES });
      const records = await trace(id);
      expect(records.map((r) => r.action)).toEqual(["restricted", "substituted"]);
      expect(records[1]).toMatchObject({ option: "other_domain_example", to: ["worked_example", "reminder"], dimensions: ["working_memory_support"], coverage: "same_activity" });
      expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
      expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null });
    });

    it("si la sustitución sí lo resuelve (el tercer ejemplo es de otro ámbito): se entrega y el resultado verificado es «limpio»", async () => {
      const t = await teacher({ analysis: cellPilotAnalysis(), decisions: cellDecisions() as never, generator: cellGenerator((call) => (call <= 2 ? cellLeaking() : cellSafe())) as never });
      const id = await t.start("automatic");
      await t.visit(id);
      expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: MAX_GENERATION_CYCLES });
      expect((await deterministic(id)).support_resolution_outcome?.map((r) => r.result)).toEqual(["clean", "clean"]);
      expect(await textOfSheet(t, id)).not.toContain("Núcleo.");
    });
  });

  describe("evidencia estructural (B): nunca una llamada por sí sola", () => {
    /** El ejemplo de dec_2 trabaja con los números de la propia tarea (2/5 y 1/5), sin dar su resultado. */
    const reusesData = (d: DraftGeneratedSegmentsV2): DraftGeneratedSegmentsV2 => ({ ...d, segments: d.segments.map((s) => (s.decision_id === "dec_2" ? { ...s, supports: s.supports.map((x) => (x.kind === "worked_example" ? { ...x, problem: "Suma 2/5 y 1/5 con el mismo denominador.", result: "Se suman los numeradores y se deja el denominador." } : x)) } : s)) });

    it("sola: la ficha se entrega con UNA generación, sin reparación, y el aviso queda registrado", async () => {
      const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d) => reusesData(d)) });
      const id = await t.start("automatic");
      await t.visit(id);
      expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
      expect(t.spy.generator).toBe(1);
      expect(await trace(id)).toEqual([]);
      expect((await deterministic(id)).support_audit!.warnings).toContainEqual(expect.objectContaining({ code: "example_reuses_data" }));
    });

    it("si ya se repara otra decisión por evidencia literal, la restricción estructural viaja en esa misma regeneración (sin ciclo extra)", async () => {
      const t = await teacher({ analysis: withStatedAnswer(), generator: generator((d, call) => (call === 1 ? reusesData(leak(d)) : d)) });
      const id = await t.start("automatic");
      await t.visit(id);
      expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
      expect(t.spy.generator).toBe(2);
      const records = await trace(id);
      expect(records.map((r) => [r.decision_id, r.trigger, r.action]).sort()).toEqual([["dec_2", "structural_signal", "restricted"], ["dec_4", "literal_answer", "restricted"]]);
    });
  });
});
