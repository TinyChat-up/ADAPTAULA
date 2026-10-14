import { DARK, INK, area, gap, intersection, px, union, type PageModel, type Rect } from "./page-model";
import { ACCEPT, toBounds, type Evidence, type Located, type VisualTarget } from "./locate";
import { barShape } from "./shapes";

/**
 * Phase 8.2B.6 · a scanned page (no text layer: a PDF made of one image, or a photo upload) has no printed words to anchor a
 * figure to its activity, so `locateVisuals` can never place it (placement 0) and a generic figure stays far below the threshold.
 * This is a NARROW extension of that locator for one case only:
 *
 *   the analysis says the page holds exactly ONE visual of any kind, and it is the required one; and the pixels show exactly ONE
 *   drawing big enough to be a figure (≥ 15 × 15 mm, one connected stroke), which is not a frame, not a stain, not scanner border,
 *   not a row of very large letters; and no line of scanned text crosses the crop.
 *
 * Every condition is mandatory; failing any one leaves the visual unlocated (an honest stop, as before). Ambiguity is never broken
 * by size, position or a model: two drawings, or a drawing plus a large decoration, stop. Scores reuse the locator's table so the
 * confidence means the same thing: sole visual of the page 0.25 (it replaces the activity anchor), uniqueness 0.20, clean crop
 * 0.15 and, for the figure itself, a large connected drawing 0.15 (a bar that also reads as a bar: its signature, 0.30). A generic
 * figure that passes everything reaches exactly ACCEPT (0.75); nothing partial is ever accepted.
 */

export const SCAN_METHOD = "scan_single_region@v1";

/** Physical thresholds (millimetres or shares), part of the engine version like the locator's. */
export const SCAN = {
  /** A figure is at least this big in BOTH directions, as one connected stroke (text glyphs and labels never are). */
  figureMm: 15,
  /** Ink this close to the page edge is scanner border or a cut drawing: never a figure. */
  edgeMm: 2,
  /** Below this in both directions: dust. */
  speckMm: 0.8,
  /** Separate strokes of one drawing (a nucleus inside a membrane, a leader line) are joined within this gap. */
  joinMm: 4,
  /** Labels (the `1`, `2`, `3` of a scheme) within this distance belong to the figure's crop. */
  labelMm: 4,
  /** Text not taken by the crop keeps at least this distance from it (the crop recipe adds a ~2 mm margin). */
  clearanceMm: 2.5,
  /** A frame: its border band is inked along (almost) all four sides and little of it is inside (a text box, an answer box). */
  frameBandMm: 1.5,
  frameSides: 0.9,
  frameInterior: 0.2,
  /** Share of a drawing's ink that is really dark (a light stain or a shadow is not a figure). */
  darkShare: 0.3,
  /** Three or more figure-sized blobs in a row, of similar height: very large letters, not drawings. */
  glyphRow: 3,
  /** Share of the crop's ink that is lines of text: above it, the region is a text box, not a figure. */
  textShare: 0.5,
  /** The crop may not be most of the page. */
  pageShare: 0.5,
} as const;

const W = { sole: 0.25, drawing: 0.15, signature: 0.3, unique: 0.2, clean: 0.15 } as const;

export type ScanReason = "scan_has_text_layer" | "scan_not_sole_visual" | "scan_no_region" | "scan_ambiguous" | "scan_text_overlap" | "scan_text_region" | "scan_too_large" | "scan_signature_mismatch" | "scan_shape_unsupported";

export interface ScanSignals {
  method: typeof SCAN_METHOD;
  /** The analysis lists this visual, required, as the only visual of its page. */
  sole_visual: boolean;
  /** Figure-sized drawings found on the page (exactly 1 is required). */
  regions: number;
  frames: number;
  edge_artifacts: number;
  faint: number;
  large_glyphs: number;
  labels: number;
}

/** What the analysis says about the page, which only the caller knows. */
export interface ScanContext {
  /** Visuals of ANY role or kind that the analysis lists on this page. */
  visualsOnPage: number;
  /** The target is the essential (`required`) visual. */
  required: boolean;
}

interface Blob extends Rect {
  pixels: number;
  dark: number;
  /** Own pixels farther than the frame band from the blob's own box. */
  interior: number;
}

/** 8-connected ink regions at full resolution, with their box, size, dark share and how much of them lies inside their box. */
export function inkBlobs(model: PageModel): Blob[] {
  const { width, height, gray } = model;
  const label = new Int32Array(width * height).fill(-1);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < gray.length; start++) {
    if (gray[start]! >= INK || label[start] !== -1) continue;
    const id = blobs.length;
    const b: Blob = { x0: width, y0: height, x1: 0, y1: 0, pixels: 0, dark: 0, interior: 0 };
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      b.pixels += 1;
      if (gray[i]! < DARK) b.dark += 1;
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x + 1 > b.x1) b.x1 = x + 1;
      if (y + 1 > b.y1) b.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (label[n] === -1 && gray[n]! < INK) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    blobs.push(b);
  }
  const band = px(model, SCAN.frameBandMm);
  for (let i = 0; i < label.length; i++) {
    const id = label[i]!;
    if (id < 0) continue;
    const b = blobs[id]!;
    const x = i % width;
    const y = (i - x) / width;
    if (x - b.x0 >= band && b.x1 - 1 - x >= band && y - b.y0 >= band && b.y1 - 1 - y >= band) b.interior += 1;
  }
  return blobs;
}

const mm = (model: PageModel, n: number) => n * model.mmPerPx;

/** Rows of small blobs (letters, labels, rules): blobs that share a line and sit close, joined left to right. */
function rowsOf(model: PageModel, blobs: readonly Blob[]): Array<Rect & { members: Blob[]; ink: number }> {
  const sorted = [...blobs].sort((a, b) => a.x0 - b.x0);
  const rows: Array<Rect & { members: Blob[]; ink: number }> = [];
  const reach = px(model, 3);
  for (const b of sorted) {
    const h = b.y1 - b.y0;
    const row = rows.find((r) => Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0) >= 0.5 * Math.min(h, r.y1 - r.y0) && b.x0 - r.x1 <= reach);
    if (row) {
      Object.assign(row, union(row, b));
      row.members.push(b);
      row.ink += b.pixels;
    } else rows.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, members: [b], ink: b.pixels });
  }
  return rows;
}

/**
 * A closed rectangle around the blob: near each side of its box (within the outer fifth) there is a straight inked line covering
 * almost that whole side, and little of the blob is inside. A text box or an answer box, not a drawing (a glyph touching the
 * border does not hide the rectangle).
 */
function isFrame(model: PageModel, b: Blob): boolean {
  if (b.interior >= SCAN.frameInterior * b.pixels) return false;
  const band = px(model, SCAN.frameBandMm);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const ink = (x: number, y: number) => model.gray[y * model.width + x]! < INK;
  /** Best coverage of a horizontal line (`horizontal`) or vertical one, starting within the given offsets of the box. */
  const best = (horizontal: boolean, starts: number[]) => {
    let top = 0;
    for (const s of starts) {
      let n = 0;
      const length = horizontal ? w : h;
      for (let i = 0; i < length; i++) {
        let hit = false;
        for (let d = 0; d < band && !hit; d++) hit = horizontal ? ink(b.x0 + i, Math.min(b.y1 - 1, s + d)) : ink(Math.min(b.x1 - 1, s + d), b.y0 + i);
        if (hit) n += 1;
      }
      top = Math.max(top, n / Math.max(1, length));
    }
    return top;
  };
  const range = (from: number, count: number) => Array.from({ length: Math.max(1, count) }, (_, i) => from + i);
  return (
    best(true, range(b.y0, Math.ceil(0.2 * h))) >= SCAN.frameSides &&
    best(true, range(b.y1 - Math.ceil(0.2 * h), Math.ceil(0.2 * h))) >= SCAN.frameSides &&
    best(false, range(b.x0, Math.ceil(0.2 * w))) >= SCAN.frameSides &&
    best(false, range(b.x1 - Math.ceil(0.2 * w), Math.ceil(0.2 * w))) >= SCAN.frameSides
  );
}

const inside = (r: Rect, outer: Rect) => r.x0 >= outer.x0 && r.y0 >= outer.y0 && r.x1 <= outer.x1 && r.y1 <= outer.y1;
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

/**
 * The single figure of a scanned page, or why there is none. Pure and deterministic over the page's grey pixels; the analysis
 * contributes only how many visuals it saw on the page and which one is required (never a position: it has none).
 */
export function locateOnScan(model: PageModel, target: VisualTarget, context: ScanContext): Located {
  const signals: ScanSignals = { method: SCAN_METHOD, sole_visual: context.visualsOnPage === 1 && context.required, regions: 0, frames: 0, edge_artifacts: 0, faint: 0, large_glyphs: 0, labels: 0 };
  const result = (reason: ScanReason, extra: Partial<Pick<Evidence, "signature" | "unique" | "clean">> = {}, confidence = 0, crop: Rect | null = null): Located => ({
    visualId: target.id,
    bounds: crop ? toBounds(model, crop) : null,
    confidence: Math.round(confidence * 1000) / 1000,
    accepted: crop !== null,
    evidence: { shape: target.shape, signature: extra.signature ?? false, placement: false, unique: extra.unique ?? false, clean: extra.clean ?? false, anchor: null, vision: { used: false, agrees: false, confidence: null, iou: null }, scan: signals, reason: crop ? "accepted" : reason },
  });
  if (model.texts.length > 0) return result("scan_has_text_layer");
  if (!signals.sole_visual) return result("scan_not_sole_visual");
  if (target.shape === "number_line") return result("scan_shape_unsupported");

  const edge = px(model, SCAN.edgeMm);
  const large: Blob[] = [];
  const small: Blob[] = [];
  for (const b of inkBlobs(model)) {
    const w = mm(model, b.x1 - b.x0);
    const h = mm(model, b.y1 - b.y0);
    if (w < SCAN.speckMm && h < SCAN.speckMm) continue;
    if (b.x0 <= edge || b.y0 <= edge || b.x1 >= model.width - edge || b.y1 >= model.height - edge) {
      signals.edge_artifacts += 1;
      continue;
    }
    if (w < SCAN.figureMm || h < SCAN.figureMm) {
      small.push(b);
      continue;
    }
    if (isFrame(model, b)) signals.frames += 1;
    else if (b.dark < SCAN.darkShare * b.pixels) signals.faint += 1;
    else large.push(b);
  }

  // Very large letters: a figure-sized blob in a line of three or more blobs of the same height, side by side (a headline).
  const glyphs = new Set<Blob>();
  const lettersLike = [...large, ...small];
  for (const b of large) {
    const h = b.y1 - b.y0;
    const peers = lettersLike
      .filter((o) => {
        const oh = o.y1 - o.y0;
        return Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) >= 0.7 * Math.min(h, oh) && Math.max(h, oh) <= 1.3 * Math.min(h, oh);
      })
      .sort((a, c) => a.x0 - c.x0);
    // The chain of peers that reaches `b`, each within 0.8 × its height of the next.
    const at = peers.indexOf(b);
    let lo = at;
    let hi = at;
    while (lo > 0 && peers[lo]!.x0 - peers[lo - 1]!.x1 <= 0.8 * h) lo -= 1;
    while (hi < peers.length - 1 && peers[hi + 1]!.x0 - peers[hi]!.x1 <= 0.8 * h) hi += 1;
    if (hi - lo + 1 >= SCAN.glyphRow) glyphs.add(b);
  }
  signals.large_glyphs = glyphs.size;

  // Drawings: the remaining figure-sized blobs, joined when they are parts of one drawing.
  const join = px(model, SCAN.joinMm);
  const regions: Rect[] = [];
  for (const b of large.filter((x) => !glyphs.has(x))) {
    const near = regions.find((r) => gap(r, b) <= join);
    if (near) Object.assign(near, union(near, b));
    else regions.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  }
  signals.regions = regions.length;
  // A stain or a frame-sized faint shape is unexplained ink: never decided in favour of the drawing.
  if (regions.length === 0) return result("scan_no_region");
  if (regions.length > 1 || signals.faint > 0) return result("scan_ambiguous");

  const region = regions[0]!;
  // Its own parts (the nucleus, the dots, a leader line) and the labels next to it, never a line of text that runs past it.
  let crop: Rect = region;
  const loose = small.filter((b) => !inside(b, region));
  const rows = rowsOf(model, loose);
  const taken = new Set<(typeof rows)[number]>();
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rows) {
      if (taken.has(r) || !inside(r, grow(crop, px(model, SCAN.labelMm)))) continue;
      taken.add(r);
      crop = union(crop, r);
    }
  }
  signals.labels = [...taken].reduce((n, r) => n + r.members.length, 0);

  const clearance = px(model, SCAN.clearanceMm);
  if (rows.some((r) => !taken.has(r) && gap(r, crop) < clearance && area(intersection(grow(r, clearance), crop)) > 0)) return result("scan_text_overlap");
  // A box made mostly of lines of words is a text box, whatever its border.
  const textInk = rowsOf(model, small.filter((b) => inside(b, crop)))
    .filter((r) => r.members.length >= 5 && mm(model, r.x1 - r.x0) >= 25)
    .reduce((n, r) => n + r.ink, 0);
  const allInk = [...large, ...small].filter((b) => inside(b, crop)).reduce((n, b) => n + b.pixels, 0);
  if (allInk > 0 && textInk > SCAN.textShare * allInk) return result("scan_text_region");
  if (area(crop) > SCAN.pageShare * model.width * model.height) return result("scan_too_large");

  let score = W.sole + W.unique + W.clean;
  let signature = false;
  if (target.shape === "bar") {
    if (!barShape(model, region, new Uint8Array(model.width * model.height))) return result("scan_signature_mismatch", { unique: true, clean: true });
    signature = true;
    score += W.signature;
  } else score += W.drawing;
  score = Math.round(score * 1000) / 1000;
  return score >= ACCEPT ? result("scan_no_region", { signature, unique: true, clean: true }, Math.min(1, score), crop) : result("scan_no_region");
}
