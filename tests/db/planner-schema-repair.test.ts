import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { PLANNER_REPAIR_OUTPUT_CEILING, recoverFailedPlanning } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { screenFor } from "@/lib/adaptation/presentation/view-model";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import type { PlanDraftDiagnosis } from "@/lib/adaptation/planner-draft";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";
import { mathAnalysis } from "../support/math-generation-case";
import { modelPlannerHook, validFractionsDraft, type ProviderLog, type ScriptedAnswer } from "../support/planner-provider";

/**
 * HOTFIX «Hacer magia falla en planning con planner_schema» (Fracciones, 4.º de Primaria, cinco actividades). The REAL model planner
 * (request, stop reason, JSON, contract) over a fake provider, through the real planning stage on the real migrations (PGlite):
 * an answer that breaks the contract is diagnosed (paths and rules, never content), fixed when unequivocal, repaired ONCE by the
 * model with the exact errors, and otherwise stopped honestly. 0 real model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);
const entitlement = async (id: string) => (await q<{ state: string; consumed_at: string | null; released_at: string | null }>("select state, consumed_at, released_at from public.adaptation_entitlements where adaptation_id = $1", [id]))[0];
const rejections = (id: string) => q<{ payload: { rejected: true; diagnosis: PlanDraftDiagnosis } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'planner_draft' and payload ? 'rejected' order by created_at", [id]);
const plans = (id: string) => q<{ payload: { decisions: Array<{ id: string; target: string; dimensions: string[] }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan' order by created_at", [id]);
const jobs = (id: string) => q<{ stage: string; status: string; error: { code: string } | null }>("select stage, status, error from public.adaptation_jobs where adaptation_id = $1 order by created_at", [id]);

type Input = Parameters<AdaptationPlanner["plan"]>[0];
type Loose = { decisions: Array<Record<string, unknown>>; summary: unknown };
const draft = (input: Input, f: (d: Loose) => void = () => {}) => {
  const d = structuredClone(validFractionsDraft(input.context.needs, mathAnalysis())) as unknown as Loose;
  f(d);
  return JSON.stringify(d);
};
const fiveNeeds = (input: Input) => (d: Loose) => (d.decisions[0]!.need_refs = input.context.needs.slice(0, 5).map((_, k) => `need_${k + 1}`));
const valid = (input: Input): ScriptedAnswer => ({ text: draft(input) });

let n = 0;
async function teacher(answer: (call: number, input: Input) => ScriptedAnswer) {
  const u = await createUser(db, `planner-schema-${++n}@example.com`);
  const material = await seedMaterial(db, u, mathAnalysis());
  const learner = await seedLearner(db, u);
  const log: ProviderLog = { requests: [] };
  const state = { answer };
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner: modelPlannerHook(mathAnalysis, (call, input) => state.answer(call, input), log) }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const start = async (mode: "automatic" | "review") => {
    const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `planner-schema-${n}-key`, creationMode: mode });
    if (!created.ok) throw new Error(created.code);
    return created.data.adaptationId;
  };
  return { user: u, log, state, orchestrator, deps, status, start, plan: (id: string) => processAdaptationStage(orchestrator, id) };
}

describe("a valid plan for the fractions sheet", () => {
  it("«Hacer magia»: one planner call, the plan, and the server crosses the gate itself (no teacher approval)", async () => {
    const t = await teacher((_c, input) => valid(input));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(1);
    const after = await t.status(id);
    expect(after).toMatchObject({ status: "generation_queued", phase: "working" });
    expect(screenFor(after)).not.toBe("review");
    expect(await rejections(id)).toEqual([]);
    expect((await plans(id))[0]!.payload.decisions.map((d) => d.target).sort()).toEqual(["act_1", "act_2", "act_3", "act_3", "act_4", "act_5"]);
  });
});

describe("an answer that breaks the contract, repaired", () => {
  it("unequivocal mistakes (null fields, repeated values, «need_01») are fixed without another call, and recorded", async () => {
    const t = await teacher((_c, input) => ({ text: draft(input, (d) => {
      d.decisions[0]!.note = null;
      d.decisions[1]!.strategies = ["working_memory_support", "working_memory_support", "worked_example"];
      d.decisions[2]!.need_refs = (d.decisions[2]!.need_refs as string[]).map((r) => r.replace("need_", "need_0"));
    }) }));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(1);
    expect((await t.status(id)).status).toBe("generation_queued");
    const stored = await q<{ payload: { deterministic_fixes: string[] } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'planner_draft' and payload ? 'deterministic_fixes'", [id]);
    expect(stored[0]!.payload.deterministic_fixes.length).toBeGreaterThanOrEqual(3);
  });

  it("a fifth need on a decision: ONE repair call that names the field and the rule; the repaired plan is used; diagnosis recorded without content", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: draft(input, fiveNeeds(input)) } : valid(input)));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(2);
    expect(t.log.requests[1]!.text).toContain("<previous_plan_issues>");
    expect(t.log.requests[1]!.text).toMatch(/dec_1: need_refs: como máximo 4 elementos/);
    expect((await t.status(id)).status).toBe("generation_queued");
    const [rejected] = await rejections(id);
    expect(rejected!.payload.diagnosis).toMatchObject({ stage: "planning", schema: "DraftAdaptationPlan v2", prompt_version: 2, kind: "schema", truncated: false, repair_attempted: false, issues: [{ path: "decisions.0.need_refs", code: "too_big" }] });
    // Needs: every decision rests on needs the profile has; nothing invented.
    const needs = new Set(((await q<{ s: { needs: Array<{ dimension: string }> } }>("select context_snapshot s from public.adaptations where id = $1", [id]))[0]!.s.needs).map((x) => x.dimension));
    expect((await plans(id))[0]!.payload.decisions.every((d) => d.dimensions.every((x) => needs.has(x)))).toBe(true);
  });

  it("an unknown enum value and a missing field together: repaired in the same single call", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: draft(input, (d) => { d.decisions[1]!.strategies = ["chunking"]; delete d.decisions[2]!.intensity; }) } : valid(input)));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(2);
    expect(t.log.requests[1]!.text).toMatch(/dec_2: strategies\.0: uno de: /);
    expect(t.log.requests[1]!.text).toMatch(/dec_3: intensity: obligatorio/);
    const [rejected] = await rejections(id);
    expect(JSON.stringify(rejected!.payload)).not.toContain("chunking");
    expect((await t.status(id)).status).toBe("generation_queued");
  });

  it("malformed JSON: repaired with «only the JSON object»", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: "Aquí tienes el plan: { \"decisions\": [ { \"target\": \"act_1\",, ] }" } : valid(input)));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(2);
    expect(t.log.requests[1]!.text).toMatch(/no era un objeto JSON válido/);
    expect((await rejections(id))[0]!.payload.diagnosis).toMatchObject({ kind: "not_json", issues: [] });
    expect((await t.status(id)).status).toBe("generation_queued");
  });

  it("a cut-off answer: regenerated ONCE with twice the room (within the ceiling) and asked to be shorter", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: draft(input).slice(0, 600), stopReason: "max_tokens", outputTokens: 4000 } : valid(input)));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests.map((r) => r.maxOutputTokens)).toEqual([4000, Math.min(8000, PLANNER_REPAIR_OUTPUT_CEILING)]);
    expect(t.log.requests[1]!.text).toMatch(/se cortó por longitud/);
    expect((await rejections(id))[0]!.payload.diagnosis).toMatchObject({ kind: "truncated", truncated: true, output_tokens: 4000, max_output_tokens: 4000 });
    expect((await t.status(id)).status).toBe("generation_queued");
  });
});

describe("limits: one repair, then an honest stop", () => {
  it("a repair that still breaks the contract: failed planner_schema after exactly two calls; the reason recorded; no third call on another visit", async () => {
    const t = await teacher((_c, input) => ({ text: draft(input, fiveNeeds(input)) }));
    const id = await t.start("automatic");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(2);
    const after = await t.status(id);
    expect(after).toMatchObject({ status: "failed", error: { code: "planner_schema" }, canRetry: false, delivered: false });
    expect(after.error?.message).not.toMatch(/volver a intentarlo/);
    expect(screenFor(after)).not.toBe("review");
    expect((await jobs(id)).map((j) => [j.stage, j.status, j.error?.code])).toEqual([["planning", "failed", "planner_schema"]]);
    const recorded = (await rejections(id)).map((r) => r.payload.diagnosis);
    expect(recorded.map((d) => [d.kind, d.repair_attempted])).toEqual([["schema", false], ["schema", true]]);
    expect(recorded[1]!.final_reason).toMatch(/tras una reparación/);
    expect(await t.plan(id)).toBeNull();
    expect(t.log.requests).toHaveLength(2);
    // The unit stays reserved (never consumed, never released): the same adaptation can still be recovered.
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null, released_at: null });
  });

  it("an activity the material does not have: blocked and never applied; with the repair already spent on the contract, no third call", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: draft(input, fiveNeeds(input)) } : { text: draft(input, (d) => (d.decisions[0]!.target = "act_9")) }));
    const id = await t.start("review");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(2);
    const validation = (await q<{ payload: { classification: { decisions: Array<{ id: string; status: string }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_validation'", [id]))[0]!.payload.classification;
    expect(validation.decisions.find((d) => d.id === "dec_1")?.status).toBe("blocked");
  });

  it("an activity the material does not have, on an otherwise valid answer: the existing single repair of blocking issues", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: draft(input, (d) => (d.decisions[0]!.target = "act_9")) } : valid(input)));
    const id = await t.start("review");
    await t.plan(id);
    expect(t.log.requests).toHaveLength(2);
    expect((await plans(id)).at(-1)!.payload.decisions.some((d) => d.target === "act_9")).toBe(false);
  });
});

describe("modes, adaptation and quota", () => {
  it("«Revisar antes de crear»: the same repair, and the plan still waits for the teacher's approval", async () => {
    const t = await teacher((call, input) => (call === 1 ? { text: draft(input, fiveNeeds(input)) } : valid(input)));
    const id = await t.start("review");
    await t.plan(id);
    const after = await t.status(id);
    expect(after).toMatchObject({ status: "awaiting_plan_review", phase: "awaiting_review", nextAction: "review_plan" });
    expect(screenFor(after)).toBe("review");
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id])).toBe(0);
  });

  it("the same adaptation and one unit through repair and failure; recovery queues the SAME adaptation and a later visit plans it", async () => {
    const t = await teacher((_c, input) => ({ text: draft(input, fiveNeeds(input)) }));
    const id = await t.start("automatic");
    await t.plan(id);
    expect((await t.status(id)).status).toBe("failed");

    // Dry run: reads only.
    const dry = await recoverFailedPlanning(t.orchestrator, id);
    expect(dry).toMatchObject({ recoverable: true, failureCode: "planner_schema", planExists: false, entitlement: { state: "reserved", consumedAt: null }, planningJobs: [{ status: "failed", code: "planner_schema" }] });
    expect(dry.queued).toBeUndefined();
    expect((await t.status(id)).status).toBe("failed");

    // Apply: the planning job of the same adaptation is queued again; nothing runs here.
    const calls = t.log.requests.length;
    expect(await recoverFailedPlanning(t.orchestrator, id, { apply: true })).toMatchObject({ recoverable: true, queued: true });
    expect(t.log.requests).toHaveLength(calls);
    expect((await t.status(id)).status).toBe("queued");

    // The next visit runs it (the model now answers within the contract) and «Hacer magia» goes on by itself.
    t.state.answer = (_c, input) => valid(input);
    await t.plan(id);
    expect((await t.status(id)).status).toBe("generation_queued");
    expect(await count("public.adaptations where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await count("public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId])).toBe(1);
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null, released_at: null });
    expect((await jobs(id)).map((j) => [j.stage, j.status])).toEqual([["planning", "failed"], ["planning", "completed"], ["generation", "queued"]]);
    // Idempotent: nothing to recover any more.
    expect(await recoverFailedPlanning(t.orchestrator, id, { apply: true })).toMatchObject({ recoverable: false });
  });
});

describe("the read-only diagnosis SQL (docs/qa/hotfix-planner-schema/diagnose.sql) runs on the real schema", () => {
  it("only SELECTs, every statement valid, and it tells the frozen budget, the cut-off call and the recorded diagnosis", async () => {
    const t = await teacher((_c, input) => ({ text: draft(input).slice(0, 600), stopReason: "max_tokens", outputTokens: 4000 }));
    const id = await t.start("automatic");
    await t.plan(id);
    const sql = readFileSync("docs/qa/hotfix-planner-schema/diagnose.sql", "utf8").replaceAll("5aa33558-5e46-4114-8afc-3385376e62d3", id);
    const statements = sql.replace(/^\s*--.*$/gm, "").split(";").map((x) => x.trim()).filter(Boolean);
    expect(statements.every((x) => /^select\b/i.test(x))).toBe(true);
    const results = [];
    for (const statement of statements) results.push((await db.query<Record<string, unknown>>(statement)).rows);
    expect(results[0]![0]).toMatchObject({ status: "failed", failure_code: "planner_schema", planner_max_output_tokens: "4000", planner_prompt_version: "2" });
    expect(results[2]!.map((r) => r.hit_output_limit)).toEqual([true, true]);
    expect(results[4]!.map((r) => (r.diagnosis as PlanDraftDiagnosis).kind)).toEqual(["truncated", "truncated"]);
    expect(results[5]![0]).toMatchObject({ activities: 5 });
    expect(results[6]![0]).toMatchObject({ state: "reserved" });
  });
});
