import "server-only";
import { normalizeText } from "@/lib/adaptation/text";
import type { AnalysisVisual } from "@/lib/schemas/material-analysis";
import { flowClaim } from "@/lib/visuals/from-analysis";
import { loadSource, type VisualDeps } from "../service";
import type { PageModel, TextBox } from "./page-model";
import { readPage } from "./read";

/**
 * Evidence that a scheme of boxes and arrows really is what the analysis says it is. The analysis's `text` and `description` come
 * from the SAME model reading, so they are one claim, not two witnesses. What can corroborate it is the ORIGINAL itself, and only
 * what the PDF itself prints (no model, no guess):
 *   · ARROWS are glyphs of the PDF's text layer («→», «->»…), on ONE row, exactly one between every two consecutive boxes. The
 *     glyph is also what gives the DIRECTION: a right-pointing arrow between a box on its left and a box on its right means the
 *     flow goes left to right, the order the claim states. A left-pointing or double arrow, or any other count, gives nothing.
 *   · LABELS are the text between the arrows, in that row. A label may be split over several lines of the same box («LARVAS DE» /
 *     «INSECTOS»): lines stacked in the same column of the same box are joined, in reading order, before comparing.
 *   · BOXES: each label sits inside a closed rectangle drawn on the page (ink on its four sides, around its text and nothing else).
 *   · Each box, in order, is read as the claim's label in the same order; nothing printed in the band that belongs to no box.
 * Anything else (an image without text layer, a connector drawn as a plain line or an image without a direction glyph, another
 * order, a missing or extra label, a box not drawn) gives nothing, and the need goes on to the next rung or to the honest stop.
 */
const RIGHT_ARROWS = new Set(["→", "⟶", "➔", "➜", "➞", "➝", "⇒", "->", "-->", "=>"]);
const OTHER_ARROWS = /[←⟵⇐↔⟷⇔↑↓]|<-|<=|<->/;
const squash = (t: string) => t.replace(/\s+/g, "");
const isRight = (b: TextBox) => RIGHT_ARROWS.has(squash(b.text));
const isOther = (b: TextBox) => OTHER_ARROWS.test(squash(b.text));
const clean = (t: string) => normalizeText(t).replace(/[^a-z0-9ñ ]/g, "").replace(/\s+/g, " ").trim();

const xOverlap = (a: TextBox, b: TextBox) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));

/** Lines of one box: stacked in the same column (their horizontal extents overlap) with no more than a line's gap between them. */
function groupLines(boxes: readonly TextBox[]): TextBox[][] {
  const groups: TextBox[][] = [];
  for (const box of [...boxes].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)) {
    const home = groups.find((g) => g.some((o) => xOverlap(o, box) >= 0.5 * Math.min(o.x1 - o.x0, box.x1 - box.x0) && Math.max(box.y0 - o.y1, o.y0 - box.y1) <= 0.8 * (box.y1 - box.y0)));
    if (home) home.push(box);
    else groups.push([box]);
  }
  return groups;
}

const darkAt = (model: PageModel, x: number, y: number) => (model.gray[y * model.width + x] ?? 255) < 225;
/** Longest search outward for a rule: a box is drawn within this many millimetres of its text. */
const MAX_BORDER_MM = 25;

/** A closed rectangle of ink around `text` that contains no other text of the page: the box the label is printed in. */
function boxedAround(model: PageModel, text: TextBox, others: readonly TextBox[]): boolean {
  const reach = Math.round(MAX_BORDER_MM / model.mmPerPx);
  const y0 = Math.floor(text.y0), y1 = Math.ceil(text.y1), x0 = Math.floor(text.x0), x1 = Math.ceil(text.x1);
  const vertical = (from: number, step: 1 | -1) => {
    for (let d = 2; d <= reach; d++) {
      const x = from + step * d;
      if (x < 0 || x >= model.width) return null;
      let ink = 0;
      for (let y = y0; y <= y1; y++) if (darkAt(model, x, y)) ink++;
      if (ink / (y1 - y0 + 1) >= 0.95) return x;
    }
    return null;
  };
  const left = vertical(x0, -1);
  const right = vertical(x1, 1);
  if (left === null || right === null) return false;
  const horizontal = (from: number, step: 1 | -1) => {
    for (let d = 2; d <= reach; d++) {
      const y = from + step * d;
      if (y < 0 || y >= model.height) return null;
      let ink = 0;
      for (let x = left; x <= right; x++) if (darkAt(model, x, y)) ink++;
      if (ink / (right - left + 1) >= 0.95) return y;
    }
    return null;
  };
  const top = horizontal(y0, -1);
  const bottom = horizontal(y1, 1);
  if (top === null || bottom === null) return false;
  // The rectangle holds this label and nothing else.
  return !others.some((o) => o.x0 >= left && o.x1 <= right && o.y0 >= top && o.y1 <= bottom);
}

export function corroboratesFlow(model: PageModel, labels: readonly string[]): boolean {
  const wanted = labels.map(clean);
  if (labels.length < 2 || new Set(wanted).size !== wanted.length) return false;
  // 1 · The arrows: one row, one between every two boxes. They are the direction evidence.
  const arrows = model.texts.filter(isRight);
  const rows: TextBox[][] = [];
  for (const a of [...arrows].sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0)) {
    const row = rows.find((r) => Math.abs((r[0]!.y0 + r[0]!.y1) / 2 - (a.y0 + a.y1) / 2) <= 0.6 * (a.y1 - a.y0));
    if (row) row.push(a);
    else rows.push([a]);
  }
  const chains = rows.filter((r) => r.length === labels.length - 1);
  if (chains.length !== 1) return false;
  const row = [...chains[0]!].sort((p, q) => p.x0 - q.x0);
  const h = Math.max(...row.map((a) => a.y1 - a.y0));
  const band = { y0: Math.min(...row.map((a) => a.y0)) - 1.5 * h, y1: Math.max(...row.map((a) => a.y1)) + 1.5 * h };
  const inBand = model.texts.filter((t) => t.y1 > band.y0 && t.y0 < band.y1);
  // A left-pointing or double arrow in the figure's band: the direction is not the claim's.
  if (inBand.some(isOther)) return false;
  // 2 · The labels: what is printed in the band between the arrows, grouped into boxes.
  const printed = inBand.filter((t) => !row.includes(t));
  const groups = groupLines(printed).map((g) => ({ lines: [...g].sort((p, q) => p.y0 - q.y0), x0: Math.min(...g.map((b) => b.x0)), x1: Math.max(...g.map((b) => b.x1)), y0: Math.min(...g.map((b) => b.y0)), y1: Math.max(...g.map((b) => b.y1)) }))
    .sort((p, q) => p.x0 - q.x0);
  if (groups.length !== labels.length) return false;
  // 3 · In order, each arrow between its two neighbours and level with them, each box read as the claim's label.
  const joined = groups.map((g) => ({ ...g, text: g.lines.map((l) => l.text).join(" ") }));
  if (!joined.every((g, i) => clean(g.text) === wanted[i])) return false;
  const between = row.every((a, i) => {
    const l = joined[i]!, r = joined[i + 1]!;
    const mid = (a.y0 + a.y1) / 2;
    return l.x1 <= a.x0 && a.x1 <= r.x0 && mid >= l.y0 && mid <= l.y1 && mid >= r.y0 && mid <= r.y1;
  });
  if (!between) return false;
  // 4 · Four boxes really drawn, one per label.
  const everything = model.texts;
  return joined.every((g) => boxedAround(model, { text: g.text, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 }, everything.filter((t) => !g.lines.includes(t))));
}

/** The printed labels of the chain, only if the stored original corroborates them; null otherwise (never a guess). */
export async function corroborateFlow(deps: Pick<VisualDeps, "admin">, input: { materialId: string; sourceSha256: string | null; visual: AnalysisVisual }): Promise<string[] | null> {
  const claim = flowClaim(input.visual);
  if (!claim || !input.sourceSha256) return null;
  try {
    const source = await loadSource(deps, input.materialId, input.sourceSha256);
    if (!source || source.mime !== "application/pdf") return null;
    const { model } = await readPage(source.bytes, source.mime, input.visual.page, 100);
    return corroboratesFlow(model, claim) ? [...claim] : null;
  } catch {
    return null;
  }
}
