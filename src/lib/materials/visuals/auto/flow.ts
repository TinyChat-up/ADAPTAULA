import "server-only";
import { normalizeText } from "@/lib/adaptation/text";
import type { AnalysisVisual } from "@/lib/schemas/material-analysis";
import { flowClaim } from "@/lib/visuals/from-analysis";
import { loadSource, type VisualDeps } from "../service";
import type { PageModel, TextBox } from "./page-model";
import { readPage } from "./read";

/**
 * Evidence that a scheme of boxes and arrows really is what the analysis says it is. The analysis's `text` and `description` come
 * from the SAME model reading, so they are one claim, not two witnesses. What can corroborate it is the ORIGINAL itself:
 *   · the PDF's own text layer prints each label as its own text box (an uploaded image has none: no evidence, no figure);
 *   · each label is printed exactly once on the page, and they sit in ONE row (or one column), in the order of the chain;
 *   · between every two consecutive labels a CONTINUOUS line of ink crosses the middle of the gap (the connector), so the arrows are
 *     real: the borders of the boxes alone do not make a chain, and it is not just a list of words that happen to share a line.
 * Anything else (a label merged into a longer text box, a repeated label, another order, no ink between two boxes, an unreadable
 * page) gives nothing, and the need goes on to the next rung or to the honest stop. Pure over a `PageModel`; no model call.
 */
const boxText = (b: TextBox) => normalizeText(b.text).replace(/[^a-z0-9ñ ]/g, "").replace(/\s+/g, " ").trim();
const labelText = (l: string) => boxText({ text: l, x0: 0, y0: 0, x1: 0, y1: 0 });

/** A connector must cover this share of the central part of the gap without a break (the ends belong to the boxes' own borders). */
const MIN_CONNECTOR_RUN = 0.9;
const INK_THRESHOLD = 225;

/** Whether a continuous line of ink crosses the middle 60 % of the strip along `axis` on at least one scan line. */
function connectorCrosses(model: PageModel, strip: { x0: number; y0: number; x1: number; y1: number }, axis: "x" | "y"): boolean {
  const along0 = axis === "x" ? strip.x0 : strip.y0;
  const along1 = axis === "x" ? strip.x1 : strip.y1;
  const across0 = Math.ceil(axis === "x" ? strip.y0 : strip.x0);
  const across1 = Math.floor(axis === "x" ? strip.y1 : strip.x1);
  const from = Math.ceil(along0 + 0.2 * (along1 - along0));
  const to = Math.floor(along1 - 0.2 * (along1 - along0));
  if (to <= from) return false;
  for (let line = across0; line <= across1; line++) {
    let ink = 0;
    for (let p = from; p <= to; p++) {
      const x = axis === "x" ? p : line;
      const y = axis === "x" ? line : p;
      if ((model.gray[y * model.width + x] ?? 255) < INK_THRESHOLD) ink++;
    }
    if (ink / (to - from + 1) >= MIN_CONNECTOR_RUN) return true;
  }
  return false;
}

export function corroboratesFlow(model: PageModel, labels: readonly string[]): boolean {
  if (labels.length < 2 || new Set(labels.map(labelText)).size !== labels.length) return false;
  const found: TextBox[] = [];
  for (const label of labels) {
    const matches = model.texts.filter((t) => boxText(t) === labelText(label));
    if (matches.length !== 1) return false;
    found.push(matches[0]!);
  }
  const center = (b: TextBox, axis: "x" | "y") => (axis === "x" ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2);
  const height = (b: TextBox) => b.y1 - b.y0;
  const width = (b: TextBox) => b.x1 - b.x0;
  // One row (left to right) or one column (top to bottom), in the order of the chain.
  const row = found.every((b) => Math.abs(center(b, "y") - center(found[0]!, "y")) <= 0.5 * Math.max(height(b), height(found[0]!))) && found.every((b, i) => i === 0 || b.x0 >= found[i - 1]!.x1);
  const column = found.every((b) => Math.abs(center(b, "x") - center(found[0]!, "x")) <= 0.5 * Math.max(width(b), width(found[0]!))) && found.every((b, i) => i === 0 || b.y0 >= found[i - 1]!.y1);
  if (!row && !column) return false;
  return found.every((b, i) => {
    if (i === 0) return true;
    const a = found[i - 1]!;
    const strip = row ? { x0: a.x1, y0: Math.min(a.y0, b.y0), x1: b.x0, y1: Math.max(a.y1, b.y1) } : { x0: Math.min(a.x0, b.x0), y0: a.y1, x1: Math.max(a.x1, b.x1), y1: b.y0 };
    return strip.x1 > strip.x0 && strip.y1 > strip.y0 && connectorCrosses(model, strip, row ? "x" : "y");
  });
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
