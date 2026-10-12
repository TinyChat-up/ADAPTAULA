import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import type { OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import { createAdaptationCommand, createAndStartAdaptation, getAdaptationPlan, getAdaptationStatus, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationJobs, processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { visualNeedsOf } from "@/lib/adaptation/presentation/visual-needs";
import type { VisualAssistants } from "@/lib/materials/visuals/auto/assistants";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { prepareVisuals } from "@/lib/materials/visuals/auto/service";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import { loadRenderInputWith } from "@/lib/render/load";
import { readinessOf } from "@/lib/render/readiness";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks } from "@/lib/schemas/material-document";
import { fractionsCaseAnalysis, fractionsPdf, type FractionsPdfOptions } from "../support/fractions-case";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";
import { resourceHarness } from "./resource-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/**
 * «Hacer magia» end to end with the visual policy (real migrations, real orchestrator, the real automatic locator on the
 * synthetic fractions PDF, scripted planner/generator/reviewer and scripted visual assistants: 0 real model calls). The teacher
 * never locates, uploads or omits anything: the sheet is delivered complete and printable, or the adaptation stops honestly.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 120_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));
const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

const planner = async (_inner: unknown, _call: number, input: { context: { needs: Array<{ dimension: string }> } }) => {
  const ref = `need_${input.context.needs.findIndex((x) => x.dimension === "planning_support") + 1}`;
  return { draft: { decisions: [{ target: "document", action: "add_support", strategies: ["planning_support"], need_refs: [ref], intensity: "light", supports: [{ kind: "checklist", uses_task_data: false }] }], summary: ["Plan de prueba"] }, runs: [] } as never;
};

const aiRun = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "anthropic" as const, model: "modelo-de-prueba", effort: "low" as const, promptKey: "visual_rewriter", promptVersion: 1, inputTokens: 900, outputTokens: 120, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0.003, latencyMs: 500, status: "success" as const, errorCode: null };

let n = 0;
async function teacher(options: { analysis?: MaterialAnalysis; pdf?: FractionsPdfOptions; assistants?: VisualAssistants | null } = {}) {
  const user = await createUser(db, `magic-visual-${++n}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  const analysis = options.analysis ?? fractionsCaseAnalysis();
  const materialId = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const visuals = visualHarness(db, user);
  const sourceSha256 = await attachSource(db, visuals, materialId, "application/pdf", await fractionsPdf(options.pdf));
  const auto = autoHarness(db, visuals);
  const resolveCalls: string[] = [];
  const visualPolicy: NonNullable<OrchestratorDeps["visuals"]> = {
    resolve: async (input) => {
      resolveCalls.push(input.adaptationId);
      await prepareVisuals(auto.deps, { workspaceId: input.workspaceId, materialId: input.materialId, analysis: input.analysis, analysisFingerprint: input.analysisFingerprint, sourceSha256, adaptationId: input.adaptationId });
      return resolveMagicVisuals(
        {
          readyOriginals: async (ids) => {
            const r = await resolveVisuals(visuals.deps, { materialId: input.materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256, visualIds: ids });
            return new Set(ids.filter((id) => r.states[id]?.status === "ready"));
          },
          assistants: options.assistants ?? null,
          recordAiRun: (run) => auto.deps.recordAiRun!(run, { workspaceId: input.workspaceId, materialId: input.materialId, adaptationId: input.adaptationId }),
        },
        { analysis: input.analysis, document: input.document, requiredVisuals: input.requiredVisuals, stage: input.stage },
      );
    },
  };
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner }), { visuals: visualPolicy });
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const magic = async () => {
    const created = await createAndStartAdaptation(deps, actor, { materialId, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `magic-visual-${n}-${Math.random()}`, creationMode: "automatic" });
    if (!created.ok) throw new Error(created.code);
    const id = created.data.adaptationId;
    for (let i = 0; i < 10 && (await processAdaptationStage(orchestrator, id)); i++);
    return id;
  };
  const sheet = async (id: string) => {
    const loaded = await loadRenderInputWith(deps, actor, id, visuals.deps, { resources: resourceHarness(db, user).deps });
    if (loaded.kind !== "ok") return { loaded, readiness: null, needs: [] };
    return { loaded, readiness: readinessOf(loaded), needs: visualNeedsOf(loaded) };
  };
  const entitlement = async (id: string) => (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]?.state;
  const plan = async (id: string) => (await q<{ payload: { plan: { needs: Array<{ key: string; category: string; resolution: { action: string } }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'visual_resolution'", [id]))[0]?.payload.plan;
  return { user, materialId, learner, deps, actor, spy, orchestrator, status, magic, sheet, entitlement, plan, resolveCalls };
}

describe("«Hacer magia» delivers the fractions sheet complete, with nothing for the teacher to do", () => {
  it("figures found in the original: ready, printable, no visual need left, one unit consumed", async () => {
    const t = await teacher();
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, automaticStop: null });
    const s = await t.sheet(id);
    expect(s.readiness).toMatchObject({ printable: true, pendingResources: 0 });
    expect(s.needs.filter((x) => x.status !== "ready")).toEqual([]);
    expect((await t.plan(id))!.needs.map((x) => [x.key, x.category])).toEqual([["vis_1", "exact_original_visual"], ["vis_2", "exact_original_visual"]]);
    expect(await t.entitlement(id)).toBe("consumed");
  });

  it("a figure that is not in the PDF is rebuilt from the analysis and drawn in its activity: ready and printable", async () => {
    const t = await teacher({ pdf: { withoutNumberLine: true } });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    const s = await t.sheet(id);
    expect(s.readiness).toMatchObject({ printable: true });
    if (s.loaded.kind !== "ok") throw new Error("no sheet");
    const figure = allBlocks(s.loaded.document).find((b) => b.type === "image" && b.source.kind === "figure");
    expect(figure).toMatchObject({ source: { kind: "figure", provenance: "reconstruction", visual_ref: "vis_2", spec: { kind: "number_line", divisions: 4 } } });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "reconstructable_structured_visual" });
  });

  it("neither found nor rebuildable: the activity is rewritten without it (validated), and the sheet is ready", async () => {
    const analysis = fractionsCaseAnalysis();
    analysis.visuals = analysis.visuals.map((v) => (v.id === "vis_2" ? { ...v, kind: "image", description: "Dibujo de una jarra." } : v));
    const assistants: VisualAssistants = {
      support: async () => ({ draft: null, run: aiRun }),
      rewrite: async () => ({ draft: { feasible: true, prompt: "Divide el segmento de 0 a 1 en cuatro partes iguales y escribe dónde iría 3/4.", steps: [], lines: 2 }, run: aiRun }),
    };
    const t = await teacher({ analysis, pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    const s = await t.sheet(id);
    expect(s.readiness).toMatchObject({ printable: true });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "rewritable_without_visual", resolution: { action: "rewrite" } });
    expect(await q("select purpose, prompt_key from public.ai_runs where adaptation_id = $1 and purpose like 'visual_%'", [id])).toEqual([{ purpose: "visual_rewrite", prompt_key: "visual_rewriter" }]);
  });

  it("nothing reliable: an honest stop — not ready, no PDF, no unit, no AI review, no request to locate; and no loop", async () => {
    const analysis = fractionsCaseAnalysis();
    analysis.visuals = analysis.visuals.map((v) => (v.id === "vis_2" ? { ...v, kind: "image", description: "Dibujo de una jarra." } : v));
    const assistants: VisualAssistants = { support: async () => ({ draft: null, run: aiRun }), rewrite: async () => ({ draft: { feasible: false, prompt: null, steps: null, lines: null }, run: aiRun }) };
    const t = await teacher({ analysis, pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    const stopped = await t.status(id);
    expect(stopped).toMatchObject({ status: "blocked", delivered: false, phase: "automatic_incomplete", automaticStop: { reason: "visual" } });
    expect(t.spy.reviewer).toBe(0);
    expect(await t.entitlement(id)).toBe("reserved");
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect((await t.status(id)).automaticStop).toMatchObject({ reason: "visual" });
    expect(t.resolveCalls).toHaveLength(1);
  });
});

describe("«Revisar antes de crear» keeps the teacher in control", () => {
  it("the visual policy never runs: the teacher locates, adds or omits as before", async () => {
    const t = await teacher({ pdf: { withoutNumberLine: true } });
    const created = await createAdaptationCommand(t.deps, t.actor, { materialId: t.materialId, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: `review-${n}-${Math.random()}` });
    if (!created.ok) throw new Error(created.code);
    const id = created.data.adaptationId;
    await startPlanning(t.deps, t.actor, id);
    await processAdaptationJobs(t.orchestrator, { limit: 5, adaptationIds: [id] });
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    await submitPlanReviewCommand(t.deps, t.actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-12T10:00:00Z", entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "prueba" })) });
    await startGeneration(t.deps, t.actor, id);
    await processAdaptationJobs(t.orchestrator, { limit: 5, adaptationIds: [id] });
    expect(t.resolveCalls).toEqual([]);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    // The teacher's sheet still waits for its images: their controls, not an automatic decision.
    const s = await t.sheet(id);
    expect(s.readiness?.printable).toBe(false);
    expect(s.needs.filter((x) => x.status === "to_select").map((x) => x.key).sort()).toEqual(["vis_1", "vis_2"]);
  });
});
