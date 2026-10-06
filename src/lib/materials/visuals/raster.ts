import "server-only";
import path from "node:path";
import { createRequire } from "node:module";
import type { Canvas } from "@napi-rs/canvas";

/**
 * Deterministic rasteriser of an ORIGINAL material page: pdf.js (Apache-2.0) drawing on @napi-rs/canvas (MIT, Skia, prebuilt
 * per platform; no system binaries). Same input, same versions → same pixels (verified in tests). The page is rendered "as shown":
 * visible box (CropBox) with /Rotate applied, which is exactly the surface of the locator's coordinates (`geometry.ts`).
 * An uploaded image is one logical page, drawn as stored. Never called from the browser and never with a provider.
 */

export type PageBox =
  | { kind: "pdf"; width_pt: number; height_pt: number; rotation: number; view: [number, number, number, number] }
  | { kind: "image"; width_px: number; height_px: number };

export interface RasterPage {
  canvas: Canvas;
  width: number;
  height: number;
  box: PageBox;
}

export class RasterError extends Error {
  constructor(readonly code: "unsupported_source" | "page_missing" | "extraction_failed") {
    super(code);
  }
}

const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"];
const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function canvasLib() {
  const napi = await import("@napi-rs/canvas");
  // pdf.js draws through these globals in Node; the canvas library provides the matching implementations.
  const g = globalThis as Record<string, unknown>;
  g.Path2D ??= napi.Path2D;
  g.DOMMatrix ??= napi.DOMMatrix;
  g.ImageData ??= napi.ImageData;
  return napi;
}

let pdfjsModule: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
const pdfjs = () => (pdfjsModule ??= canvasLib().then(() => import("pdfjs-dist/legacy/build/pdf.mjs")));

/** Standard 14 font data shipped with pdf.js (a PDF may use Helvetica without embedding it). Resolved from the installed package. */
function standardFontDir(): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  return path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
}

/** Opens a PDF; `close()` releases it (the loading task owns the document and its worker). */
async function openPdf(bytes: Uint8Array) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: standardFontDir(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  return Object.assign(doc, { close: () => task.destroy() });
}

export async function pageCount(bytes: Uint8Array, mime: string): Promise<number> {
  if (IMAGE_MIME.includes(mime)) return 1;
  if (mime !== "application/pdf") throw new RasterError("unsupported_source");
  const doc = await openPdf(bytes);
  try {
    return doc.numPages;
  } finally {
    await doc.close();
  }
}

/**
 * Renders one page at `dpi` (PDF) or at its own size (image), never above `maxPx` on the long side and never upscaled beyond the
 * requested density. White background (a transparent PDF page is paper).
 */
export async function renderPage(bytes: Uint8Array, mime: string, pageNumber: number, options: { dpi: number; maxPx: number }): Promise<RasterPage> {
  const napi = await canvasLib();
  if (IMAGE_MIME.includes(mime)) {
    if (pageNumber !== 1) throw new RasterError("page_missing");
    let image;
    try {
      image = await napi.loadImage(Buffer.from(bytes));
    } catch {
      throw new RasterError("extraction_failed");
    }
    const scale = Math.min(1, options.maxPx / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = napi.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return { canvas, width, height, box: { kind: "image", width_px: image.width, height_px: image.height } };
  }
  if (mime !== "application/pdf") throw new RasterError("unsupported_source");

  const doc = await openPdf(bytes);
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new RasterError("page_missing");
    const page = await doc.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(options.dpi / 72, options.maxPx / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const canvas = napi.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    // pdf.js's own canvas type is the DOM one; the napi canvas implements the same drawing API.
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    const [a, b, c, d] = page.view;
    return {
      canvas,
      width,
      height,
      box: { kind: "pdf", width_pt: round3(natural.width), height_pt: round3(natural.height), rotation: ((page.rotate % 360) + 360) % 360, view: [round3(a!), round3(b!), round3(c!), round3(d!)] },
    };
  } catch (error) {
    if (error instanceof RasterError) throw error;
    throw new RasterError("extraction_failed");
  } finally {
    await doc.close();
  }
}

/** The page box without drawing anything (what the locator records). */
export async function pageBox(bytes: Uint8Array, mime: string, pageNumber: number): Promise<PageBox> {
  if (IMAGE_MIME.includes(mime)) return (await renderPage(bytes, mime, pageNumber, { dpi: 72, maxPx: 1 << 14 })).box;
  if (mime !== "application/pdf") throw new RasterError("unsupported_source");
  const doc = await openPdf(bytes);
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new RasterError("page_missing");
    const page = await doc.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const [a, b, c, d] = page.view;
    return { kind: "pdf", width_pt: round3(natural.width), height_pt: round3(natural.height), rotation: ((page.rotate % 360) + 360) % 360, view: [round3(a!), round3(b!), round3(c!), round3(d!)] };
  } finally {
    await doc.close();
  }
}

/** Field by field (a box read back from jsonb has its keys reordered). */
export function sameBox(a: PageBox, b: PageBox): boolean {
  if (a.kind === "image" || b.kind === "image") return a.kind === b.kind && a.kind === "image" && b.kind === "image" && a.width_px === b.width_px && a.height_px === b.height_px;
  return a.width_pt === b.width_pt && a.height_pt === b.height_pt && a.rotation === b.rotation && a.view.length === 4 && a.view.every((v, i) => v === b.view[i]);
}

/** Crops a rendered page to a pixel rectangle and encodes it as PNG (lossless: thin lines and text inside figures survive). */
export async function cropPng(page: RasterPage, rect: { left: number; top: number; width: number; height: number }): Promise<{ png: Buffer; width: number; height: number }> {
  if (rect.width < 1 || rect.height < 1) throw new RasterError("extraction_failed");
  const napi = await canvasLib();
  const out = napi.createCanvas(rect.width, rect.height);
  out.getContext("2d").drawImage(page.canvas, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return { png: await out.encode("png"), width: rect.width, height: rect.height };
}

export const encodePng = (page: RasterPage): Promise<Buffer> => page.canvas.encode("png");
