import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { AUTO_ENGINE_VERSION, prepareVisuals, type AutoRunInput } from "@/lib/materials/visuals/auto/service";
import type { VisionLocator } from "@/lib/materials/visuals/auto/vision";
import { locateVisual, resolveVisuals } from "@/lib/materials/visuals/service";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { BAR_BOUNDS, fractionsCaseAnalysis, fractionsPdf, type FractionsPdfOptions } from "../support/fractions-case";
import { as, createTestDb, createUser } from "./harness";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAdaptationCommand, createAndStartAdaptation, getAdaptationPlan, getAdaptationStatus, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationJobs, processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type User } from "./orchestration-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/**
 * Phase 8.2B.1 over the real migrations (PGlite): the automatic locator saves `auto` locators, crops with the SAME recipe as a
 * person's, verified reconstructions and one auditable run per material version. RLS isolation, idempotency, concurrency, the
 * teacher's control, vision cost and quotas. 0 real model calls (a scripted vision locator where one is needed).
 */

let db: PGlite;
let pdf: Uint8Array;
beforeAll(async () => {
  db = await createTestDb();
  pdf = await fractionsPdf();
}, 120_000);

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (table: string, materialId: string) => Number((await q<{ c: string }>(`select count(*)::text c from public.${table} where material_id = $1`, [materialId]))[0]!.c);
let n = 0;

async function world(options: { analysis?: MaterialAnalysis; pdf?: FractionsPdfOptions; vision?: VisionLocator } = {}) {
  const user = await createUser(db, `auto-visuals-${++n}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  const analysis = options.analysis ?? fractionsCaseAnalysis();
  const materialId = await seedMaterial(db, user, analysis);
  const visuals = visualHarness(db, user);
  const sourceSha256 = await attachSource(db, visuals, materialId, "application/pdf", options.pdf ? await fractionsPdf(options.pdf) : pdf);
  const auto = autoHarness(db, visuals, options.vision);
  const input: AutoRunInput = { workspaceId: user.workspaceId, materialId, analysis, analysisFingerprint: fingerprint(analysis), sourceSha256, adaptationId: null };
  const resolve = () => resolveVisuals(visuals.deps, { materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256, visualIds: ["vis_1", "vis_2"] });
  return { user, materialId, visuals, auto, input, resolve };
}

describe("«Hacer magia» locates, crops and reconstructs the fractions sheet by itself", () => {
  it("bar and number line: `auto` locators (confidence ≥ 0.75, signals without content), crops with the person's recipe, verified specs → choice C", async () => {
    const w = await world();
    const summary = await prepareVisuals(w.auto.deps, w.input);
    expect(summary).toMatchObject({ status: "completed", result: { engine: AUTO_ENGINE_VERSION, vision_pages: 0, visuals: { vis_1: { choice: "C", spec: { kind: "fraction_bar" } }, vis_2: { choice: "C", spec: { kind: "number_line" } } } } });
    const locators = await q<{ visual_id: string; method: string; confidence: number; evidence: Record<string, unknown>; created_by: string | null }>("select visual_id, method, confidence, evidence, created_by from public.material_visual_locators where material_id = $1 order by visual_id", [w.materialId]);
    expect(locators.map((l) => [l.visual_id, l.method, l.created_by])).toEqual([["vis_1", "auto", null], ["vis_2", "auto", null]]);
    for (const l of locators) {
      expect(l.confidence).toBeGreaterThanOrEqual(0.75);
      expect(l.evidence).toMatchObject({ engine: AUTO_ENGINE_VERSION, signature: true, placement: true, clean: true, page_dpi: 100 });
      // Signals and coordinates only: no word of the material.
      expect(JSON.stringify(l.evidence)).not.toMatch(/Observa|barra|recta|Marca|fracci/i);
    }
    expect(await count("material_visual_assets", w.materialId)).toBe(2);
    const specs = await q<{ visual_id: string; kind: string; spec: unknown; spec_sha256: string }>("select visual_id, kind, spec, spec_sha256 from public.material_visual_specs where material_id = $1 order by visual_id", [w.materialId]);
    expect(specs.map((s) => [s.visual_id, s.kind])).toEqual([["vis_1", "fraction_bar"], ["vis_2", "number_line"]]);
    for (const s of specs) expect(fingerprint(s.spec)).toBe(s.spec_sha256);
    expect(specs[0]!.spec).toMatchObject({ parts: 8, shaded: [0, 1, 2] });
    expect(specs[1]!.spec).toMatchObject({ start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4 });
  });

  it("what the sheet reads (with the TEACHER's rights): ready, choice C with the verified spec, and the crop's physical width", async () => {
    const w = await world();
    await prepareVisuals(w.auto.deps, w.input);
    const resolved = await w.resolve();
    expect(resolved.states.vis_1).toMatchObject({ status: "ready", resolution: "C", provenance: { method: "auto" }, spec: { kind: "fraction_bar", parts: 8 } });
    expect(resolved.states.vis_2).toMatchObject({ status: "ready", resolution: "C", spec: { kind: "number_line" } });
    // 320 pt of bar + the recipe's margin ≈ 117 mm.
    expect(resolved.states.vis_1!.widthMm).toBeGreaterThan(110);
    expect(resolved.states.vis_1!.widthMm).toBeLessThan(125);
  });

  it("a spec whose stored bytes do not match its sha-256 is not used: the crop is (choice B), never a doubtful drawing", async () => {
    const w = await world();
    await prepareVisuals(w.auto.deps, w.input);
    // A tampered row: only the database owner can do this (the immutability trigger is disabled for the test).
    await db.query("alter table public.material_visual_specs disable trigger material_visual_specs_check");
    await db.query("update public.material_visual_specs set spec = jsonb_set(spec, '{parts}', '7') where material_id = $1 and visual_id = 'vis_1'", [w.materialId]);
    await db.query("alter table public.material_visual_specs enable trigger material_visual_specs_check");
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "ready", resolution: "B" });
    expect((await w.resolve()).states.vis_1!.spec).toBeUndefined();
  });
});

describe("idempotency, concurrency and cost", () => {
  it("a second run (another adaptation, a PDF download) does nothing: same rows, no vision call, the recorded result", async () => {
    const vision: VisionLocator = { locate: async () => ({ hypotheses: new Map(), run: null as never }) };
    const w = await world({ vision });
    const first = await prepareVisuals(w.auto.deps, w.input);
    const rows = await Promise.all(["material_visual_locators", "material_visual_assets", "material_visual_specs"].map((t) => count(t, w.materialId)));
    const again = await prepareVisuals(w.auto.deps, w.input);
    expect(again).toEqual({ status: "cached", result: (first as { result: unknown }).result });
    expect(await Promise.all(["material_visual_locators", "material_visual_assets", "material_visual_specs"].map((t) => count(t, w.materialId)))).toEqual(rows);
    expect(w.auto.calls.vision).toBe(0);
    expect(await count("material_visual_autolocations", w.materialId)).toBe(1);
  });

  it("two simultaneous runs: one works, the other stands aside; one locator per visual", async () => {
    const w = await world();
    const results = await Promise.all([prepareVisuals(w.auto.deps, w.input), prepareVisuals(w.auto.deps, w.input)]);
    expect(results.map((r) => r.status).sort()).toEqual(["busy", "completed"]);
    expect(await count("material_visual_locators", w.materialId)).toBe(2);
    expect(await count("material_visual_specs", w.materialId)).toBe(2);
  });

  it("vision only when geometry is not enough: ONE call for the page, recorded in ai_runs (no content); a stray rectangle is not accepted", async () => {
    // Without the analysis's link between activity 1 and the bar, geometry alone is not sure enough.
    const unlinked = fractionsCaseAnalysis();
    unlinked.activities = unlinked.activities.map((a) => (a.id === "act_1" ? { ...a, resource_ids: [] } : a));
    unlinked.visuals = unlinked.visuals.map((v) => (v.id === "vis_1" ? { ...v, activity_ids: [] } : v));
    const run = { purpose: "locate_visual" as const, attempt: 1, alias: "STANDARD" as const, provider: "anthropic" as const, model: "modelo-de-prueba", effort: "medium" as const, promptKey: "visual_locator", promptVersion: 1, inputTokens: 1800, outputTokens: 120, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0.0048, latencyMs: 900, status: "success" as const, errorCode: null };
    const agrees: VisionLocator = { locate: async ({ figures }) => ({ hypotheses: new Map(figures.map((f) => [f.id, { bounds: { x: BAR_BOUNDS.x - 0.01, y: BAR_BOUNDS.y - 0.005, w: BAR_BOUNDS.w + 0.02, h: BAR_BOUNDS.h + 0.01 }, confidence: 0.92 }])), run }) };
    const w = await world({ analysis: unlinked, vision: agrees });
    const summary = await prepareVisuals(w.auto.deps, w.input);
    expect(w.auto.calls.vision).toBe(1);
    expect(summary).toMatchObject({ status: "completed", result: { vision_pages: 1, visuals: { vis_1: { choice: "C", signals: { vision: { used: true, agrees: true } } }, vis_2: { choice: "C" } } } });
    const runs = await q<{ purpose: string; prompt_key: string; model_alias: string; estimated_cost_usd: string }>("select purpose, prompt_key, model_alias, estimated_cost_usd::text from public.ai_runs where material_id = $1", [w.materialId]);
    expect(runs).toEqual([{ purpose: "locate_visual", prompt_key: "visual_locator", model_alias: "STANDARD", estimated_cost_usd: "0.004800" }]);
    expect((await q<{ vision_calls: number }>("select vision_calls from public.material_visual_autolocations where material_id = $1", [w.materialId]))[0]!.vision_calls).toBe(1);

    const stray: VisionLocator = { locate: async ({ figures }) => ({ hypotheses: new Map(figures.map((f) => [f.id, { bounds: { x: 0.55, y: 0.85, w: 0.3, h: 0.08 }, confidence: 0.99 }])), run }) };
    const v = await world({ analysis: unlinked, vision: stray });
    const refused = await prepareVisuals(v.auto.deps, v.input);
    expect(refused).toMatchObject({ result: { visuals: { vis_1: { choice: "D", reason: "hypothesis_not_snapped" } } } });
    expect((refused as { result: { visuals: Record<string, { confidence: number }> } }).result.visuals.vis_1!.confidence).toBeLessThanOrEqual(0.6);
    expect((await v.resolve()).states.vis_1).toMatchObject({ status: "missing_locator", resolution: "D" });
  });

  it("no unit, no usage event, no entitlement is touched", async () => {
    const w = await world();
    const before = await q<{ u: string; e: string }>("select (select count(*) from public.usage_events)::text u, (select count(*) from public.adaptation_entitlements)::text e");
    await prepareVisuals(w.auto.deps, w.input);
    expect(await q("select (select count(*) from public.usage_events)::text u, (select count(*) from public.adaptation_entitlements)::text e")).toEqual(before);
  });
});

describe("the teacher keeps control", () => {
  it("a figure the teacher located is kept as it is (choice A): no automatic locator, no reconstruction over it", async () => {
    const w = await world();
    const actor = { userId: w.user.id, workspaceId: w.user.workspaceId, canWrite: true };
    await locateVisual(w.visuals.deps, actor, { materialId: w.materialId, visualId: "vis_1", page: 1, bounds: { x: 0.12, y: 0.16, w: 0.6, h: 0.06 } });
    const summary = await prepareVisuals(w.auto.deps, w.input);
    expect(summary).toMatchObject({ result: { visuals: { vis_1: { choice: "A", reason: "kept_human" }, vis_2: { choice: "C" } } } });
    expect(await q("select method from public.material_visual_locators where material_id = $1 and visual_id = 'vis_1'", [w.materialId])).toEqual([{ method: "human" }]);
    expect((await w.resolve()).states.vis_1).toMatchObject({ resolution: "A", provenance: { method: "human" } });
  });

  it("the teacher's correction replaces the automatic one (and its reconstruction no longer applies)", async () => {
    const w = await world();
    await prepareVisuals(w.auto.deps, w.input);
    const actor = { userId: w.user.id, workspaceId: w.user.workspaceId, canWrite: true };
    const relocated = await locateVisual(w.visuals.deps, actor, { materialId: w.materialId, visualId: "vis_2", page: 1, bounds: { x: 0.1, y: 0.53, w: 0.75, h: 0.08 } });
    expect(relocated).toMatchObject({ ok: true, status: "ready", revision: 2 });
    expect((await w.resolve()).states.vis_2).toMatchObject({ status: "ready", resolution: "A", provenance: { method: "human", revision: 2 } });
  });
});

describe("an essential figure that cannot be found: the honest stop, never an invented image", () => {
  it("no number line on the page → D for it (no locator, no crop), the bar still resolved", async () => {
    const w = await world({ pdf: { withoutNumberLine: true } });
    const summary = await prepareVisuals(w.auto.deps, w.input);
    expect(summary).toMatchObject({ result: { visuals: { vis_1: { choice: "C" }, vis_2: { choice: "D" } } } });
    expect((await w.resolve()).states.vis_2).toMatchObject({ status: "missing_locator", resolution: "D" });
  });
});

describe("database guards and isolation (RLS)", () => {
  it("an automatic locator below the threshold, or without its evidence, cannot be stored; a reconstruction only for an automatic locator", async () => {
    const w = await world();
    const box = JSON.stringify({ kind: "pdf", width_pt: 595.28, height_pt: 841.89, rotation: 0, view: [0, 0, 595.28, 841.89] });
    const call = (confidence: number | null, evidence: string | null) =>
      as(db, "service_role", null, () => db.query("select public.create_visual_locator($1, $2, $3, 'vis_1', $4, 'auto', 1, 0.1, 0.1, 0.5, 0.05, $5, null, $6, $7)", [w.user.workspaceId, w.materialId, w.input.analysisFingerprint, w.input.sourceSha256, box, confidence, evidence]));
    await expect(call(0.6, "{}")).rejects.toThrow();
    await expect(call(0.9, null)).rejects.toThrow();
    const actor = { userId: w.user.id, workspaceId: w.user.workspaceId, canWrite: true };
    await locateVisual(w.visuals.deps, actor, { materialId: w.materialId, visualId: "vis_1", page: 1, bounds: { x: 0.12, y: 0.16, w: 0.6, h: 0.06 } });
    const human = (await q<{ id: string }>("select id from public.material_visual_locators where material_id = $1", [w.materialId]))[0]!.id;
    await expect(
      as(db, "service_role", null, () => db.query("insert into public.material_visual_specs (workspace_id, material_id, locator_id, visual_id, spec_version, extractor_version, kind, spec, spec_sha256) values ($1, $2, $3, 'vis_1', 1, 'visual_spec_extractor@v1', 'fraction_bar', '{\"kind\":\"fraction_bar\"}', $4)", [w.user.workspaceId, w.materialId, human, "a".repeat(64)])),
    ).rejects.toThrow(/localizador automático/);
    // An automatic locator never replaces the active one (here, the teacher's).
    const kept = await call(0.95, "{}");
    expect((kept.rows[0] as { create_visual_locator: { created: boolean } }).create_visual_locator.created).toBe(false);
  });

  it("reconstructions are immutable; members read their workspace's rows; another workspace and the browser write nothing and read nothing", async () => {
    const w = await world();
    await prepareVisuals(w.auto.deps, w.input);
    await expect(as(db, "service_role", null, () => db.query("update public.material_visual_specs set checks = '{}' where material_id = $1", [w.materialId]))).rejects.toThrow(/inmutable/);
    const read = (u: User, table: string) => as(db, "authenticated", u.id, () => db.query(`select id from public.${table} where material_id = $1`, [w.materialId])).then((r) => r.rows.length);
    expect(await read(w.user, "material_visual_specs")).toBe(2);
    expect(await read(w.user, "material_visual_autolocations")).toBe(1);
    const other = await createUser(db, `auto-visuals-other-${Math.random().toString(36).slice(2, 7)}@example.com`);
    expect(await read(other, "material_visual_specs")).toBe(0);
    expect(await read(other, "material_visual_autolocations")).toBe(0);
    await expect(as(db, "authenticated", w.user.id, () => db.query("insert into public.material_visual_autolocations (workspace_id, material_id, analysis_fingerprint, source_sha256, engine_version) values ($1, $2, $3, $4, 'auto_visuals@v9')", [w.user.workspaceId, w.materialId, "b".repeat(64), "c".repeat(64)]))).rejects.toThrow();
    await expect(as(db, "authenticated", w.user.id, () => db.query("select public.claim_visual_autolocation($1, $2, $3, $4, 'auto_visuals@v9')", [w.user.workspaceId, w.materialId, "b".repeat(64), "c".repeat(64)]))).rejects.toThrow();
  });
});

describe("where it runs: «Hacer magia» before the delivery; «Revisar antes de crear» never by itself", () => {
  type Need = "planning_support";
  const plannerOf = () => async (_inner: unknown, _call: number, input: { context: { needs: Array<{ dimension: string }> } }) => {
    const ref = (dim: Need) => `need_${input.context.needs.findIndex((x) => x.dimension === dim) + 1}`;
    return { draft: { decisions: [{ target: "document", action: "add_support", strategies: ["planning_support"], need_refs: [ref("planning_support")], intensity: "light", supports: [{ kind: "checklist", uses_task_data: false }] }], summary: ["Plan de prueba"] }, runs: [] } as never;
  };

  async function pipeline(prepare: (input: { materialId: string; adaptationId: string; analysisFingerprint: string }) => Promise<void>) {
    const user = await createUser(db, `auto-visuals-pipe-${++n}@example.com`);
    const material = await seedMaterial(db, user, fractionsCaseAnalysis());
    const learner = await seedLearner(db, user);
    const spy = newSpy();
    const orchestrator = makeDeps(db, scriptedServices(spy, { planner: plannerOf() }), { visuals: { prepare } });
    orchestrator.entitlements = dbEntitlements(orchestrator.store);
    const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions };
    const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
    return { user, material, learner, orchestrator, deps, actor };
  }

  it("magic: prepared once, BEFORE the sheet is ready, for its material and pinned analysis; the unit is consumed once", async () => {
    const calls: Array<{ materialId: string; status: string | undefined }> = [];
    const store: { current?: Awaited<ReturnType<typeof pipeline>>["orchestrator"]["store"] } = {};
    const p = await pipeline(async (input) => {
      calls.push({ materialId: input.materialId, status: (await store.current!.getPipeline(input.adaptationId))?.adaptation.status });
    });
    store.current = p.orchestrator.store;
    const created = await createAndStartAdaptation(p.deps, p.actor, { materialId: p.material, learnerProfileId: p.learner, adaptationType: "accessibility", requestKey: `auto-vis-${n}`, creationMode: "automatic" });
    if (!created.ok) throw new Error(created.code);
    for (let i = 0; i < 8 && (await processAdaptationStage(p.orchestrator, created.data.adaptationId)); i++);
    const status = await getAdaptationStatus(p.deps, p.actor, created.data.adaptationId);
    expect(status.ok && status.data).toMatchObject({ status: "ready", delivered: true });
    expect(calls).toEqual([{ materialId: p.material, status: "reviewing_ai" }]);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [created.data.adaptationId]))[0]!.state).toBe("consumed");
  });

  it("magic: a failure while preparing never fails the generation (the sheet then waits for what it lacks)", async () => {
    const p = await pipeline(async () => {
      throw new Error("rasteriser down");
    });
    const created = await createAndStartAdaptation(p.deps, p.actor, { materialId: p.material, learnerProfileId: p.learner, adaptationType: "accessibility", requestKey: `auto-vis-fail-${n}`, creationMode: "automatic" });
    if (!created.ok) throw new Error(created.code);
    for (let i = 0; i < 8 && (await processAdaptationStage(p.orchestrator, created.data.adaptationId)); i++);
    const status = await getAdaptationStatus(p.deps, p.actor, created.data.adaptationId);
    expect(status.ok && status.data).toMatchObject({ status: "ready", delivered: true });
  });

  it("review mode: the teacher approves the plan and the sheet is delivered, and nothing is located for them", async () => {
    let called = 0;
    const p = await pipeline(async () => {
      called += 1;
    });
    const created = await createAdaptationCommand(p.deps, p.actor, { materialId: p.material, learnerProfileId: p.learner, adaptationType: "accessibility", requestKey: `auto-vis-review-${n}` });
    if (!created.ok) throw new Error(created.code);
    const id = created.data.adaptationId;
    await startPlanning(p.deps, p.actor, id);
    await processAdaptationJobs(p.orchestrator, { limit: 5, adaptationIds: [id] });
    const plan = await getAdaptationPlan(p.deps, p.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    await submitPlanReviewCommand(p.deps, p.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-11T10:00:00Z", entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "prueba" })) });
    await startGeneration(p.deps, p.actor, id);
    await processAdaptationJobs(p.orchestrator, { limit: 5, adaptationIds: [id] });
    const status = await getAdaptationStatus(p.deps, p.actor, id);
    expect(status.ok && status.data).toMatchObject({ status: "ready", delivered: true });
    expect(called).toBe(0);
  });
});
