import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { renderPage } from "@/lib/materials/visuals/raster";
import { cellPdf } from "./cell-case";

/**
 * Phase 8.2B.6: «La célula animal» (`cell-case.ts`) as a teacher's SCANNER would deliver it. The vector sheet is drawn, then
 * rasterised at 150 ppp, given a paper tone, a deterministic grain, speckles and the dark band a scanner leaves along one edge, and
 * stored as ONE image per page: a PDF with no text layer (or the PNG itself, like a photo upload). No private material.
 *
 * Variants add what makes a scan hard to read without words: a second drawing, decorations, a headline in very large letters, a
 * framed paragraph, a drawing cut by the page edge.
 */

export interface ScanOptions {
  /** The scheme of the cell (the essential figure). Default true. */
  scheme?: boolean;
  /** A second drawing (a microscope sketch) below activity 3. */
  secondFigure?: boolean;
  /** A small star in the top-right corner (≈ 8 mm). */
  smallDecoration?: boolean;
  /** A large flower ornament at the bottom (≈ 30 mm): decoration as big as a figure. */
  largeDecoration?: boolean;
  /** The title in very large letters (≈ 20 mm high): scanned text with figure-sized glyphs. */
  headline?: boolean;
  /** Activity 2 inside a printed frame (a box of text, not a figure). */
  framedText?: boolean;
  /** A large drawing that runs off the left edge of the page. */
  edgeFigure?: boolean;
  /** A line of running text printed right under the scheme (closer than the crop margin). */
  textTouching?: boolean;
  /** Scanner shadow along the left edge. Default true. */
  shadow?: boolean;
}

const A4 = { w: 595.28, h: 841.89 } as const;
const top = (y: number) => A4.h - y;

/** The vector sheet with the variant's extra drawings (the scheme itself comes from the cell case). */
async function sourcePdf(options: ScanOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await cellPdf({ withoutScheme: options.scheme === false }));
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  if (options.secondFigure) {
    // A microscope sketch: tube, stage and base, all one stroke (≈ 30 × 45 mm).
    const path = "M 0 0 L 30 0 L 30 60 L 60 60 L 60 80 L -30 80 L -30 60 L 0 60 Z M 10 80 L 10 120 L -20 120 L -20 128 L 70 128 L 70 120 L 40 120 L 40 80";
    page.drawSvgPath(path, { x: 440, y: top(632), borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
  }
  if (options.smallDecoration) page.drawSvgPath("M 10 0 L 13 7 L 20 7 L 14 11 L 16 19 L 10 14 L 4 19 L 6 11 L 0 7 L 7 7 Z", { x: 520, y: top(40), color: rgb(0.2, 0.2, 0.2) });
  if (options.largeDecoration) {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      page.drawEllipse({ x: 300 + 26 * Math.cos(a), y: top(700) + 26 * Math.sin(a), xScale: 22, yScale: 14, rotate: degrees(i * 60), borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
    }
    page.drawCircle({ x: 300, y: top(700), size: 12, color: rgb(0.3, 0.3, 0.3) });
  }
  if (options.headline) page.drawText("CELULA", { x: 60, y: top(790), size: 64, font, color: rgb(0, 0, 0) });
  if (options.framedText) page.drawRectangle({ x: 66, y: top(530), width: 470, height: 110, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  if (options.textTouching) page.drawText("Fijate bien en cada parte antes de escribir su nombre en las lineas.", { x: 76, y: top(347), size: 11, font: await pdf.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
  if (options.edgeFigure) page.drawEllipse({ x: 10, y: top(690), xScale: 70, yScale: 55, borderColor: rgb(0, 0, 0), borderWidth: 1.6, color: rgb(0.85, 0.85, 0.85) });
  return pdf.save({ useObjectStreams: false });
}

/** Deterministic grain (mulberry32): the same scan every run. */
function grain(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sheet as a scanner image (PNG bytes, 150 ppp, A4). */
export async function scannedPng(options: ScanOptions = {}): Promise<Uint8Array> {
  const page = await renderPage(await sourcePdf(options), "application/pdf", 1, { dpi: 150, maxPx: 4096 });
  const ctx = page.canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, page.width, page.height);
  const data = image.data;
  const rand = grain(0x5ca7);
  const shadow = options.shadow !== false ? Math.round((4 / 25.4) * 150) : 0;
  for (let y = 0; y < page.height; y++) {
    for (let x = 0; x < page.width; x++) {
      const i = (y * page.width + x) * 4;
      // Paper tone (white → 244) and grain (± 5), darker ink stays dark.
      let v = data[i]! * 0.957 + (rand() - 0.5) * 10;
      if (x < shadow) v = Math.min(v, 40 + (x / shadow) * 120);
      v = Math.max(0, Math.min(255, Math.round(v)));
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  // Dust: isolated dark specks below 0.5 mm.
  for (let k = 0; k < 120; k++) {
    const x = 40 + Math.floor(rand() * (page.width - 80));
    const y = 40 + Math.floor(rand() * (page.height - 80));
    const i = (y * page.width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 60;
  }
  ctx.putImageData(image, 0, 0);
  return new Uint8Array(await page.canvas.encode("png"));
}

/** The scan stored as a PDF: one full-page image, no text layer at all. */
export async function scannedPdf(options: ScanOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(await scannedPng(options));
  const page = pdf.addPage([A4.w, A4.h]);
  page.drawImage(png, { x: 0, y: 0, width: A4.w, height: A4.h });
  return pdf.save({ useObjectStreams: false });
}

/** Where the scheme is on the page (normalised, top-left origin): the membrane ellipse with its numbered leaders. */
export const SCHEME_BOUNDS = { x: 120 / A4.w, y: 166 / A4.h, w: (412 - 120) / A4.w, h: (342 - 166) / A4.h } as const;
