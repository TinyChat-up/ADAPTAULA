import type { PGlite } from "@electric-sql/pglite";
import { createCanvas } from "@napi-rs/canvas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { VisualNeedsPanel } from "@/components/material/visual-needs-panel";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { blockingNeeds, visualNeedsOf } from "@/lib/adaptation/presentation/visual-needs";
import { normaliseTeacherImage } from "@/lib/adaptation/resources/image";
import { omitVisualResource, provideVisualResource, resolveResources } from "@/lib/adaptation/resources/service";
import { locateVisual } from "@/lib/materials/visuals/service";
import { loadRenderInputWith, sheetModel } from "@/lib/render/load";
import { readinessOf } from "@/lib/render/readiness";
import { MATERIAL_RENDERER_VERSION } from "@/lib/render/version";
import { renderPrintHtml } from "@/lib/render/print/html";
import { listState } from "@/lib/adaptation/presentation/list";
import { ReadyPanel } from "@/components/adaptation/status-panels";
import { modelAssetRefs } from "@/lib/render/print/pinned-assets";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks } from "@/lib/schemas/material-document";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { visualFixturePdf } from "../support/visual-fixture";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type User } from "./orchestration-harness";
import { resourceHarness } from "./resource-harness";
import { attachSource, visualHarness } from "./visual-harness";

/**
 * Phase 8.2A · visual resources, over the real migrations (PGlite) and the real pipeline with scripted providers (0 real model
 * calls). Each case ends in a complete, correct sheet or in a clear action for the teacher that resolves it on the SAME
 * adaptation: never a silent block and never a wrong delivery (docs/VISUAL_RESOURCES.md).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

let db: PGlite;
let pdf: Uint8Array;
beforeAll(async () => {
  db = await createTestDb();
  pdf = await visualFixturePdf();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const count = async (sql: string, params: unknown[]) => Number((await q<{ c: string }>(`select count(*)::text c from ${sql}`, params))[0]!.c);
const html = (model: Parameters<typeof MaterialSheet>[0]["model"]) => renderToStaticMarkup(createElement(MaterialSheet, { model }));

type Extra = (needRefs: string[], unusedRefs: string[]) => Record<string, unknown>;
let n = 0;

/** «Hacer magia» on `analysis` with the scripted planner's plan plus `extra` decisions (what the real planner proposes). */
async function magic(analysis: MaterialAnalysis, extra: Extra[], options: { user?: User; materialId?: string } = {}) {
  const user = options.user ?? (await createUser(db, `vres-${++n}@example.com`));
  const materialId = options.materialId ?? (await seedMaterial(db, user, analysis));
  const visuals = visualHarness(db, user);
  await attachSource(db, visuals, materialId, "application/pdf", pdf);
  const learner = await seedLearner(db, user);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, {
    planner: async (inner, _call, input) => {
      const out = await inner.plan(input);
      const draft = out.draft as { decisions: Array<{ need_refs: string[] }> };
      const refs = draft.decisions[0]?.need_refs ?? ["need_1"];
      const used = new Set(draft.decisions.flatMap((d) => d.need_refs));
      const unused = (input.context.needs as unknown[]).map((_, i) => `need_${i + 1}`).filter((r) => !used.has(r));
      return { ...out, draft: { ...draft, decisions: [...draft.decisions, ...extra.map((e) => e(refs, unused))] } } as never;
    },
  }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const key = `vres-key-${n}-${Math.random()}`;
  const created = await createAndStartAdaptation(deps, actor, { materialId, learnerProfileId: learner, adaptationType: "accessibility", requestKey: key, creationMode: "automatic" });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  for (let i = 0; i < 6; i++) if (!(await processAdaptationStage(orchestrator, id))) break;
  const status = await getAdaptationStatus(deps, actor, id);
  if (!status.ok) throw new Error(status.code);
  const resources = resourceHarness(db, user);
  const load = (pin = false) => loadRenderInputWith(deps, actor, id, visuals.deps, { pin, resources: resources.deps });
  return { user, materialId, id, deps, actor, spy, status: status.data, visuals, resources, load, key, learner, orchestrator };
}

async function sheet(m: Awaited<ReturnType<typeof magic>>, mode: "student" | "teacher_preview" = "student", pin = false) {
  const loaded = await m.load(pin);
  if (loaded.kind !== "ok") throw new Error(loaded.kind);
  return { loaded, ...sheetModel(loaded, mode), needs: visualNeedsOf(loaded) };
}

/** The teacher selects the two essential figures of the original (what «Localizar en el original» does). */
async function locateOriginals(m: Awaited<ReturnType<typeof magic>>) {
  for (const [visualId, y] of [["vis_1", 0.22], ["vis_2", 0.45]] as const) {
    expect((await locateVisual(m.visuals.deps, m.actor, { materialId: m.materialId, visualId, page: 2, bounds: { x: 0.15, y, w: 0.6, h: 0.12 } })).ok).toBe(true);
  }
}

/** Fractions with its strips (vis_2) given as structured data: a bar chart the renderer rebuilds from verified values. */
function withChart(): MaterialAnalysis {
  const base = fractionsAnalysis();
  return { ...base, visuals: base.visuals.map((v) => (v.id === "vis_2" ? { ...v, kind: "chart" as const, title: "Partes coloreadas por tira", chart: { type: "bar" as const, categories: ["Tira A", "Tira B"], series: [{ name: "", values: [1, 2] }], x_label: "Tira", y_label: "Partes", unit: "partes" } } : v)) };
}

/** The production export chain with an engine that only records it was reached: blocked sheets never get that far. */
async function exportPdf(m: Awaited<ReturnType<typeof magic>>) {
  const { exportAdaptationPdf } = await import("@/lib/render/pdf-export");
  let reached = false;
  const engine = { name: "probe", render: async () => { reached = true; throw new Error("probe"); } } as never;
  const result = await exportAdaptationPdf({ service: m.deps, visuals: m.visuals.deps, resources: m.resources.deps, engine }, m.actor, m.id);
  return result.ok ? { ok: true } : { ok: false, code: result.code, ...(reached ? { engineReached: true } : {}) };
}

async function teacherPng(width = 640, height = 360) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#23426b";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(40, height / 2);
  ctx.lineTo(width - 40, height / 2);
  ctx.stroke();
  const image = await normaliseTeacherImage(new Uint8Array(await canvas.encode("png")));
  if (!image.ok) throw new Error(image.reason);
  return image;
}

const reuse = (activity: string, visual: string): Extra => (refs) => ({ target: activity, action: "add_support", strategies: ["visual_support"], need_refs: refs, intensity: "light", supports: [{ kind: "visual_cue", uses_task_data: false }], visual: { mode: "reuse_original", source_visual: visual, purpose: "Tener la figura junto a la actividad", essential: true } });
const transform = (activity: string, visual: string): Extra => (refs) => ({ target: activity, action: "add_support", strategies: ["visual_support"], need_refs: refs, intensity: "light", visual: { mode: "transform_original", source_visual: visual, purpose: "El gráfico con sus datos", essential: true } });
const newEssential = (activity: string): Extra => (refs) => ({ target: activity, action: "add_support", strategies: ["visual_support"], need_refs: refs, intensity: "light", visual: { mode: "new_representation", source_visual: null, purpose: "Recta numérica para ordenar las fracciones", essential: true } });
const optional = (activity: string): Extra => (refs) => ({ target: activity, action: "add_support", strategies: ["visual_support"], need_refs: refs, intensity: "light", supports: [{ kind: "visual_cue", uses_task_data: false }], visual: { mode: "optional_support", source_visual: null, purpose: "Pictograma de «sumar»", essential: false } });

describe("before 8.2A every visual decision stopped «Hacer magia» at the plan; now the plan executes and the sheet is delivered", () => {
  it.each([
    ["reuse an original visual", reuse("act_1", "vis_1")],
    ["a new essential representation", newEssential("act_4")],
    ["an optional visual support", optional("act_3")],
  ])("%s: no «no executor» blocker, one adaptation delivered, one unit consumed, nobody asked to review the plan", async (_name, extra) => {
    const m = await magic(fractionsAnalysis(), [extra]);
    expect(m.status).toMatchObject({ status: "ready", phase: "ready" });
    const report = (await q<{ payload: { execution: { blockers: string[]; decisions: Array<{ id: string; route: string; visual?: { kind: string } }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' order by created_at desc limit 1", [m.id]))[0]!.payload;
    expect(report.execution.blockers).toEqual([]);
    const visualDecision = report.execution.decisions.find((d) => d.visual)!;
    expect(visualDecision.route).toBe("deterministic");
    expect(await count("public.adaptations where request_key = $1", [m.key])).toBe(1);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [m.id]))[0]!.state).toBe("consumed");
    expect(m.spy.planner).toBe(1);
    expect(m.spy.generator).toBe(1);
  });
});

describe("A · an existing visual of the original, located", () => {
  it("is kept next to its activity and printed: the PDF pins the exact crop; no action left", async () => {
    const m = await magic(fractionsAnalysis(), [reuse("act_1", "vis_1")]);
    await locateOriginals(m);
    const s = await sheet(m, "student", true);
    expect(s.validation.status).not.toBe("not_renderable");
    const blocks = allBlocks(s.loaded.document);
    const figure = blocks.find((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === "vis_1")!;
    const activity = blocks.find((b) => b.type === "activity" && b.trace.source_refs.includes("act_1"));
    expect(activity?.type === "activity" && activity.resource_block_ids).toContain(figure.id);
    expect(figure.trace.decision_ids.length).toBeGreaterThan(0);
    expect(modelAssetRefs(s.model)).toHaveLength(2);
    expect(blockingNeeds(s.needs)).toEqual([]);
  });
});

describe("B · an existing visual of the original that needs to be selected", () => {
  it("delivered but not printable; «Localizar en el original»; once selected, the SAME adaptation prints, nothing re-run", async () => {
    const m = await magic(fractionsAnalysis(), []);
    const before = await sheet(m, "teacher_preview");
    expect(before.validation.status).toBe("not_renderable");
    const blocking = blockingNeeds(before.needs);
    expect(blocking.map((b) => [b.key, b.message])).toEqual([
      ["vis_1", "Esta actividad necesita una imagen del documento original. Localízala en el original o, si no está, añade la tuya."],
      ["vis_2", "Esta actividad necesita una imagen del documento original. Localízala en el original o, si no está, añade la tuya."],
    ]);
    const panel = renderToStaticMarkup(createElement(VisualNeedsPanel, { needs: before.needs, adaptationId: m.id, canWrite: true, locateHref: (v: string) => `/app/materiales/${m.materialId}/visuales/${v}` }));
    expect(panel).toContain("Localizar en el original");
    expect(panel).toContain("Falta");
    expect(panel).not.toMatch(/missing_locator|asset_missing|render_unresolved|visual_crop|located_processing/);
    expect(panel).not.toContain("Continuar sin esta imagen"); // an original essential visual is never skipped

    await locateOriginals(m);
    const after = await sheet(m, "student", true);
    expect(after.validation.status).not.toBe("not_renderable");
    expect(blockingNeeds(after.needs)).toEqual([]);
    expect(await count("public.adaptations where material_id = $1", [m.materialId])).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [m.id])).toBe(2);
    expect(await count("public.adaptation_versions where adaptation_id = $1", [m.id])).toBe(1);
    expect(m.spy.planner + m.spy.generator + m.spy.reviewer).toBe(3);
  });
});

describe("C · a chart that is represented by structured data", () => {
  it("is rebuilt from the verified data (same categories, values, axes and unit): no image to select, nothing invented", async () => {
    const analysis = withChart();
    const m = await magic(analysis, [transform("act_2", "vis_2")]);
    expect(m.status.status).toBe("ready");
    const s = await sheet(m, "student", true);
    const chart = s.model.pages.flatMap((p) => p.nodes).find((node) => node.kind === "chart");
    const source = analysis.visuals.find((v) => v.id === "vis_2")!.chart!;
    expect(chart?.kind === "chart" && [chart.categories, chart.series.map((x) => x.values), chart.unit, chart.xLabel, chart.yLabel]).toEqual([source.categories, source.series.map((x) => x.values), source.unit, source.x_label, source.y_label]);
    // The chart is linked to the activity that uses it and needs no crop: only the figure (vis_1) is an image to select.
    const blocks = allBlocks(s.loaded.document);
    const chartBlock = blocks.find((b) => b.type === "chart")!;
    const activity = blocks.find((b) => b.type === "activity" && b.trace.source_refs.includes("act_2"));
    expect(activity?.type === "activity" && activity.resource_block_ids).toContain(chartBlock.id);
    expect(s.needs.some((x) => x.key === "vis_2")).toBe(false);
    expect(blockingNeeds(s.needs).map((x) => x.key)).toEqual(["vis_1"]);
  });
});

describe("D · an essential visual that is not in the original", () => {
  it("its place is reserved and the sheet is not printable; read-only cannot act; the teacher adds it and the SAME adaptation prints", async () => {
    const m = await magic(fractionsAnalysis(), [newEssential("act_4")]);
    const before = await sheet(m, "teacher_preview");
    expect(before.validation.status).toBe("not_renderable");
    const need = blockingNeeds(before.needs).find((x) => x.origin === "requested")!;
    expect(need).toMatchObject({ essential: true, status: "to_provide", activity: "Actividad 4", omittable: false });
    expect(need.message).toBe("Esta actividad necesita un recurso visual que no está en el documento original: añádelo para poder imprimir la ficha.");
    // Never a stand-in image in the student's sheet.
    expect(html(sheetModel(before.loaded, "student").model)).not.toContain("<img");

    const image = await teacherPng();
    const viewer = { ...m.actor, canWrite: false };
    expect(await provideVisualResource(m.resources.deps, viewer, { adaptationId: m.id, decisionId: need.key, ...image, rightsConfirmed: true })).toEqual({ ok: false, code: "forbidden" });
    expect(await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...image, rightsConfirmed: false })).toEqual({ ok: false, code: "invalid" });
    expect(await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "dec_99", ...image, rightsConfirmed: true })).toEqual({ ok: false, code: "not_found" });

    await locateOriginals(m);
    expect((await sheet(m)).validation.status).toBe("not_renderable"); // the figures alone do not make it printable
    const first = await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...image, rightsConfirmed: true });
    expect(first).toMatchObject({ ok: true, reused: false, state: { status: "provided" } });
    const again = await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...image, rightsConfirmed: true });
    expect(again).toMatchObject({ ok: true, reused: true });
    expect(await count("public.adaptation_visual_resources where adaptation_id = $1", [m.id])).toBe(1);

    const screen = await sheet(m, "student");
    expect(screen.validation.status).not.toBe("not_renderable");
    expect(html(screen.model)).toContain(`src="/api/adaptations/${m.id}/resources/${need.key}"`);
    const print = await sheet(m, "student", true);
    expect(modelAssetRefs(print.model).some((ref) => first.ok && first.state.status === "provided" && ref.includes(first.state.sha256))).toBe(true);
    expect(print.loaded.pinned.some((p) => p.bytes.byteLength === image.png.byteLength)).toBe(true);
    // Same adaptation, same version, same consumption: nothing was regenerated.
    expect(await count("public.adaptation_versions where adaptation_id = $1", [m.id])).toBe(1);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [m.id]))[0]!.state).toBe("consumed");
  });

  it("without an alternative it can NOT be skipped: refused on the server, a forced row is ignored, the PDF stays blocked until it is added", async () => {
    const m = await magic(fractionsAnalysis(), [newEssential("act_4")]);
    await locateOriginals(m);
    const need = blockingNeeds((await sheet(m)).needs).find((x) => x.origin === "requested")!;
    expect(need).toMatchObject({ omittable: false });
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key })).toEqual({ ok: false, code: "needs_resource" });
    expect(await count("public.adaptation_visual_resources where adaptation_id = $1", [m.id])).toBe(0);
    // Even a recorded omission (an old row, a race, a direct call) does not make the sheet printable without the visual.
    await as(db, "service_role", null, () => db.query("select public.set_adaptation_visual_resource($1, $2, $3, 'omitted', null, null, null, null, null, false, $4)", [m.user.workspaceId, m.id, need.key, m.user.id]));
    const forced = await sheet(m, "teacher_preview");
    expect(forced.validation.status).toBe("not_renderable");
    expect(blockingNeeds(forced.needs).map((x) => [x.key, x.status])).toEqual([[need.key, "to_provide"]]);
    const panel = renderToStaticMarkup(createElement(VisualNeedsPanel, { needs: forced.needs, adaptationId: m.id, canWrite: true, locateHref: (v: string) => v }));
    expect(panel).not.toContain(">Continuar sin esta imagen<");
    expect(await exportPdf(m)).toEqual({ ok: false, code: "resource_pending" });
    // Resolved by adding it: same adaptation, the PDF is now allowed (the engine is reached).
    await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...(await teacherPng()), rightsConfirmed: true });
    expect(await exportPdf(m)).toEqual({ ok: false, code: "render_failed", engineReached: true });
    expect(await count("public.adaptations where request_key = $1", [m.key])).toBe(1);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [m.id]))[0]!.state).toBe("consumed");
  });

  it("text written for the same decision does NOT make it skippable: refused, the text is not a substitute, the PDF stays blocked", async () => {
    const withText: Extra = (refs, unused) => ({ ...newEssential("act_4")(refs, unused), supports: [{ kind: "step_list", uses_task_data: false }] });
    const m = await magic(fractionsAnalysis(), [withText]);
    await locateOriginals(m);
    const before = await sheet(m);
    const need = blockingNeeds(before.needs).find((x) => x.origin === "requested")!;
    // The decision did produce written content…
    expect(allBlocks(before.loaded.document).some((b) => b.type === "list" && b.trace.decision_ids.includes(need.key))).toBe(true);
    // …but it proves no functional equivalence: the essential visual must be provided.
    expect(need).toMatchObject({ essential: true, omittable: false });
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key })).toEqual({ ok: false, code: "needs_resource" });
    expect(await count("public.adaptation_visual_resources where adaptation_id = $1", [m.id])).toBe(0);
    await as(db, "service_role", null, () => db.query("select public.set_adaptation_visual_resource($1, $2, $3, 'omitted', null, null, null, null, null, false, $4)", [m.user.workspaceId, m.id, need.key, m.user.id]));
    expect((await sheet(m)).validation.status).toBe("not_renderable");
    expect(await exportPdf(m)).toEqual({ ok: false, code: "resource_pending" });
    await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...(await teacherPng()), rightsConfirmed: true });
    expect(await exportPdf(m)).toEqual({ ok: false, code: "render_failed", engineReached: true });
  });
});

describe("an essential visual of the ORIGINAL (a question that reads a figure) is never skippable", () => {
  it("there is no omission path for it at all, and the PDF stays blocked until it is selected", async () => {
    const m = await magic(fractionsAnalysis(), []);
    const s = await sheet(m, "teacher_preview");
    expect(blockingNeeds(s.needs).every((x) => x.origin === "original" && !x.omittable)).toBe(true);
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "vis_2" })).toEqual({ ok: false, code: "needs_resource" });
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "dec_1" })).toEqual({ ok: false, code: "not_found" });
    expect(await exportPdf(m)).toEqual({ ok: false, code: "resource_pending" });
    await locateOriginals(m);
    expect(await exportPdf(m)).toEqual({ ok: false, code: "render_failed", engineReached: true });
  });
});

describe("E · an optional visual support", () => {
  it("never blocks: the sheet prints without it, the teacher sees it as optional and may still add it", async () => {
    const m = await magic(fractionsAnalysis(), [optional("act_3")]);
    await locateOriginals(m);
    const s = await sheet(m, "student", true);
    expect(s.validation.status).toBe("renderable_with_warnings");
    const need = s.needs.find((x) => x.origin === "requested")!;
    expect(need).toMatchObject({ essential: false, status: "to_provide", message: "Apoyo visual opcional: la ficha se puede imprimir sin él." });
    expect(blockingNeeds(s.needs)).toEqual([]);
    expect(html(s.model)).not.toContain("Apoyo visual opcional");
    // An optional support may be left out explicitly, idempotently.
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key })).toMatchObject({ ok: true, reused: false });
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key })).toMatchObject({ ok: true, reused: true });
    expect((await sheet(m)).needs.find((x) => x.key === need.key)?.status).toBe("omitted");
  });
});

describe("privacy and isolation of the teacher's resources", () => {
  it("another workspace sees neither the row nor the object, and cannot provide or omit; the stored image has no metadata", async () => {
    const m = await magic(fractionsAnalysis(), [newEssential("act_4")]);
    const need = blockingNeeds((await sheet(m)).needs).find((x) => x.origin === "requested")!;
    const image = await teacherPng();
    const saved = await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...image, rightsConfirmed: true });
    expect(saved.ok).toBe(true);
    const path = [...m.resources.objects.keys()][0]!;
    expect(path.startsWith(`${m.user.workspaceId}/${m.id}/resources/`)).toBe(true);

    const intruder = await createUser(db, `vres-intruder-${n}@example.com`);
    const other = resourceHarness(db, intruder, m.resources.objects);
    const intruderActor = { userId: intruder.id, workspaceId: intruder.workspaceId, canWrite: true };
    expect(await other.deps.reader.activeResources(m.id)).toEqual([]);
    expect(await other.deps.reader.readObject(path)).toBeNull();
    expect((await resolveResources(other.deps, m.id, [need.key], { withBytes: true })).bytes).toEqual({});
    expect(await provideVisualResource(other.deps, intruderActor, { adaptationId: m.id, decisionId: need.key, ...image, rightsConfirmed: true })).toEqual({ ok: false, code: "not_found" });
    expect(await omitVisualResource(other.deps, intruderActor, { adaptationId: m.id, decisionId: need.key })).toEqual({ ok: false, code: "not_found" });
    // The browser's role cannot write the table, whatever it sends.
    await expect(as(db, "authenticated", m.user.id, () => db.query("insert into public.adaptation_visual_resources (workspace_id, adaptation_id, decision_id, resolution) values ($1, $2, 'dec_1', 'omitted')", [m.user.workspaceId, m.id]))).rejects.toThrow();
    await expect(as(db, "authenticated", m.user.id, () => db.query("select public.set_adaptation_visual_resource($1, $2, 'dec_1', 'omitted', null, null, null, null, null, false, $3)", [m.user.workspaceId, m.id, m.user.id]))).rejects.toThrow();
    // Rows are immutable: a correction is a new row.
    await expect(db.query("update public.adaptation_visual_resources set decision_id = 'dec_99' where adaptation_id = $1", [m.id])).rejects.toThrow();
  });
});

describe("PDF smoke · the production chain with the teacher's resource (real Chromium)", () => {
  it("prints the figures of the original and the teacher's image, pinned and embedded; nothing fetched, valid PDF", async () => {
    const { engine } = await import("../pdf/harness");
    const { exportAdaptationPdf } = await import("@/lib/render/pdf-export");
    const m = await magic(fractionsAnalysis(), [newEssential("act_4")]);
    await locateOriginals(m);
    const need = blockingNeeds((await sheet(m)).needs).find((x) => x.origin === "requested")!;
    expect((await exportAdaptationPdf({ service: m.deps, visuals: m.visuals.deps, resources: m.resources.deps, engine }, m.actor, m.id)).ok).toBe(false); // still waiting for it
    await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: need.key, ...(await teacherPng()), rightsConfirmed: true });
    const result = await exportAdaptationPdf({ service: m.deps, visuals: m.visuals.deps, resources: m.resources.deps, engine }, m.actor, m.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new TextDecoder("latin1").decode(result.pdf.subarray(0, 5))).toBe("%PDF-");
    expect(result.pageCount).toBeGreaterThan(0);
  }, 120_000);
});

describe("8.2A.1 · one state everywhere: adaptation screen, sheet, lists and PDF agree", () => {
  const readiness = async (m: Awaited<ReturnType<typeof magic>>, verify = true) => {
    const loaded = await loadRenderInputWith(m.deps, m.actor, m.id, m.visuals.deps, { resources: m.resources.deps, verify });
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    return readinessOf(loaded);
  };
  const panel = (m: Awaited<ReturnType<typeof magic>>, info: { visualsPending: number; printable: boolean }) =>
    renderToStaticMarkup(createElement(ReadyPanel, { dto: m.status, materialId: m.materialId, info: { version: 1, createdAt: "2026-10-09T10:00:00Z", ...info } }));

  it("an original image not located: «casi lista» on the screen and the list, «Completar ficha», no PDF button, 409 resource_pending", async () => {
    const m = await magic(fractionsAnalysis(), []);
    const r = await readiness(m);
    expect(r).toEqual({ printable: false, pendingResources: 2, reason: "resource_pending" });
    expect(await readiness(m, false)).toEqual(r); // the list's row-only reading agrees with the verified one
    const out = panel(m, { visualsPending: r.pendingResources, printable: r.printable });
    expect(out).toContain("La ficha está casi lista · Falta completar un recurso");
    expect(out).toContain("Completar ficha");
    expect(out).not.toMatch(/La ficha está lista|Descargar PDF/);
    expect(listState("ready", false, false, !r.printable)).toEqual({ label: "Casi lista · falta un recurso", group: "attention", cta: "Completar ficha" });
    expect(await exportPdf(m)).toEqual({ ok: false, code: "resource_pending" });

    // Located: the same adaptation is now ready everywhere and the PDF reaches the engine.
    await locateOriginals(m);
    const after = await readiness(m);
    expect(after).toEqual({ printable: true, pendingResources: 0, reason: null });
    expect(panel(m, { visualsPending: 0, printable: true })).toContain("Descargar PDF");
    expect(listState("ready", false, false, !after.printable).label).toBe("Ficha preparada");
    expect(await exportPdf(m)).toEqual({ ok: false, code: "render_failed", engineReached: true });
  });

  it("«No está en el original · Añadir imagen»: the teacher's image stands in, pinned for the PDF; never omittable; idempotent; one unit", async () => {
    const m = await magic(fractionsAnalysis(), []);
    const image = await teacherPng();
    expect(await omitVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "vis_1" })).toEqual({ ok: false, code: "needs_resource" });
    expect(await provideVisualResource(m.resources.deps, { ...m.actor, canWrite: false }, { adaptationId: m.id, decisionId: "vis_1", ...image, rightsConfirmed: true })).toEqual({ ok: false, code: "forbidden" });
    expect(await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "vis_99", ...image, rightsConfirmed: true })).toEqual({ ok: false, code: "not_found" });
    const first = await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "vis_1", ...image, rightsConfirmed: true });
    expect(first).toMatchObject({ ok: true, reused: false });
    expect(await provideVisualResource(m.resources.deps, m.actor, { adaptationId: m.id, decisionId: "vis_1", ...image, rightsConfirmed: true })).toMatchObject({ ok: true, reused: true });
    const s = await sheet(m, "teacher_preview");
    expect(s.needs.find((x) => x.key === "vis_1")).toMatchObject({ status: "provided", message: "Imagen añadida por ti: no se encontró en el documento original." });
    expect(blockingNeeds(s.needs).map((x) => x.key)).toEqual(["vis_2"]); // the other figure is still to locate
    await locateVisual(m.visuals.deps, m.actor, { materialId: m.materialId, visualId: "vis_2", page: 2, bounds: { x: 0.15, y: 0.45, w: 0.6, h: 0.12 } });
    const print = await sheet(m, "student", true);
    expect(print.validation.status).not.toBe("not_renderable");
    expect(print.loaded.pinned).toHaveLength(2);
    expect(modelAssetRefs(print.model).some((ref) => first.ok && first.state.status === "provided" && ref.includes(first.state.sha256))).toBe(true);
    // The database itself refuses an omission of an original visual.
    await expect(as(db, "service_role", null, () => db.query("select public.set_adaptation_visual_resource($1, $2, 'vis_2', 'omitted', null, null, null, null, null, false, $3)", [m.user.workspaceId, m.id, m.user.id]))).rejects.toThrow();
    expect(await count("public.adaptations where request_key = $1", [m.key])).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [m.id])).toBe(2);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [m.id]))[0]!.state).toBe("consumed");
    expect(m.spy.planner + m.spy.generator + m.spy.reviewer).toBe(3);
  });

  it("an optional support never makes the sheet «casi lista»", async () => {
    const m = await magic(fractionsAnalysis(), [optional("act_3")]);
    await locateOriginals(m);
    expect(await readiness(m)).toEqual({ printable: true, pendingResources: 0, reason: null });
  });
});

describe("8.2A.1 · a layout decision the renderer cannot execute never reaches a «ready» sheet silently", () => {
  const onText = (dimsFrom: "first" | "unused"): Extra => (refs, unused) => ({ target: "ctt_1", action: "reorganize", strategies: ["visual_load_reduction"], need_refs: dimsFrom === "first" ? refs : unused.slice(0, 1), intensity: "light" });

  it("its need covered elsewhere: left out by the recommendation WITH its reason, delivered without a «not applied» warning", async () => {
    const m = await magic(fractionsAnalysis(), [onText("first")]);
    expect(m.status.status).toBe("ready");
    const review = (await q<{ payload: { entries: Array<{ decision_id: string; action: string; reason: string }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review' order by created_at desc limit 1", [m.id]))[0]!.payload;
    expect(review.entries.find((e) => e.decision_id === "dec_2")).toMatchObject({ action: "rejected", reason: expect.stringMatching(/Ningún ejecutor puede aplicarla/) });
    await locateOriginals(m);
    const s = await sheet(m, "teacher_preview");
    expect(s.validation.issues.some((i) => i.code === "deferred_unsupported" && i.severity === "warning")).toBe(false);
  });

  it("its need not covered: never deferred to a sheet that ignores it; the teacher decides in the review (no delivery, no new unit)", async () => {
    const m = await magic(fractionsAnalysis(), [onText("unused")]);
    const plan = (await q<{ payload: { decisions: Array<{ id: string; target: string }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan' order by created_at desc limit 1", [m.id]))[0]!.payload;
    expect(plan.decisions.some((d) => d.target === "ctt_1")).toBe(true); // the profile really has that need: the decision is valid
    expect(m.status).toMatchObject({ status: "awaiting_plan_review", phase: "awaiting_review", nextAction: "review_plan" });
    const report = (await q<{ payload: { execution: { blockers: string[] } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' order by created_at desc limit 1", [m.id]))[0]!.payload;
    expect(report.execution.blockers.join(" ")).toMatch(/solo sabe separar visualmente actividades/);
    expect(await count("public.adaptation_versions where adaptation_id = $1", [m.id])).toBe(0);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [m.id]))[0]!.state).toBe("reserved");
  });
});

describe("8.2A.1 · Sistema CLARO is the product design, on screen and in the PDF", () => {
  it("the production model and its print HTML are CLARO, renderer v4", async () => {
    const m = await magic(fractionsAnalysis(), []);
    await locateOriginals(m);
    const screen = await sheet(m, "student");
    expect(screen.model.design).toBe("claro");
    expect(html(screen.model)).toContain('data-design="claro"');
    const print = await sheet(m, "student", true);
    const out = await renderPrintHtml(print.model, print.loaded.pinned);
    expect(out.html).toContain('data-design="claro"');
    expect(print.model.rendererVersion).toBe(MATERIAL_RENDERER_VERSION);
    expect(MATERIAL_RENDERER_VERSION).toBe("material_renderer@v4");
  });
});
