/**
 * The page as the automatic locator reads it: grey pixels of the page AS SHOWN (the locator's surface, `geometry.ts`) and the
 * printed text boxes of the PDF on that same surface. Pure functions over arrays: no rasteriser, no provider, deterministic.
 *
 * What is "ink" and what is text is decided here, never by a model: text boxes come from the PDF's own text layer, so a figure is
 * what remains when they are removed (lines, fills, drawings, images). An uploaded image has no text layer: everything is ink.
 */

export interface TextBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageModel {
  width: number;
  height: number;
  /** Luma 0–255, row-major. */
  gray: Uint8Array;
  texts: TextBox[];
  /** Millimetres per pixel of this raster (thresholds are physical, not pixel counts). */
  mmPerPx: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const INK = 225;
export const DARK = 160;

export const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
export const union = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const intersection = (a: Rect, b: Rect): Rect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
export const iou = (a: Rect, b: Rect) => {
  const i = area(intersection(a, b));
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
};
export const gap = (a: Rect, b: Rect) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
export const px = (model: PageModel, mm: number) => Math.max(1, Math.round(mm / model.mmPerPx));

/** RGBA → luma (Rec. 601), the same grey the thresholds were chosen on. */
export function lumaOf(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
  return out;
}

/** Text boxes in normalised page coordinates → pixels of a raster of that page. */
export const textBoxesToPx = (boxes: ReadonlyArray<{ text: string; x: number; y: number; w: number; h: number }>, width: number, height: number): TextBox[] =>
  boxes.map((b) => ({ text: b.text, x0: b.x * width, y0: b.y * height, x1: (b.x + b.w) * width, y1: (b.y + b.h) * height }));

/** A mask of the pixels covered by text (each box grown by `pad` px), so a figure is what remains. */
export function textMask(model: PageModel, pad = 1): Uint8Array {
  const mask = new Uint8Array(model.width * model.height);
  for (const t of model.texts) {
    const x0 = Math.max(0, Math.floor(t.x0) - pad);
    const x1 = Math.min(model.width - 1, Math.ceil(t.x1) + pad);
    const y0 = Math.max(0, Math.floor(t.y0) - pad);
    const y1 = Math.min(model.height - 1, Math.ceil(t.y1) + pad);
    for (let y = y0; y <= y1; y++) mask.fill(1, y * model.width + x0, y * model.width + x1 + 1);
  }
  return mask;
}

export interface TextLine extends Rect {
  text: string;
}

/** Text boxes → reading lines (boxes that share most of their height), top to bottom, left to right. */
export function textLines(texts: readonly TextBox[]): TextLine[] {
  const sorted = [...texts].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const lines: Array<TextLine & { boxes: TextBox[] }> = [];
  for (const box of sorted) {
    const h = box.y1 - box.y0;
    const line = lines.find((l) => Math.min(l.y1, box.y1) - Math.max(l.y0, box.y0) >= 0.5 * Math.min(h, l.y1 - l.y0));
    if (line) {
      line.boxes.push(box);
      Object.assign(line, union(line, box));
    } else lines.push({ ...box, boxes: [box] });
  }
  return lines
    .map((l) => ({ x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, text: l.boxes.sort((a, b) => a.x0 - b.x0).map((b) => b.text).join(" ").replace(/\s+/g, " ").trim() }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/**
 * Reading lines cut where the gap between two consecutive words is wider than `gapMm`: text printed side by side in different
 * columns (two instructions, a figure's letter and an answer field) is not one line.
 */
export function textSegments(model: Pick<PageModel, "texts" | "mmPerPx">, gapMm = 6): TextLine[] {
  const gapPx = gapMm / model.mmPerPx;
  return textLines(model.texts).flatMap((line) => {
    const boxes = model.texts
      .filter((b) => b.x0 >= line.x0 - 0.5 && b.x1 <= line.x1 + 0.5 && Math.min(line.y1, b.y1) - Math.max(line.y0, b.y0) >= 0.5 * Math.min(b.y1 - b.y0, line.y1 - line.y0))
      .sort((a, b) => a.x0 - b.x0);
    const out: TextBox[][] = [];
    for (const b of boxes) {
      const last = out.at(-1);
      if (last && b.x0 - Math.max(...last.map((x) => x.x1)) <= gapPx) last.push(b);
      else out.push([b]);
    }
    return out.map((g) => ({ x0: Math.min(...g.map((b) => b.x0)), y0: Math.min(...g.map((b) => b.y0)), x1: Math.max(...g.map((b) => b.x1)), y1: Math.max(...g.map((b) => b.y1)), text: g.map((b) => b.text).join(" ").replace(/\s+/g, " ").trim() }));
  }).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** A printed label of a figure (`0`, `1/4`, `A`), as opposed to running text. */
export const isLabel = (text: string) => /^\s*([0-9]{1,3}(\s*\/\s*[0-9]{1,3})?|[A-Za-z])\s*$/.test(text);
/** A line made only of labels (the row `0 1/4 1/2 3/4 1` under a number line). */
export const isLabelLine = (text: string) => text.trim().split(/\s+/).every(isLabel);

export interface Component extends Rect {
  inkPx: number;
}

/**
 * Connected regions of non-text ink on a grid of ~1 mm cells, with gaps of up to `linkMm` bridged (the strokes of one drawing).
 * Returns tight pixel boxes.
 */
export function components(model: PageModel, mask = textMask(model), linkMm = 1.5): Component[] {
  const cell = px(model, 1);
  const cols = Math.ceil(model.width / cell);
  const rows = Math.ceil(model.height / cell);
  const on = new Uint8Array(cols * rows);
  const ink = new Uint32Array(cols * rows);
  for (let y = 0; y < model.height; y++) {
    for (let x = 0; x < model.width; x++) {
      const i = y * model.width + x;
      if (model.gray[i]! < INK && !mask[i]) {
        const c = Math.floor(y / cell) * cols + Math.floor(x / cell);
        on[c] = 1;
        ink[c]! += 1;
      }
    }
  }
  const reach = Math.max(1, Math.round(linkMm));
  const seen = new Uint8Array(cols * rows);
  const out: Component[] = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let cx0 = cols;
    let cy0 = rows;
    let cx1 = 0;
    let cy1 = 0;
    let inkPx = 0;
    while (queue.length > 0) {
      const c = queue.pop()!;
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      cx0 = Math.min(cx0, cx);
      cy0 = Math.min(cy0, cy);
      cx1 = Math.max(cx1, cx);
      cy1 = Math.max(cy1, cy);
      inkPx += ink[c]!;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (on[n] && !seen[n]) {
            seen[n] = 1;
            queue.push(n);
          }
        }
      }
    }
    out.push(tighten(model, mask, { x0: cx0 * cell, y0: cy0 * cell, x1: Math.min(model.width, (cx1 + 1) * cell), y1: Math.min(model.height, (cy1 + 1) * cell) }, inkPx));
  }
  return out;
}

/** The exact pixel box of the ink inside a cell box. */
function tighten(model: PageModel, mask: Uint8Array, r: Rect, inkPx: number): Component {
  let x0 = r.x1;
  let y0 = r.y1;
  let x1 = r.x0;
  let y1 = r.y0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = y * model.width + x;
      if (model.gray[i]! < INK && !mask[i]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  }
  return x1 > x0 ? { x0, y0, x1, y1, inkPx } : { ...r, inkPx };
}

/** Fraction of the region's pixels that are ink (text excluded). */
export function inkFraction(model: PageModel, r: Rect, mask?: Uint8Array): number {
  let ink = 0;
  let total = 0;
  for (let y = Math.max(0, Math.floor(r.y0)); y < Math.min(model.height, Math.ceil(r.y1)); y++) {
    for (let x = Math.max(0, Math.floor(r.x0)); x < Math.min(model.width, Math.ceil(r.x1)); x++) {
      total += 1;
      const i = y * model.width + x;
      if (model.gray[i]! < INK && !(mask && mask[i])) ink += 1;
    }
  }
  return total > 0 ? ink / total : 0;
}
