import { DARK, px, textMask, type PageModel, type Rect } from "./page-model";

const STROKE = 110;

/**
 * Pixel signatures of the two simple mathematical figures this phase recognises. They read only the grey pixels of a region
 * (text removed) and return measurements, never a judgement about the task. Shared by the locator (is this region a number line?)
 * and the extractor (which ticks, which parts?).
 */

const dark = (model: PageModel, mask: Uint8Array, x: number, y: number) => {
  const i = y * model.width + x;
  return model.gray[i]! < DARK && !mask[i];
};

export interface NumberLineShape {
  /** Rows of the axis band (inclusive). */
  axis: { y0: number; y1: number; x0: number; x1: number };
  /** Centres of the ticks, left to right (px). */
  ticks: number[];
  tickHalfPx: number;
}

/** A long horizontal stroke crossed by at least three short vertical ones. Null when the region is not that. */
export function numberLineShape(model: PageModel, r: Rect, mask = textMask(model)): NumberLineShape | null {
  const x0 = Math.max(0, Math.floor(r.x0));
  const x1 = Math.min(model.width, Math.ceil(r.x1));
  const y0 = Math.max(0, Math.floor(r.y0));
  const y1 = Math.min(model.height, Math.ceil(r.y1));
  const w = x1 - x0;
  if (w < px(model, 20) || w < 3 * (y1 - y0) * 0.6) return null;
  const counts: number[] = [];
  for (let y = y0; y < y1; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) if (dark(model, mask, x, y)) n += 1;
    counts.push(n);
  }
  const best = Math.max(...counts);
  if (best < 0.6 * w) return null;
  const rows = counts.map((n, i) => (n >= 0.6 * w ? y0 + i : -1)).filter((y) => y >= 0);
  const axisY0 = rows[0]!;
  const axisY1 = rows.at(-1)!;
  if (axisY1 - axisY0 > px(model, 1.2)) return null;
  // Horizontal extent of the axis (its first and last dark pixel on the strongest row).
  const row = y0 + counts.indexOf(best);
  let ax0 = x1;
  let ax1 = x0;
  for (let x = x0; x < x1; x++) {
    if (!dark(model, mask, x, row)) continue;
    ax0 = Math.min(ax0, x);
    ax1 = Math.max(ax1, x);
  }

  const minExtent = px(model, 1.2);
  const extents: number[] = [];
  for (let x = x0; x < x1; x++) {
    let up = 0;
    for (let y = axisY0 - 1; y >= y0 && dark(model, mask, x, y); y--) up += 1;
    let down = 0;
    for (let y = axisY1 + 1; y < y1 && dark(model, mask, x, y); y++) down += 1;
    extents.push(up + down >= minExtent ? up + down : 0);
  }
  const ticks: number[] = [];
  const halves: number[] = [];
  for (let i = 0; i < extents.length; ) {
    if (extents[i]! === 0) {
      i += 1;
      continue;
    }
    let j = i;
    let longest = 0;
    while (j < extents.length && extents[j]! > 0) longest = Math.max(longest, extents[j++]!);
    // A tick is a thin stroke: a wide dark run crossing the axis is a fill or a drawing, not a tick.
    if (j - i <= px(model, 1.2)) {
      ticks.push(x0 + (i + j - 1) / 2);
      halves.push(longest / 2);
    }
    i = j;
  }
  if (ticks.length < 3) return null;
  return { axis: { y0: axisY0, y1: axisY1, x0: ax0, x1: ax1 }, ticks, tickHalfPx: halves.sort((a, b) => a - b)[Math.floor(halves.length / 2)]! };
}

export interface BarShape {
  outline: Rect;
  /** Inner dividers, left to right (px, centres). */
  dividers: number[];
  /** Centres of the left and right border strokes (parts are measured between stroke centres, like the dividers). */
  left: number;
  right: number;
}

/** A rectangle (closed outline) divided by vertical strokes. Null when the region is not that. */
export function barShape(model: PageModel, r: Rect, mask = textMask(model)): BarShape | null {
  const x0 = Math.max(0, Math.floor(r.x0));
  const x1 = Math.min(model.width, Math.ceil(r.x1));
  const y0 = Math.max(0, Math.floor(r.y0));
  const y1 = Math.min(model.height, Math.ceil(r.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < px(model, 15) || h < px(model, 3) || w < 1.5 * h) return null;
  const rowCoverage = (y: number) => {
    let n = 0;
    for (let x = x0; x < x1; x++) if (dark(model, mask, x, y)) n += 1;
    return n / w;
  };
  const colCoverage = (x: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) if (dark(model, mask, x, y)) n += 1;
    return n / h;
  };
  const edge = px(model, 0.8);
  const hasEdge = (from: number, to: number, cover: (i: number) => number) => {
    for (let i = from; i !== to; i += Math.sign(to - from)) if (cover(i) >= 0.85) return true;
    return false;
  };
  if (!hasEdge(y0, Math.min(y1, y0 + edge), rowCoverage) || !hasEdge(y1 - 1, Math.max(y0, y1 - 1 - edge), rowCoverage)) return null;
  if (!hasEdge(x0, Math.min(x1, x0 + edge), colCoverage) || !hasEdge(x1 - 1, Math.max(x0, x1 - 1 - edge), colCoverage)) return null;

  // Dividers: columns clearly darker than the columns a little to each side, over the interior rows (a stroke on a white part or
  // on a shaded one alike).
  const inset = Math.max(1, Math.round(h * 0.15));
  const mean = (x: number) => {
    let s = 0;
    for (let y = y0 + inset; y < y1 - inset; y++) s += model.gray[y * model.width + x]!;
    return s / Math.max(1, y1 - y0 - 2 * inset);
  };
  const profile = Array.from({ length: w }, (_, i) => mean(x0 + i));
  const side = Math.max(2, px(model, 0.8));
  const marks: number[] = [];
  for (let i = side; i < w - side; i++) {
    const v = profile[i]!;
    if (v < DARK && profile[i - side]! - v >= 40 && profile[i + side]! - v >= 40) marks.push(i);
  }
  const dividers: number[] = [];
  for (let k = 0; k < marks.length; ) {
    let j = k;
    while (j + 1 < marks.length && marks[j + 1]! - marks[j]! <= 1) j += 1;
    const centre = (marks[k]! + marks[j]!) / 2;
    if (centre > edge * 2 && centre < w - edge * 2) dividers.push(x0 + centre);
    k = j + 1;
  }
  if (dividers.length < 1) return null;
  // A border stroke is BLACK (a mid-grey fill next to it is not part of it).
  const stroke = (x: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) if (model.gray[y * model.width + x]! < STROKE && !mask[y * model.width + x]) n += 1;
    return n / h >= 0.85;
  };
  const strokeCentre = (from: number, dir: 1 | -1) => {
    let i = from;
    while (i >= x0 && i < x1 && !stroke(i)) i += dir;
    let j = i;
    while (j + dir >= x0 && j + dir < x1 && stroke(j + dir)) j += dir;
    return (i + j) / 2;
  };
  return { outline: { x0, y0, x1, y1 }, dividers, left: strokeCentre(x0, 1), right: strokeCentre(x1 - 1, -1) };
}
