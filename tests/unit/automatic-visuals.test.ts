import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { VisualSpecView } from "@/components/material/visual-spec";
import { pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { extractSpec } from "@/lib/materials/visuals/auto/extract";
import { ACCEPT, AI_ONLY_CAP, locateVisuals, type Located, type VisualTarget } from "@/lib/materials/visuals/auto/locate";
import { iou, type PageModel } from "@/lib/materials/visuals/auto/page-model";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { autoTargets, shapeOf } from "@/lib/materials/visuals/auto/service";
import { cropPng, renderPage, toPdfRect } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { buildRenderModel, flatNodes, type RenderNode } from "@/lib/render/model";
import { comparisonFromText } from "@/lib/visuals/comparison";
import { VISUAL_SPEC_VERSION, VisualSpecSchema, describeSpec, numberLineGeometry, barGeometry, specIssues, type VisualSpec } from "@/lib/visuals/spec";
import { A4, BAR_BOUNDS, LINE_BOUNDS, TRUTH, fractionsCaseAnalysis, fractionsCaseDocument, fractionsPdf } from "../support/fractions-case";

/**
 * Phase 8.2B.1 on the synthetic «Fracciones en situaciones cotidianas» sheet (same mathematical properties as the real case, no
 * private material): the original's figures are found, cropped and — the simple mathematical ones — reconstructed and verified
 * WITHOUT a person and WITHOUT a model (0 real calls: a vision hypothesis, where used, is a literal). Then the sheet places each
 * figure with its activity.
 */

const PDF = "application/pdf";
const analysis = fractionsCaseAnalysis();
const activities = analysis.activities.map((a) => ({ id: a.id, label: a.label, instruction: a.instruction }));
const targets: VisualTarget[] = autoTargets(analysis).map(({ id, shape, activityIds }) => ({ id, shape, activityIds }));
const asRect = (b: { x: number; y: number; w: number; h: number }) => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });

let page: PageModel;
let hi: PageModel;
let located: Located[];
beforeAll(async () => {
  const bytes = await fractionsPdf();
  page = (await readPage(bytes, PDF, 1, 100)).model;
  hi = (await readPage(bytes, PDF, 1, 200)).model;
  located = locateVisuals(page, targets, activities);
}, 60_000);

describe("what the locator looks for", () => {
  it("the two required figures, by the analysis's own kind and words; never a decoration, a table or a chart", () => {
    expect(targets).toEqual([
      { id: "vis_1", shape: "bar", activityIds: ["act_1"] },
      { id: "vis_2", shape: "number_line", activityIds: ["act_4"] },
    ]);
    expect(shapeOf({ kind: "decorative", title: null, description: "Estrellas", text: null })).toBe("figure");
    const decorated = structuredClone(analysis);
    decorated.visuals.push({ ...decorated.visuals[0]!, id: "vis_3", role: "decorative", kind: "decorative" }, { ...decorated.visuals[0]!, id: "vis_4", role: "illustrative" });
    expect(autoTargets(decorated).map((t) => t.id)).toEqual(["vis_1", "vis_2"]);
  });
});

describe("automatic location of the bar and the number line (geometry only, no model)", () => {
  it("each one is found where it is (IoU ≥ 0.8 with the drawn figure), with its labels, at confidence ≥ 0.75", () => {
    const [bar, line] = located;
    expect(bar).toMatchObject({ visualId: "vis_1", accepted: true, evidence: { shape: "bar", signature: true, placement: true, unique: true, clean: true, anchor: "act_1", reason: "accepted" } });
    expect(line).toMatchObject({ visualId: "vis_2", accepted: true, evidence: { shape: "number_line", signature: true, placement: true, unique: true, clean: true, anchor: "act_4", reason: "accepted" } });
    expect(iou(asRect(bar!.bounds!), asRect(BAR_BOUNDS))).toBeGreaterThan(0.8);
    expect(iou(asRect(line!.bounds!), asRect(LINE_BOUNDS))).toBeGreaterThan(0.8);
    for (const l of located) expect(l.confidence).toBeGreaterThanOrEqual(ACCEPT);
    // No vision call was needed for this sheet.
    expect(located.every((l) => !l.evidence.vision.used)).toBe(true);
  });

  it("the crop never takes another exercise or the student's fields: nothing of activities 2 or 3, no «Nombre»", () => {
    for (const l of located) {
      const r = asRect(l.bounds!);
      const lines = page.texts.filter((t) => !/^[0-9/ ]+$/.test(t.text));
      for (const t of lines) expect(iou({ x0: t.x0 / page.width, y0: t.y0 / page.height, x1: t.x1 / page.width, y1: t.y1 / page.height }, r), t.text).toBe(0);
    }
  });

  it("coordinates: a sideways-stored page shown upright by /Rotate 90 gives the same locator, and maps to its own PDF user space", async () => {
    const read = await readPage(await fractionsPdf({ rotate: 90 }), PDF, 1, 100);
    expect(read.box).toMatchObject({ kind: "pdf", rotation: 90 });
    const [bar, line] = locateVisuals(read.model, targets, activities);
    expect(bar!.accepted && line!.accepted).toBe(true);
    // As shown, the page is the same portrait sheet: the same normalised rectangle as the upright original.
    expect(iou(asRect(bar!.bounds!), asRect(located[0]!.bounds!))).toBeGreaterThan(0.95);
    // In PDF user space (landscape, origin bottom-left) the bar is x 150–178 (its distance from the top of the sheet), y 80–400
    // (its x on paper): the same rectangle pdf.js's own viewport gives.
    const truth = [TRUTH.bar.y, TRUTH.bar.x, TRUTH.bar.y + TRUTH.bar.h, TRUTH.bar.x + TRUTH.bar.w];
    toPdfRect(bar!.bounds!, read.box)!.forEach((v, i) => expect(Math.abs(v - truth[i]!), `coordenada ${i}`).toBeLessThan(3));
    // Upright page: PDF y grows upwards (842 − top of the figure).
    const upright = [TRUTH.bar.x, A4.h - TRUTH.bar.y - TRUTH.bar.h, TRUTH.bar.x + TRUTH.bar.w, A4.h - TRUTH.bar.y];
    toPdfRect(located[0]!.bounds!, { kind: "pdf", width_pt: A4.w, height_pt: A4.h, rotation: 0, view: [0, 0, A4.w, A4.h] })!.forEach((v, i) => expect(Math.abs(v - upright[i]!)).toBeLessThan(3));
  });

  it("scale: the crop recipe (200 ppp + 1 % margin) over the located bounds contains the whole bar and nothing far from it", async () => {
    const bytes = await fractionsPdf();
    const raster = await renderPage(bytes, PDF, 1, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
    const surface = raster.box.kind === "pdf" ? { width: raster.box.width_pt, height: raster.box.height_pt } : { width: 1, height: 1 };
    const rect = pixelRect(withMargin(located[0]!.bounds!, surface, VISUAL_CROP_RECIPE.margin), raster.width, raster.height);
    const crop = await cropPng(raster, rect);
    const pxPerPt = VISUAL_CROP_RECIPE.dpi / 72;
    expect(rect.left).toBeLessThanOrEqual(TRUTH.bar.x * pxPerPt);
    expect(rect.left + rect.width).toBeGreaterThanOrEqual((TRUTH.bar.x + TRUTH.bar.w) * pxPerPt);
    expect(crop.width).toBeLessThan((TRUTH.bar.w + 20) * pxPerPt);
    expect(crop.height).toBeLessThan((TRUTH.bar.h + 20) * pxPerPt);
  });
});

describe("a model's rectangle is a hypothesis, never a fact", () => {
  const blind: VisualTarget = { id: "vis_1", shape: "bar", activityIds: [] };
  it("without an activity anchor neither geometry nor an agreeing hypothesis establishes identity", () => {
    const [alone] = locateVisuals(page, [blind], []);
    expect(alone!.accepted).toBe(false);
    expect(alone!.confidence).toBeLessThan(ACCEPT);
    const [helped] = locateVisuals(page, [blind], [], new Map([["vis_1", { bounds: { x: BAR_BOUNDS.x - 0.01, y: BAR_BOUNDS.y - 0.005, w: BAR_BOUNDS.w + 0.02, h: BAR_BOUNDS.h + 0.01 }, confidence: 0.9 }]]));
    expect(helped).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "activity_unverified", vision: { used: true, agrees: true } } });
  });

  it("a confident rectangle over empty paper (or over another exercise) is rejected: capped at 0.60, nothing located", () => {
    for (const bounds of [{ x: 0.6, y: 0.86, w: 0.3, h: 0.08 }, { x: 0.12, y: 0.36, w: 0.5, h: 0.05 }]) {
      const [result] = locateVisuals(page, [blind], [], new Map([["vis_1", { bounds, confidence: 0.99 }]]));
      expect(result).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "hypothesis_not_snapped" } });
      expect(result!.confidence).toBeLessThanOrEqual(AI_ONLY_CAP);
    }
  });

  it("a generic figure is not located because a region has ink and lines: without a vision agreement it stays at 0.60; with one, it is", () => {
    const generic: VisualTarget = { id: "vis_1", shape: "figure", activityIds: ["act_1"] };
    const [alone] = locateVisuals(page, [generic], activities);
    expect(alone).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "low_confidence" } });
    expect(alone!.confidence).toBeLessThan(ACCEPT);
    const hypothesis = { bounds: { x: BAR_BOUNDS.x - 0.01, y: BAR_BOUNDS.y - 0.005, w: BAR_BOUNDS.w + 0.02, h: BAR_BOUNDS.h + 0.01 }, confidence: 0.9 };
    const [agreed] = locateVisuals(page, [generic], activities, new Map([["vis_1", hypothesis]]));
    expect(agreed).toMatchObject({ accepted: true, evidence: { vision: { agrees: true } } });
  });

  it("an essential figure that is not on the page is not invented: no region, reason recorded", async () => {
    const read = await readPage(await fractionsPdf({ withoutNumberLine: true }), PDF, 1, 100);
    const [, line] = locateVisuals(read.model, targets, activities);
    expect(line).toMatchObject({ visualId: "vis_2", accepted: false, bounds: null });
  });
});

describe("VisualSpec: the simple figures rebuilt from what the original shows, and verified", () => {
  it("bar: 8 equal parts, exactly 3 shaded (the answer 3/8 is NOT in the spec: there is nowhere to write it)", () => {
    const result = extractSpec(hi, located[0]!.bounds!, "bar");
    expect(result).toMatchObject({ ok: true, spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } });
    if (!result.ok) return;
    expect(result.checks.unequal_parts).toBeLessThan(0.02);
    expect(Object.keys(result.spec).sort()).toEqual(["kind", "parts", "shaded", "spec_version"]);
    const g = barGeometry(result.spec as Extract<VisualSpec, { kind: "fraction_bar" }>);
    expect(new Set(g.parts.map((p) => p.w.toFixed(6))).size).toBe(1);
    expect(g.parts.filter((p) => p.shaded)).toHaveLength(3);
  });

  it("number line: 0 to 1, ticks at 0, 1/4, 1/2, 3/4 and 1 at equal spacing, the original's labels only, and no mark of any kind", () => {
    const result = extractSpec(hi, located[1]!.bounds!, "number_line");
    expect(result).toMatchObject({ ok: true, spec: { kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4 } });
    if (!result.ok || result.spec.kind !== "number_line") return;
    expect(result.spec.labels.map((l) => l.text)).toEqual(["0", "1/4", "1/2", "3/4", "1"]);
    const g = numberLineGeometry(result.spec);
    expect(g.ticks.map((t) => `${t.value.n}/${t.value.d}`)).toEqual(["0/1", "1/4", "1/2", "3/4", "1/1"]);
    const steps = g.ticks.slice(1).map((t, i) => t.x - g.ticks[i]!.x);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-9);
    expect(Object.keys(result.spec).sort()).toEqual(["divisions", "end", "kind", "labels", "spec_version", "start"]);
  });

  it("refused — the original is kept: an X on the line (it may be the answer), unequal parts", async () => {
    const marked = await readPage(await fractionsPdf({ markOnLine: true }), PDF, 1, 200);
    const [, line] = locateVisuals((await readPage(await fractionsPdf({ markOnLine: true }), PDF, 1, 100)).model, targets, activities);
    expect(extractSpec(marked.model, line!.bounds!, "number_line")).toMatchObject({ ok: false, reason: "marks_on_line" });
    const unequal = await fractionsPdf({ unequalBar: true });
    const [bar] = locateVisuals((await readPage(unequal, PDF, 1, 100)).model, targets, activities);
    expect(extractSpec((await readPage(unequal, PDF, 1, 200)).model, bar!.bounds!, "bar")).toMatchObject({ ok: false, reason: "unequal_parts" });
  });

  it("a spec whose label is not the value of its tick is invalid, and the schema has no field for an answer", () => {
    const wrong = { spec_version: VISUAL_SPEC_VERSION, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 1, text: "1/3" }] };
    expect(VisualSpecSchema.safeParse(wrong).success).toBe(false);
    expect(specIssues(wrong as never)).toContain("una etiqueta no coincide con el valor de su marca");
    const withMark = { spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [], marks: [{ n: 3, d: 4 }] };
    expect(VisualSpecSchema.parse(withMark)).not.toHaveProperty("marks");
    const comparison = { spec_version: 1, kind: "comparison", items: [{ left: { n: 2, d: 3 }, right: { n: 3, d: 5 }, sign: ">" }] };
    expect(JSON.stringify(VisualSpecSchema.parse(comparison))).not.toContain(">");
  });
});

describe("comparisons with boxes, read from the activity's printed words", () => {
  const a2 = analysis.activities.find((a) => a.id === "act_2")!;
  it("«2/3 ☐ 3/5» and «4/8 ☐ 1/2»: two items, one box each, never a sign", () => {
    const parsed = comparisonFromText(a2.instruction, a2.context);
    expect(parsed).toMatchObject({ pairsOnly: true, spec: { kind: "comparison", items: [{ left: { n: 2, d: 3 }, right: { n: 3, d: 5 } }, { left: { n: 4, d: 8 }, right: { n: 1, d: 2 } }] } });
    const svg = renderToStaticMarkup(createElement(VisualSpecView, { spec: parsed!.spec, label: describeSpec(parsed!.spec) }));
    expect(svg.match(/data-answer-box/g)).toHaveLength(2);
    // Inside the drawing there is no relation sign at all: only digits, bars and empty boxes.
    expect(svg.replace(/aria-label="[^"]*"/, "")).not.toMatch(/&lt;|&gt;|>\s*=\s*<|≤|≥/);
  });

  it("not a comparison task (or one that already shows its relation): left as the analysis said", () => {
    expect(comparisonFromText("Escribe >, < o =.", "2/3 > 3/5   4/8 ☐ 1/2")).toBeNull();
    expect(comparisonFromText("Calcula 2/3 + 3/5.", null)).toBeNull();
    expect(comparisonFromText("Compara usando >, < o =", "2/3 ☐ 3/5 y también 1/2")).toBeNull();
  });
});

describe("the deterministic SVG renderer", () => {
  const bar = VisualSpecSchema.parse({ spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] });
  const line = VisualSpecSchema.parse({ spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 0, text: "0" }, { tick: 1, text: "1/4" }, { tick: 2, text: "1/2" }, { tick: 3, text: "3/4" }, { tick: 4, text: "1" }] });
  const svg = (spec: VisualSpec) => renderToStaticMarkup(createElement(VisualSpecView, { spec, label: describeSpec(spec) }));

  it("draws exactly what the spec says: 8 parts and 3 shaded; 5 ticks; sized in millimetres", () => {
    expect(svg(bar).match(/data-part=/g)).toHaveLength(8);
    expect(svg(bar).match(/data-shaded=/g)).toHaveLength(3);
    expect(svg(line).match(/data-tick=/g)).toHaveLength(5);
    expect(svg(bar)).toMatch(/width="122mm"/);
    expect(describeSpec(bar)).toBe("Barra dividida en 8 partes iguales; 3 partes sombreadas.");
  });

  it("is inert: no script, no link, no external resource, no event handler, no foreign markup", () => {
    for (const s of [bar, line]) {
      const out = svg(s);
      expect(out).not.toMatch(/<script|<foreignObject|<image|<use|href=|xlink|url\(|\bon[a-z]+=|style=/i);
    }
  });
});

describe("each figure with its activity, and the pages it takes", () => {
  const { document } = fractionsCaseDocument();
  const bySource = (n: RenderNode, ref: string) => n.kind === "activity" && (n.prompt[0]?.[0]?.text ?? "").length > 0 && ref.length > 0;
  const model = (figures: Record<string, VisualSpec> = {}) =>
    buildRenderModel(document, { mode: "student", design: "claro", requiredVisuals: ["vis_1", "vis_2"], figures, assets: {}, deferred: [] });
  const activityNodes = (m: ReturnType<typeof model>["model"]) => m.pages.flatMap((p, i) => p.nodes.filter((n) => n.kind === "activity").map((n) => ({ page: i + 1, node: n as Extract<RenderNode, { kind: "activity" }> })));
  const barSpec = VisualSpecSchema.parse({ spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] });
  const lineSpec = VisualSpecSchema.parse({ spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 0, text: "0" }, { tick: 4, text: "1" }] });

  it("the bar is drawn inside activity 1 after its prompt; the number line inside activity 4; the example before activity 3", () => {
    const { model: m, validation } = model({ vis_1: barSpec, vis_2: lineSpec });
    expect(validation.status).not.toBe("not_renderable");
    const acts = activityNodes(m);
    expect(acts.map((a) => a.node.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(acts[0]!.node.figures.map((f) => f.kind === "image" && f.spec?.kind)).toEqual(["fraction_bar"]);
    expect(acts[3]!.node.figures.map((f) => f.kind === "image" && f.spec?.kind)).toEqual(["number_line"]);
    expect(acts[2]!.node.leads.map((l) => l.kind)).toEqual(["paragraph", "worked_example"]);
    // No figure or example is left loose on a page.
    expect(m.pages.flatMap((p) => p.nodes).filter((n) => n.kind === "image" || n.kind === "worked_example")).toEqual([]);
    expect(bySource(acts[0]!.node, "act_1")).toBe(true);
  });

  it("activity 2 answers in two empty boxes (no writing box); activity 4 on its line (no writing lines); the rest keep their space", () => {
    const acts = activityNodes(model({ vis_1: barSpec, vis_2: lineSpec }).model);
    expect(acts[1]!.node.response).toMatchObject({ kind: "comparison", spec: { items: [{}, {}] } });
    expect(acts[1]!.node.prompt.flat().map((r) => r.text).join("")).not.toMatch(/2\/3|3\/5/);
    expect(acts[3]!.node.response).toEqual({ kind: "none" });
    expect(acts[0]!.node.response).toMatchObject({ kind: "lines", lines: 1 });
    expect(acts[4]!.node.response).toMatchObject({ kind: "lines", lines: 3 });
  });

  it("two pages, each justified: the profile allows 3 activities per page; no page holds only figures; every figure is on its activity's page", () => {
    const { model: m } = model({ vis_1: barSpec, vis_2: lineSpec });
    expect(document.presentation.max_tasks_per_page).toBe(3);
    expect(m.pages).toHaveLength(2);
    expect(m.pages.map((p) => p.nodes.filter((n) => n.kind === "activity").length)).toEqual([2, 3]);
    for (const p of m.pages) expect(p.nodes.some((n) => n.kind === "activity")).toBe(true);
    const imagesOutside = m.pages.flatMap((p) => p.nodes).filter((n) => n.kind === "image");
    expect(imagesOutside).toEqual([]);
  });

  it("a figure that is still missing keeps its place inside the activity, and an essential one stops the sheet (never printed without it)", () => {
    const { model: m, validation } = model({ vis_1: barSpec });
    const missing = flatNodes(m.pages.flatMap((p) => p.nodes)).find((n) => n.kind === "image" && n.state === "missing");
    expect(missing).toMatchObject({ essential: true });
    expect(validation.status).toBe("not_renderable");
  });

  it("screen and print draw the same figure markup (one renderer): the sheet holds the bar, the line and two answer boxes", () => {
    const { model: m } = model({ vis_1: barSpec, vis_2: lineSpec });
    const html = renderToStaticMarkup(createElement(MaterialSheet, { model: m }));
    expect(html.match(/<svg class="ms-spec" data-spec="fraction_bar"/g)).toHaveLength(1);
    expect(html.match(/<svg class="ms-spec" data-spec="number_line"/g)).toHaveLength(1);
    expect(html.match(/data-answer-box/g)).toHaveLength(2);
    // The figure follows its prompt inside the same activity section.
    expect(html.indexOf("Observa la barra")).toBeLessThan(html.indexOf('data-spec="fraction_bar"'));
    expect(html.indexOf('data-spec="fraction_bar"')).toBeLessThan(html.indexOf("Compara las fracciones"));
  });
});

describe("the deterministic review accepts the new answer areas", () => {
  it("no check FAILS on the fractions sheet: the pairs of activity 2 are still there (in its boxes) and activity 4 answers on its line", async () => {
    const { deterministicChecks } = await import("@/lib/adaptation/review");
    const { analysis: a, plan, context, document } = fractionsCaseDocument();
    const checks = deterministicChecks({ analysis: a, plan, context, document } as never);
    expect(checks.filter((c) => c.status === "FAIL").map((c) => `${c.check}: ${c.detail}`)).toEqual([]);
  });
});

describe("unchanged for sheets without these figures", () => {
  it("an activity with no figure renders as before (no leads, no figures)", () => {
    const { document } = fractionsCaseDocument();
    const { model } = buildRenderModel(document, { mode: "student", figures: {}, assets: {}, deferred: [] });
    const fifth = model.pages.flatMap((p) => p.nodes).find((n) => n.kind === "activity" && n.label === "5") as Extract<RenderNode, { kind: "activity" }>;
    expect(fifth.figures).toEqual([]);
    expect(fifth.leads).toEqual([]);
  });

  it("the answer of the analysis is never shown: «3/8» is nowhere in the student sheet", () => {
    const { document } = fractionsCaseDocument();
    const { model } = buildRenderModel(document, { mode: "student", figures: { vis_1: VisualSpecSchema.parse({ spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] }) }, assets: {}, deferred: [] });
    expect(renderToStaticMarkup(createElement(MaterialSheet, { model }))).not.toContain("3/8");
  });
});

describe("textless originals have no independently verified activity identity", () => {
  it("rejects even a matching vision hypothesis before accessing pixels", () => {
    const textless: PageModel = { width: 4096, height: 4096, texts: [], mmPerPx: .05,
      get gray(): Uint8Array { throw new Error("must reject before pixel traversal"); } };
    const hypotheses = new Map(targets.map((t) => [t.id, { bounds: BAR_BOUNDS, confidence: 1 }]));
    for (const result of locateVisuals(textless, targets, activities, hypotheses))
      expect(result).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_identity_unverified" } });
  });
});
