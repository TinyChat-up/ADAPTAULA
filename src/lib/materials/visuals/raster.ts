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

/** One printed text item of a PDF page, on the locator's surface (visible box, /Rotate applied, normalised, origin top-left). */
export interface PageTextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The PDF's own text layer of one page, mapped to the same surface as the raster (pdf.js viewport: CropBox and /Rotate). Each
 * item's box is its four corners (baseline, advance, ascent, a quarter of descent) through the viewport transform, so rotated
 * pages and rotated text come out right. An uploaded image has no text layer: none.
 */
export async function pageText(bytes: Uint8Array, mime: string, pageNumber: number): Promise<PageTextItem[]> {
  if (IMAGE_MIME.includes(mime)) return [];
  if (mime !== "application/pdf") throw new RasterError("unsupported_source");
  const doc = await openPdf(bytes);
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new RasterError("page_missing");
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const out: PageTextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const [a, b, c, d, e, f] = item.transform as number[];
      const advance = Math.hypot(a!, b!) || 1;
      const size = Math.hypot(c!, d!) || item.height || 1;
      const dir = [a! / advance, b! / advance];
      const up = [c! / size, d! / size];
      const width = item.width || advance * item.str.length * 0.5;
      const corners = [
        [e! - up[0]! * size * 0.25, f! - up[1]! * size * 0.25],
        [e! + dir[0]! * width - up[0]! * size * 0.25, f! + dir[1]! * width - up[1]! * size * 0.25],
        [e! + up[0]! * size * 0.95, f! + up[1]! * size * 0.95],
        [e! + dir[0]! * width + up[0]! * size * 0.95, f! + dir[1]! * width + up[1]! * size * 0.95],
      ].map(([x, y]) => viewport.convertToViewportPoint(x!, y!) as [number, number]);
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const x0 = Math.max(0, Math.min(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const x1 = Math.min(viewport.width, Math.max(...xs));
      const y1 = Math.min(viewport.height, Math.max(...ys));
      if (x1 <= x0 || y1 <= y0) continue;
      out.push({ text: item.str, x: x0 / viewport.width, y: y0 / viewport.height, w: (x1 - x0) / viewport.width, h: (y1 - y0) / viewport.height });
    }
    return out;
  } catch (error) {
    if (error instanceof RasterError) throw error;
    throw new RasterError("extraction_failed");
  } finally {
    await doc.close();
  }
}

/** Luma of a rendered page (RGBA read back from the canvas). */
export function pageRgba(page: RasterPage): Uint8ClampedArray {
  return page.canvas.getContext("2d").getImageData(0, 0, page.width, page.height).data;
}

/**
 * A rectangle on the locator's surface (normalised, top-left origin, rotated visible box) → PDF user space of the page
 * ([x0, y0, x1, y1], points, origin bottom-left of the MediaBox): undoes /Rotate, then scales to the visible box. For audit.
 */
export function toPdfRect(bounds: { x: number; y: number; w: number; h: number }, box: PageBox): [number, number, number, number] | null {
  if (box.kind !== "pdf") return null;
  const [vx0, vy0, vx1, vy1] = box.view;
  const unrotate = (u: number, v: number): [number, number] => {
    switch (box.rotation) {
      case 90: return [v, 1 - u];
      case 180: return [1 - u, 1 - v];
      case 270: return [1 - v, u];
      default: return [u, v];
    }
  };
  const pts = [unrotate(bounds.x, bounds.y), unrotate(bounds.x + bounds.w, bounds.y + bounds.h)].map(([u, v]) => [vx0 + u * (vx1 - vx0), vy1 - v * (vy1 - vy0)]);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return [r3(Math.min(pts[0]![0]!, pts[1]![0]!)), r3(Math.min(pts[0]![1]!, pts[1]![1]!)), r3(Math.max(pts[0]![0]!, pts[1]![0]!)), r3(Math.max(pts[0]![1]!, pts[1]![1]!))];
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

/**
 * What actually rasterised, read at run time (not hard-coded). For audit only: the bytes of a valid render may differ between
 * runtimes, so this never takes part in an asset's identity or in deciding whether an asset is correct. A version that cannot be
 * read in this runtime is recorded as null.
 */
export function engineProvenance(): Record<string, string | null> {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const version = (name: string) => {
    try {
      return (require(`${name}/package.json`) as { version: string }).version;
    } catch {
      return null;
    }
  };
  return { "pdfjs-dist": version("pdfjs-dist"), "@napi-rs/canvas": version("@napi-rs/canvas"), node: process.version, platform: process.platform, arch: process.arch };
}
