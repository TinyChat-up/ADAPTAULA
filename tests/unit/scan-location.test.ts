import { beforeAll, describe, expect, it } from "vitest";
import { pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { locateVisuals, type VisualTarget } from "@/lib/materials/visuals/auto/locate";
import { INK, type PageModel } from "@/lib/materials/visuals/auto/page-model";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { SCAN_METHOD, isUnverifiedScanLocator, locateOnScan } from "@/lib/materials/visuals/auto/scan";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { pageRgba, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { cellCaseAnalysis, cellCaseDocument, cellPdf } from "../support/cell-case";
import { SCHEME_BOUNDS, scannedPdf, scannedPng, type ScanOptions } from "../support/scan-case";

const target: VisualTarget = { id: "vis_1", shape: "figure", activityIds: ["act_1"] };
const sole = { visualsOnPage: 1, required: true };
const variants = {
  base: {}, noScheme: { scheme: false }, twoFigures: { secondFigure: true },
  smallDecoration: { smallDecoration: true }, largeDecoration: { largeDecoration: true },
  headline: { headline: true }, headlineOnly: { headline: true, scheme: false },
  framedText: { framedText: true }, framedTextOnly: { framedText: true, scheme: false },
  edgeOnly: { edgeFigure: true, scheme: false }, edgeAndScheme: { edgeFigure: true }, textTouching: { textTouching: true },
} satisfies Record<string, ScanOptions>;
const pages = new Map<string, PageModel>();
beforeAll(async () => {
  // Rasterise sequentially: fixture setup must not retain twelve live PDF canvases at once.
  for (const [name, options] of Object.entries(variants)) pages.set(name, (await readPage(await scannedPdf(options), "application/pdf", 1, 100)).model);
}, 180_000);

describe("scan identity is unverified even when the synthetic drawing happens to be correct", () => {
  it.each(Object.keys(variants))("%s: never replace activity identity with sole-region geometry", (name) => {
    const model = pages.get(name)!;
    expect(model.texts).toEqual([]);
    expect(locateOnScan(model, target, sole)).toMatchObject({ accepted: false, bounds: null, confidence: 0,
      evidence: { reason: "scan_identity_unverified", scan: { method: SCAN_METHOD, sole_visual: true, identity_verified: false } } });
  });
  it("a PNG scan has the same restriction", async () => {
    const model = (await readPage(await scannedPng(), "image/png", 1, 100)).model;
    expect(locateOnScan(model, target, sole).accepted).toBe(false);
  });
  it("does not route a PDF with real text through the scan gate", async () => {
    const model = (await readPage(await cellPdf(), "application/pdf", 1, 100)).model;
    expect(model.texts.length).toBeGreaterThan(0);
    expect(locateOnScan(model, target, sole).evidence.reason).toBe("scan_has_text_layer");
  });
  it("multiple visuals, or a non-required one, remain unsupported", () => {
    for (const context of [{ visualsOnPage: 2, required: true }, { visualsOnPage: 1, required: false }])
      expect(locateOnScan(pages.get("base")!, target, context).evidence.reason).toBe("scan_not_sole_visual");
  });
  it("the prior locator and vision agreement cannot bypass the textless restriction, including bars", () => {
    const targets = [target, { ...target, id: "vis_2", shape: "bar" as const }];
    const hypotheses = new Map(targets.map((t) => [t.id, { confidence: 1, bounds: SCHEME_BOUNDS }]));
    for (const result of locateVisuals(pages.get("base")!, targets, cellCaseAnalysis().activities, hypotheses))
      expect(result).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_identity_unverified" } });
  });
  it("rejects before inspecting pixels: no full-resolution labels, flood-fill stack or quadratic row grouping", () => {
    const model: PageModel = { width: 4096, height: 4096, texts: [], mmPerPx: .05,
      get gray(): Uint8Array { throw new Error("pixel traversal not needed to decide missing identity evidence"); } };
    expect(locateOnScan(model, target, sole).accepted).toBe(false);
  });
  it("quarantines persisted scan evidence, preserving human and anchored legacy locators", () => {
    expect(isUnverifiedScanLocator({ method: "auto", evidence: { engine: "auto_visuals@v3", scan: { method: "scan_single_region@v1" } } })).toBe(true);
    expect(isUnverifiedScanLocator({ method: "human", evidence: null })).toBe(false);
    expect(isUnverifiedScanLocator({ method: "auto", evidence: { engine: "auto_visuals@v2", placement: true } })).toBe(false);
  });
});

describe("the supported manual selection and honest stop", () => {
  it("the known, manually selected fixture crop preserves nucleus and all three label leaders at 200 dpi", async () => {
    const page = await renderPage(await scannedPdf(), "application/pdf", 1, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
    const rect = pixelRect(withMargin(SCHEME_BOUNDS, { width: 595.28, height: 841.89 }, VISUAL_CROP_RECIPE.margin), page.width, page.height);
    const rgba = pageRgba(page);
    const point = (x: number, y: number) => ({ x: Math.round(x / 595.28 * page.width), y: Math.round(y / 841.89 * page.height) });
    const inside = (p: { x: number; y: number }) => p.x >= rect.left && p.x < rect.left + rect.width && p.y >= rect.top && p.y < rect.top + rect.height;
    const nucleus = point(265, 255);
    expect(rgba[(nucleus.y * page.width + nucleus.x) * 4]!).toBeLessThan(INK);
    for (const [x, y] of [[265, 255], [400, 200], [400, 300], [120, 330]]) expect(inside(point(x!, y!))).toBe(true);
    expect(inside(point(300, 360))).toBe(false);
    expect(inside(point(300, 132))).toBe(false);
  });
  it("missing identity stays unresolved, never an invented original visual", async () => {
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set() }, {
      analysis: cellCaseAnalysis(), document: cellCaseDocument().document, requiredVisuals: ["vis_1"], stage: "eso",
    });
    expect(plan.needs).toEqual([expect.objectContaining({ key: "vis_1", essential: true, category: "unresolved_visual" })]);
  });
});
