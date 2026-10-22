import { MIN_SIDE, type NormalizedBounds } from "../geometry";
import { area, components, gap, inkFraction, intersection, iou, isLabel, isLabelLine, px, textLines, textMask, textSegments, union, type Component, type PageModel, type Rect, type TextLine } from "./page-model";
import { isMark, isMarkLine, isMeasure, type ExpectedMarks } from "./marks";
import { barShape, numberLineShape } from "./shapes";

/**
 * Where a visual of the analysis is on its page, decided by deterministic signals and an explicit confidence:
 *
 *   signature  0.30  the region has the pixel signature of its kind (number line, divided bar); a generic figure 0 (any drawing
 *                    has ink and lines: that is not evidence it is THE visual, so a generic figure needs a vision model's agreement)
 *   placement  0.25  it lies in the zone of the activity that uses it (from that activity's printed instruction to the next one)
 *   unique     0.20  it is the only region in that zone with that signature, or clearly the best (≥ 0.15 ahead)
 *   clean      0.15  REQUIRED: it has ink, it is not most of the page, and no running text of the sheet falls inside the crop
 *   vision     0.20  a vision model's hypothesis lands on THAT region (IoU ≥ 0.5, model confidence ≥ 0.7)
 *
 * Accepted at ≥ 0.75. A hypothesis that lands on no region found here is never accepted (capped at 0.60): a rectangle is not
 * true because a model returned it. Thresholds are part of `AUTO_ENGINE_VERSION`: changing one is a new engine version.
 *
 * A generic figure whose analysis names the marks it carries (`marks.ts`: letters A–D, arrows 1–4, measures) has a signature
 * too: EVERY expected mark is printed, once, on that drawing (the PDF's own text layer), legibly. Its crop then includes those
 * marks (a measure written beside a side, the «?» of an unknown one) and the text enclosed in its own boxes; never an activity's
 * instruction or a printed solution. Only for such a figure the page is read by columns (text segments, not full-width lines) and
 * the figure may lead its activity (above the first instruction of its column), as real sheets print it. Thresholds unchanged.
 */

export const ACCEPT = 0.75;
export const AI_ONLY_CAP = 0.6;
export const HYPOTHESIS_IOU = 0.5;
export const HYPOTHESIS_CONFIDENCE = 0.7;
const W = { signature: 0.3, genericSignature: 0, placement: 0.25, unique: 0.2, clean: 0.15, vision: 0.2 } as const;

export type VisualShape = "number_line" | "bar" | "figure";

export interface VisualTarget {
  id: string;
  shape: VisualShape;
  /** Activities that use it, in order (the first one with a printed anchor gives its zone). */
  activityIds: string[];
  /** The marks its analysis names (only generic figures): its signature, when all are printed on it. */
  marks?: ExpectedMarks | null;
}

/** The smallest printed mark still legible on A4 (≈ 5 pt type) and the smallest side of a figure worth printing. */
export const MIN_MARK_MM = 1.8;
export const MIN_FIGURE_MM = 20;

export interface ActivityText {
  id: string;
  label: string | null;
  instruction: string;
}

export interface Hypothesis {
  bounds: NormalizedBounds;
  confidence: number;
}

export interface Evidence {
  shape: VisualShape;
  signature: boolean;
  placement: boolean;
  unique: boolean;
  clean: boolean;
  anchor: string | null;
  vision: { used: boolean; agrees: boolean; confidence: number | null; iou: number | null };
  /** A figure located by its marks: what was expected and found on the crop, and whether they print legibly. */
  marks?: { expected: string[]; found: string[]; measures: number; legible: boolean };
  reason: "accepted" | "low_confidence" | "no_candidate" | "not_clean" | "hypothesis_not_snapped" | "conflict" | "scan_identity_unverified" | "activity_unverified" | "marks_incomplete" | "illegible";
}

export interface Located {
  visualId: string;
  bounds: NormalizedBounds | null;
  confidence: number;
  accepted: boolean;
  evidence: Evidence;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const stripLabel = (s: string) => s.replace(/^\(?[0-9a-z]{1,3}[.)]\s+/, "");

/** The printed line where each activity's instruction starts (its anchor). An activity whose words are not found has none. */
export function activityAnchors(lines: readonly TextLine[], activities: readonly ActivityText[]): Map<string, TextLine> {
  const anchors = new Map<string, TextLine>();
  const used = new Set<TextLine>();
  for (const activity of activities) {
    const instruction = normalize(activity.instruction);
    if (instruction.length < 8) continue;
    const line = lines.find((l) => {
      if (used.has(l)) return false;
      const text = stripLabel(normalize(l.text));
      if (text.length < 8) return false;
      const head = text.slice(0, Math.min(text.length, 28));
      return instruction.startsWith(head) || text.includes(instruction.slice(0, Math.min(instruction.length, 28)));
    });
    if (line) {
      anchors.set(activity.id, line);
      used.add(line);
    }
  }
  return anchors;
}

/**
 * Zones that follow the page's columns: anchors printed side by side (same row) split the width between them; each zone runs to
 * the next anchor BELOW IT IN ITS COLUMN. The first anchor of a column also gets the area above it (its `lead`), where a sheet
 * prints the figure its activity is about. Used only for figures located by their marks.
 */
export function columnZones(anchors: Map<string, TextLine>, model: PageModel): { zones: Map<string, Rect>; leads: Map<string, Rect> } {
  const list = [...anchors.values()];
  const sameRow = (a: TextLine, b: TextLine) => Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) <= Math.max(a.y1 - a.y0, b.y1 - b.y0);
  const column = (line: TextLine) => {
    const mates = list.filter((o) => o !== line && sameRow(o, line));
    const left = mates.filter((o) => o.x0 < line.x0).sort((a, b) => b.x0 - a.x0)[0];
    const right = mates.filter((o) => o.x0 > line.x0).sort((a, b) => a.x0 - b.x0)[0];
    return { x0: left ? (left.x1 + line.x0) / 2 : 0, x1: right ? (line.x1 + right.x0) / 2 : model.width };
  };
  const zones = new Map<string, Rect>();
  const leads = new Map<string, Rect>();
  for (const [id, line] of anchors) {
    const col = column(line);
    const inColumn = list.filter((o) => o !== line && (o.x0 + o.x1) / 2 >= col.x0 && (o.x0 + o.x1) / 2 <= col.x1);
    const below = inColumn.filter((o) => o.y0 > line.y0 && !sameRow(o, line)).sort((a, b) => a.y0 - b.y0)[0];
    const above = inColumn.some((o) => o.y0 < line.y0 && !sameRow(o, line));
    zones.set(id, { x0: col.x0, y0: line.y0 - px(model, 1), x1: col.x1, y1: (below?.y0 ?? model.height) - px(model, 0.5) });
    if (!above) leads.set(id, { x0: col.x0, y0: 0, x1: col.x1, y1: line.y0 });
  }
  return { zones, leads };
}

/** From an activity's anchor to the next anchor below it (or the end of the page). */
export function activityZones(anchors: Map<string, TextLine>, model: PageModel): Map<string, Rect> {
  const sorted = [...anchors.entries()].sort((a, b) => a[1].y0 - b[1].y0);
  return new Map(sorted.map(([id, line], i) => [id, { x0: 0, y0: line.y0 - px(model, 1), x1: model.width, y1: (sorted[i + 1]?.[1].y0 ?? model.height) - px(model, 0.5) }]));
}

interface Candidate extends Rect {
  /** The region plus the printed labels that belong to it (`0`, `1/4`…), i.e. what would be cropped. */
  crop: Rect;
  /** The region plus every printed mark that belongs to it (labels, measures, «?»): the crop of a figure located by its marks. */
  markCrop: Rect;
  inkPx: number;
  /** An empty outline (ink on its border only): a box to write in, or a drawn rectangle; only a figure with its marks may be one. */
  hollow?: true;
}

/** Regions that can be a figure: single drawings and drawings close to each other, minus rules, frames, specks and empty boxes. */
export function candidates(model: PageModel, mask = textMask(model)): Candidate[] {
  const all = components(model, mask);
  const page: Rect = { x0: 0, y0: 0, x1: model.width, y1: model.height };
  const shaped = (c: Component) => {
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (w < px(model, 3) && h < px(model, 3)) return false;
    if (h <= px(model, 1.5) && w >= px(model, 10)) return false; // a rule or an answer line
    if (w >= 0.85 * model.width && h >= 0.5 * model.height) return false; // a page frame
    return area(c) <= 0.6 * area(page);
  };
  const keep = (c: Component) => shaped(c) && !hollow(model, mask, c);
  const singles = all.filter(keep);
  // Empty outlines stay out of every group; they are offered apart, flagged, for a figure that carries its marks (a rectangle B).
  const outlines = all.filter((c) => shaped(c) && hollow(model, mask, c)).map((c) => ({ ...c, hollow: true as const }));
  const merged: Component[] = [];
  for (const c of singles) {
    const near = merged.find((m) => gap(m, c) <= px(model, 4));
    if (near) Object.assign(near, union(near, c), { inkPx: near.inkPx + c.inkPx });
    else merged.push({ ...c });
  }
  const seen = new Set<string>();
  return [...singles, ...merged, ...outlines]
    .filter((c) => {
      const key = `${c.x0}:${c.y0}:${c.x1}:${c.y1}`;
      return !seen.has(key) && seen.add(key) !== undefined;
    })
    .map((c) => ({ ...c, crop: withLabels(model, c), markCrop: withMarks(model, c) }));
}

/** An empty box (a frame to write in, a sign box): ink on its border only. */
function hollow(model: PageModel, mask: Uint8Array, c: Rect): boolean {
  const inset = px(model, 1.2);
  const inner = { x0: c.x0 + inset, y0: c.y0 + inset, x1: c.x1 - inset, y1: c.y1 - inset };
  if (inner.x1 <= inner.x0 || inner.y1 <= inner.y0) return false;
  return inkFraction(model, inner, mask) < 0.002;
}

/**
 * The printed labels within 4 mm of a figure belong to its crop (the 0 and the 1 of a number line), and so do the labels touching
 * those (the denominator under a numerator). Running text never does.
 */
function withLabels(model: PageModel, r: Rect): Rect {
  let crop = r;
  const labels = model.texts.filter((t) => isLabel(t.text));
  for (let pass = 0; pass < 3; pass++) {
    const grown = labels.reduce((c, t) => (gap(c, t) <= px(model, pass === 0 ? 4 : 1) ? union(c, t) : c), crop);
    if (area(grown) === area(crop)) break;
    crop = grown;
  }
  return crop;
}

/**
 * The marks printed within reach of a figure belong to its crop: labels and «?» within 4 mm, a measure within 6 mm (it is written
 * beside the side it measures), and the marks touching those. Running text never does.
 */
function withMarks(model: PageModel, r: Rect): Rect {
  let crop = r;
  const marks = model.texts.filter((t) => isMark(t.text));
  for (let pass = 0; pass < 3; pass++) {
    const grown = marks.reduce((c, t) => (gap(c, t) <= px(model, pass === 0 ? (isMeasure(t.text) ? 6 : 4) : 1) ? union(c, t) : c), crop);
    if (area(grown) === area(crop)) break;
    crop = grown;
  }
  return crop;
}

const centreInside = (t: Rect, r: Rect) => (t.x0 + t.x1) / 2 >= r.x0 && (t.x0 + t.x1) / 2 <= r.x1 && (t.y0 + t.y1) / 2 >= r.y0 && (t.y0 + t.y1) / 2 <= r.y1;

/** The expected marks printed on the crop (each once), how many measures it carries, and whether they are legible on A4. */
function marksOn(model: PageModel, crop: Rect, marks: ExpectedMarks): { ok: boolean; found: string[]; measures: number; legible: boolean } {
  const inside = model.texts.filter((t) => isMark(t.text) && centreInside(t, crop));
  const tokens = inside.flatMap((t) => (isMeasure(t.text) ? [] : t.text.trim().split(/\s+/)));
  const count = (mark: string) => tokens.filter((x) => x === mark).length;
  const expected = [...marks.letters, ...marks.numbers];
  const found = expected.filter((m) => count(m) === 1);
  const measures = inside.filter((t) => isMeasure(t.text)).length;
  const ok = found.length === expected.length && (!marks.measures || measures >= 2) && (expected.length > 0 || marks.measures);
  const relevant = inside.filter((t) => isMeasure(t.text) || expected.includes(t.text.trim()));
  const minMark = relevant.length > 0 ? Math.min(...relevant.map((t) => (t.y1 - t.y0) * model.mmPerPx)) : 0;
  const side = Math.min(crop.x1 - crop.x0, crop.y1 - crop.y0) * model.mmPerPx;
  return { ok, found, measures, legible: ok && minMark >= MIN_MARK_MM && side >= MIN_FIGURE_MM };
}

/** Words that mark a printed solution or answer key: never part of a figure's crop. */
const SOLUTION = /\b(soluci[oó]n|soluciones|respuestas?\s+correctas?|clave|solucionario)\b/i;

/**
 * A text line inside one of the figure's own boxes (the label of a box of a diagram): on each side there is a straight edge of
 * ink that spans it (a row covering ≥ 90 % of its width above and below, a column covering its height left and right), and the box
 * those edges make is a part of the crop (at most half of it), never the crop's own outer frame or a card around activities.
 */
function boxed(model: PageModel, mask: Uint8Array, line: Rect, crop: Rect): boolean {
  // A box's border may be a light grey (luma ≈ 225) that anti-aliasing lifts above the ink threshold: an edge is any thin
  // straight line darker than EDGE with paper (or a lighter fill) outside it. A tinted fill is not an edge (it is not thin).
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < model.width && y < model.height && model.gray[y * model.width + x]! < EDGE && !mask[y * model.width + x];
  const x0 = Math.floor(line.x0), x1 = Math.ceil(line.x1), y0 = Math.floor(line.y0), y1 = Math.ceil(line.y1);
  const rowCover = (y: number) => {
    let n = 0;
    for (let x = x0; x < x1; x++) if (dark(x, y)) n++;
    return n / Math.max(1, x1 - x0);
  };
  const colCover = (x: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) if (dark(x, y)) n++;
    return n / Math.max(1, y1 - y0);
  };
  const t = px(model, 0.8);
  const find = (from: number, to: number, cover: (i: number) => number) => {
    const step = from <= to ? 1 : -1;
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) if (cover(i) >= 0.9 && cover(i + step * t) < 0.5) return i;
    return null;
  };
  const top = find(y0 - 1, Math.ceil(crop.y0), rowCover);
  const bottom = find(y1 + 1, Math.floor(crop.y1) - 1, rowCover);
  const left = find(x0 - 1, Math.ceil(crop.x0), colCover);
  const right = find(x1 + 1, Math.floor(crop.x1) - 1, colCover);
  if (top === null || bottom === null || left === null || right === null) return false;
  return area({ x0: left, y0: top, x1: right, y1: bottom }) <= 0.5 * area(crop);
}
const EDGE = 238;

/**
 * Clean crop of a figure located by its marks: as `isClean`, but its marks and the text inside its own boxes belong to it. Any
 * line of an activity's instruction (its anchor or a continuation) and any printed solution make it unclean.
 */
function isCleanFigure(model: PageModel, mask: Uint8Array, lines: readonly TextLine[], instruction: (l: TextLine) => boolean, crop: Rect): boolean {
  if (area(crop) > 0.5 * model.width * model.height) return false;
  if (inkFraction(model, crop) < 0.004) return false;
  return !lines.some((l) => {
    if (area(intersection(l, crop)) <= 0.15 * area(l)) return false;
    if (instruction(l) || SOLUTION.test(l.text)) return true;
    if (isMarkLine(l.text)) return false;
    return !(centreInside(l, crop) && boxed(model, mask, l, crop));
  });
}

function signatureOf(model: PageModel, mask: Uint8Array, shape: VisualShape, c: Candidate): { score: number; ok: boolean } {
  if (shape === "number_line") return numberLineShape(model, c, mask) ? { score: W.signature, ok: true } : { score: 0, ok: false };
  if (shape === "bar") return barShape(model, c, mask) ? { score: W.signature, ok: true } : { score: 0, ok: false };
  return c.inkPx >= px(model, 3) ** 2 ? { score: W.genericSignature, ok: true } : { score: 0, ok: false };
}

/** Clean crop: ink inside, not most of the page, and no running text line (an instruction, a name field…) inside it. */
function isClean(model: PageModel, lines: readonly TextLine[], crop: Rect): boolean {
  if (area(crop) > 0.5 * model.width * model.height) return false;
  if (inkFraction(model, crop) < 0.004) return false;
  return !lines.some((l) => !isLabelLine(l.text) && area(intersection(l, crop)) > 0.15 * area(l));
}

export const toBounds = (model: PageModel, r: Rect): NormalizedBounds => {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  let x = r.x0 / model.width;
  let y = r.y0 / model.height;
  let w = (r.x1 - r.x0) / model.width;
  let h = (r.y1 - r.y0) / model.height;
  // A thin figure (a number line) is grown symmetrically to the smallest side a locator may have, never cut.
  if (w < MIN_SIDE) {
    x = Math.max(0, x - (MIN_SIDE - w) / 2);
    w = MIN_SIDE;
  }
  if (h < MIN_SIDE) {
    y = Math.max(0, y - (MIN_SIDE - h) / 2);
    h = MIN_SIDE;
  }
  return { x: round(Math.min(x, 1 - w)), y: round(Math.min(y, 1 - h)), w: round(w), h: round(h) };
};
const fromBounds = (model: PageModel, b: NormalizedBounds): Rect => ({ x0: b.x * model.width, y0: b.y * model.height, x1: (b.x + b.w) * model.width, y1: (b.y + b.h) * model.height });

interface Scored {
  target: VisualTarget;
  candidate: Candidate;
  score: number;
  evidence: Evidence;
  /** A figure located by its marks: every expected mark is on this crop (legible or not). */
  complete: boolean;
}

/**
 * Every visual of one page → its region or none, with the signals that decided it. `hypotheses` (optional) are a vision model's
 * proposals by visual id: they only ever ADD agreement to a region found here.
 */
export function locateVisuals(model: PageModel, targets: readonly VisualTarget[], activities: readonly ActivityText[], hypotheses: ReadonlyMap<string, Hypothesis> = new Map()): Located[] {
  // Vision agreement alone does not supply an independent activity anchor on a scan.
  if (model.texts.length === 0) return targets.map((target) => ({
    visualId: target.id, accepted: false, bounds: null, confidence: 0,
    evidence: { shape: target.shape, signature: false, placement: false, unique: false, clean: false, anchor: null,
      vision: { used: false, agrees: false, confidence: null, iou: null }, reason: "scan_identity_unverified" },
  }));
  const mask = textMask(model);
  const lines = textLines(model.texts);
  const anchors = activityAnchors(lines, activities);
  const zones = activityZones(anchors, model);
  const regions = candidates(model, mask);
  // Figures located by their marks read the page by columns: segments (not full-width lines) give their anchors and their crops.
  const segments = textSegments(model);
  const segmentAnchors = activityAnchors(segments, activities);
  const byColumn = columnZones(segmentAnchors, model);
  const anchorLines = new Set(segmentAnchors.values());
  const instructions = activities.map((a) => normalize(stripLabel(a.instruction))).filter((t) => t.length >= 8);
  const isInstruction = (l: TextLine) => {
    if (anchorLines.has(l)) return true;
    const text = normalize(stripLabel(l.text));
    return text.length >= 8 && instructions.some((i) => i.includes(text));
  };

  const scored: Scored[] = [];
  for (const target of targets) {
    const byMarks = target.shape === "figure" && !!target.marks;
    const anchor = target.activityIds.find((id) => (byMarks ? segmentAnchors : zones).has(id)) ?? null;
    const zone = anchor && !byMarks ? zones.get(anchor)! : null;
    const column = anchor && byMarks ? [byColumn.zones.get(anchor), byColumn.leads.get(anchor)].filter((r): r is Rect => r !== undefined) : [];
    const hypothesis = hypotheses.get(target.id);
    const rows = regions.filter((candidate) => byMarks || !candidate.hollow).map((candidate) => {
      const crop = byMarks ? candidate.markCrop : candidate.crop;
      const marks = byMarks ? marksOn(model, crop, target.marks!) : null;
      const signature = marks ? { score: marks.legible ? W.signature : 0, ok: marks.legible } : signatureOf(model, mask, target.shape, candidate);
      const cx = (candidate.x0 + candidate.x1) / 2;
      const cy = (candidate.y0 + candidate.y1) / 2;
      const placement = byMarks ? column.some((z) => cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1) : zone !== null && cy >= zone.y0 && cy <= zone.y1;
      const clean = byMarks ? isCleanFigure(model, mask, segments, isInstruction, crop) : isClean(model, lines, candidate.crop);
      const overlap = hypothesis ? iou(crop, fromBounds(model, hypothesis.bounds)) : null;
      const agrees = hypothesis !== undefined && overlap !== null && overlap >= HYPOTHESIS_IOU && hypothesis.confidence >= HYPOTHESIS_CONFIDENCE;
      const score = signature.score + (placement ? W.placement : 0) + (clean ? W.clean : 0) + (agrees ? W.vision : 0);
      const evidence: Evidence = {
        shape: target.shape, signature: signature.ok, placement, unique: false, clean, anchor,
        vision: { used: hypothesis !== undefined, agrees, confidence: hypothesis?.confidence ?? null, iou: overlap === null ? null : Math.round(overlap * 1000) / 1000 },
        ...(marks ? { marks: { expected: [...target.marks!.letters, ...target.marks!.numbers, ...(target.marks!.measures ? ["medidas"] : [])], found: marks.found, measures: marks.measures, legible: marks.legible } } : {}),
        reason: "low_confidence",
      };
      return { target, candidate: byMarks ? { ...candidate, crop } : candidate, score, evidence, complete: marks?.ok ?? false };
    });
    // Uniqueness among the regions of its zone (or the page) that carry its signature. A figure and the frame around it that carry
    // the same marks are ONE figure: the innermost complete region stands for both (never a frame and its drawing as two rivals).
    const contains = (a: Rect, b: Rect) => a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1 && area(a) > area(b);
    const signed = rows.filter((r) => r.evidence.signature && r.evidence.clean && (byMarks ? r.evidence.placement : zone === null || r.evidence.placement));
    const rivals = (byMarks ? signed.filter((r) => !signed.some((o) => o !== r && contains(r.candidate.crop, o.candidate.crop))) : signed).sort((a, b) => b.score - a.score);
    for (const r of rows) {
      const ahead = rivals[0] === r && (rivals.length === 1 || r.score - rivals[1]!.score >= 0.15);
      if (ahead) {
        r.evidence.unique = true;
        r.score += W.unique;
      }
    }
    scored.push(...rows);
  }

  // Greedy assignment, best first: one region per visual, one visual per region, and no two crops that overlap.
  const out = new Map<string, Located>();
  const taken: Rect[] = [];
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (out.has(s.target.id)) continue;
    if (!s.evidence.clean || !s.evidence.placement || !s.evidence.anchor || s.score < ACCEPT) continue;
    if (taken.some((t) => iou(t, s.candidate.crop) > 0.2)) continue;
    taken.push(s.candidate.crop);
    out.set(s.target.id, { visualId: s.target.id, bounds: toBounds(model, s.candidate.crop), confidence: round3(Math.min(1, s.score)), accepted: true, evidence: { ...s.evidence, reason: "accepted" } });
  }
  for (const target of targets) {
    if (out.has(target.id)) continue;
    const best = scored.filter((s) => s.target === target).sort((a, b) => b.score - a.score)[0];
    const hypothesis = hypotheses.get(target.id);
    const byMarks = target.shape === "figure" && !!target.marks;
    const anchor = target.activityIds.find((id) => (byMarks ? segmentAnchors : zones).has(id)) ?? null;
    if (hypothesis && !scored.some((s) => s.target === target && s.evidence.vision.agrees)) {
      out.set(target.id, { visualId: target.id, bounds: null, confidence: round3(Math.min(AI_ONLY_CAP, hypothesis.confidence)), accepted: false, evidence: { shape: target.shape, signature: false, placement: false, unique: false, clean: false, anchor, vision: { used: true, agrees: false, confidence: hypothesis.confidence, iou: null }, reason: "hypothesis_not_snapped" } });
      continue;
    }
    if (!best) {
      out.set(target.id, { visualId: target.id, bounds: null, confidence: 0, accepted: false, evidence: { shape: target.shape, signature: false, placement: false, unique: false, clean: false, anchor, vision: { used: hypothesis !== undefined, agrees: false, confidence: hypothesis?.confidence ?? null, iou: null }, reason: "no_candidate" } });
      continue;
    }
    const complete = scored.filter((s) => s.target === target && s.complete);
    const reason: Evidence["reason"] = byMarks && complete.length === 0 ? "marks_incomplete"
      : byMarks && complete.every((s) => s.evidence.marks && !s.evidence.marks.legible) ? "illegible"
      : !best.evidence.clean ? "not_clean" : !best.evidence.placement || !anchor ? "activity_unverified" : best.score >= ACCEPT ? "conflict" : "low_confidence";
    out.set(target.id, { visualId: target.id, bounds: null, confidence: round3(Math.min(1, best.score)), accepted: false, evidence: { ...best.evidence, reason } });
  }
  return targets.map((t) => out.get(t.id)!);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
