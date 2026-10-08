import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { buildRenderModel, type RenderModel } from "@/lib/render/model";
import { tokenStyle, renderTokens } from "@/lib/render/tokens";
import { MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { FIXTURES, bachillerato, eso, primary, primaryStructured } from "../visual-qa/fixtures";

/**
 * Phase 8 · the student sheet's design rules (material_renderer@v3), checked on the markup the PDF prints. They are system rules:
 * the QA sheets only reveal them, nothing in the renderer knows about any of them.
 */

const build = (doc: MaterialDocument) => buildRenderModel(doc, { mode: "student", deferred: [], assets: {}, requiredVisuals: [] });
const html = (model: RenderModel) => renderToStaticMarkup(createElement(MaterialSheet, { model }));
const visible = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const css = readFileSync("src/components/material/material.css", "utf8");

describe("stage: only what the document states", () => {
  it("the model carries the document's stage and the sheet exposes it to the stylesheet", () => {
    expect(build(primary()).model.stage).toBe("primaria");
    expect(build(eso()).model.stage).toBe("eso");
    expect(build(bachillerato()).model.stage).toBe("bachillerato");
    expect(html(build(bachillerato()).model)).toContain('data-stage="bachillerato"');
  });

  it("an unknown stage is not guessed: no attribute, the common design", () => {
    const doc = MaterialDocumentSchema.parse({ ...eso(), meta: { ...eso().meta, stage: "fp" } });
    expect(build(doc).model.stage).toBeNull();
    expect(html(build(doc).model)).not.toContain("data-stage");
  });

  it("stage rules modulate density and tone only (the same blocks, the same answer spaces)", () => {
    for (const rule of css.match(/\[data-stage="[a-z]+"\][^{]*\{[^}]*\}/g) ?? []) expect(rule).not.toMatch(/display:\s*none|content:/);
  });
});

describe("answer spaces", () => {
  it("an activity that points at a table is answered in its cells: no second empty box", () => {
    const out = html(build(eso()).model);
    const activity = build(eso()).model.pages.flatMap((p) => p.nodes).find((n) => n.kind === "activity" && n.response.kind === "table_cells");
    expect(activity && activity.kind === "activity" && activity.response.kind === "table_cells" && activity.response.inTable).toBe(true);
    expect(out).not.toContain("ms-box-area");
  });

  it("a table answer without a table of the sheet still gets its writing box", () => {
    const doc = eso();
    const detached = MaterialDocumentSchema.parse({ ...doc, pages: doc.pages.map((p) => ({ blocks: p.blocks.map((b) => (b.type === "activity" ? { ...b, resource_block_ids: undefined } : b)) })) });
    expect(html(build(detached).model)).toContain("ms-box-area");
  });

  it("match: numbers on the left, LETTERS on the right, as printed text, and a box to write the letter", () => {
    const out = html(build(primary()).model);
    const match = out.slice(out.indexOf('class="ms-match"'));
    expect(visible(match)).toMatch(/1\. 1\/2.*2\. 1\/5.*3\. 2\/3.*A\. 4\/6.*B\. 2\/10.*C\. 5\/10/);
    expect((match.match(/ms-box-write/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("order: a box big enough for a handwritten number; a squared area ends in whole squares", () => {
    expect(html(build(primaryStructured()).model)).toContain("ms-box ms-box-write");
    const grid = /ms-grid-area" style="height:(\d+)mm"/.exec(html(build(primary()).model));
    expect(Number(grid![1]) % 6).toBe(0);
  });

  it("a word bank and sentence starters say what they are", () => {
    expect(visible(html(build(primary()).model))).toContain("Puedes usar:");
    expect(visible(html(build(eso()).model))).toContain("Puedes empezar así");
  });

  it("activities are separated by space, never by a rule that would read as one more writing line", () => {
    const activity = /\.ms-activity \{[^}]*\}/.exec(css)![0];
    expect(activity).not.toMatch(/border/);
    expect(css).toMatch(/\.ms-activity\[data-numbered\] > \.ms-answer \{ margin-left:/);
    expect(css).toMatch(/\.ms-activity-head \{[^}]*break-after: avoid/);
  });
});

describe("colour is a help, never the meaning", () => {
  it("high contrast turns every tone to black and white", () => {
    const high = tokenStyle(renderTokens({ ...primary().presentation, contrast: "high" }, "primaria"));
    for (const key of ["--ms-accent", "--ms-write", "--ms-rule-soft", "--ms-ink"]) expect(high[key]).toBe("#000000");
    expect(high["--ms-tint"]).toBe("#ffffff");
  });

  it("the accent prints as a dark grey (luminance below 30 %): headings and numbers stay readable in greyscale", () => {
    const hex = tokenStyle(renderTokens(primary().presentation, "primaria"))["--ms-accent"]!;
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    expect(0.299 * r! + 0.587 * g! + 0.114 * bl!).toBeLessThan(0.3);
  });
});

describe("student privacy on every QA sheet", () => {
  it.each(FIXTURES.map((f) => [f.name, f.doc] as const))("%s: no ids, traces, review, AI or teacher information", (_name, doc) => {
    const out = html(build(doc()).model);
    expect(out).not.toMatch(/blk_|dec_|need_|data-trace|ms-teacher|ms-missing/);
    expect(visible(out)).not.toMatch(/trace|decisi[oó]n|reviewer|revisor|confidence|prompt|\bIA\b|inteligencia artificial|diagn|docente|profesor/i);
  });
});
