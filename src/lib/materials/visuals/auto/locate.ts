import { MIN_SIDE, type NormalizedBounds } from "../geometry";
import { area, components, gap, inkFraction, intersection, iou, isLabel, isLabelLine, px, textLines, textMask, union, type Component, type PageModel, type Rect, type TextLine } from "./page-model";
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
}

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
  reason: "accepted" | "low_confidence" | "no_candidate" | "not_clean" | "hypothesis_not_snapped" | "conflict" | "scan_identity_unverified" | "activity_unverified";
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

/** From an activity's anchor to the next anchor below it (or the end of the page). */
export function activityZones(anchors: Map<string, TextLine>, model: PageModel): Map<string, Rect> {
  const sorted = [...anchors.entries()].sort((a, b) => a[1].y0 - b[1].y0);
  return new Map(sorted.map(([id, line], i) => [id, { x0: 0, y0: line.y0 - px(model, 1), x1: model.width, y1: (sorted[i + 1]?.[1].y0 ?? model.height) - px(model, 0.5) }]));
}

interface Candidate extends Rect {
  /** The region plus the printed labels that belong to it (`0`, `1/4`…), i.e. what would be cropped. */
  crop: Rect;
  inkPx: number;
}

/** Regions that can be a figure: single drawings and drawings close to each other, minus rules, frames, specks and empty boxes. */
export function candidates(model: PageModel, mask = textMask(model)): Candidate[] {
  const all = components(model, mask);
  const page: Rect = { x0: 0, y0: 0, x1: model.width, y1: model.height };
  const keep = (c: Component) => {
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (w < px(model, 3) && h < px(model, 3)) return false;
    if (h <= px(model, 1.5) && w >= px(model, 10)) return false; // a rule or an answer line
    if (w >= 0.85 * model.width && h >= 0.5 * model.height) return false; // a page frame
    if (area(c) > 0.6 * area(page)) return false;
    return !hollow(model, mask, c);
  };
  const singles = all.filter(keep);
  const merged: Component[] = [];
  for (const c of singles) {
    const near = merged.find((m) => gap(m, c) <= px(model, 4));
    if (near) Object.assign(near, union(near, c), { inkPx: near.inkPx + c.inkPx });
    else merged.push({ ...c });
  }
  const seen = new Set<string>();
  return [...singles, ...merged]
    .filter((c) => {
      const key = `${c.x0}:${c.y0}:${c.x1}:${c.y1}`;
      return !seen.has(key) && seen.add(key) !== undefined;
    })
    .map((c) => ({ ...c, crop: withLabels(model, c) }));
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

  const scored: Scored[] = [];
  for (const target of targets) {
    const anchor = target.activityIds.find((id) => zones.has(id)) ?? null;
    const zone = anchor ? zones.get(anchor)! : null;
    const hypothesis = hypotheses.get(target.id);
    const rows = regions.map((candidate) => {
      const signature = signatureOf(model, mask, target.shape, candidate);
      const cy = (candidate.y0 + candidate.y1) / 2;
      const placement = zone !== null && cy >= zone.y0 && cy <= zone.y1;
      const clean = isClean(model, lines, candidate.crop);
      const overlap = hypothesis ? iou(candidate.crop, fromBounds(model, hypothesis.bounds)) : null;
      const agrees = hypothesis !== undefined && overlap !== null && overlap >= HYPOTHESIS_IOU && hypothesis.confidence >= HYPOTHESIS_CONFIDENCE;
      const score = signature.score + (placement ? W.placement : 0) + (clean ? W.clean : 0) + (agrees ? W.vision : 0);
      const evidence: Evidence = { shape: target.shape, signature: signature.ok, placement, unique: false, clean, anchor, vision: { used: hypothesis !== undefined, agrees, confidence: hypothesis?.confidence ?? null, iou: overlap === null ? null : Math.round(overlap * 1000) / 1000 }, reason: "low_confidence" };
      return { target, candidate, score, evidence };
    });
    // Uniqueness among the regions of its zone (or the page) that carry its signature.
    const rivals = rows.filter((r) => r.evidence.signature && r.evidence.clean && (zone === null || r.evidence.placement)).sort((a, b) => b.score - a.score);
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
    const anchor = target.activityIds.find((id) => zones.has(id)) ?? null;
    if (hypothesis && !scored.some((s) => s.target === target && s.evidence.vision.agrees)) {
      out.set(target.id, { visualId: target.id, bounds: null, confidence: round3(Math.min(AI_ONLY_CAP, hypothesis.confidence)), accepted: false, evidence: { shape: target.shape, signature: false, placement: false, unique: false, clean: false, anchor, vision: { used: true, agrees: false, confidence: hypothesis.confidence, iou: null }, reason: "hypothesis_not_snapped" } });
      continue;
    }
    if (!best) {
      out.set(target.id, { visualId: target.id, bounds: null, confidence: 0, accepted: false, evidence: { shape: target.shape, signature: false, placement: false, unique: false, clean: false, anchor, vision: { used: hypothesis !== undefined, agrees: false, confidence: hypothesis?.confidence ?? null, iou: null }, reason: "no_candidate" } });
      continue;
    }
    const reason: Evidence["reason"] = !best.evidence.clean ? "not_clean" : !best.evidence.placement || !anchor ? "activity_unverified" : best.score >= ACCEPT ? "conflict" : "low_confidence";
    out.set(target.id, { visualId: target.id, bounds: null, confidence: round3(Math.min(1, best.score)), accepted: false, evidence: { ...best.evidence, reason } });
  }
  return targets.map((t) => out.get(t.id)!);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
