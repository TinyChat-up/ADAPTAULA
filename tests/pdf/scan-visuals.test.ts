import { describe, expect, it } from "vitest";
import { pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { locateOnScan } from "@/lib/materials/visuals/auto/scan";
import { cropPng, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { cellCaseDocument } from "../support/cell-case";
import { scannedPdf } from "../support/scan-case";
import { buildRenderModel, type RenderNode } from "@/lib/render/model";
import { assetRef } from "@/lib/render/print/pinned-assets";
import { pin } from "./fixtures";
import { printPdf } from "./harness";

/**
 * Phase 8.2B.6 end to end with the production engine (Chromium), nothing simulated but the scan itself: the scanned cell sheet →
 * the scan locator → the crop with the person's recipe (200 ppp + margin) → the adapted sheet → the PDF. The scheme printed is
 * that crop (pinned by its sha-256), inside activity 1, before its answer lines. 0 model calls.
 */

const PDF = "application/pdf";
const ASSET = "8b6e2c1a-0000-4000-8000-000000000b26";

describe("the scanned cell sheet, its located scheme printed with its activity", () => {
  it("one page; the crop of the scan is the image of activity 1, from the pinned bytes; nothing fetched, no script", async () => {
    const bytes = await scannedPdf();
    const located = locateOnScan((await readPage(bytes, PDF, 1, 100)).model, { id: "vis_1", shape: "figure", activityIds: ["act_1"] }, { visualsOnPage: 1, required: true });
    expect(located.accepted).toBe(true);
    const page = await renderPage(bytes, PDF, 1, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
    const crop = await cropPng(page, pixelRect(withMargin(located.bounds!, page, VISUAL_CROP_RECIPE.margin), page.width, page.height));
    // About 103 mm × 62 mm of the original (plus the recipe's margin) at 200 ppp: the scheme, not the page.
    expect(crop.width).toBeGreaterThan(780);
    expect(crop.width).toBeLessThan(860);
    expect(crop.height).toBeGreaterThan(470);
    expect(crop.height).toBeLessThan(530);

    const asset = pin(ASSET, new Uint8Array(crop.png));
    const { document } = cellCaseDocument();
    // As production resolves it (`resolveVisuals`): the pinned crop and its physical width at the recipe's density.
    const widthMm = Math.round(((crop.width * 25.4) / VISUAL_CROP_RECIPE.dpi) * 10) / 10;
    const { model, validation } = buildRenderModel(document, { mode: "student", design: "claro", requiredVisuals: ["vis_1"], deferred: [], assets: { vis_1: { src: assetRef(asset), widthMm } } });
    expect(validation.status).not.toBe("not_renderable");
    // The scheme is a figure OF activity 1 (inside its block, so on its page), and nowhere else.
    const activities = model.pages.flatMap((p, i) => p.nodes.filter((n): n is Extract<RenderNode, { kind: "activity" }> => n.kind === "activity").map((node) => ({ page: i, node })));
    const first = activities.find((a) => a.node.label === "1")!;
    expect(first.node.figures).toEqual([expect.objectContaining({ kind: "image", state: "available", src: assetRef(asset), origin: "original", essential: true, widthMm })]);
    expect(activities.filter((a) => a.node.label !== "1").flatMap((a) => a.node.figures)).toEqual([]);

    const printed = await printPdf("scan-visuals-cell", model, [asset], 1);
    expect(printed.validation.issues).toEqual([]);
    expect(printed.validation.imageCount).toBe(1);
    expect(printed.result.blockedRequests).toEqual([]);
    expect(printed.print.html).not.toMatch(/<script|https?:\/\//);
    expect(printed.print.assets).toEqual([`asset:${ASSET}@${asset.sha256}`]);
    expect(printed.pages[first.page]!.text).toContain("Observa el esquema");
    // The pinned bytes are inlined: after the prompt of activity 1, before activity 2, and only once.
    const html = printed.print.html;
    const image = html.indexOf("data:image/png");
    expect(html.indexOf("data:image/png", image + 1)).toBe(-1);
    expect(image).toBeGreaterThan(html.indexOf("Observa el esquema"));
    expect(image).toBeLessThan(html.indexOf("¿Qué función tiene el núcleo?"));
  });
});
