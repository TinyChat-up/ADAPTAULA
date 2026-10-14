import { beforeAll, describe, expect, it } from "vitest";
import { NormalizedBoundsSchema, pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { locateVisuals, type Located, type VisualTarget } from "@/lib/materials/visuals/auto/locate";
import { INK, iou, type PageModel } from "@/lib/materials/visuals/auto/page-model";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { SCAN_METHOD, locateOnScan, type ScanContext } from "@/lib/materials/visuals/auto/scan";
import { autoTargets } from "@/lib/materials/visuals/auto/service";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { pageRgba, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { cellCaseAnalysis, cellCaseDocument, cellPdf } from "../support/cell-case";
import { SCHEME_BOUNDS, scannedPdf, scannedPng, type ScanOptions } from "../support/scan-case";

/**
 * Phase 8.2B.6 · «La célula animal» scanned (`scan-case.ts`: one image per page, no text layer, paper tone, grain, dust and the
 * scanner's dark edge). The essential scheme of activity 1 has no printed words to anchor it, so the 8.2B.5 engine cannot place it;
 * the scan extension accepts it ONLY when the analysis lists it as the page's single (required) visual and the pixels show exactly
 * one drawing. Every negative case must stay unlocated: no arbitrary crop, no decision by size, no text taken for a figure.
 * 0 model calls, 0 OCR.
 */

const PDF = "application/pdf";
const analysis = cellCaseAnalysis();
const target: VisualTarget = { id: "vis_1", shape: "figure", activityIds: ["act_1"] };
const sole: ScanContext = { visualsOnPage: 1, required: true };
const asRect = (b: { x: number; y: number; w: number; h: number }) => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });

const VARIANTS = {
  base: {},
  noScheme: { scheme: false },
  twoFigures: { secondFigure: true },
  smallDecoration: { smallDecoration: true },
  largeDecoration: { largeDecoration: true },
  headline: { headline: true },
  headlineOnly: { headline: true, scheme: false },
  framedText: { framedText: true },
  framedTextOnly: { framedText: true, scheme: false },
  edgeOnly: { edgeFigure: true, scheme: false },
  edgeAndScheme: { edgeFigure: true },
  textTouching: { textTouching: true },
} satisfies Record<string, ScanOptions>;
type Variant = keyof typeof VARIANTS;

const pages = {} as Record<Variant, PageModel>;
let png: PageModel;
const scan = (v: Variant, t: VisualTarget = target, context: ScanContext = sole): Located => locateOnScan(pages[v], t, context);

beforeAll(async () => {
  await Promise.all(
    Object.entries(VARIANTS).map(async ([name, options]) => {
      pages[name as Variant] = (await readPage(await scannedPdf(options), PDF, 1, 100)).model;
    }),
  );
  png = (await readPage(await scannedPng(), "image/png", 1, 100)).model;
}, 180_000);

describe("the case that failed before (engine auto_visuals@v2)", () => {
  it("a scanned page has no text layer: no anchor, no placement, the generic figure stays at 0.15 and is never located", () => {
    expect(pages.base.texts).toEqual([]);
    const targets = autoTargets(analysis).map(({ id, shape, activityIds }) => ({ id, shape, activityIds }));
    expect(targets).toEqual([target]);
    const [before] = locateVisuals(pages.base, targets, analysis.activities.map((a) => ({ id: a.id, label: a.label, instruction: a.instruction })));
    expect(before).toMatchObject({ visualId: "vis_1", accepted: false, bounds: null, evidence: { placement: false, anchor: null, reason: "low_confidence" } });
    expect(before!.confidence).toBeLessThan(0.75);
  });
});

describe("what now works: the single required figure of a scanned page", () => {
  it("found where it is (IoU ≥ 0.8 with the drawn scheme and its numbered leaders), at exactly the threshold, with its signals", () => {
    const located = scan("base");
    expect(located).toMatchObject({ visualId: "vis_1", accepted: true, confidence: 0.75, evidence: { shape: "figure", signature: false, placement: false, unique: true, clean: true, anchor: null, reason: "accepted", vision: { used: false } } });
    expect(located.evidence.scan).toMatchObject({ method: SCAN_METHOD, sole_visual: true, regions: 1, faint: 0 });
    // The scanner's dark edge was seen and set aside, never taken as a figure.
    expect(located.evidence.scan!.edge_artifacts).toBeGreaterThanOrEqual(1);
    expect(iou(asRect(located.bounds!), asRect(SCHEME_BOUNDS))).toBeGreaterThan(0.8);
  });

  it("the crop holds the scheme and nothing of the text around it: not the instruction above, not the answer lines below", () => {
    const b = scan("base").bounds!;
    // Instruction lines end at 146 pt from the top; the first answer line is at 360 pt (A4 is 841.89 pt high).
    expect(b.y).toBeGreaterThan(150 / 841.89);
    expect(b.y + b.h).toBeLessThan(358 / 841.89);
  });

  it("the same scheme from a photo/scan uploaded as an image (PNG): same place", () => {
    const fromPng = locateOnScan(png, target, sole);
    expect(fromPng.accepted).toBe(true);
    expect(iou(asRect(fromPng.bounds!), asRect(scan("base").bounds!))).toBeGreaterThan(0.95);
  });

  it("a small decoration (a star in the corner) is not a figure and does not make the page ambiguous", () => {
    expect(scan("smallDecoration")).toMatchObject({ accepted: true });
    expect(iou(asRect(scan("smallDecoration").bounds!), asRect(scan("base").bounds!))).toBeGreaterThan(0.99);
  });

  it("very large letters and a framed paragraph are text, not drawings: the scheme next to them is still the only figure", () => {
    expect(scan("headline")).toMatchObject({ accepted: true, evidence: { scan: { regions: 1 } } });
    expect(scan("headline").evidence.scan!.large_glyphs).toBeGreaterThan(0);
    expect(scan("framedText")).toMatchObject({ accepted: true, evidence: { scan: { regions: 1, frames: 1 } } });
  });

  it("a drawing cut by the page edge is scanner border or an incomplete figure: ignored, the scheme is located", () => {
    expect(scan("edgeAndScheme")).toMatchObject({ accepted: true });
  });
});

describe("still unlocated (honest stop): ambiguity, no figure, text, wrong page", () => {
  it("two drawings on the page: ambiguous, nothing chosen by size or position", () => {
    expect(scan("twoFigures")).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_ambiguous", scan: { regions: 2 } } });
  });

  it("a decoration as large as a figure (a flower ornament) makes the page ambiguous too", () => {
    expect(scan("largeDecoration")).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_ambiguous" } });
  });

  it("a page without the scheme: no region, no crop (the essential figure is not invented)", () => {
    expect(scan("noScheme")).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_no_region", scan: { regions: 0 } } });
  });

  it("scanned text alone is never a figure: very large letters, a framed paragraph", () => {
    expect(scan("headlineOnly")).toMatchObject({ accepted: false, evidence: { reason: "scan_no_region" } });
    expect(scan("framedTextOnly")).toMatchObject({ accepted: false, evidence: { reason: "scan_no_region", scan: { frames: 1 } } });
  });

  it("a drawing running off the page is not cropped (its coordinates would leave the page): no region", () => {
    expect(scan("edgeOnly")).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_no_region" } });
  });

  it("a line of running text closer to the scheme than the crop margin: the crop would take it, so it is not cropped", () => {
    expect(scan("textTouching")).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_text_overlap" } });
  });

  it("the analysis must say it is the page's only visual, and the required one", () => {
    expect(scan("base", target, { visualsOnPage: 2, required: true })).toMatchObject({ accepted: false, evidence: { reason: "scan_not_sole_visual", scan: { sole_visual: false } } });
    expect(scan("base", target, { visualsOnPage: 1, required: false })).toMatchObject({ accepted: false, evidence: { reason: "scan_not_sole_visual" } });
  });

  it("a figure the analysis calls a bar must read as a bar; a number line is not attempted on a scan", () => {
    expect(scan("base", { ...target, shape: "bar" })).toMatchObject({ accepted: false, evidence: { reason: "scan_signature_mismatch" } });
    expect(scan("base", { ...target, shape: "number_line" })).toMatchObject({ accepted: false, evidence: { reason: "scan_shape_unsupported" } });
  });

  it("a page WITH a text layer is never read as a scan (the anchored locator decides there)", async () => {
    const vector = (await readPage(await cellPdf(), PDF, 1, 100)).model;
    expect(vector.texts.length).toBeGreaterThan(0);
    expect(locateOnScan(vector, target, sole)).toMatchObject({ accepted: false, evidence: { reason: "scan_has_text_layer" } });
  });
});

describe("coordinates and the crop", () => {
  it("bounds are inside the page and valid for a locator (the same schema a person's selection passes)", () => {
    for (const located of [scan("base"), scan("headline"), scan("framedText"), locateOnScan(png, target, sole)]) {
      expect(NormalizedBoundsSchema.safeParse(located.bounds).success).toBe(true);
    }
  });

  it("the crop the producer cuts (200 ppp + the recipe's margin) contains the nucleus and the three numbers' leaders, and no answer line", async () => {
    const bytes = await scannedPdf();
    const page = await renderPage(bytes, PDF, 1, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
    const rect = pixelRect(withMargin(scan("base").bounds!, page, VISUAL_CROP_RECIPE.margin), page.width, page.height);
    const rgba = pageRgba(page);
    const gray = (xPt: number, yPt: number) => {
      const x = Math.round((xPt / 595.28) * page.width);
      const y = Math.round((yPt / 841.89) * page.height);
      return { x, y, v: rgba[(y * page.width + x) * 4]! };
    };
    const within = (p: { x: number; y: number }) => p.x >= rect.left && p.x < rect.left + rect.width && p.y >= rect.top && p.y < rect.top + rect.height;
    const nucleus = gray(265, 255);
    expect(nucleus.v).toBeLessThan(INK);
    expect(within(nucleus)).toBe(true);
    // The ends of the leaders of «1», «2» and «3».
    for (const [x, y] of [[400, 200], [400, 300], [120, 330]] as const) expect(within(gray(x, y)), `${x},${y}`).toBe(true);
    // The first answer line (360 pt) and the instruction (132 pt) stay outside.
    expect(within(gray(300, 360))).toBe(false);
    expect(within(gray(300, 132))).toBe(false);
  });
});

describe("with its activity, through the visual policy of «Hacer magia»", () => {
  const { document } = cellCaseDocument();
  const base = { analysis, document, requiredVisuals: ["vis_1"], stage: "eso" as const };

  it("located → the essential scheme is the original's own figure, attached to activity 1 (the activity and its answer are unchanged)", async () => {
    const plan = await resolveMagicVisuals({ readyOriginals: async (ids) => new Set(ids.filter((id) => id === "vis_1")) }, base);
    expect(plan.needs).toEqual([expect.objectContaining({ key: "vis_1", origin: "original", essential: true, activityIds: ["act_1"], category: "exact_original_visual" })]);
  });

  it("not located and nothing else may resolve it (no assistants, no illustration) → an honest stop, never a sheet without it", async () => {
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set() }, base);
    expect(plan.needs).toEqual([expect.objectContaining({ key: "vis_1", essential: true, category: "unresolved_visual" })]);
  });
});
