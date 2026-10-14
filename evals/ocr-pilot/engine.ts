import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { isLabel, type PageModel, type Rect, type TextBox } from "@/lib/materials/visuals/auto/page-model";

/**
 * Local OCR for the pilot (NOT wired to production): Tesseract 5 compiled to WebAssembly (tesseract.js), run in this process on
 * the scan's own pixels. No network call is made while recognising; the Spanish model is read from a local cache whose bytes are
 * pinned by sha-256 (README: how to fetch it once).
 *
 *   page pass   the whole page, automatic layout (PSM 3) with Tesseract's own deskew (`rotateAuto`): instructions and running
 *               text. Word boxes come back in the deskewed frame (`upright`) and are mapped back onto the page as shown.
 *   label pass  glyph-sized ink blobs that the page pass left unread, each re-read alone (PSM 8, alphanumeric whitelist). The
 *               page pass drops isolated one- or two-character labels next to drawings; this pass exists only to measure whether
 *               they can be recovered. It reads text; it never proposes a figure.
 */

export const LANG_FILE = "spa.traineddata.gz";
/** @tesseract.js-data/spa@1.0.0, 4.0.0_best_int (the tesseract.js default for the LSTM engine). */
export const LANG_SHA256 = "40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb";
export const CACHE_DIR = path.join(import.meta.dirname, ".cache");

export interface OcrWord extends TextBox {
  /** The same word in the deskewed frame (reading order is computed there). */
  upright: Rect;
  confidence: number;
  pass: "page" | "label";
}

export interface PageRead {
  words: OcrWord[];
  /** Skew Tesseract estimated and corrected (degrees; 0 when below its threshold or not detected). */
  skewDeg: number;
}

export interface OcrEngine {
  page(model: PageModel, dpi: number): Promise<PageRead>;
  /** `skewDeg` from the page pass places the labels in the deskewed frame too. */
  labels(model: PageModel, dpi: number, read: PageRead): Promise<OcrWord[]>;
  terminate(): Promise<void>;
}

const PAGE_MIN_CONFIDENCE = 40;
const LABEL_MIN_CONFIDENCE = 50;
const DARK = 160;

export function assertModel(dir = CACHE_DIR) {
  const file = path.join(dir, LANG_FILE);
  if (!existsSync(file)) throw new Error(`Falta ${file}. Descárgalo una vez (evals/ocr-pilot/README.md).`);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sha !== LANG_SHA256) throw new Error(`${LANG_FILE} no coincide con el sha-256 fijado (${sha}).`);
}

const png = (width: number, height: number, gray: (i: number) => number) => {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = gray(i);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer("image/png");
};

/** Rotates a box about the page centre by `rad` (y down) and returns its axis-aligned bounds. */
export function rotateBox(model: Pick<PageModel, "width" | "height">, r: Rect, rad: number): Rect {
  const cx = model.width / 2;
  const cy = model.height / 2;
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => [cx + (x! - cx) * Math.cos(rad) - (y! - cy) * Math.sin(rad), cy + (x! - cx) * Math.sin(rad) + (y! - cy) * Math.cos(rad)] as const);
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

type Blob = { x0: number; y0: number; x1: number; y1: number; pixels: number[] };

/** 4-connected dark components outside the already-read words (8-connectivity would merge a label with a nearby leader). */
function blobs(model: PageModel, read: readonly TextBox[], padPx: number): Blob[] {
  const { width, height, gray } = model;
  const seen = new Uint8Array(width * height);
  for (const t of read) {
    for (let y = Math.max(0, Math.floor(t.y0) - padPx); y <= Math.min(height - 1, Math.ceil(t.y1) + padPx); y++)
      seen.fill(1, y * width + Math.max(0, Math.floor(t.x0) - padPx), y * width + Math.min(width - 1, Math.ceil(t.x1) + padPx) + 1);
  }
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < gray.length; start++) {
    if (seen[start] || gray[start]! >= DARK) continue;
    const b: Blob = { x0: width, y0: height, x1: 0, y1: 0, pixels: [] };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      b.pixels.push(i);
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x + 1);
      b.y1 = Math.max(b.y1, y + 1);
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (j >= 0 && !seen[j] && gray[j]! < DARK) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(b);
  }
  return out;
}

/** Glyph-sized blobs, grouped when they sit side by side on one line (`12`, `1/4`). Thresholds are physical. */
export function labelGroups(model: PageModel, read: readonly TextBox[]): Blob[] {
  const mm = (v: number) => v * model.mmPerPx;
  const glyphs = blobs(model, read, Math.round(0.5 / model.mmPerPx)).filter((b) => {
    const h = mm(b.y1 - b.y0);
    const w = mm(b.x1 - b.x0);
    return h >= 1.8 && h <= 6 && w >= 0.2 && w <= 5 && b.pixels.length * model.mmPerPx ** 2 >= 0.25;
  });
  glyphs.sort((a, b) => a.x0 - b.x0);
  const groups: Blob[] = [];
  for (const g of glyphs) {
    const near = groups.find((o) => mm(g.x0 - o.x1) <= 0.8 && mm(g.x0 - o.x1) >= -0.2 && Math.min(o.y1, g.y1) - Math.max(o.y0, g.y0) >= 0.5 * Math.min(o.y1 - o.y0, g.y1 - g.y0));
    if (near && mm(Math.max(near.x1, g.x1) - near.x0) <= 9) {
      near.x0 = Math.min(near.x0, g.x0);
      near.y0 = Math.min(near.y0, g.y0);
      near.x1 = Math.max(near.x1, g.x1);
      near.y1 = Math.max(near.y1, g.y1);
      near.pixels.push(...g.pixels);
    } else groups.push({ ...g, pixels: [...g.pixels] });
  }
  return groups;
}

function words(data: Awaited<ReturnType<Worker["recognize"]>>["data"]) {
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
}

export async function createOcr(dir = CACHE_DIR): Promise<OcrEngine> {
  assertModel(dir);
  const options = { langPath: dir, cachePath: dir, gzip: true, cacheMethod: "none" };
  const pageWorker = await createWorker("spa", 1, options);
  const labelWorker = await createWorker("spa", 1, options);
  await pageWorker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  await labelWorker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/" });
  return {
    async page(model, dpi) {
      await pageWorker.setParameters({ user_defined_dpi: String(dpi) });
      const { data } = await pageWorker.recognize(png(model.width, model.height, (i) => model.gray[i]!), { rotateAuto: true }, { blocks: true });
      // Tesseract rotated the image by `rad` about its centre before reading; undo it to land on the page as shown.
      const rad = data.rotateRadians ?? 0;
      const read = words(data)
        .filter((w) => w.text.trim() !== "" && w.confidence >= PAGE_MIN_CONFIDENCE)
        .map((w) => ({ text: w.text.trim(), ...rotateBox(model, w.bbox, -rad), upright: { ...w.bbox }, confidence: w.confidence, pass: "page" as const }));
      return { words: read, skewDeg: (rad * 180) / Math.PI };
    },
    async labels(model, dpi, read) {
      const out: OcrWord[] = [];
      const rad = (read.skewDeg * Math.PI) / 180;
      for (const g of labelGroups(model, read.words)) {
        // Only the group's own pixels, on white, scaled to a ~40 px glyph: neighbouring strokes are not read.
        const scale = Math.max(1, Math.min(4, 40 / (g.y1 - g.y0)));
        const pad = Math.round(20 / scale);
        const w = g.x1 - g.x0 + 2 * pad;
        const h = g.y1 - g.y0 + 2 * pad;
        const own = new Map(g.pixels.map((i) => [i, model.gray[i]!]));
        const W = Math.round(w * scale);
        const H = Math.round(h * scale);
        const image = png(W, H, (i) => {
          const sx = g.x0 - pad + Math.floor((i % W) / scale);
          const sy = g.y0 - pad + Math.floor(Math.floor(i / W) / scale);
          return own.get(sy * model.width + sx) ?? 255;
        });
        await labelWorker.setParameters({ user_defined_dpi: String(Math.round(dpi * scale)) });
        const found = words((await labelWorker.recognize(image, {}, { blocks: true })).data);
        const text = found.map((f) => f.text.trim()).join("");
        const confidence = Math.min(...found.map((f) => f.confidence));
        if (text && isLabel(text) && confidence >= LABEL_MIN_CONFIDENCE) out.push({ text, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, upright: rotateBox(model, g, rad), confidence, pass: "label" });
      }
      return out;
    },
    async terminate() {
      await Promise.all([pageWorker.terminate(), labelWorker.terminate()]);
    },
  };
}
