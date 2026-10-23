import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractSpec } from "@/lib/materials/visuals/auto/extract";
import { locateVisuals } from "@/lib/materials/visuals/auto/locate";
import { components, inkFraction, px, textMask, type PageModel } from "@/lib/materials/visuals/auto/page-model";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { autoTargets } from "@/lib/materials/visuals/auto/service";
import { buildRenderModel } from "@/lib/render/model";
import type { VisualSpec } from "@/lib/visuals/spec";
import { fractionsCaseAnalysis, fractionsCaseDocument, fractionsPdf } from "../support/fractions-case";
import { OUT_DIR, printPdf } from "./harness";

/**
 * Phase 8.2B.1, end to end with the production engine (Chromium) and nothing simulated: the synthetic fractions sheet → the
 * automatic locator and extractor on the ORIGINAL → the adapted sheet with its reconstructions → the PDF. Then the PDF is read back
 * with the SAME deterministic reader, and its mathematical elements are compared with the original's: 8 parts and 3 shaded, a line
 * from 0 to 1 in quarters with the same labels, and two EMPTY comparison boxes. 0 model calls.
 */

const PDF = "application/pdf";
const analysis = fractionsCaseAnalysis();
const targets = autoTargets(analysis).map(({ id, shape, activityIds }) => ({ id, shape, activityIds }));
const activities = analysis.activities.map((a) => ({ id: a.id, label: a.label, instruction: a.instruction }));

/** The original's figures, as «Hacer magia» reads them (geometry only). */
async function originalSpecs(): Promise<Record<string, VisualSpec>> {
  const bytes = await fractionsPdf();
  const located = locateVisuals((await readPage(bytes, PDF, 1, 100)).model, targets, activities);
  const hi = (await readPage(bytes, PDF, 1, 200)).model;
  const out: Record<string, VisualSpec> = {};
  for (const l of located) {
    const extracted = extractSpec(hi, l.bounds!, targets.find((t) => t.id === l.visualId)!.shape);
    if (extracted.ok) out[l.visualId] = extracted.spec;
  }
  return out;
}

/** Empty square boxes of the comparison (about 9 mm) on a printed page. */
function answerBoxes(model: PageModel): number {
  const mask = textMask(model);
  return components(model, mask, 0.4).filter((c) => {
    const w = (c.x1 - c.x0) * model.mmPerPx;
    const h = (c.y1 - c.y0) * model.mmPerPx;
    if (Math.abs(w - 9) > 1.2 || Math.abs(h - 9) > 1.2) return false;
    const inset = px(model, 1.2);
    return inkFraction(model, { x0: c.x0 + inset, y0: c.y0 + inset, x1: c.x1 - inset, y1: c.y1 - inset }, mask) < 0.002;
  }).length;
}

describe("the fractions sheet, printed by Chromium and read back", () => {
  it("bar 3/8, number line 0–1 in quarters and two empty boxes survive the PDF, each on its activity's page", async () => {
    const figures = await originalSpecs();
    expect(Object.keys(figures).sort()).toEqual(["vis_1", "vis_2"]);
    const { document } = fractionsCaseDocument();
    const { model, validation } = buildRenderModel(document, { mode: "student", design: "claro", requiredVisuals: ["vis_1", "vis_2"], figures, assets: {}, deferred: [] });
    expect(validation.status).not.toBe("not_renderable");
    const printed = await printPdf("automatic-visuals-fractions", model);
    expect(printed.validation.issues).toEqual([]);
    expect(printed.result.blockedRequests).toEqual([]);
    expect(printed.print.html).not.toMatch(/<script|https?:\/\//);
    // answer_space@v1 gives the word problem its operations grid; with the profile's limit of visible tasks the sheet takes up to
    // three sheets of paper. What is checked below is that every figure stays on its activity's page.
    expect(printed.pages.length).toBeLessThanOrEqual(3);

    const report: Record<string, unknown> = { pages: printed.pages.length };
    const pages = await Promise.all(printed.pages.map((_, i) => readPage(printed.result.pdf, PDF, i + 1, 200)));
    const pageOf = (fragment: string) => printed.pages.findIndex((p) => p.text.includes(fragment));
    const barPage = pageOf("Observa la barra");
    const linePage = pageOf("Marca 3/4");
    expect(barPage).toBeGreaterThanOrEqual(0);
    expect(linePage).toBeGreaterThanOrEqual(0);

    // The same locator, on the PRINTED page: each figure is found in its own activity's zone.
    const onPage = (i: number) => locateVisuals(pages[i]!.model, targets, activities);
    const bar = onPage(barPage).find((l) => l.visualId === "vis_1")!;
    const line = onPage(linePage).find((l) => l.visualId === "vis_2")!;
    expect(bar).toMatchObject({ accepted: true, evidence: { placement: true } });
    expect(line).toMatchObject({ accepted: true, evidence: { placement: true } });
    const barSpec = extractSpec(pages[barPage]!.model, bar.bounds!, "bar");
    const lineSpec = extractSpec(pages[linePage]!.model, line.bounds!, "number_line");
    expect(barSpec).toMatchObject({ ok: true, spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } });
    expect(lineSpec).toMatchObject({ ok: true, spec: { kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4 } });
    if (lineSpec.ok && lineSpec.spec.kind === "number_line") expect(lineSpec.spec.labels.map((l) => l.text)).toEqual(["0", "1/4", "1/2", "3/4", "1"]);
    // Printed at the original's figures' equivalents: the same mathematics, compared element by element.
    expect(barSpec.ok && barSpec.spec).toEqual(figures.vis_1);
    expect(lineSpec.ok && lineSpec.spec).toEqual(figures.vis_2);

    const comparisonPage = pageOf("Compara las fracciones");
    expect(answerBoxes(pages[comparisonPage]!.model)).toBe(2);
    expect(printed.print.html.match(/data-answer-box/g)).toHaveLength(2);
    // No relation sign was printed in the boxes, and the analysis's answer is nowhere.
    const all = printed.pages.map((p) => p.text).join(" ");
    expect(all).not.toContain("3/8");
    Object.assign(report, { barPage: barPage + 1, linePage: linePage + 1, comparisonPage: comparisonPage + 1, bar: barSpec.ok ? barSpec.checks : null, line: lineSpec.ok ? lineSpec.checks : null });
    writeFileSync(path.join(OUT_DIR, "automatic-visuals-fractions", "report.json"), JSON.stringify(report, null, 2));
  });
});
