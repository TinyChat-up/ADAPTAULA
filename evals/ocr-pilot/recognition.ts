import { isLabel, type TextBox, type TextLine } from "@/lib/materials/visuals/auto/page-model";

/**
 * Phase I recognition rules of the OCR pilot (pure, no Tesseract). Each one addresses a class of errors seen on our own synthetic
 * sheets, with physical or typographic criteria rather than per-sheet constants. References are never an input: they only score.
 */

export interface LineWord extends TextBox {
  /** Tesseract line this word came from (block/paragraph/line flattened); label-pass words get their own line. */
  line: number;
  confidence: number;
}

/** Words whose OCR confidence is below this need line context to be kept. */
export const PAGE_MIN_CONFIDENCE = 40;
const CONFIDENT = 85;
const WORDLIKE = /^[¿¡«"(]?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}[.,;:?!»")]*$/u;

/**
 * Tesseract dropped to confidence 0–39 some correctly read words at the start of an instruction ("Observa el", "¿Cuántos"). Keep a
 * low-confidence token only when it looks like a word and at least three other words of the SAME Tesseract line are confident.
 */
export function keepLowConfidenceWord(w: LineWord, lineWords: readonly LineWord[]): boolean {
  if (w.confidence >= PAGE_MIN_CONFIDENCE) return true;
  if (!WORDLIKE.test(w.text)) return false;
  return lineWords.filter((o) => o !== w && o.line === w.line && o.confidence >= CONFIDENT).length >= 3;
}

/**
 * Reading lines from Tesseract's own line structure instead of regrouping every word on the page by height (which merged two
 * columns into one line). A gap wider than 2.5 line heights (and ≥ 8 mm) inside one Tesseract line also starts a new segment.
 */
export function ocrLines(words: readonly LineWord[], mmPerPx: number): TextLine[] {
  const byLine = new Map<number, LineWord[]>();
  for (const w of words) (byLine.get(w.line) ?? byLine.set(w.line, []).get(w.line)!).push(w);
  const out: TextLine[] = [];
  for (const group of byLine.values()) {
    const sorted = [...group].sort((a, b) => a.x0 - b.x0);
    const heights = sorted.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
    const h = heights[Math.floor(heights.length / 2)] ?? 0;
    const split = Math.max(2.5 * h, 8 / mmPerPx);
    let current: LineWord[] = [];
    const flush = () => {
      if (!current.length) return;
      out.push({
        x0: Math.min(...current.map((w) => w.x0)), y0: Math.min(...current.map((w) => w.y0)),
        x1: Math.max(...current.map((w) => w.x1)), y1: Math.max(...current.map((w) => w.y1)),
        text: current.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim(),
      });
      current = [];
    };
    for (const w of sorted) {
      const last = current[current.length - 1];
      if (last && w.x0 - last.x1 > split) flush();
      current.push(w);
    }
    flush();
  }
  return readingOrder(out);
}

/**
 * Row-major reading order over line segments: segments that share most of their height form a row, read left to right. Columns
 * stay separate segments (for anchors), while the page text keeps the familiar top-to-bottom, left-to-right order.
 */
export function readingOrder<T extends TextLine>(segments: readonly T[]): T[] {
  const rows: Array<{ y0: number; y1: number; items: T[] }> = [];
  for (const s of [...segments].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const h = s.y1 - s.y0;
    const row = rows.find((r) => Math.min(r.y1, s.y1) - Math.max(r.y0, s.y0) >= 0.5 * Math.min(h, r.y1 - r.y0));
    if (row) { row.items.push(s); row.y0 = Math.min(row.y0, s.y0); row.y1 = Math.max(row.y1, s.y1); }
    else rows.push({ y0: s.y0, y1: s.y1, items: [s] });
  }
  return rows.sort((a, b) => a.y0 - b.y0).flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));
}


/**
 * The reading of one label group. A single connected component is one character: several different letters from it ("Los" from a
 * C) are a language-model guess and are rejected; case variants of one letter ("Cc") collapse to the most confident one.
 */
export function resolveGlyphReading(symbols: ReadonlyArray<{ text: string; confidence: number }>, components: number, minConfidence = 50, wordConfidence = 100): string | null {
  const parts = symbols.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
  // Both levels must be confident: a high symbol score inside a word Tesseract itself doubts (confidence 9) is not evidence.
  if (!parts.length || wordConfidence < minConfidence || Math.min(...parts.map((s) => s.confidence)) < minConfidence) return null;
  if (components > 1) return parts.map((s) => s.text).join("");
  if (new Set(parts.map((s) => s.text.toLowerCase())).size !== 1) return null;
  return [...parts].sort((a, b) => b.confidence - a.confidence)[0]!.text;
}

/** Letters whose lower case is a scaled copy of the capital: only their height says which one was printed. */
const SAME_SHAPE = new Set(["c", "o", "s", "u", "v", "w", "x", "z"]);

/**
 * Case of shape-ambiguous single letters, from the height of the other capitals/digits read on the same page (lower case is about
 * 70 % of a capital). Without such a reference nothing changes.
 */
export function caseByHeight<T extends { text: string; h: number }>(labels: readonly T[]): T[] {
  const ref = labels.filter((l) => /^[A-Z0-9]+$/.test(l.text) && !SAME_SHAPE.has(l.text.toLowerCase())).map((l) => l.h).sort((a, b) => a - b);
  if (!ref.length) return [...labels];
  const capital = ref[Math.floor(ref.length / 2)]!;
  return labels.map((l) => (SAME_SHAPE.has(l.text) && l.h >= 0.8 * capital ? { ...l, text: l.text.toUpperCase() } : l));
}

/**
 * One straight thin stroke (a clock tick, a sun ray, a leader stub) is not a character. Measured on the component's pixels: all
 * of them within 0.6 mm (and 15 % of its length) of its principal axis. A plain «I» or «l» is also a straight stroke and is
 * therefore not accepted as a label: a missed label is preferred to an invented one.
 */
export function isStraightStroke(pixels: readonly number[], width: number, mmPerPx: number): boolean {
  if (pixels.length < 3) return false;
  let mx = 0;
  let my = 0;
  for (const i of pixels) { mx += i % width; my += Math.floor(i / width); }
  mx /= pixels.length;
  my /= pixels.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const i of pixels) {
    const dx = (i % width) - mx;
    const dy = Math.floor(i / width) - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let lo = Infinity;
  let hi = -Infinity;
  let perp = 0;
  for (const i of pixels) {
    const dx = (i % width) - mx;
    const dy = Math.floor(i / width) - my;
    const along = dx * ux + dy * uy;
    lo = Math.min(lo, along); hi = Math.max(hi, along);
    perp = Math.max(perp, Math.abs(-dx * uy + dy * ux));
  }
  const length = (hi - lo) * mmPerPx;
  const off = perp * mmPerPx;
  return length >= 1.5 && off <= Math.min(0.6, 0.15 * length);
}

/**
 * A label touching a straight horizontal or vertical stroke (an hour tick, a grid line, a leader) forms one component too big for a
 * glyph. Remove pixel runs at least `runMm` long in either axis and return the remaining pieces of glyph height (≥ 1.8 mm).
 * Diagonal strokes are not handled.
 */
export function detachStrokes(pixels: readonly number[], width: number, mmPerPx: number, runMm: number): number[][] {
  const set = new Set(pixels);
  const run = Math.max(2, Math.round(runMm / mmPerPx));
  const drop = new Set<number>();
  const scan = (next: (i: number) => number, isStart: (i: number) => boolean) => {
    for (const start of set) {
      if (!isStart(start)) continue;
      const runPixels: number[] = [];
      for (let i = start; set.has(i); i = next(i)) runPixels.push(i);
      if (runPixels.length >= run) for (const i of runPixels) drop.add(i);
    }
  };
  scan((i) => ((i + 1) % width === 0 ? -1 : i + 1), (i) => i % width === 0 || !set.has(i - 1));
  scan((i) => i + width, (i) => !set.has(i - width));
  const kept = new Set([...set].filter((i) => !drop.has(i)));
  const parts: number[][] = [];
  const seen = new Set<number>();
  for (const start of kept) {
    if (seen.has(start)) continue;
    const part: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      part.push(i);
      for (const j of [i % width ? i - 1 : -1, (i + 1) % width ? i + 1 : -1, i - width, i + width]) {
        if (j >= 0 && kept.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    const ys = part.map((i) => Math.floor(i / width));
    if ((Math.max(...ys) - Math.min(...ys) + 1) * mmPerPx >= 1.8 && part.length * mmPerPx ** 2 >= 0.25) parts.push(part);
  }
  return parts;
}

/**
 * Single label-like tokens that the page pass read on a line of their own (sun rays read as «N», a C read as «e»). The page pass
 * has no character-level evidence for them; they are re-read by the label pass instead, under its stricter rules.
 */
export function loneLabelWords<T extends LineWord>(words: readonly T[]): T[] {
  const byLine = new Map<number, T[]>();
  for (const w of words) (byLine.get(w.line) ?? byLine.set(w.line, []).get(w.line)!).push(w);
  return words.filter((w) => isLabel(w.text) && byLine.get(w.line)!.every((o) => isLabel(o.text)));
}

type Box = { text: string; x0: number; y0: number; x1: number; y1: number };
const sameRow = (a: Box, b: Box) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
const PAIRS: Record<string, string> = { O: "0", "0": "O", B: "8", "8": "B", S: "5", "5": "S", Z: "2", "2": "Z" };
const isDigits = (s: string) => /^[0-9]+(\/[0-9]+)?$/.test(s);
const isLetter = (s: string) => /^[A-Za-z]$/.test(s);

/**
 * Labels of one sequence share a type (a number line, a row of letters). A shape-ambiguous O/0, B/8, S/5 or Z/2 takes the type
 * of its row when at least two other labels on that row are all digits or all letters; a mixed row decides nothing.
 */
export function digitLetterByRow<T extends Box>(labels: readonly T[]): T[] {
  return labels.map((l) => {
    const other = PAIRS[l.text];
    if (!other) return l;
    const row = labels.filter((o) => o !== l && sameRow(o, l));
    if (row.length < 2) return l;
    if (row.every((o) => isDigits(o.text)) && isDigits(other)) return { ...l, text: other };
    if (row.every((o) => isLetter(o.text)) && isLetter(other)) return { ...l, text: other };
    return l;
  });
}

/** Three or more identical, same-size readings on one row are a drawn texture (crosses, ticks), not labels: none is kept. */
export function dropRepeatedMarks<T extends Box>(labels: readonly T[]): T[] {
  const h = (b: Box) => b.y1 - b.y0;
  return labels.filter((l) => labels.filter((o) => o.text === l.text && sameRow(o, l) && Math.abs(h(o) - h(l)) <= 0.15 * h(l)).length < 3);
}
