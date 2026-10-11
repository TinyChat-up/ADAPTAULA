import { VISUAL_SPEC_VERSION, VisualSpecSchema, parseLabel, sameValue, specIssues, tickValue, type Fraction, type VisualSpec } from "@/lib/visuals/spec";
import type { NormalizedBounds } from "../geometry";
import { DARK, INK, px, textMask, type PageModel, type Rect, type TextBox } from "./page-model";
import { barShape, numberLineShape } from "./shapes";
import type { VisualShape } from "./locate";

/**
 * A located figure → its VisualSpec, read ONLY from what the original shows (pixels of the region and the labels printed in it),
 * then verified. Any doubt — unequal parts, a part neither clearly shaded nor clearly white, a tick out of rhythm, a label that is
 * not where its value is, a mark or a word the spec cannot carry — means NO spec: the localized original is kept. A spec never
 * adds a label, a point or a mark the original does not have.
 */

export const SPEC_EXTRACTOR_VERSION = "visual_spec_extractor@v1";
/** Tolerances (part of the extractor version). */
export const TOLERANCE = { equalParts: 0.04, equalSpacing: 0.04, shadedBelow: 225, whiteAbove: 240, strayInk: 0.002 } as const;

export type Extraction = { ok: true; spec: VisualSpec; checks: Record<string, number | boolean> } | { ok: false; reason: string; checks: Record<string, number | boolean> };

const rectOf = (model: PageModel, b: NormalizedBounds): Rect => ({ x0: Math.floor(b.x * model.width), y0: Math.floor(b.y * model.height), x1: Math.ceil((b.x + b.w) * model.width), y1: Math.ceil((b.y + b.h) * model.height) });
const inside = (r: Rect, t: TextBox) => t.x0 >= r.x0 - 1 && t.x1 <= r.x1 + 1 && t.y0 >= r.y0 - 1 && t.y1 <= r.y1 + 1;
const spread = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((m, v) => Math.max(m, Math.abs(v - mean) / mean), 0);
};

export function extractSpec(model: PageModel, bounds: NormalizedBounds, shape: VisualShape): Extraction {
  const region = rectOf(model, bounds);
  if (shape === "bar") return extractBar(model, region);
  if (shape === "number_line") return extractNumberLine(model, region);
  return { ok: false, reason: "shape_not_reconstructible", checks: {} };
}

function verified(candidate: unknown, checks: Record<string, number | boolean>): Extraction {
  const parsed = VisualSpecSchema.safeParse(candidate);
  if (!parsed.success || specIssues(parsed.data).length > 0) return { ok: false, reason: "spec_invalid", checks };
  return { ok: true, spec: parsed.data, checks };
}

function extractBar(model: PageModel, region: Rect): Extraction {
  const mask = textMask(model);
  const shape = barShape(model, region, mask);
  if (!shape) return { ok: false, reason: "no_bar", checks: {} };
  const { outline, dividers } = shape;
  // Words or numbers printed inside the bar would be lost by a reconstruction.
  const printed = model.texts.filter((t) => inside(outline, t)).length;
  const edges = [shape.left, ...dividers, shape.right];
  const widths = edges.slice(1).map((x, i) => x - edges[i]!);
  const parts = widths.length;
  const unequal = spread(widths);
  const shaded: number[] = [];
  let ambiguous = 0;
  const inset = px(model, 1);
  for (let i = 0; i < parts; i++) {
    const cell = { x0: edges[i]! + inset, x1: edges[i + 1]! - inset, y0: outline.y0 + inset, y1: outline.y1 - inset };
    let sum = 0;
    let n = 0;
    for (let y = Math.ceil(cell.y0); y < Math.floor(cell.y1); y++) {
      for (let x = Math.ceil(cell.x0); x < Math.floor(cell.x1); x++) {
        sum += model.gray[y * model.width + x]!;
        n += 1;
      }
    }
    const mean = n > 0 ? sum / n : 255;
    if (mean < TOLERANCE.shadedBelow) shaded.push(i);
    else if (mean < TOLERANCE.whiteAbove) ambiguous += 1;
  }
  const checks = { parts, unequal_parts: Math.round(unequal * 1000) / 1000, shaded: shaded.length, ambiguous_parts: ambiguous, printed_inside: printed };
  if (printed > 0) return { ok: false, reason: "text_inside", checks };
  if (parts < 2 || parts > 24 || unequal > TOLERANCE.equalParts) return { ok: false, reason: "unequal_parts", checks };
  if (ambiguous > 0) return { ok: false, reason: "ambiguous_shading", checks };
  return verified({ spec_version: VISUAL_SPEC_VERSION, kind: "fraction_bar", parts, shaded }, checks);
}

/** A label printed under or over a tick: one item (`3/4`) or two stacked numbers (numerator over denominator). */
function labelAt(texts: readonly TextBox[]): { text: string; value: Fraction } | null {
  if (texts.length === 1) {
    const text = texts[0]!.text.replace(/\s+/g, "");
    const value = parseLabel(text);
    return value ? { text, value } : null;
  }
  if (texts.length === 2) {
    const [a, b] = [...texts].sort((p, q) => p.y0 - q.y0);
    if (!/^\d{1,3}$/.test(a!.text.trim()) || !/^\d{1,3}$/.test(b!.text.trim())) return null;
    const text = `${a!.text.trim()}/${b!.text.trim()}`;
    const value = parseLabel(text);
    return value ? { text, value } : null;
  }
  return null;
}

function extractNumberLine(model: PageModel, region: Rect): Extraction {
  const mask = textMask(model);
  const shape = numberLineShape(model, region, mask);
  if (!shape) return { ok: false, reason: "no_number_line", checks: {} };
  const { ticks, axis } = shape;
  const spacing = ticks.slice(1).map((x, i) => x - ticks[i]!);
  const uneven = spread(spacing);
  const step = [...spacing].sort((a, b) => a - b)[Math.floor(spacing.length / 2)]!;

  // Every printed item in the region must be a label of one tick; anything else (a word, a letter, a stray number) is content a
  // reconstruction would drop.
  const texts = model.texts.filter((t) => inside(region, t));
  const byTick = new Map<number, TextBox[]>();
  let unplaced = 0;
  for (const t of texts) {
    const cx = (t.x0 + t.x1) / 2;
    const nearest = ticks.reduce((best, x, i) => (Math.abs(x - cx) < Math.abs(ticks[best]! - cx) ? i : best), 0);
    const tick = Math.abs(ticks[nearest]! - cx) <= step * 0.3 ? nearest : -1;
    if (tick < 0) unplaced += 1;
    else byTick.set(tick, [...(byTick.get(tick) ?? []), t]);
  }
  const labels: Array<{ tick: number; text: string; value: Fraction }> = [];
  let unreadable = 0;
  for (const [tick, items] of [...byTick.entries()].sort((a, b) => a[0] - b[0])) {
    const label = labelAt(items);
    if (label) labels.push({ tick, ...label });
    else unreadable += 1;
  }

  // Ink on the axis band that is neither the axis nor a tick: a point, an X, an arrow inside the interval. It may be the task's
  // own data (or its answer): the original is kept.
  const half = Math.max(shape.tickHalfPx, px(model, 1)) + px(model, 1.5);
  const tickHalfWidth = px(model, 0.8);
  let stray = 0;
  let band = 0;
  for (let y = Math.max(region.y0, Math.floor(axis.y0 - half)); y <= Math.min(region.y1 - 1, Math.ceil(axis.y1 + half)); y++) {
    for (let x = Math.ceil(ticks[0]! + tickHalfWidth); x < Math.floor(ticks.at(-1)! - tickHalfWidth); x++) {
      band += 1;
      const i = y * model.width + x;
      const onAxis = y >= axis.y0 - 1 && y <= axis.y1 + 1;
      const onTick = ticks.some((t) => Math.abs(t - x) <= tickHalfWidth);
      if (!onAxis && !onTick && !mask[i] && model.gray[i]! < INK) stray += 1;
    }
  }
  const strayShare = band > 0 ? stray / band : 0;
  const first = labels.find((l) => l.tick === 0);
  const last = labels.find((l) => l.tick === ticks.length - 1);
  const checks = { ticks: ticks.length, uneven_spacing: Math.round(uneven * 1000) / 1000, labels: labels.length, unplaced_text: unplaced, unreadable_labels: unreadable, stray_ink: Math.round(strayShare * 10000) / 10000, ends_labelled: Boolean(first && last) };
  if (uneven > TOLERANCE.equalSpacing) {
    // Labelled ticks in a perfect rhythm plus strokes crossing the line elsewhere: those strokes are marks (an X, a point).
    const labelled = labels.map((l) => ticks[l.tick]!);
    const rhythm = labelled.slice(1).map((x, i) => x - labelled[i]!);
    const marked = labelled.length >= 3 && spread(rhythm) <= TOLERANCE.equalSpacing && ticks.some((_, i) => !byTick.has(i));
    return { ok: false, reason: marked ? "marks_on_line" : "uneven_spacing", checks };
  }
  if (unplaced > 0 || unreadable > 0) return { ok: false, reason: "unknown_text", checks };
  if (strayShare > TOLERANCE.strayInk) return { ok: false, reason: "marks_on_line", checks };
  if (!first || !last) return { ok: false, reason: "ends_not_labelled", checks };
  const spec = { spec_version: VISUAL_SPEC_VERSION, kind: "number_line" as const, start: first.value, end: last.value, divisions: ticks.length - 1, labels: labels.map((l) => ({ tick: l.tick, text: l.text })) };
  // Every printed label must be exactly the value of its tick (rational arithmetic): otherwise the line is not uniform as read.
  if (labels.some((l) => !sameValue(l.value, tickValue(spec, l.tick)))) return { ok: false, reason: "label_mismatch", checks };
  return verified(spec, checks);
}

/** Dark pixels of the region (for the "crop has the figure" check of a stored crop). */
export function hasFigure(model: PageModel, region: Rect): boolean {
  let n = 0;
  for (let y = Math.max(0, region.y0); y < Math.min(model.height, region.y1); y++) for (let x = Math.max(0, region.x0); x < Math.min(model.width, region.x1); x++) if (model.gray[y * model.width + x]! < DARK) n += 1;
  return n >= px(model, 2) ** 2;
}
