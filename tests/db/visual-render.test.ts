import type { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { TeacherPanel } from "@/components/material/teacher-panel";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { processAdaptationJobs } from "@/lib/adaptation/orchestration/worker";
import { createAdaptationCommand, getAdaptationPlan, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { locateVisual } from "@/lib/materials/visuals/service";
import { loadRenderInputWith } from "@/lib/render/load";
import { buildRenderModel } from "@/lib/render/model";
import { MaterialAnalysisSchema } from "@/lib/schemas/material-analysis";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { INFERRED_ANSWER } from "../support/adaptation-ui-fixtures";
import { visualFixturePdf } from "../support/visual-fixture";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type User } from "./orchestration-harness";
import { attachSource, visualHarness, type VisualHarness } from "./visual-harness";

/** The sheet viewer with the visual asset layer, over the real pipeline output on PGlite (mock providers, 0 real calls). */
let db: PGlite;
let pdf: Uint8Array;
const base = fractionsAnalysis();
// An inferred expected answer sits in the analysis on purpose: nothing on these paths may show it.
const analysis = { ...base, activities: base.activities.map((a, i) => (i === 0 ? { ...a, expected_answer: { basis: "inferred" as const, value: INFERRED_ANSWER } } : a)) };
beforeAll(async () => {
  db = await createTestDb();
  pdf = await visualFixturePdf();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

let n = 0;
async function material() {
  const user = await createUser(db, `vrender-${++n}@example.com`);
  const id = await seedMaterial(db, user, analysis);
  const visuals = visualHarness(db, user);
  await attachSource(db, visuals, id, "application/pdf", pdf);
  return { user, id, visuals };
}

async function deliveredAdaptation(user: User, materialId: string) {
  const learner = await seedLearner(db, user);
  const orchestrator = makeDeps(db, scriptedServices(newSpy(), {}), {});
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const created = await createAdaptationCommand(deps, actor, { materialId, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `vr-${n}-${Math.random()}` });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  const tick = () => processAdaptationJobs(orchestrator, { limit: 5, adaptationIds: [id] });
  await startPlanning(deps, actor, id);
  await tick();
  const plan = await getAdaptationPlan(deps, actor, id);
  if (!plan.ok) throw new Error(plan.code);
  await submitPlanReviewCommand(deps, actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00Z", entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" })) });
  await startGeneration(deps, actor, id);
  await tick();
  return { id, deps, actor };
}

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const html = (model: Parameters<typeof MaterialSheet>[0]["model"]) => renderToStaticMarkup(createElement(MaterialSheet, { model }));

async function view(a: { id: string; deps: ServiceDeps; actor: Actor }, visuals: VisualHarness, mode: "student" | "teacher_preview" = "student") {
  const loaded = await loadRenderInputWith(a.deps, a.actor, a.id, visuals.deps);
  if (loaded.kind !== "ok") throw new Error(loaded.kind);
  const built = buildRenderModel(loaded.document, { mode, requiredVisuals: loaded.requiredVisuals, deferred: loaded.deferred, assets: loaded.assets, assetFailures: loaded.assetFailures });
  return { loaded, ...built };
}

describe("visor + localización: de no renderizable a renderizable sin tocar la adaptación", () => {
  it("20/21/23/24/35 · necessary missing → not_renderable; locate both → renderable; the student sees the crops; the teacher sees the state", async () => {
    const m = await material();
    const a = await deliveredAdaptation(m.user, m.id);
    const reviewBefore = await q("select review from public.adaptation_versions where adaptation_id = $1", [a.id]);
    const documentBefore = await q<{ document: unknown }>("select document from public.adaptation_versions where adaptation_id = $1", [a.id]);

    const before = await view(a, m.visuals);
    expect(before.loaded.requiredVisuals.sort()).toEqual(["vis_1", "vis_2"]);
    expect(before.validation.status).toBe("not_renderable");
    expect(before.loaded.visuals.map((v) => v.status)).toEqual(expect.arrayContaining(["missing_locator"]));
    expect(before.validation.issues.find((i) => i.severity === "error")!.message).toContain("todavía no se ha señalado");

    const actor = { userId: m.user.id, workspaceId: m.user.workspaceId, canWrite: true };
    expect(await locateVisual(m.visuals.deps, actor, { materialId: m.id, visualId: "vis_1", page: 2, bounds: { x: 0.15, y: 0.22, w: 0.42, h: 0.14 } })).toMatchObject({ status: "ready" });
    const halfway = await view(a, m.visuals);
    expect(halfway.validation.status).toBe("not_renderable"); // vis_2 still missing
    expect(await locateVisual(m.visuals.deps, actor, { materialId: m.id, visualId: "vis_2", page: 2, bounds: { x: 0.15, y: 0.45, w: 0.72, h: 0.06 } })).toMatchObject({ status: "ready" });

    const after = await view(a, m.visuals);
    // vis_3 is decorative (optional): missing it is only a warning; nothing blocks any more.
    expect(after.validation.status).toBe("renderable_with_warnings");
    expect(after.validation.issues.filter((i) => i.severity === "error")).toEqual([]);
    const student = html(after.model);
    expect(student).toContain(`src="/api/adaptations/${a.id}/visuals/vis_1"`);
    expect(student).toContain(`src="/api/adaptations/${a.id}/visuals/vis_2"`);
    expect(student).toMatch(/alt="(Figura 1|Tiras de fracciones|Recurso visual de la actividad)"/);
    expect(student).not.toContain(INFERRED_ANSWER);
    expect(student).not.toMatch(/storage|generated-assets|token=|signed/i);

    const teacher = await view(a, m.visuals, "teacher_preview");
    const panel = renderToStaticMarkup(createElement(TeacherPanel, {
      validation: teacher.validation,
      version: teacher.loaded.version.version,
      observations: [],
      visuals: teacher.loaded.visuals.map((state) => ({ state, label: state.visualId === "vis_3" ? "Decoración" : "Figura", essential: teacher.loaded.requiredVisuals.includes(state.visualId), locateHref: `/app/materiales/${m.id}/visuales/${state.visualId}` })),
    }));
    expect(panel).toContain("localizada a mano en la página 2 (revisión 1)");
    expect(panel).toContain("Localizar también");
    expect(panel).toContain("Corregir la localización");
    expect(panel).not.toMatch(/storage_path|sha256|analysis_fingerprint|diagn/i);

    // The adaptation itself did not change: same version, same review, same document (no asset URL in it).
    expect(await q("select review from public.adaptation_versions where adaptation_id = $1", [a.id])).toEqual(reviewBefore);
    const documentAfter = await q<{ document: unknown }>("select document from public.adaptation_versions where adaptation_id = $1", [a.id]);
    expect(documentAfter).toEqual(documentBefore);
    expect(JSON.stringify(documentAfter)).not.toMatch(/\/api\/|visuals\/|storage|\.png/);
    expect(MaterialDocumentSchema.safeParse(documentAfter[0]!.document).success).toBe(true);
    expect((await q("select 1 from public.adaptation_versions where adaptation_id = $1", [a.id])).length).toBe(1);
  }, 60_000);

  it("14/19 · a second adaptation of the same material and analysis reuses the crops (no new asset), also an older one", async () => {
    const m = await material();
    const first = await deliveredAdaptation(m.user, m.id);
    const actor = { userId: m.user.id, workspaceId: m.user.workspaceId, canWrite: true };
    await locateVisual(m.visuals.deps, actor, { materialId: m.id, visualId: "vis_1", page: 2, bounds: { x: 0.15, y: 0.22, w: 0.42, h: 0.14 } });
    await locateVisual(m.visuals.deps, actor, { materialId: m.id, visualId: "vis_2", page: 2, bounds: { x: 0.15, y: 0.45, w: 0.72, h: 0.06 } });
    const assets = (await q("select 1 from public.material_visual_assets where material_id = $1", [m.id])).length;
    const second = await deliveredAdaptation(m.user, m.id);
    for (const a of [first, second]) expect((await view(a, m.visuals)).validation.status).toBe("renderable_with_warnings");
    expect((await q("select 1 from public.material_visual_assets where material_id = $1", [m.id])).length).toBe(assets);
  }, 60_000);

  it("15 · a re-analysed material (another analysis fingerprint) does not lend its crops to adaptations pinned to the old analysis", async () => {
    const m = await material();
    const old = await deliveredAdaptation(m.user, m.id);
    const changed = { ...analysis, identification: { ...analysis.identification, topic: { ...analysis.identification.topic, value: "Otro tema" } } };
    expect(MaterialAnalysisSchema.safeParse(changed).success).toBe(true);
    await db.query("update public.materials set analysis = $2 where id = $1", [m.id, JSON.stringify(changed)]);
    const actor = { userId: m.user.id, workspaceId: m.user.workspaceId, canWrite: true };
    // The locator is made for the material's CURRENT analysis…
    expect(await locateVisual(m.visuals.deps, actor, { materialId: m.id, visualId: "vis_1", page: 2, bounds: { x: 0.15, y: 0.22, w: 0.42, h: 0.14 } })).toMatchObject({ status: "ready" });
    // …and the old adaptation (pinned to the previous fingerprint) does not pick it up.
    const states = await loadRenderInputWith(old.deps, old.actor, old.id, m.visuals.deps);
    if (states.kind !== "ok") throw new Error(states.kind);
    expect(states.visuals.find((v) => v.visualId === "vis_1")!.status).toBe("missing_locator");
  }, 60_000);

  it("16/17 · another workspace's viewer resolves nothing for this adaptation", async () => {
    const m = await material();
    const a = await deliveredAdaptation(m.user, m.id);
    await locateVisual(m.visuals.deps, { userId: m.user.id, workspaceId: m.user.workspaceId, canWrite: true }, { materialId: m.id, visualId: "vis_1", page: 2, bounds: { x: 0.15, y: 0.22, w: 0.42, h: 0.14 } });
    const intruder = await createUser(db, `vintruder-${++n}@example.com`);
    const intruderDeps: ServiceDeps = { ...a.deps, reader: readerFor(db, intruder) };
    expect(await loadRenderInputWith(intruderDeps, { userId: intruder.id, workspaceId: intruder.workspaceId, canWrite: true }, a.id, visualHarness(db, intruder, { objects: m.visuals.objects, sources: m.visuals.sources }).deps)).toEqual({ kind: "not_found" });
  }, 60_000);
});
