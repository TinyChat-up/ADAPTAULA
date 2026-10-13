import "server-only";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { tableText, usableChoiceTable, type ChoiceTable, type TableEvidence } from "@/lib/adaptation/table-choice";
import type { AnalysisVisual } from "@/lib/schemas/material-analysis";
import { loadSource, type VisualDeps } from "../service";
import { components, inkFraction, textMask, type PageModel, type Rect } from "./page-model";
import { readPage } from "./read";

/** Full grid rules, not word presence: a value in the wrong column or a missing row must never corroborate a transcription. */
function rules(model: PageModel, rect: Rect, vertical: boolean): number[] {
  const from = Math.round(vertical ? rect.x0 : rect.y0), to = Math.round(vertical ? rect.x1 : rect.y1);
  const acrossFrom = Math.ceil(vertical ? rect.y0 : rect.x0), acrossTo = Math.floor(vertical ? rect.y1 : rect.x1);
  const groups: number[][] = [];
  for (let pos = from; pos <= to; pos++) {
    let dark = 0;
    for (let a = acrossFrom; a < acrossTo; a++) if ((model.gray[(vertical ? a : pos) * model.width + (vertical ? pos : a)] ?? 255) < 180) dark++;
    if (dark / (acrossTo - acrossFrom) < 0.9) continue;
    const last = groups.at(-1);
    if (last && pos - last.at(-1)! <= 2) last.push(pos); else groups.push([pos]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** Test each segment too: a mostly continuous rule can hide a merged cell. */
function edgePresent(model: PageModel, from: number, to: number, fixed: number, vertical: boolean): boolean {
  let dark = 0;
  const start = Math.ceil(from), end = Math.floor(to), at = Math.round(fixed);
  for (let p = start; p <= end; p++) if ((model.gray[(vertical ? p : at) * model.width + (vertical ? at : p)] ?? 255) < 180) dark++;
  return end >= start && dark / (end - start + 1) >= 0.9;
}

export function corroboratesTable(model: PageModel, table: ChoiceTable): boolean {
  if (!usableChoiceTable(table)) return false;
  const expected = [table.headers, ...table.rows];
  let matches = 0;
  for (const rect of components(model, textMask(model))) {
    if (rect.x1 - rect.x0 < 60 || rect.y1 - rect.y0 < 25) continue;
    const xs = rules(model, rect, true), ys = rules(model, rect, false);
    if (xs.length !== table.headers.length + 1 || ys.length !== expected.length + 1) continue;
    const texts = model.texts.filter((t) => t.x0 >= xs[0]! && t.x1 <= xs.at(-1)! && t.y0 >= ys[0]! && t.y1 <= ys.at(-1)!);
    if (texts.length !== expected.length * table.headers.length) continue;
    const ok = expected.every((row, r) => row.every((cell, c) => {
      if (![xs[c]!, xs[c + 1]!].every((x) => edgePresent(model, ys[r]!, ys[r + 1]!, x, true))
        || ![ys[r]!, ys[r + 1]!].every((y) => edgePresent(model, xs[c]!, xs[c + 1]!, y, false))) return false;
      const inCell = texts.filter((t) => t.x0 > xs[c]! && t.x1 < xs[c + 1]! && t.y0 > ys[r]! && t.y1 < ys[r + 1]!);
      return inCell.length === 1 && tableText(inCell[0]!.text) === tableText(cell) && inkFraction(model, inCell[0]!) > 0.01;
    }));
    if (ok) matches++;
  }
  return matches === 1;
}

export async function corroborateTable(deps: Pick<VisualDeps, "admin">, input: { materialId: string; sourceSha256: string | null; visual: AnalysisVisual }): Promise<TableEvidence | null> {
  if (!input.visual.table || !usableChoiceTable(input.visual.table) || !input.sourceSha256) return null;
  try {
    const source = await loadSource(deps, input.materialId, input.sourceSha256);
    if (!source || source.mime !== "application/pdf") return null;
    const { model } = await readPage(source.bytes, source.mime, input.visual.page, 100);
    return corroboratesTable(model, input.visual.table) ? { method: "pdf_grid_text_v1", sourceSha256: input.sourceSha256, page: input.visual.page, tableSha256: fingerprint(input.visual.table) } : null;
  } catch { return null; }
}
