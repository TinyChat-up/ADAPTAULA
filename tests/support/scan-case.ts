import { PDFDocument } from "pdf-lib";
import { renderPage } from "@/lib/materials/visuals/raster";
import { cellPdf } from "./cell-case";

/** One synthetic cell sheet flattened to an image: verifies manual selection without a text layer. */
const A4 = { w: 595.28, h: 841.89 } as const;

export async function scannedPng(options: { scheme?: boolean } = {}): Promise<Uint8Array> {
  const page = await renderPage(await cellPdf({ withoutScheme: options.scheme === false }), "application/pdf", 1, { dpi: 150, maxPx: 4096 });
  return new Uint8Array(await page.canvas.encode("png"));
}

export async function scannedPdf(options: { scheme?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(await scannedPng(options));
  pdf.addPage([A4.w, A4.h]).drawImage(png, { x: 0, y: 0, width: A4.w, height: A4.h });
  return pdf.save();
}

/** Explicit teacher selection enclosing the membrane and all three numbered leaders. */
export const SCHEME_BOUNDS = { x: 120 / A4.w, y: 166 / A4.h, w: (412 - 120) / A4.w, h: (342 - 166) / A4.h } as const;
