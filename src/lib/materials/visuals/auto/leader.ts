import { INK, gap, isLabel, px, type PageModel, type Rect } from "./page-model";

/**
 * A detached mark may belong to a figure when a thin, continuous horizontal leader reaches towards it from that figure.
 * Distance alone never adds a mark. Inspect the ORIGINAL component, not a bounding box already grown by other marks.
 */
export function hasLeader(model: PageModel, mask: Uint8Array, figure: Rect, mark: Rect & { text: string }): boolean {
  if (!isLabel(mark.text)) return false;
  const height = mark.y1 - mark.y0;
  if (height <= 0 || gap(figure, mark) > Math.min(px(model, 12), height * 1.5)) return false;
  const left = mark.x1 < figure.x0;
  const right = mark.x0 > figure.x1;
  if (!left && !right) return false;
  const direction = left ? 1 : -1;
  const start = left ? Math.ceil(figure.x0) : Math.floor(figure.x1) - 1;
  const length = Math.ceil(height * 2);
  const centre = (mark.y0 + mark.y1) / 2;
  const top = Math.max(0, Math.floor(centre - height / 2));
  const bottom = Math.min(model.height - 1, Math.ceil(centre + height / 2));
  let previous: number | null = null;
  for (let i = 0; i < length; i++) {
    const x = start + direction * i;
    if (x < figure.x0 || x >= figure.x1 || x < 0 || x >= model.width) return false;
    let min = bottom + 1, max = -1;
    for (let y = top; y <= bottom; y++) {
      const at = y * model.width + x;
      if (!mask[at] && model.gray[at]! < INK) { min = Math.min(min, y); max = Math.max(max, y); }
    }
    if (max < min || max - min + 1 > px(model, 1)) return false;
    const y = (min + max) / 2;
    if (previous !== null && Math.abs(y - previous) > px(model, 0.6)) return false;
    previous = y;
  }
  return true;
}
