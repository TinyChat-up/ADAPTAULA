import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import type { OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import { createAdaptationCommand, createAndStartAdaptation, getAdaptationPlan, getAdaptationStatus, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationJobs, processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { visualNeedsOf } from "@/lib/adaptation/presentation/visual-needs";
import type { VisualAssistants } from "@/lib/materials/visuals/auto/assistants";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { corroborateSpec, prepareVisuals } from "@/lib/materials/visuals/auto/service";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import { loadRenderInputWith } from "@/lib/render/load";
import { readinessOf } from "@/lib/render/readiness";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks } from "@/lib/schemas/material-document";
import { fractionsCaseAnalysis, fractionsPdf, type FractionsPdfOptions } from "../support/fractions-case";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Scripted } from "./orchestration-harness";
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
/** Visual 2 turned into a mere data source (a label that carries «3/4 de litro»), used by a calculation. */
function dataSourceAnalysis(): MaterialAnalysis {
  const analysis = fractionsCaseAnalysis();
  analysis.visuals = analysis.visuals.map((v) => (v.id === "vis_2" ? { ...v, kind: "image", title: null, description: "Etiqueta de una botella de agua: 3/4 de litro.", text: null } : v));
  analysis.activities = analysis.activities.map((a) => (a.id === "act_4" ? { ...a, instruction: "Calcula cuántos cuartos de litro le faltan a la botella para llegar a 1 litro.", response_format: "calculate", answer_area: { type: "lines", lines: 2 }, objective_ids: ["obj_3"] } : a));
  analysis.protected_elements = analysis.protected_elements.filter((p) => !p.resource_ids.includes("vis_2"));
  return analysis;
}

async function teacher(options: { analysis?: MaterialAnalysis; pdf?: FractionsPdfOptions; assistants?: VisualAssistants | null; reviewer?: Scripted["reviewer"] } = {}) {
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
      // The same wiring as production (`auto/server.ts`): only crops THIS engine accepted, and pixel-corroborated rebuilds.
      const summary = await prepareVisuals(auto.deps, { workspaceId: input.workspaceId, materialId: input.materialId, analysis: input.analysis, analysisFingerprint: input.analysisFingerprint, sourceSha256, adaptationId: input.adaptationId });
      const accepted = "result" in summary && summary.result ? summary.result.visuals : {};
      return resolveMagicVisuals(
        {
          readyOriginals: async (ids) => {
            const r = await resolveVisuals(visuals.deps, { materialId: input.materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256, visualIds: ids });
            return new Set(ids.filter((id) => r.states[id]?.status === "ready" && (r.states[id]?.provenance?.method === "human" || ["B", "C"].includes(accepted[id]?.choice ?? ""))));
          },
          corroborate: (visual, activityTexts) => corroborateSpec(auto.deps, { materialId: input.materialId, sourceSha256, visual, activityTexts }),
          assistants: options.assistants ?? null,
          recordAiRun: (run) => auto.deps.recordAiRun!(run, { workspaceId: input.workspaceId, materialId: input.materialId, adaptationId: input.adaptationId }),
        },
        { analysis: input.analysis, document: input.document, requiredVisuals: input.requiredVisuals, stage: input.stage, functionalNeeds: input.functionalNeeds },
      );
    },
  };
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner, ...(options.reviewer ? { reviewer: options.reviewer } : {}) }), { visuals: visualPolicy });
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
  return { user, materialId, learner, deps, actor, spy, orchestrator, status, magic, sheet, entitlement, plan, resolveCalls, visuals, auto, sourceSha256 };
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

  it("no number line in the PDF: a NEW line 0–1 in quarters is drawn with activity 4 → ready, printable, one unit, no model, no teacher step", async () => {
    const calls: string[] = [];
    const assistants: VisualAssistants = { support: async () => (calls.push("support"), { draft: null, run: aiRun }), rewrite: async () => (calls.push("rewrite"), { draft: null, run: aiRun }), substitute: async () => (calls.push("substitute"), { draft: null, run: aiRun }) };
    const t = await teacher({ pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, automaticStop: null });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "generatable_support_visual", resolution: { action: "figure", provenance: "generated", spec: { kind: "number_line", divisions: 4 } } });
    const s = await t.sheet(id);
    expect(s.readiness).toMatchObject({ printable: true, pendingResources: 0 });
    expect(s.needs.filter((x) => x.status !== "ready")).toEqual([]);
    if (s.loaded.kind !== "ok") throw new Error("no sheet");
    const act4 = allBlocks(s.loaded.document).find((b) => b.type === "activity" && b.label === "4");
    expect(act4).toMatchObject({ response: { kind: "none" } });
    expect(await t.entitlement(id)).toBe("consumed");
    expect(calls).toEqual([]);
  });

  it("a wrong crop is never used (pixels 8/3, description 6/2): the bar is drawn from the activity's answer, and the sheet is delivered", async () => {
    const analysis = fractionsCaseAnalysis();
    analysis.visuals = analysis.visuals.map((v) => (v.id === "vis_1" ? { ...v, description: "Barra dividida en 6 partes iguales con 2 partes coloreadas." } : v));
    const t = await teacher({ analysis });
    const id = await t.magic();
    const result = (await q<{ result: { visuals: Record<string, { choice: string; reason: string }> } }>("select result from public.material_visual_autolocations where material_id = $1", [t.materialId]))[0]!.result;
    expect(result.visuals.vis_1).toMatchObject({ choice: "D", reason: "contradicts_analysis" });
    expect(result.visuals.vis_2).toMatchObject({ choice: "C" });
    expect(await q("select 1 from public.material_visual_locators where material_id = $1 and visual_id = 'vis_1'", [t.materialId])).toEqual([]);
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_1")).toMatchObject({ category: "generatable_support_visual", resolution: { action: "figure", spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } } });
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    expect(await t.entitlement(id)).toBe("consumed");
  });

  it("an automatic crop of an earlier engine that this one does not find again is never used: the bar is rebuilt from its real pixels", async () => {
    const analysis = fractionsCaseAnalysis();
    const t = await teacher({ analysis });
    const { fingerprint } = await import("@/lib/adaptation/fingerprint");
    const { readPage } = await import("@/lib/materials/visuals/auto/read");
    const { loadSource, produceVisualAsset } = await import("@/lib/materials/visuals/service");
    const { box } = await readPage(await fractionsPdf(), "application/pdf", 1, 100);
    // A v1 false positive: a «figure» crop over another exercise, accepted at exactly 0.75 without vision, with its crop produced.
    const stale = await t.visuals.deps.admin.createLocator({ workspaceId: t.user.workspaceId, materialId: t.materialId, analysisFingerprint: fingerprint(analysis), visualId: "vis_1", sourceSha256: t.sourceSha256, page: 1, bounds: { x: 0.12, y: 0.36, w: 0.5, h: 0.05 }, pageBox: box, userId: null, method: "auto", confidence: 0.75, evidence: { engine: "auto_visuals@v1" } });
    expect(await produceVisualAsset(t.visuals.deps, stale.id, (await loadSource(t.visuals.deps, t.materialId, t.sourceSha256))!)).toMatchObject({ ok: true });
    const id = await t.magic();
    const result = (await q<{ result: { visuals: Record<string, { choice: string; reason: string }> } }>("select result from public.material_visual_autolocations where material_id = $1", [t.materialId]))[0]!.result;
    expect(result.visuals.vis_1).toMatchObject({ choice: "D", reason: "auto_not_revalidated" });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_1")).toMatchObject({ category: "reconstructable_structured_visual", resolution: { action: "figure", spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } } });
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    const s = await t.sheet(id);
    if (s.loaded.kind !== "ok") throw new Error("no sheet");
    expect(allBlocks(s.loaded.document).some((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === "vis_1")).toBe(false);
  });

  it("the figure only carried a datum: the activity is rewritten without it (validated as equivalent), and the sheet is ready", async () => {
    const assistants: VisualAssistants = {
      support: async () => ({ draft: null, run: aiRun }),
      rewrite: async () => ({ draft: { feasible: true, prompt: "La botella tiene 3/4 de litro de agua. Calcula cuántos cuartos de litro le faltan para llegar a 1 litro.", steps: [], lines: 2 }, run: aiRun }),
      substitute: async () => ({ draft: null, run: aiRun }),
    };
    const t = await teacher({ analysis: dataSourceAnalysis(), pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true });
    const s = await t.sheet(id);
    expect(s.readiness).toMatchObject({ printable: true });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "rewritable_without_visual", resolution: { action: "rewrite" } });
    expect(await q("select purpose, prompt_key from public.ai_runs where adaptation_id = $1 and purpose like 'visual_%'", [id])).toEqual([{ purpose: "visual_rewrite", prompt_key: "visual_rewriter" }]);
    expect(await t.entitlement(id)).toBe("consumed");
  });

  it("the rewrite is not valid: a NEW equivalent activity replaces it (validated), and the sheet is delivered", async () => {
    const assistants: VisualAssistants = {
      support: async () => ({ draft: null, run: aiRun }),
      rewrite: async () => ({ draft: { feasible: false, prompt: null, steps: null, lines: null }, run: aiRun }),
      substitute: async () => ({ draft: { feasible: true, prompt: "Una botella de 1 litro contiene 3/4 de litro de agua. Calcula cuántos cuartos de litro le faltan para estar llena.", steps: [], lines: 2, figure: null }, run: { ...aiRun, promptKey: "visual_substitute" } }),
    };
    const t = await teacher({ analysis: dataSourceAnalysis(), pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, automaticStop: null });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "substituted_activity", resolution: { action: "substitute", spec: null } });
    expect((await t.sheet(id)).readiness).toMatchObject({ printable: true });
    expect(await q("select prompt_key from public.ai_runs where adaptation_id = $1 and purpose like 'visual_%' order by prompt_key", [id])).toEqual([{ prompt_key: "visual_rewriter" }, { prompt_key: "visual_substitute" }]);
    expect(await t.entitlement(id)).toBe("consumed");
  });

  it("rejects an added operation, corrects once with feedback and delivers a printable sheet with both attempts recorded", async () => {
    const inputs: Parameters<VisualAssistants["substitute"]>[0][] = [];
    const prompt = "Una botella de 1 litro contiene 3/4 de litro de agua. Calcula cuántos cuartos de litro le faltan para estar llena.";
    const assistants: VisualAssistants = {
      support: async () => ({ draft: null, run: aiRun }),
      rewrite: async () => ({ draft: { feasible: false, prompt: null, steps: null, lines: null }, run: aiRun }),
      substitute: async (input) => {
        inputs.push(input);
        return { draft: { feasible: true, prompt: inputs.length === 1 ? `${prompt} Explica el resultado.` : prompt, steps: [], lines: 2, figure: null }, run: { ...aiRun, promptKey: "visual_substitute", promptVersion: 2 } };
      },
    };
    const t = await teacher({ analysis: dataSourceAnalysis(), pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    expect(inputs.map((input) => input.rejectionCodes)).toEqual([[], ["action_added"]]);
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, automaticStop: null });
    expect((await t.sheet(id)).readiness).toMatchObject({ printable: true });
    expect(await q("select attempt, prompt_version from public.ai_runs where adaptation_id = $1 and prompt_key = 'visual_substitute' order by attempt", [id])).toEqual([{ attempt: 1, prompt_version: 2 }, { attempt: 2, prompt_version: 2 }]);
    expect(await t.entitlement(id)).toBe("consumed");
  });

  it("only when nothing valid can be built (every proposal rejected): the stop — not ready, no PDF, no unit, no AI review; and no loop", async () => {
    const assistants: VisualAssistants = { support: async () => ({ draft: null, run: aiRun }), rewrite: async () => ({ draft: { feasible: false, prompt: null, steps: null, lines: null }, run: aiRun }), substitute: async () => ({ draft: { feasible: false, prompt: null, steps: null, lines: null, figure: null }, run: aiRun }) };
    const t = await teacher({ analysis: dataSourceAnalysis(), pdf: { withoutNumberLine: true }, assistants });
    const id = await t.magic();
    const stopped = await t.status(id);
    expect(stopped).toMatchObject({ status: "blocked", delivered: false, phase: "automatic_incomplete", automaticStop: { reason: "visual" } });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "unresolved_visual", resolution: { reason: "no_equivalent_activity" }, attempts: ["locate", "reconstruct", "generate", "rewrite", "substitute"] });
    expect(t.spy.reviewer).toBe(0);
    expect(await t.entitlement(id)).toBe("reserved");
    expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
    expect((await t.status(id)).automaticStop).toMatchObject({ reason: "visual" });
    expect(t.resolveCalls).toHaveLength(1);
  });
});

describe("a sheet the visual policy changed is still repaired by itself (regression)", () => {
  it("the line is drawn anew AND the first review fails on a support: the correction finds that review, regenerates and delivers", async () => {
    // The first AI review finds the plan's support infantilising (a finding pinned on the support's own block); the second passes.
    const reviewer: Scripted["reviewer"] = async (inner, call, input) => {
      const out = await inner.review(input);
      if (call > 1) return out;
      const support = allBlocks(input.document).find((b) => b.trace.decision_ids.length > 0 && b.type !== "activity");
      const draft = out.draft as { checks: Array<{ check: string; status: string; targets: string[]; detail: string }> };
      return { ...out, draft: { checks: [...draft.checks.filter((c) => c.check !== "age_appropriate"), { check: "age_appropriate", status: "FAIL", targets: support ? [support.id] : [], detail: "Tono infantil" }] } } as never;
    };
    const t = await teacher({ pdf: { withoutNumberLine: true }, reviewer });
    const id = await t.magic();
    // Before the fix: the correction rebuilt the sheet WITHOUT the drawn line, found no review for it and stopped («quality»).
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, automaticStop: null, generationsUsed: 2 });
    expect((await t.plan(id))!.needs.find((x) => x.key === "vis_2")).toMatchObject({ category: "generatable_support_visual" });
    expect(await t.entitlement(id)).toBe("consumed");
  });
});

describe("rebuilt only with evidence from the original's pixels", () => {
  const corroborate = async (t: Awaited<ReturnType<typeof teacher>>, analysis: MaterialAnalysis, visualId: string) => {
    const visual = analysis.visuals.find((v) => v.id === visualId)!;
    const texts = analysis.activities.filter((a) => visual.activity_ids.includes(a.id)).map((a) => a.instruction);
    return corroborateSpec(t.auto.deps, { materialId: t.materialId, sourceSha256: t.sourceSha256, visual, activityTexts: texts });
  };

  it("bar 8 / 3 and line 0–1 in quarters: the description selects the drawing, the drawing is what is drawn", async () => {
    const analysis = fractionsCaseAnalysis();
    const t = await teacher({ analysis });
    expect(await corroborate(t, analysis, "vis_1")).toEqual({ spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] });
    expect(await corroborate(t, analysis, "vis_2")).toMatchObject({ kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ text: "0" }, { text: "1/4" }, { text: "1/2" }, { text: "3/4" }, { text: "1" }] });
  });

  it("no evidence, no figure: absent drawing, a different drawing, a mark on the line, unequal parts, an incomplete description", async () => {
    const base = fractionsCaseAnalysis();
    expect(await corroborate(await teacher({ analysis: base, pdf: { withoutNumberLine: true } }), base, "vis_2")).toBeNull();
    expect(await corroborate(await teacher({ analysis: base, pdf: { markOnLine: true } }), base, "vis_2")).toBeNull();
    expect(await corroborate(await teacher({ analysis: base, pdf: { unequalBar: true } }), base, "vis_1")).toBeNull();
    const other = fractionsCaseAnalysis();
    other.visuals = other.visuals.map((v) => (v.id === "vis_1" ? { ...v, description: "Barra dividida en 6 partes iguales con 2 partes coloreadas." } : v.id === "vis_2" ? { ...v, description: "Recta numérica de 0 a 1 dividida en quintos." } : v));
    const t = await teacher({ analysis: other });
    expect(await corroborate(t, other, "vis_1")).toBeNull();
    expect(await corroborate(t, other, "vis_2")).toBeNull();
    const incomplete = fractionsCaseAnalysis();
    incomplete.visuals = incomplete.visuals.map((v) => (v.id === "vis_1" ? { ...v, description: "Barra dividida en partes, algunas coloreadas." } : v));
    expect(await corroborate(await teacher({ analysis: incomplete }), incomplete, "vis_1")).toBeNull();
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
