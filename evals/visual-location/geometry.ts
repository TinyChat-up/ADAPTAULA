import type { PageModel, Rect } from "@/lib/materials/visuals/auto/page-model";

/**
 * Phase II geometric recovery of figures (prototype, NOT wired to production). Pure functions over a page's pixels and its OCR
 * boxes. Nothing here approves a crop: semantic identity, complete content and visual-answer safety stay unverifiable.
 */

/** Rotates a box about the page centre by `rad` (y down) and returns its axis-aligned bounds. */
export function rotateRect(model: Pick<PageModel, "width" | "height">, r: Rect, rad: number): Rect {
  const cx = model.width / 2;
  const cy = model.height / 2;
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => [cx + (x! - cx) * Math.cos(rad) - (y! - cy) * Math.sin(rad), cy + (x! - cx) * Math.sin(rad) + (y! - cy) * Math.cos(rad)] as const);
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

/**
 * The page in the OCR's deskewed frame: the grey image rotated by `rad` about its centre (bilinear, white outside), so that zones,
 * candidates and text boxes share one frame. Regions found here go back to the original with `rotateRect(model, r, -rad)`.
 * The source pixels are never modified.
 */
export function deskew(model: PageModel, rad: number): PageModel {
  if (Math.abs(rad) < 1e-4) return { ...model, gray: model.gray.slice() };
  const { width: w, height: h, gray } = model;
  const out = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2, cos = Math.cos(rad), sin = Math.sin(rad);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Upright pixel u → page pixel p = R(-rad)(u - c) + c.
      const dx = x - cx, dy = y - cy;
      const px = cx + dx * cos + dy * sin;
      const py = cy - dx * sin + dy * cos;
      const x0 = Math.floor(px), y0 = Math.floor(py);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) { out[y * w + x] = 255; continue; }
      const fx = px - x0, fy = py - y0, i = y0 * w + x0;
      out[y * w + x] = Math.round(gray[i]! * (1 - fx) * (1 - fy) + gray[i + 1]! * fx * (1 - fy) + gray[i + w]! * (1 - fx) * fy + gray[i + w + 1]! * fx * fy);
    }
  }
  return { ...model, gray: out };
}

/**
 * Paper normalisation for grey paper and faint photocopies: the paper level (median grey) is shifted to white, ink keeps its
 * distance from the paper. Grain below the paper level by less than `INK` margin stays paper; nothing is sharpened or invented.
 */
export function normalizePaper(model: PageModel): PageModel {
  const hist = new Uint32Array(256);
  for (let i = 0; i < model.gray.length; i++) hist[model.gray[i]!]!++;
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= model.gray.length / 2) { paper = v; break; } }
  const shift = 255 - paper;
  if (shift <= 0) return model;
  const out = new Uint8Array(model.gray.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, model.gray[i]! + shift);
  return { ...model, gray: out };
}

const DARK_STROKE = 160;
type Px = { model: PageModel; mask: Uint8Array };
const darkAt = ({ model, mask }: Px, x: number, y: number) => { const i = y * model.width + x; return model.gray[i]! < DARK_STROKE && !mask[i]; };
const clampRect = (model: PageModel, r: Rect) => ({ x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(model.width, Math.ceil(r.x1)), y1: Math.min(model.height, Math.ceil(r.y1)) });
const pxOf = (model: PageModel, mm: number) => Math.max(1, Math.round(mm / model.mmPerPx));

/** Coverage of dark (non-text) pixels along a row or a column of a rectangle. */
function coverage(p: Px, r: Rect) {
  const { x0, y0, x1, y1 } = clampRect(p.model, r);
  return {
    row: (y: number) => { let n = 0; for (let x = x0; x < x1; x++) if (darkAt(p, x, y)) n++; return n / Math.max(1, x1 - x0); },
    col: (x: number) => { let n = 0; for (let y = y0; y < y1; y++) if (darkAt(p, x, y)) n++; return n / Math.max(1, y1 - y0); },
    x0, y0, x1, y1,
  };
}

/**
 * The closed rectangle inside a region: the outermost rows/columns with ≥ 85 % dark coverage, searched in the outer 25 % of the
 * region (a speck or a label beside the outline must not move the border). Null when no closed outline exists.
 */
export function outline(model: PageModel, mask: Uint8Array, r: Rect): Rect | null {
  const c = coverage({ model, mask }, r);
  const h = c.y1 - c.y0, w = c.x1 - c.x0;
  if (w < 4 || h < 4) return null;
  const find = (from: number, to: number, cover: (i: number) => number) => {
    for (let i = from; i !== to; i += Math.sign(to - from)) if (cover(i) >= 0.85) return i;
    return null;
  };
  const top = find(c.y0, c.y0 + Math.ceil(h / 4), c.row);
  const bottom = find(c.y1 - 1, c.y1 - 1 - Math.ceil(h / 4), c.row);
  if (top === null || bottom === null || bottom - top < 4) return null;
  const inner = coverage({ model, mask }, { x0: c.x0, y0: top, x1: c.x1, y1: bottom + 1 });
  const left = find(c.x0, c.x0 + Math.ceil(w / 4), inner.col);
  const right = find(c.x1 - 1, c.x1 - 1 - Math.ceil(w / 4), inner.col);
  if (left === null || right === null || right - left < 4) return null;
  return { x0: left, y0: top, x1: right + 1, y1: bottom + 1 };
}

export interface BarSignature { outline: Rect; parts: number }

/**
 * A fraction bar: one closed rectangle, wider than tall, with no inner horizontal rule (a table has them), split by vertical
 * dividers that are either dark strokes or light gaps between shaded parts, into roughly equal parts. Says nothing about
 * which parts are shaded or whether that is the right fraction.
 */
export function barSignature(model: PageModel, mask: Uint8Array, r: Rect): BarSignature | null {
  const o = outline(model, mask, r);
  if (!o) return null;
  const w = o.x1 - o.x0, h = o.y1 - o.y0;
  if (w < pxOf(model, 15) || h < pxOf(model, 3) || w < 1.5 * h) return null;
  const c = coverage({ model, mask }, o);
  const edge = pxOf(model, 1.2);
  for (let y = o.y0 + edge; y < o.y1 - edge; y++) if (c.row(y) >= 0.85) return null; // inner horizontal rule: a table
  const inset = Math.max(1, Math.round(h * 0.15));
  const profile = Array.from({ length: w }, (_, i) => {
    let s = 0;
    for (let y = o.y0 + inset; y < o.y1 - inset; y++) s += model.gray[y * model.width + o.x0 + i]!;
    return s / Math.max(1, h - 2 * inset);
  });
  const side = Math.max(2, pxOf(model, 0.8));
  const marks: number[] = [];
  for (let i = side; i < w - side; i++) {
    const v = profile[i]!;
    const valley = profile[i - side]! - v >= 40 && profile[i + side]! - v >= 40 && v < DARK_STROKE;
    const ridge = v - profile[i - side]! >= 40 && v - profile[i + side]! >= 40; // a light gap between two shaded parts
    if (valley || ridge) marks.push(i);
  }
  const dividers: number[] = [];
  for (let k = 0; k < marks.length; ) {
    let j = k;
    while (j + 1 < marks.length && marks[j + 1]! - marks[j]! <= 1) j++;
    const centre = (marks[k]! + marks[j]!) / 2;
    if (centre > 2 * edge && centre < w - 2 * edge) dividers.push(centre);
    k = j + 1;
  }
  if (dividers.length < 1) return null;
  const cuts = [0, ...dividers, w];
  const parts = cuts.slice(1).map((x, i) => x - cuts[i]!);
  const mean = w / parts.length;
  if (parts.some((p) => Math.abs(p - mean) > 0.35 * mean)) return null; // unequal parts: not a fraction bar
  return { outline: o, parts: parts.length };
}

/** A number line: a long thin horizontal axis crossed by ≥ 3 short ticks, and not a closed rectangle (a bar). */
export function numberLineSignature(model: PageModel, mask: Uint8Array, r: Rect): { axisY: number; ticks: number } | null {
  if (barSignature(model, mask, r)) return null;
  const c = coverage({ model, mask }, r);
  const w = c.x1 - c.x0;
  if (w < pxOf(model, 20)) return null;
  let best = -1, axisY = -1;
  for (let y = c.y0; y < c.y1; y++) { const v = c.row(y); if (v > best) { best = v; axisY = y; } }
  if (best < 0.6) return null;
  const rows: number[] = [];
  for (let y = c.y0; y < c.y1; y++) if (c.row(y) >= 0.6) rows.push(y);
  if (rows.at(-1)! - rows[0]! > pxOf(model, 1.5)) return null; // a thick band or two long rules: not one axis
  const reach = pxOf(model, 1.2);
  let ticks = 0, run = 0;
  for (let x = c.x0; x <= c.x1; x++) {
    let up = 0, down = 0;
    if (x < c.x1) {
      for (let y = rows[0]! - 1; y >= c.y0 && darkAt({ model, mask }, x, y); y--) up++;
      for (let y = rows.at(-1)! + 1; y < c.y1 && darkAt({ model, mask }, x, y); y++) down++;
    }
    if (x < c.x1 && up + down >= reach) run++;
    else { if (run > 0 && run <= pxOf(model, 1.5)) ticks++; run = 0; }
  }
  return ticks >= 3 ? { axisY, ticks } : null;
}

/** Convex hull (monotone chain) of a component's ink, sampled at the leftmost/rightmost dark pixel of each row. */
function hull(p: Px, r: Rect): Array<[number, number]> {
  const { x0, y0, x1, y1 } = clampRect(p.model, r);
  const pts: Array<[number, number]> = [];
  for (let y = y0; y < y1; y++) {
    let a = -1, b = -1;
    for (let x = x0; x < x1; x++) if (darkAt(p, x, y)) { if (a < 0) a = x; b = x; }
    if (a >= 0) { pts.push([a, y]); if (b !== a) pts.push([b, y]); }
  }
  pts.sort((m, n) => m[0] - n[0] || m[1] - n[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const q of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  const upper: Array<[number, number]> = [];
  for (const q of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Corners of a convex outline: hull vertices whose turn exceeds 30° after merging points closer than `minMm`. */
export function polygonCorners(model: PageModel, mask: Uint8Array, r: Rect, minMm = 3): number {
  const h = hull({ model, mask }, r);
  if (h.length < 3) return 0;
  const min = minMm / model.mmPerPx;
  const merged: Array<[number, number]> = [];
  for (const q of h) { const last = merged[merged.length - 1]; if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= min) merged.push(q); }
  if (merged.length > 2 && Math.hypot(merged[0]![0] - merged.at(-1)![0], merged[0]![1] - merged.at(-1)![1]) < min) merged.pop();
  let corners = 0;
  for (let i = 0; i < merged.length; i++) {
    const a = merged[(i + merged.length - 1) % merged.length]!, b = merged[i]!, c = merged[(i + 1) % merged.length]!;
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let turn = Math.abs(t2 - t1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > Math.PI / 6) corners++;
  }
  return corners;
}

/** A round dial: the ink's convex hull is a circle (radii within 6 % of their mean) and there is ink near its centre (hands). */
export function dialSignature(model: PageModel, mask: Uint8Array, r: Rect): boolean {
  const h = hull({ model, mask }, r);
  if (h.length < 12) return false;
  const cx = h.reduce((s, q) => s + q[0], 0) / h.length, cy = h.reduce((s, q) => s + q[1], 0) / h.length;
  const radii = h.map((q) => Math.hypot(q[0] - cx, q[1] - cy));
  const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
  if (mean * model.mmPerPx < 10 || radii.some((v) => Math.abs(v - mean) > 0.06 * mean)) return false;
  const core = pxOf(model, 4);
  let ink = 0;
  for (let y = Math.round(cy - core); y < cy + core; y++) for (let x = Math.round(cx - core); x < cx + core; x++) if (x >= 0 && y >= 0 && x < model.width && y < model.height && darkAt({ model, mask }, x, y)) ink++;
  return ink >= 0.03 * (2 * core) ** 2; // hands or hub: a few % of the central 8 mm square; an empty ring has none
}

/** A grid (a plan, a table of cells): at least three long horizontal and three long vertical rules inside the outline. */
export function gridSignature(model: PageModel, mask: Uint8Array, r: Rect): boolean {
  const o = outline(model, mask, r);
  if (!o) return false;
  const c = coverage({ model, mask }, o);
  const count = (from: number, to: number, cover: (i: number) => number) => {
    let n = 0, inRun = false;
    for (let i = from; i < to; i++) { const on = cover(i) >= 0.85; if (on && !inRun) n++; inRun = on; }
    return n;
  };
  return count(o.y0, o.y1, c.row) >= 3 && count(o.x0, o.x1, c.col) >= 3;
}
