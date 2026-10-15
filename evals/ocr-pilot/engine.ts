import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { isLabel, type PageModel, type Rect, type TextBox } from "@/lib/materials/visuals/auto/page-model";
import { caseByHeight, detachStrokes, digitLetterByRow, dropRepeatedMarks, isStraightStroke, keepLowConfidenceWord, loneLabelWords, resolveGlyphReading } from "./recognition";

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
 *
 * Phase I (`ocr_pilot@phase1`, rules in `recognition.ts`): low-confidence words kept only inside confident lines; lone label-like
 * page words re-read by the label pass; labels touching straight ticks detached; straight strokes rejected; one component = one
 * character (PSM 10 fallback); case of c/o/s/… by height; O/0-type pairs by row; repeated identical marks dropped; reading lines
 * from Tesseract's own line structure.
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
  /** Tesseract line (page pass) or a line of its own (label pass): reading lines come from this structure. */
  line: number;
  /** Lone label-like page word handed to the label pass; the combined reading uses the label pass's result instead. */
  rerouted?: boolean;
}

export interface PageRead {
  words: OcrWord[];
  /** Skew Tesseract estimated and corrected (degrees; 0 when below its threshold or not detected). */
  skewDeg: number;
  labelCalls?: number;
}

export interface OcrEngine {
  page(model: PageModel, dpi: number): Promise<PageRead>;
  /** `skewDeg` from the page pass places the labels in the deskewed frame too. */
  labels(model: PageModel, dpi: number, read: PageRead): Promise<OcrWord[]>;
  terminate(): Promise<void>;
}

const LABEL_MIN_CONFIDENCE = 50;
const DARK = 160;
export const OCR_LIMITS = { pixels: 12_000_000, components: 20_000, glyphs: 512, labelCalls: 64, pageMs: 30_000, labelsMs: 30_000 } as const;

function assertRaster(model: PageModel) {
  if (!Number.isInteger(model.width) || !Number.isInteger(model.height) || model.width < 1 || model.height < 1 ||
    model.width * model.height > OCR_LIMITS.pixels || model.gray.length !== model.width * model.height ||
    !Number.isFinite(model.mmPerPx) || model.mmPerPx < 25.4 / 600) throw new Error("ocr_raster_limit");
}

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

export type Blob = { x0: number; y0: number; x1: number; y1: number; pixels: number[]; components?: number };

const GLYPH = { minH: 1.8, maxH: 6, minW: 0.2, maxW: 5, minArea: 0.25 } as const;
/** Up to this size a too-big component may be a glyph touching a tick or leader; its pixels are kept for `detachStrokes`. */
const ATTACHED = { maxW: 14, maxH: 8 } as const;
const bounds = (pixels: readonly number[], width: number): Blob => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of pixels) { const x = i % width, y = (i - x) / width; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  return { x0, y0, x1, y1, pixels: [...pixels] };
};
const glyphSized = (b: Blob, mmPerPx: number) => {
  const h = (b.y1 - b.y0) * mmPerPx, w = (b.x1 - b.x0) * mmPerPx;
  return h >= GLYPH.minH && h <= GLYPH.maxH && w >= GLYPH.minW && w <= GLYPH.maxW && b.pixels.length * mmPerPx ** 2 >= GLYPH.minArea;
};

/** 4-connected dark components outside the already-read words (8-connectivity would merge a label with a nearby leader). */
function blobs(model: PageModel, read: readonly TextBox[], padPx: number): Blob[] {
  assertRaster(model);
  const { width, height, gray } = model;
  const seen = new Uint8Array(width * height);
  for (const t of read) {
    const x0 = Math.max(0, Math.floor(t.x0) - padPx);
    const x1 = Math.min(width - 1, Math.ceil(t.x1) + padPx);
    if (x1 < x0) continue;
    for (let y = Math.max(0, Math.floor(t.y0) - padPx); y <= Math.min(height - 1, Math.ceil(t.y1) + padPx); y++)
      seen.fill(1, y * width + x0, y * width + x1 + 1);
  }
  const out: Blob[] = [];
  const stack = new Uint32Array(width * height);
  let top = 0;
  let count = 0;
  for (let start = 0; start < gray.length; start++) {
    if (seen[start] || gray[start]! >= DARK) continue;
    const b: Blob = { x0: width, y0: height, x1: 0, y1: 0, pixels: [] };
    if (++count > OCR_LIMITS.components) throw new Error("ocr_component_limit");
    let oversized = false;
    seen[start] = 1;
    stack[top++] = start;
    while (top) {
      const i = stack[--top]!;
      const x = i % width;
      const y = (i - x) / width;
      if (!oversized) b.pixels.push(i);
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x + 1);
      b.y1 = Math.max(b.y1, y + 1);
      if (!oversized && ((b.x1 - b.x0) * model.mmPerPx > ATTACHED.maxW || (b.y1 - b.y0) * model.mmPerPx > ATTACHED.maxH)) {
        oversized = true;
        b.pixels = [];
      }
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (j >= 0 && !seen[j] && gray[j]! < DARK) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (!oversized && (b.y1 - b.y0) * model.mmPerPx >= GLYPH.minH && b.pixels.length * model.mmPerPx ** 2 >= GLYPH.minArea) {
      out.push(b);
      if (out.length > OCR_LIMITS.glyphs) throw new Error("ocr_glyph_limit");
    }
  }
  // A glyph touching a straight tick/leader: remove long horizontal/vertical runs and keep glyph-sized pieces.
  const glyphs = out.filter((b) => glyphSized(b, model.mmPerPx));
  const heights = glyphs.map((b) => (b.y1 - b.y0) * model.mmPerPx).sort((a, b) => a - b);
  const runMm = Math.max(2.4, 1.2 * (heights[Math.floor(heights.length / 2)] ?? 2.5));
  for (const b of out) {
    if (glyphSized(b, model.mmPerPx)) continue;
    for (const part of detachStrokes(b.pixels, width, model.mmPerPx, runMm)) {
      const piece = bounds(part, width);
      if (glyphSized(piece, model.mmPerPx)) glyphs.push(piece);
    }
    if (glyphs.length > OCR_LIMITS.glyphs) throw new Error("ocr_glyph_limit");
  }
  return glyphs;
}

/** Glyph-sized blobs, grouped when they sit side by side on one line (`12`, `1/4`). Thresholds are physical. */
export function labelGroups(model: PageModel, read: readonly TextBox[]): Blob[] {
  const mm = (v: number) => v * model.mmPerPx;
  const glyphs = blobs(model, read, Math.round(0.5 / model.mmPerPx));
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
      near.components = (near.components ?? 1) + 1;
    } else groups.push({ ...g, pixels: [...g.pixels], components: 1 });
  }
  if (groups.length > OCR_LIMITS.labelCalls) throw new Error("ocr_label_call_limit");
  return groups;
}

/**
 * Only the group's own pixels (plus their light anti-aliased rim, never another dark stroke), on white, scaled smoothly to a ~64 px
 * glyph with a margin of 60 % of its height: neighbouring strokes are not read.
 */
export function glyphImage(model: PageModel, g: Blob): { image: Buffer; scale: number } {
  const own = new Map(g.pixels.map((i) => [i, model.gray[i]!]));
  for (const i of g.pixels) {
    const x = i % model.width;
    for (const d of [-1, 1, -model.width, model.width, -model.width - 1, -model.width + 1, model.width - 1, model.width + 1]) {
      const j = i + d;
      if (j < 0 || j >= model.gray.length || Math.abs((j % model.width) - x) > 1 || own.has(j)) continue;
      if (model.gray[j]! >= DARK && model.gray[j]! < 235) own.set(j, model.gray[j]!);
    }
  }
  const scale = Math.max(1, Math.min(6, 64 / (g.y1 - g.y0)));
  const pad = Math.max(4, Math.round(0.6 * (g.y1 - g.y0)));
  const sw = g.x1 - g.x0 + 2 * pad;
  const sh = g.y1 - g.y0 + 2 * pad;
  const src = createCanvas(sw, sh);
  const sctx = src.getContext("2d");
  const img = sctx.createImageData(sw, sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const v = own.get((g.y0 - pad + y) * model.width + (g.x0 - pad + x)) ?? 255;
    const k = (y * sw + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
    img.data[k + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const W = Math.round(sw * scale);
  const H = Math.round(sh * scale);
  const dst = createCanvas(W, H);
  const ctx = dst.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, 0, 0, W, H);
  return { image: dst.toBuffer("image/png"), scale };
}

type TessData = Awaited<ReturnType<Worker["recognize"]>>["data"];
function words(data: TessData) {
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
}
function lines(data: TessData) {
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}
const symbolsOf = (data: TessData) => words(data).flatMap((w) => (w.symbols?.length ? w.symbols : [w]).map((s) => ({ text: s.text, confidence: s.confidence })));


export async function createOcr(dir = CACHE_DIR): Promise<OcrEngine> {
  assertModel(dir);
  const options = { langPath: path.resolve(dir), cachePath: path.resolve(dir), gzip: true, cacheMethod: "none", errorHandler: () => {} };
  const pageWorker = await createWorker("spa", 1, options);
  let labelWorker: Worker;
  try { labelWorker = await createWorker("spa", 1, options); }
  catch { await pageWorker.terminate(); throw new Error("ocr_initialization_failed"); }
  await pageWorker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  await labelWorker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/" });
  const bounded = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => {
        void Promise.allSettled([pageWorker.terminate(), labelWorker.terminate()]);
        reject(new Error("ocr_timeout"));
      }, ms); })]);
    } finally { clearTimeout(timer); }
  };
  return {
    async page(model, dpi) {
      assertRaster(model);
      await pageWorker.setParameters({ user_defined_dpi: String(dpi) });
      const { data } = await bounded(pageWorker.recognize(png(model.width, model.height, (i) => model.gray[i]!), { rotateAuto: true }, { blocks: true }), OCR_LIMITS.pageMs);
      // Tesseract rotated the image by `rad` about its centre before reading; undo it to land on the page as shown.
      const rad = data.rotateRadians ?? 0;
      const toWord = (text: string, box: Rect, confidence: number, line: number): OcrWord =>
        ({ text, ...rotateBox(model, box, -rad), upright: { ...box }, confidence, pass: "page", line });
      const read: OcrWord[] = [];
      lines(data).forEach((l, line) => {
        const all = l.words.filter((w) => w.text.trim() !== "").map((w) => toWord(w.text.trim(), w.bbox, w.confidence, line));
        read.push(...all.filter((w) => keepLowConfidenceWord(w, all)));
      });
      for (const w of loneLabelWords(read)) w.rerouted = true;
      return { words: read, skewDeg: (rad * 180) / Math.PI };
    },
    async labels(model, dpi, read) {
      assertRaster(model);
      const deadline = performance.now() + OCR_LIMITS.labelsMs;
      read.labelCalls = 0;
      const out: OcrWord[] = [];
      const rad = (read.skewDeg * Math.PI) / 180;
      // Rerouted lone page words are re-read here, so their ink is not excluded.
      const groups = labelGroups(model, read.words.filter((w) => !w.rerouted));
      const recognise = async (image: Buffer, psm: PSM) => {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error("ocr_timeout");
        read.labelCalls!++;
        await labelWorker.setParameters({ tessedit_pageseg_mode: psm });
        return (await bounded(labelWorker.recognize(image, {}, { blocks: true }), remaining)).data;
      };
      let line = -1;
      for (const [index, g] of groups.entries()) {
        const components = g.components ?? 1;
        // A single straight stroke (tick, ray, leader stub) is not a character.
        if (components === 1 && isStraightStroke(g.pixels, model.width, model.mmPerPx)) continue;
        const { image, scale } = glyphImage(model, g);
        await labelWorker.setParameters({ user_defined_dpi: String(Math.round(dpi * scale)) });
        const first = await recognise(image, PSM.SINGLE_WORD);
        let confidence = Math.min(...words(first).map((w) => w.confidence));
        let text = resolveGlyphReading(symbolsOf(first), components, LABEL_MIN_CONFIDENCE, confidence);
        // One component read as several letters: ask again as a single character, within the same call budget.
        // Fallback only while every remaining group still fits in the same 64-call budget.
        if (text === null && components === 1 && read.labelCalls! + (groups.length - index - 1) < OCR_LIMITS.labelCalls) {
          const again = await recognise(image, PSM.SINGLE_CHAR);
          confidence = Math.min(...words(again).map((w) => w.confidence));
          text = resolveGlyphReading(symbolsOf(again), 1, LABEL_MIN_CONFIDENCE, confidence);
        }
        if (text && isLabel(text)) out.push({ text, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, upright: rotateBox(model, g, rad), confidence, pass: "label", line: line-- });
      }
      // Page-level choices among readings: case by height, digit/letter by row, textures of identical marks dropped.
      const chosen = dropRepeatedMarks(digitLetterByRow(caseByHeight(out.map((w) => ({ ...w, h: (w.y1 - w.y0) * model.mmPerPx })))));
      return chosen.map((w) => { const { h, ...word } = w; void h; return word; });
    },
    async terminate() {
      await Promise.all([pageWorker.terminate(), labelWorker.terminate()]);
    },
  };
}
