import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFRawStream, type PDFDict } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { locateVisuals } from "@/lib/materials/visuals/auto/locate";
import { expectedMarks } from "@/lib/materials/visuals/auto/marks";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { cropPng, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { buildRenderModel } from "@/lib/render/model";
import { assetRef, type PinnedAsset } from "@/lib/render/print/pinned-assets";
import { MaterialDocumentSchema, type Block } from "@/lib/schemas/material-document";
import { ARROWS_INSTRUCTION, LETTERS_INSTRUCTION, POLYGON_INSTRUCTION, USERS, VISUALS, activities, arrowsSheet, lettersSheet, polygonSheet } from "../support/marked-figures";
import { OUT_DIR, printPdf } from "./harness";

/**
 * Figures located by their marks, end to end with the production engine (Chromium): ORIGINAL synthetic sheet → automatic locator
 * (v6) → crop with the person's recipe → adapted CLARO sheet → PDF. Evidence that nothing is redrawn: the crop's pixels are the
 * original page's pixels of that region, byte for byte; the PDF embeds it at the crop's own pixel size (not resampled), on the same
 * page as its instruction, at a printed width where its smallest mark stays legible. 0 model calls. Not the real sheets.
 */

const PDF = "application/pdf";
type Kind = "polygon" | "letters" | "arrows";
const CASES: Record<Kind, { pdf: () => Promise<Uint8Array>; instruction: string }> = {
  polygon: { pdf: () => polygonSheet(), instruction: POLYGON_INSTRUCTION },
  letters: { pdf: () => lettersSheet(), instruction: LETTERS_INSTRUCTION },
  arrows: { pdf: () => arrowsSheet(), instruction: ARROWS_INSTRUCTION },
};

/** RGBA of a PNG. */
async function pixels(png: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const img = await loadImage(Buffer.from(png));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return { width: img.width, height: img.height, data: canvas.getContext("2d").getImageData(0, 0, img.width, img.height).data };
}

/** Width × height of every image XObject Chromium embedded, page by page. */
async function embeddedImages(pdf: Uint8Array): Promise<Array<Array<{ width: number; height: number }>>> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject")) as PDFDict | undefined;
    if (!xobjects) return [];
    const out: Array<{ width: number; height: number }> = [];
    const visit = (dict: PDFDict) => {
      for (const [, ref] of dict.entries()) {
        const obj = doc.context.lookup(ref);
        if (!(obj instanceof PDFRawStream)) continue;
        const subtype = obj.dict.get(PDFName.of("Subtype"))?.toString();
        if (subtype === "/Image" && !obj.dict.get(PDFName.of("SMask"))?.toString().includes("Mask")) {
          out.push({ width: Number(obj.dict.get(PDFName.of("Width"))?.toString()), height: Number(obj.dict.get(PDFName.of("Height"))?.toString()) });
        }
        if (subtype === "/Form") {
          const inner = (obj.dict.lookup(PDFName.of("Resources")) as PDFDict | undefined)?.lookup(PDFName.of("XObject")) as PDFDict | undefined;
          if (inner) visit(inner);
        }
      }
    };
    visit(xobjects);
    return out;
  });
}

describe("figuras con marcas: del original al PDF de la ficha adaptada, sin redibujar", () => {
  for (const kind of Object.keys(CASES) as Kind[]) {
    it(`${kind}: recorte idéntico a los píxeles del original, impreso a su tamaño junto a su consigna y legible`, async () => {
      const c = CASES[kind];
      const bytes = await c.pdf();
      const model = (await readPage(bytes, PDF, 1, 100)).model;
      const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks: expectedMarks(VISUALS[kind], USERS[kind] as never) }], activities(c.instruction));
      expect(located).toMatchObject({ accepted: true });

      // The crop, with the person's recipe, and the same region of the original page rendered by the same engine.
      const page = await renderPage(bytes, PDF, 1, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
      const surface = page.box.kind === "pdf" ? { width: page.box.width_pt, height: page.box.height_pt } : { width: page.width, height: page.height };
      const rect = pixelRect(withMargin(located!.bounds!, surface, VISUAL_CROP_RECIPE.margin), page.width, page.height);
      const crop = await cropPng(page, rect);
      const region = page.canvas.getContext("2d").getImageData(rect.left, rect.top, rect.width, rect.height).data;
      const cropped = await pixels(new Uint8Array(crop.png));
      expect([cropped.width, cropped.height]).toEqual([rect.width, rect.height]);
      expect(Buffer.from(cropped.data).equals(Buffer.from(region))).toBe(true);

      // The adapted sheet: the figure (an original image) right before its activity, printed at the crop's physical width.
      const widthMm = (crop.width / VISUAL_CROP_RECIPE.dpi) * 25.4;
      const trace = { origin: "original" as const, source_refs: [], decision_ids: [] };
      const blocks: Block[] = [
        { id: "blk_title", type: "heading", level: 1, text: "Ficha adaptada", trace },
        { id: "blk_figure", type: "image", source: { kind: "original", visual_ref: "vis_1" }, alt_text: "Figura del material original", trace: { ...trace, source_refs: ["vis_1"] } },
        { id: "blk_task1", type: "activity", label: "1", prompt: c.instruction, response: { kind: "lines", lines: 3 }, resource_block_ids: ["blk_figure"], trace: { ...trace, source_refs: ["act_1"] } },
      ];
      const doc = MaterialDocumentSchema.parse({
        schema_version: 1, meta: { title: "Ficha adaptada", language: "es", stage: "primaria", grade: "4-primaria", subject: "ciencias", topic: "figuras" },
        presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "high", decoration: "none", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: false },
        admin_fields: [], pages: [{ blocks }], answer_key: [],
      });
      const bytesPng = new Uint8Array(crop.png);
      const sha256 = createHash("sha256").update(bytesPng).digest("hex");
      const assetId = "22222222-3333-4333-8333-222222222222";
      const pin: PinnedAsset = { assetId, sha256, mime: "image/png", bytes: bytesPng };
      const { model: render } = buildRenderModel(doc, { mode: "student", design: "claro", deferred: [], assets: { vis_1: { src: assetRef({ assetId, sha256 }), widthMm } }, requiredVisuals: ["vis_1"] });
      const printed = await printPdf(`marked-${kind}`, render, [pin], 1);
      expect(printed.validation.issues).toEqual([]);

      const images = await embeddedImages(printed.result.pdf);
      const instructionPage = printed.pages.findIndex((p) => p.text.replace(/\s+/g, " ").includes(c.instruction));
      expect(instructionPage).toBeGreaterThanOrEqual(0);
      // On the same sheet of paper as its instruction, embedded at the crop's own pixel size (Chromium did not resample it).
      expect(images[instructionPage]).toContainEqual({ width: crop.width, height: crop.height });

      const dir = path.join(OUT_DIR, `marked-${kind}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "original-crop.png"), crop.png);
      writeFileSync(path.join(dir, "report.json"), JSON.stringify({ kind, bounds: located!.bounds, evidence: located!.evidence, crop: { width: crop.width, height: crop.height, sha256 }, widthMm: Math.round(widthMm), pages: printed.pages.length }, null, 2));
    });
  }
});
