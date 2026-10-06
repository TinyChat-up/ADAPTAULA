import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

/**
 * Synthetic original material for the visual locator (no private document). Every page carries a solid RED square near the
 * top-left corner of its user space, so a test can check where the rasteriser put it after rotation/CropBox, and the pages carry
 * the two figures that motivate this feature: a raster image and a VECTOR fraction figure with a number line (no image object).
 *
 *   1 · text + raster (blue/white stripes)       2 · vector fraction figure + number line with labels
 *   3/4/5 · page 2 rotated 90/180/270            6 · page 2 with a CropBox offset (visible region ≠ MediaBox)
 */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
/** Red marker in user space: x 40–80, y (from top) 40–80 → centre (60, 60 from the top). */
export const MARKER = { cx: 60, cyFromTop: 60, size: 40 } as const;
export const CROPBOX = { x: 30, y: 100, w: 520, h: 700 } as const;

/** Where the marker's centre must appear on the page AS SHOWN (normalised, origin top-left), per page of the fixture. */
export function expectedMarker(page: number): { x: number; y: number } {
  const u = MARKER.cx / PAGE_W;
  const v = MARKER.cyFromTop / PAGE_H;
  switch (page) {
    case 3: return { x: 1 - v, y: u }; // 90° clockwise
    case 4: return { x: 1 - u, y: 1 - v }; // 180°
    case 5: return { x: v, y: 1 - u }; // 270°
    case 6: return { x: (MARKER.cx - CROPBOX.x) / CROPBOX.w, y: (CROPBOX.y + CROPBOX.h - (PAGE_H - MARKER.cyFromTop)) / CROPBOX.h };
    default: return { x: u, y: v };
  }
}

/** The vector fraction figure on page 2, in normalised coordinates of the unrotated page (for tests that crop it). */
export const FRACTION_FIGURE = { x: 100 / PAGE_W, y: 200 / PAGE_H, w: 240 / PAGE_W, h: 100 / PAGE_H } as const;
export const NUMBER_LINE = { x: 90 / PAGE_W, y: 385 / PAGE_H, w: 420 / PAGE_W, h: 45 / PAGE_H } as const;
export const RASTER = { x: 100 / PAGE_W, y: 250 / PAGE_H, w: 300 / PAGE_W, h: 150 / PAGE_H } as const;

async function stripesPng(): Promise<Buffer> {
  const canvas = createCanvas(300, 150);
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1e3cc8" : "#ffffff";
    ctx.fillRect(i * 30, 0, 30, 150);
  }
  return canvas.encode("png");
}

/** `cropBoxPage: false` leaves out page 6 (five pages fit the Free plan's upload limit, for the browser tests). */
export async function visualFixturePdf(options: { cropBoxPage?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const png = await pdf.embedPng(await stripesPng());
  const marker = (p: ReturnType<typeof pdf.addPage>) => p.drawRectangle({ x: 40, y: PAGE_H - 80, width: 40, height: 40, color: rgb(1, 0, 0) });
  const figures = (p: ReturnType<typeof pdf.addPage>) => {
    p.drawText("Colorea 3/4 de la figura y situa 1/2 en la recta.", { x: 60, y: PAGE_H - 140, size: 12, font });
    for (let i = 0; i < 4; i++) p.drawRectangle({ x: 100 + i * 60, y: PAGE_H - 300, width: 60, height: 100, color: i < 3 ? rgb(0.6, 0.6, 0.6) : rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
    p.drawLine({ start: { x: 100, y: PAGE_H - 400 }, end: { x: 500, y: PAGE_H - 400 }, thickness: 1 });
    for (let i = 0; i <= 4; i++) {
      p.drawLine({ start: { x: 100 + i * 100, y: PAGE_H - 408 }, end: { x: 100 + i * 100, y: PAGE_H - 392 }, thickness: 1 });
      p.drawText(["0", "1/4", "1/2", "3/4", "1"][i]!, { x: 95 + i * 100, y: PAGE_H - 425, size: 10, font });
    }
  };
  const p1 = pdf.addPage([PAGE_W, PAGE_H]);
  marker(p1);
  p1.drawText("Ficha sintetica - pagina 1", { x: 100, y: PAGE_H - 60, size: 16, font });
  p1.drawImage(png, { x: 100, y: PAGE_H - 400, width: 300, height: 150 });
  const p2 = pdf.addPage([PAGE_W, PAGE_H]);
  marker(p2);
  figures(p2);
  for (const rotation of [90, 180, 270]) {
    const p = pdf.addPage([PAGE_W, PAGE_H]);
    marker(p);
    figures(p);
    p.setRotation(degrees(rotation));
  }
  if (options.cropBoxPage !== false) {
    const p6 = pdf.addPage([PAGE_W, PAGE_H]);
    marker(p6);
    figures(p6);
    p6.setCropBox(CROPBOX.x, CROPBOX.y, CROPBOX.w, CROPBOX.h);
  }
  return pdf.save({ useObjectStreams: false });
}

/** A synthetic uploaded photo/scan: 800×600 PNG with the red square at (100–160, 80–140). */
export async function visualFixtureImage(): Promise<Uint8Array> {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 800, 600);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(100, 80, 60, 60);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.strokeRect(300, 200, 400, 300);
  return canvas.encode("png");
}
