import { INK, gap, px, union, type PageModel, type Rect, type TextBox } from "./page-model";

/** Complete, regular lattice lines, read from the original pixels, not from the analysis or a model's bounding box. */
function gridLines(model: PageModel, mask: Uint8Array, r: Rect, vertical: boolean): number[] {
  const from = Math.ceil(vertical ? r.x0 : r.y0), to = Math.floor(vertical ? r.x1 : r.y1);
  const start = Math.ceil(vertical ? r.y0 : r.x0), end = Math.floor(vertical ? r.y1 : r.x1);
  const bands: number[][] = [];
  for (let a = from; a < to; a++) {
    let ink = 0;
    for (let b = start; b < end; b++) {
      const at = vertical ? b * model.width + a : a * model.width + b;
      if (!mask[at] && model.gray[at]! < INK) ink++;
    }
    if (ink < (end - start) * 0.9) continue;
    const last = bands.at(-1);
    if (last && a === last.at(-1)! + 1) last.push(a);
    else bands.push([a]);
  }
  const lines = bands.map((b) => (b[0]! + b.at(-1)!) / 2);
  if (lines.length < 3 || lines.length > 10) return [];
  const gaps = lines.slice(1).map((n, i) => n - lines[i]!);
  // Each rasterised stroke can round to either adjacent pixel; this is not a tolerance on mathematical values.
  return Math.max(...gaps) - Math.min(...gaps) <= 2 ? lines : [];
}

/**
 * Coordinate labels may sit further from a grid than ordinary figure marks. Include them only when EVERY cell has exactly
 * one aligned axis label, in A… / 1… order, and both pixel axes are complete and regular. Internal symbols stay as source pixels.
 */
export function withGridMarks(model: PageModel, mask: Uint8Array, r: Rect): Rect {
  if (Math.min(r.x1 - r.x0, r.y1 - r.y0) < px(model, 20)) return r;
  const columns = gridLines(model, mask, r, true), rows = gridLines(model, mask, r, false);
  if (columns.length < 3 || columns.length > 9 || rows.length < 3) return r;
  const close = (t: TextBox) => gap(r, t) <= Math.min(px(model, 12), (t.y1 - t.y0) * 2);
  const letters = model.texts.filter((t) => /^[A-H]$/.test(t.text) && t.y1 < r.y0 && close(t));
  const numbers = model.texts.filter((t) => /^[1-9]$/.test(t.text) && t.x1 < r.x0 && close(t));
  const aligned = (lines: number[], labels: TextBox[], vertical: boolean, alphabet: string): TextBox[] | null => {
    const out: TextBox[] = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const centre = (lines[i]! + lines[i + 1]!) / 2;
      const matches = labels.filter((t) => Math.abs((vertical ? (t.y0 + t.y1) : (t.x0 + t.x1)) / 2 - centre) <= (t.y1 - t.y0) / 2);
      if (matches.length !== 1 || matches[0]!.text !== alphabet[i]) return null;
      out.push(matches[0]!);
    }
    return out;
  };
  const x = aligned(columns, letters, false, "ABCDEFGH"), y = aligned(rows, numbers, true, "123456789");
  return x && y ? [...x, ...y].reduce(union, r) : r;
}
