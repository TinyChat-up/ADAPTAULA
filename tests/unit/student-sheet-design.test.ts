import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { buildRenderModel, type RenderModel } from "@/lib/render/model";
import { tokenStyle, renderTokens } from "@/lib/render/tokens";
import { MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { FIXTURES, bachillerato, eso, primary, primaryStructured, visualCrop } from "../visual-qa/fixtures";
import { composeMath } from "@/lib/render/math";
import { pilotBachillerato, pilotPrimary } from "../visual-qa/pilots";

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
    const doc = MaterialDocumentSchema.parse({ ...primary(), pages: [{ blocks: [...primary().pages[0]!.blocks, { id: "blk_qagrid1", type: "activity", label: "9", prompt: "Calcula.", response: { kind: "grid" }, trace: { origin: "adapted", source_refs: [], decision_ids: [] } }] }] });
    const grid = /ms-grid-area" style="height:(\d+)mm"/.exec(html(build(doc).model));
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

describe("Sistema CLARO (pilot, behind a render option)", () => {
  const claro = (doc: MaterialDocument) => buildRenderModel(doc, { mode: "student", deferred: [], design: "claro" });

  it("is opt-in: by default nothing changes (no attribute, no brand, the same numbers)", () => {
    const out = html(build(pilotPrimary()).model);
    expect(build(pilotPrimary()).model.design).toBe("standard");
    expect(out).not.toMatch(/data-design|ms-brand|ms-cue|>01</);
  });

  it("the same blocks through the same renderer: header with a discreet mark, guide numbers 01/02, reading and visual cues", () => {
    const out = html(claro(pilotPrimary()).model);
    expect(out).toContain('data-design="claro"');
    expect(visible(out)).toMatch(/Ciencias de la Naturaleza · 4\.º Primaria Adaptaula/);
    expect(out).toMatch(/class="ms-num">01<\/span>[\s\S]*class="ms-num">02<\/span>/);
    expect(visible(out)).toContain("Lee");
  });

  it("every CLARO rule is scoped to the variant (it cannot leak into the current sheets)", () => {
    const block = css.slice(css.indexOf("ADAPTAULA · SISTEMA CLARO"), css.indexOf("/* Marco de la vista"));
    const selectors = block.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^{}\n]+(?=\{)/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(20);
    for (const sel of selectors) expect(sel.trim()).toMatch(/^(\[data-design="claro"\]|:is)/);
    for (const sel of selectors) expect(sel).toContain('[data-design="claro"]');
  });

  it("the stage sets the tone (type scale); the profile can still enlarge it at any stage", () => {
    const pri = claro(pilotPrimary()).model.tokens.fontPt;
    const bach = claro(pilotBachillerato()).model.tokens.fontPt;
    expect([pri, bach]).toEqual([12.5, 11.3]);
    const big = buildRenderModel(MaterialDocumentSchema.parse({ ...pilotBachillerato(), presentation: { ...pilotBachillerato().presentation, font_scale: 1.3 } }), { mode: "student", deferred: [], design: "claro" });
    expect(big.model.tokens.fontPt).toBeGreaterThan(pri);
    expect(big.model.stage).toBe("bachillerato");
  });

  it("palette: petroleum and fog only as CLARO tokens; high contrast is black and white", () => {
    const normal = tokenStyle(renderTokens(pilotPrimary().presentation, "primaria", "claro"));
    expect([normal["--ms-accent"], normal["--ms-petrol"], normal["--ms-fog"]]).toEqual(["#23426b", "#227e81", "#eff3f7"]);
    const high = tokenStyle(renderTokens({ ...pilotPrimary().presentation, contrast: "high" }, "primaria", "claro"));
    expect([high["--ms-petrol"], high["--ms-fog"]]).toEqual(["#000000", "#ffffff"]);
  });

  it.each([["piloto-primaria", pilotPrimary], ["piloto-bachillerato", pilotBachillerato]] as const)("%s: no ids, traces, review, AI, profile or teacher information", (_n, doc) => {
    const out = html(claro(doc()).model);
    expect(out).not.toMatch(/blk_|dec_|need_|ms-teacher|ms-missing/);
    expect(visible(out)).not.toMatch(/decisi[oó]n|revisor|prompt|\bIA\b|diagn|docente|perfil|adaptaci[oó]n|TDAH|dislex/i);
  });
});

describe("Sistema CLARO on the five complete sheets · reusable rules", () => {
  const claroModel = (doc: MaterialDocument) => buildRenderModel(doc, { mode: "student", deferred: [], design: "claro", assets: {}, requiredVisuals: [] }).model;
  const activities = (m: RenderModel) => m.pages.flatMap((p) => p.nodes).filter((n) => n.kind === "activity");

  it("a writing help right after a writing activity is shown inside it: prompt and requirements → help → answer space", () => {
    const d = claroModel(bachillerato());
    const essay = activities(d).find((a) => a.kind === "activity" && a.supports.length > 0)!;
    expect(essay.kind === "activity" && [essay.label, essay.supports.map((s) => s.kind)]).toEqual(["3", ["planner"]]);
    const out = html(d);
    const at = out.indexOf('class="ms-activity-supports"');
    expect(out.lastIndexOf("Entre 150 y 200 palabras", at)).toBeGreaterThan(-1);
    expect(out.indexOf('class="ms-answer"', at)).toBeGreaterThan(at);
    const c = activities(claroModel(eso())).find((a) => a.kind === "activity" && a.label === "4")!;
    expect(c.kind === "activity" && c.supports.map((s) => s.kind)).toEqual(["sentence_starters"]);
  });

  it("a help after a non-writing activity, or a checklist after an essay, stays a block of its own", () => {
    const d = claroModel(bachillerato());
    expect(d.pages.flatMap((p) => p.nodes).some((n) => n.kind === "checklist")).toBe(true);
  });

  it("closing a page for «max tasks per page» carries the heading, orientation or help that leads into the next activity", () => {
    const pages = claroModel(primaryStructured()).pages;
    const second = pages[1]!.nodes;
    expect(second[0]!.kind).toBe("help_box");
    expect(second[1]!.kind).toBe("activity");
    expect(pages.every((p) => p.nodes.filter((n) => n.kind === "activity").length <= 3)).toBe(true);
  });

  it("an activity answered in a table of the sheet is kept with it when paginating", () => {
    const out = html(claroModel(eso()));
    expect(out).toMatch(/data-table-answer="true"/);
    expect(out.indexOf("data-table-answer")).toBeLessThan(out.indexOf("Tabla 1. Estructuras celulares"));
  });

  it("school fractions are composed stacked; anything beyond the subset keeps its source and spoken text", () => {
    expect(composeMath("\\frac{1}{2} = \\frac{1 \\times 2}{2 \\times 2}")).toEqual([
      { kind: "frac", num: "1", den: "2" },
      { kind: "text", text: " = " },
      { kind: "frac", num: "1 × 2", den: "2 × 2" },
    ]);
    expect(composeMath("\\sqrt{2}")).toBeNull();
    expect(composeMath("\\int_0^1 x\\,dx")).toBeNull();
    const out = html(claroModel(primary()));
    expect(out).toContain('class="ms-frac"');
    expect(out).toMatch(/role="math" aria-label="un medio es igual a/);
  });

  it("CLARO labels what is observed (charts, images) and reading; the decoration of the profile still reduces surfaces", () => {
    expect(visible(html(claroModel(visualCrop())))).toMatch(/Observa .*Precipitaciones por estación/);
    expect(css).toMatch(/\[data-design="claro"\]\[data-decoration\] :is\(\.ms-help, \.ms-help\[data-variant\]/);
    expect(css).toMatch(/\[data-design="claro"\]\[data-decoration="reduced"\] :is\(\.ms-instruction/);
  });

  it.each(FIXTURES.map((f) => [f.name, f.doc] as const))("%s in CLARO: no ids, traces, review, AI, profile or teacher information", (_n, doc) => {
    const out = html(claroModel(doc()));
    expect(out).toContain('data-design="claro"');
    expect(out).not.toMatch(/blk_|dec_|need_|ms-teacher|ms-missing/);
    expect(visible(out)).not.toMatch(/decisi[oó]n|revisor|prompt|\bIA\b|diagn|docente|perfil|adaptaci[oó]n|TDAH|dislex|memoria de trabajo/i);
  });
});

describe("pedagogical corrections of the QA sheets (content, not CSS)", () => {
  const blocks = (doc: MaterialDocument) => doc.pages.flatMap((p) => p.blocks);

  it("A · the 3/5 activity is answered in a table of operations, not in a generic grid; an analogous example comes first", () => {
    const all = blocks(primary());
    expect(all.some((x) => x.type === "activity" && x.response.kind === "grid")).toBe(false);
    const seven = all.findIndex((x) => x.type === "activity" && x.label === "7");
    expect(all[seven + 1]!.type).toBe("table");
    expect(all.findIndex((x) => x.type === "math")).toBeLessThan(seven);
  });

  it("B · each part of the reading is followed by its question, and the three terms are named before they are assessed", () => {
    const all = blocks(primaryStructured());
    const kinds = all.map((x) => x.type);
    expect(kinds.slice(2, 8)).toEqual(["reading_text", "activity", "reading_text", "activity", "reading_text", "activity"]);
    const text = JSON.stringify(all.filter((x) => x.type === "reading_text"));
    for (const term of ["evaporación", "condensación", "precipitación"]) expect(text).toContain(term);
    const draw = all.find((x) => x.type === "activity" && x.response.kind === "box")!;
    const scheme = all.findIndex((x) => x.type === "activity" && x.response.kind === "fill_blank");
    expect(scheme).toBeLessThan(all.indexOf(draw));
  });

  it("C · the table instruction comes before the table; «frases completas» only where the answer is written", () => {
    const all = blocks(eso());
    const table = all.findIndex((x) => x.type === "table");
    const before = all[table - 1]!;
    expect(before.type === "activity" && before.response.kind).toBe("table_cells");
    expect(JSON.stringify(all.filter((x) => x.type === "instruction"))).not.toMatch(/frases completas/i);
  });

  it("E · the climograph and the seasonal chart tell the same data; the instruction separates observation from prior knowledge", async () => {
    const { CLIMATE } = await import("../visual-qa/fixtures");
    const chart = blocks(visualCrop()).find((x) => x.type === "chart")!;
    const r = CLIMATE.rainMm;
    expect(chart.type === "chart" && chart.series[0]!.values).toEqual([r[11]! + r[0]! + r[1]!, r[2]! + r[3]! + r[4]!, r[5]! + r[6]! + r[7]!, r[8]! + r[9]! + r[10]!]);
    expect(CLIMATE.months).toHaveLength(12);
    const instruction = blocks(visualCrop()).find((x) => x.type === "instruction")!;
    expect(instruction.type === "instruction" && instruction.text).toMatch(/lo que has estudiado/);
    expect(instruction.type === "instruction" && instruction.text).not.toMatch(/Todas las respuestas están en la imagen/);
  });
});
