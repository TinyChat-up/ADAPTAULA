import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { cropPng, pageBox, pageCount, renderPage, RasterError, type RasterPage } from "@/lib/materials/visuals/raster";
import { boundsFromCorners, pixelRect, toNormalized, withMargin, NormalizedBoundsSchema } from "@/lib/materials/visuals/geometry";
import { CROPBOX, FRACTION_FIGURE, NUMBER_LINE, RASTER, expectedMarker, visualFixtureImage, visualFixturePdf } from "../support/visual-fixture";

const PDF = "application/pdf";
let pdf: Uint8Array;
let image: Uint8Array;
beforeAll(async () => {
  pdf = await visualFixturePdf();
  image = await visualFixtureImage();
}, 30_000);

const pixel = (page: RasterPage, nx: number, ny: number) => {
  const x = Math.min(page.width - 1, Math.round(nx * page.width));
  const y = Math.min(page.height - 1, Math.round(ny * page.height));
  return page.canvas.getContext("2d").getImageData(x, y, 1, 1).data;
};
const isRed = (p: Uint8ClampedArray) => p[0]! > 200 && p[1]! < 60 && p[2]! < 60;

describe("rasteriser: the page as shown (rotation and CropBox resolved once, deterministically)", () => {
  it("counts pages of a PDF; an image is one logical page; other types are unsupported", async () => {
    expect(await pageCount(pdf, PDF)).toBe(6);
    expect(await pageCount(image, "image/png")).toBe(1);
    await expect(pageCount(pdf, "application/zip")).rejects.toBeInstanceOf(RasterError);
  });

  it("6 · 0°, 90°, 180°, 270° and a CropBox put the marker exactly where the reader sees it", async () => {
    for (const page of [1, 2, 3, 4, 5, 6]) {
      const r = await renderPage(pdf, PDF, page, { dpi: 100, maxPx: 4096 });
      const e = expectedMarker(page);
      expect(isRed(pixel(r, e.x, e.y)), `página ${page}`).toBe(true);
      if (page === 3 || page === 5) expect(r.width).toBeGreaterThan(r.height); // landscape after rotation
    }
    const crop = await pageBox(pdf, PDF, 6);
    expect(crop).toMatchObject({ kind: "pdf", width_pt: CROPBOX.w, height_pt: CROPBOX.h, rotation: 0 });
    expect(await pageBox(pdf, PDF, 3)).toMatchObject({ rotation: 90 });
  }, 30_000);

  it("200 ppp on A4 is 1654×2339 px (print quality), capped at 4096 px and never upscaled", async () => {
    const a4 = await renderPage(pdf, PDF, 1, { dpi: 200, maxPx: 4096 });
    expect([a4.width, a4.height]).toEqual([1654, 2339]);
    const capped = await renderPage(pdf, PDF, 1, { dpi: 600, maxPx: 2000 });
    expect(Math.max(capped.width, capped.height)).toBe(2000);
    const img = await renderPage(image, "image/png", 1, { dpi: 200, maxPx: 4096 });
    expect([img.width, img.height]).toEqual([800, 600]);
    expect(img.box).toEqual({ kind: "image", width_px: 800, height_px: 600 });
  }, 30_000);

  it("is deterministic: the same page twice gives the same pixels and the same PNG bytes", async () => {
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const a = await renderPage(pdf, PDF, 2, { dpi: 200, maxPx: 4096 });
    const b = await renderPage(pdf, PDF, 2, { dpi: 200, maxPx: 4096 });
    const rect = pixelRect(FRACTION_FIGURE, a.width, a.height);
    expect(sha((await cropPng(a, rect)).png)).toBe(sha((await cropPng(b, rect)).png));
  }, 30_000);

  it("a missing page is `page_missing`, a corrupt source `extraction_failed`", async () => {
    await expect(renderPage(pdf, PDF, 7, { dpi: 72, maxPx: 4096 })).rejects.toMatchObject({ code: "page_missing" });
    await expect(renderPage(image, "image/png", 2, { dpi: 72, maxPx: 4096 })).rejects.toMatchObject({ code: "page_missing" });
    await expect(renderPage(new Uint8Array([1, 2, 3]), "image/png", 1, { dpi: 72, maxPx: 4096 })).rejects.toMatchObject({ code: "extraction_failed" });
  });
});

describe("8/31 · raster AND vector figures are captured from the rendered page (not by extracting image objects)", () => {
  it("the vector fraction figure (shaded parts), the number line and the raster stripes all land in their crops", async () => {
    const page2 = await renderPage(pdf, PDF, 2, { dpi: 200, maxPx: 4096 });
    const figure = await cropPng(page2, pixelRect(FRACTION_FIGURE, page2.width, page2.height));
    const ctx2 = page2.canvas.getContext("2d");
    const at = (nx: number, ny: number) => ctx2.getImageData(Math.round(nx * page2.width), Math.round(ny * page2.height), 1, 1).data;
    const grey = at(FRACTION_FIGURE.x + FRACTION_FIGURE.w * 0.1, FRACTION_FIGURE.y + FRACTION_FIGURE.h / 2);
    const white = at(FRACTION_FIGURE.x + FRACTION_FIGURE.w * 0.9, FRACTION_FIGURE.y + FRACTION_FIGURE.h / 2);
    expect(grey[0]).toBeLessThan(200); // shaded quarter
    expect(white[0]).toBeGreaterThan(240); // unshaded quarter
    expect(figure.width).toBeGreaterThan(600);
    const line = await cropPng(page2, pixelRect(NUMBER_LINE, page2.width, page2.height));
    expect(line.width).toBeGreaterThan(line.height * 5);
    const page1 = await renderPage(pdf, PDF, 1, { dpi: 200, maxPx: 4096 });
    const stripe = page1.canvas.getContext("2d").getImageData(Math.round((RASTER.x + 0.01) * page1.width), Math.round((RASTER.y + RASTER.h / 2) * page1.height), 1, 1).data;
    expect(stripe[2]).toBeGreaterThan(150);
    expect(stripe[0]).toBeLessThan(100);
  }, 30_000);
});

describe("geometry: one coordinate system for the tool and the producer", () => {
  it("4 · normalised coordinates do not depend on zoom or screen size", () => {
    const at = (scale: number) => {
      const rect = { left: 10, top: 20, width: 600 * scale, height: 848 * scale };
      return boundsFromCorners(toNormalized(10 + 120 * scale, 20 + 212 * scale, rect), toNormalized(10 + 300 * scale, 20 + 424 * scale, rect));
    };
    expect(at(1)).toEqual(at(1.5));
    expect(at(1)).toEqual(at(0.6));
    expect(at(1)).toEqual({ x: 0.2, y: 0.25, w: 0.3, h: 0.25 });
  });

  it("a drag in any direction or past the page edge is normalised and clamped", () => {
    expect(boundsFromCorners({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.5 });
    expect(boundsFromCorners({ x: -0.2, y: 0.9 }, { x: 0.3, y: 1.4 })).toEqual({ x: 0, y: 0.9, w: 0.3, h: 0.1 });
  });

  it("3 · invalid bounds are refused: too small, outside, non-finite", () => {
    expect(NormalizedBoundsSchema.safeParse({ x: 0.1, y: 0.1, w: 0.3, h: 0.2 }).success).toBe(true);
    expect(NormalizedBoundsSchema.safeParse({ x: 0.1, y: 0.1, w: 0.01, h: 0.2 }).success).toBe(false);
    expect(NormalizedBoundsSchema.safeParse({ x: 0.8, y: 0.1, w: 0.3, h: 0.2 }).success).toBe(false);
    expect(NormalizedBoundsSchema.safeParse({ x: Number.NaN, y: 0.1, w: 0.3, h: 0.2 }).success).toBe(false);
    expect(NormalizedBoundsSchema.safeParse({ x: -0.1, y: 0.1, w: 0.3, h: 0.2 }).success).toBe(false);
  });

  it("9/17 · the 1 % margin is the same physical distance on both axes and is clamped at the page edges", () => {
    const page = { width: 595.28, height: 841.89 };
    const m = withMargin({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, page, 0.01);
    expect((0.2 - m.x) * page.width).toBeCloseTo((0.2 - m.y) * page.height, 6);
    expect((0.2 - m.x) * page.width).toBeCloseTo(0.01 * page.width, 6);
    const edge = withMargin({ x: 0, y: 0.995, w: 0.3, h: 0.005 }, page, 0.01);
    expect(edge.x).toBe(0);
    expect(edge.y + edge.h).toBe(1);
    expect(edge.y).toBeGreaterThan(0.98);
    const full = withMargin({ x: 0, y: 0, w: 1, h: 1 }, page, 0.01);
    expect(full).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("pixel rectangles round outwards and stay inside the raster", () => {
    expect(pixelRect({ x: 0.1001, y: 0.2, w: 0.3, h: 0.3 }, 1000, 1000)).toEqual({ left: 100, top: 200, width: 301, height: 300 });
    expect(pixelRect({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 333, 333)).toEqual({ left: 299, top: 299, width: 34, height: 34 });
  });
});
