import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { deterministicChecks } from "@/lib/adaptation/review";
import { visualNeedsOf } from "@/lib/adaptation/presentation/visual-needs";
import { applyVisualResolution, danglingPictureReferences, refersToPicture, visualNeedsOfDocument, type VisualResolutionPlan } from "@/lib/adaptation/visual-policy";
import { resolveMagicVisuals, type MagicVisualDeps } from "@/lib/materials/visuals/auto/policy";
import type { VisualAssistants } from "@/lib/materials/visuals/auto/assistants";
import type { IllustrationOutcome, IllustrationRequest } from "@/lib/materials/visuals/illustrate/service";
import { buildRenderModel, flatNodes } from "@/lib/render/model";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import { cellCaseDocument } from "../support/cell-case";
import { fractionsCaseDocument } from "../support/fractions-case";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/**
 * Case B («La célula animal», 1.º ESO) through the visual policy: the scheme that cannot be located nor drawn as an exact figure
 * becomes a NEW illustration (approved by its review) in the activity's place, never a text task; without illustrations the
 * adaptation stops honestly; an activity that refers to a picture the sheet lacks is caught. 0 model calls: scripted.
 */

const ASSET = { id: "11111111-2222-4333-8444-555555555555", sha256: "c".repeat(64), width: 1536, height: 1024, alt: "Esquema de una célula animal con tres partes señaladas con los números 1, 2 y 3." };
const approved: IllustrationOutcome = { ok: true, asset: ASSET, cached: false, attempts: 1 };
const run = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "m", effort: "low" as const, promptKey: "k", promptVersion: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null };
const silentAssistants = (calls: string[]): VisualAssistants => ({
  support: async () => (calls.push("support"), { draft: null, run }),
  rewrite: async () => (calls.push("rewrite"), { draft: null, run }),
  substitute: async () => (calls.push("substitute"), { draft: { feasible: true, prompt: "Escribe qué parte de la célula guarda la información genética.", steps: [], lines: 2, figure: null }, run }),
});
const outcome = (plan: VisualResolutionPlan, key: string) => plan.needs.find((n) => n.key === key)!;

function cell(withIllustrations: boolean, result: IllustrationOutcome = approved) {
  const s = cellCaseDocument();
  const requests: Array<Omit<IllustrationRequest, "workspaceId" | "adaptationId">> = [];
  const calls: string[] = [];
  const deps: MagicVisualDeps = {
    readyOriginals: async () => new Set(),
    corroborate: async () => null,
    assistants: silentAssistants(calls),
    illustrate: withIllustrations ? async (r) => (requests.push(r), result) : null,
  };
  return { s, deps, requests, calls, resolve: () => resolveMagicVisuals(deps, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1"], stage: "eso", grade: "1-eso", subject: "biologia-geologia", functionalNeeds: ["working_memory_support", "visual_distraction_reduction"] }) };
}

describe("case B · the scheme of the cell, not in the PDF and not an exact figure", () => {
  it("a NEW illustration, reviewed and approved, stands in for it; the activity stays as written («Observa el esquema…»)", async () => {
    const c = cell(true);
    const plan = await c.resolve();
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "generated_illustration", resolution: { action: "illustration", asset: { id: ASSET.id } }, attempts: ["locate", "reconstruct", "generate", "illustrate"] });
    // What the illustration is asked for: the activity, its objective, the missing scheme, the stage and the supports, never the learner.
    expect(c.requests[0]).toMatchObject({ needKey: "vis_1", stage: "eso", grade: "1-eso", subject: "biologia-geologia", missing: expect.stringContaining("Esquema de una célula animal"), lowDetail: true, expectedAnswer: expect.stringContaining("núcleo") });
    expect(c.requests[0]!.supports).toEqual(expect.arrayContaining(["Apoyo a la memoria de trabajo", "Menos distracciones visuales"]));
    expect(JSON.stringify(c.requests[0])).not.toMatch(/display_name|contextual_tags|alumn[oa] [A-Z]/);
    expect(c.calls).toEqual([]);
    const doc = applyVisualResolution(c.s.document, plan);
    const image = allBlocks(doc).find((b) => b.type === "image");
    expect(image).toMatchObject({ source: { kind: "generated", asset_id: ASSET.id, sha256: ASSET.sha256, visual_ref: "vis_1" }, alt_text: ASSET.alt });
    const act1 = allBlocks(doc).find((b) => b.type === "activity" && b.label === "1");
    expect(act1).toMatchObject({ prompt: expect.stringContaining("Observa el esquema"), resource_block_ids: [image!.id] });
    expect(deterministicChecks({ analysis: c.s.analysis, plan: c.s.plan, context: c.s.context, document: doc } as never).filter((x) => x.status === "FAIL")).toEqual([]);
  });

  it("its contract says what it is: a resource to generate, from an image model, reviewed, with its private asset", async () => {
    const plan = await cell(true).resolve();
    expect(outcome(plan, "vis_1").contract).toEqual({ class: "must_generate_or_edit", provenance: "ai_illustration", reason: "activity_uses_original_visual", validation: "ai_reviewed", asset: { kind: "illustration", id: ASSET.id, sha256: ASSET.sha256 } });
  });

  it("drawn in the CLARO sheet next to its activity, at its size, from the verified bytes (screen) — and missing if they are not there", async () => {
    const c = cell(true);
    const doc = applyVisualResolution(c.s.document, await c.resolve());
    const withBytes = buildRenderModel(doc, { mode: "student", design: "claro", requiredVisuals: ["vis_1"], deferred: [], generated: { [ASSET.id]: { src: "/api/x", widthMm: 120 } } });
    const act1 = withBytes.model.pages.flatMap((p) => p.nodes).find((n) => n.kind === "activity" && n.label === "1");
    expect(act1?.kind === "activity" && act1.figures[0]).toMatchObject({ kind: "image", state: "available", src: "/api/x", widthMm: 120, alt: ASSET.alt });
    const html = renderToStaticMarkup(createElement(MaterialSheet, { model: withBytes.model }));
    expect(html).toContain('src="/api/x"');
    const without = buildRenderModel(doc, { mode: "student", design: "claro", requiredVisuals: ["vis_1"], deferred: [] });
    expect(flatNodes(without.model.pages.flatMap((p) => p.nodes)).find((n) => n.kind === "image")).toMatchObject({ state: "missing", essential: true });
    expect(without.validation.status).toBe("not_renderable");
  });

  it("the teacher sees it as done, with where it comes from, and no action to locate or upload", async () => {
    const c = cell(true);
    const doc = applyVisualResolution(c.s.document, await c.resolve());
    const needs = visualNeedsOf({ document: doc, visuals: [], requiredVisuals: ["vis_1"], requested: [], generated: { [ASSET.id]: {} } });
    expect(needs).toEqual([expect.objectContaining({ key: "vis_1", status: "ready", generated: true, message: expect.stringContaining("creada y revisada automáticamente") })]);
  });

  it("without illustrations (flag, plan or credentials): never a text task in its place — the honest stop", async () => {
    const c = cell(false);
    const plan = await c.resolve();
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "unresolved_visual", resolution: { action: "unresolved", reason: "representation_not_buildable" }, contract: { class: "unresolvable", validation: "failed" } });
    // The substitute assistant (which would propose words) is not even asked for a representation it cannot draw.
    expect(c.calls).not.toContain("substitute");
  });

  it("an illustration that is never approved leads to the same honest stop (its unit was given back by the pipeline)", async () => {
    const c = cell(true, { ok: false, reason: "review_rejected", detail: ["concept:pared celular"] });
    const plan = await c.resolve();
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "unresolved_visual", attempts: expect.arrayContaining(["illustrate:review_rejected"]) });
  });
});

describe("exact representations never go to an image model", () => {
  it("the fractions bar and number line (exact data) are drawn by our renderer; the image model is not asked", async () => {
    const s = fractionsCaseDocument();
    const asked: string[] = [];
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), corroborate: async () => null, illustrate: async (r) => (asked.push(r.needKey), approved) }, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1", "vis_2"], stage: "primaria" });
    expect(plan.needs.map((n) => [n.key, n.category])).toEqual([["vis_1", "generatable_support_visual"], ["vis_2", "generatable_support_visual"]]);
    expect(asked).toEqual([]);
  });

  it("a chart, a map or a figure described with measures or a scale is not illustrated", async () => {
    const c = cell(true);
    c.s.analysis.visuals[0] = { ...c.s.analysis.visuals[0]!, kind: "diagram", description: "Esquema de una célula animal de 20 µm a escala 1 cm = 5 µm." };
    const plan = await resolveMagicVisuals(c.deps, { analysis: c.s.analysis, document: c.s.document, requiredVisuals: ["vis_1"], stage: "eso" });
    expect(c.requests).toEqual([]);
    expect(outcome(plan, "vis_1").category).toBe("unresolved_visual");
  });

  it("at most three illustrations per adaptation", async () => {
    const c = cell(true);
    const doc = structuredClone(c.s.document) as MaterialDocument;
    const page = doc.pages[0]!;
    const image = page.blocks.find((b) => b.type === "image")!;
    for (let k = 2; k <= 5; k++) {
      c.s.analysis.visuals.push({ ...c.s.analysis.visuals[0]!, id: `vis_${k}`, activity_ids: [] });
      page.blocks.push({ ...image, id: `blk_extra000${k}`, source: { kind: "original", visual_ref: `vis_${k}` }, trace: { ...image.trace, source_refs: ["act_1"] } });
    }
    const plan = await resolveMagicVisuals(c.deps, { analysis: c.s.analysis, document: doc, requiredVisuals: ["vis_1", "vis_2", "vis_3", "vis_4", "vis_5"], stage: "eso" });
    expect(c.requests).toHaveLength(3);
    expect(plan.needs.filter((n) => n.category === "generated_illustration")).toHaveLength(3);
  });
});

describe("«Observa el esquema» with no scheme on the sheet", () => {
  /** The cell sheet as if the analyzer had not seen the scheme at all: the activity still points at it. */
  function noScheme() {
    const s = cellCaseDocument();
    const doc = structuredClone(s.document) as MaterialDocument;
    const image = allBlocks(doc).find((b) => b.type === "image")!;
    doc.pages = doc.pages.map((p) => ({ blocks: p.blocks.filter((b) => b.id !== image.id).map((b) => (b.type === "activity" ? { ...b, resource_block_ids: undefined } : b)) }));
    return { ...s, document: doc };
  }

  it("is detected (definite references only; a zone image counts; «dibuja un esquema» asks the student to make one)", () => {
    expect(refersToPicture("Observa el esquema de la célula animal.")).toBe(true);
    expect(refersToPicture("Según el gráfico, ¿qué mes llovió más?")).toBe(true);
    expect(refersToPicture("Dibuja un esquema de la célula.")).toBe(false);
    expect(refersToPicture("Explica el dibujo que has hecho.")).toBe(false);
    const s = noScheme();
    expect(danglingPictureReferences(s.document)).toEqual([expect.objectContaining({ activityId: "act_1" })]);
    expect(danglingPictureReferences(cellCaseDocument().document)).toEqual([]);
  });

  it("the review FAILs it (it cannot be delivered as it is) and says what to do", () => {
    const s = noScheme();
    const check = deterministicChecks({ analysis: s.analysis, plan: s.plan, context: s.context, document: s.document } as never).find((x) => x.check === "visual_references_resolved");
    expect(check).toMatchObject({ status: "FAIL", targets: expect.arrayContaining(["act_1"]) });
  });

  it("in «Hacer magia» it is a visual need: illustrated, placed right before the activity and linked to it; the review then passes", async () => {
    const s = noScheme();
    s.analysis.visuals = [];
    s.analysis.activities = s.analysis.activities.map((a) => ({ ...a, resource_ids: [] }));
    s.analysis.protected_elements = s.analysis.protected_elements.filter((p) => p.type !== "necessary_visual");
    expect(visualNeedsOfDocument(s.document, [])).toEqual([{ key: "act_1", origin: "referenced", essential: true, activityIds: ["act_1"] }]);
    const asked: string[] = [];
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), illustrate: async (r) => (asked.push(r.needKey), approved) }, { analysis: s.analysis, document: s.document, requiredVisuals: [], stage: "eso" });
    expect(outcome(plan, "act_1")).toMatchObject({ origin: "referenced", category: "generated_illustration", contract: { class: "must_generate_or_edit", reason: "activity_refers_to_picture" } });
    const doc = applyVisualResolution(s.document, plan);
    const blocks = allBlocks(doc);
    const at = blocks.findIndex((b) => b.type === "activity" && b.label === "1");
    expect(blocks[at - 1]).toMatchObject({ id: "blk_pic0001", type: "image", source: { kind: "generated", activity_ref: "act_1" }, trace: { origin: "adapted", source_refs: ["act_1"], decision_ids: [] } });
    expect(blocks[at]).toMatchObject({ resource_block_ids: ["blk_pic0001"] });
    const checks = deterministicChecks({ analysis: s.analysis, plan: s.plan, context: s.context, document: doc } as never);
    expect(checks.filter((x) => x.status === "FAIL")).toEqual([]);
  });

  it("and without a way to build it: the honest stop, never «ready» with the dangling reference", async () => {
    const s = noScheme();
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set() }, { analysis: s.analysis, document: s.document, requiredVisuals: [], stage: "eso" });
    expect(plan.needs.find((n) => n.key === "act_1")).toMatchObject({ category: "unresolved_visual", resolution: { reason: "referenced_picture_unavailable" } });
  });
});
