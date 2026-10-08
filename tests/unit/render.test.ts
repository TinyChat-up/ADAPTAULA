import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { MaterialSheet } from "@/components/material/sheet";
import { NODE_RENDERERS } from "@/components/material/nodes";
import { TeacherPanel } from "@/components/material/teacher-panel";
import { parseBlanks, parseInline } from "@/lib/render/inline";
import { buildRenderModel, gradeLabel, type RenderModel } from "@/lib/render/model";
import { renderTokens } from "@/lib/render/tokens";
import { MATERIAL_RENDERER_VERSION } from "@/lib/render/version";
import { BlockSchema, MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { INFERRED_ANSWER, analysisWithInferredAnswer } from "../support/adaptation-ui-fixtures";
import { ANSWER_KEY_SECRET, BLANK_SECRET, bachillerato, geografia, primaria, stress, withBlocks, withPresentation } from "../support/render-fixtures";
import { contextFor, planOf } from "./adaptation-helpers";

const build = (doc: MaterialDocument, over: Partial<Parameters<typeof buildRenderModel>[1]> = {}) => buildRenderModel(doc, { mode: "student", deferred: [], ...over });
const html = (model: RenderModel) => renderToStaticMarkup(createElement(MaterialSheet, { model }));
const visible = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (markup: string, re: RegExp) => (markup.match(re) ?? []).length;

describe("registry: every block type has a renderer and nothing disappears silently", () => {
  it("1 · the schema's block types are exactly the renderer registry's (plus the visible `unknown`)", () => {
    const types = BlockSchema.options.map((o) => o.shape.type.value).sort();
    expect(types).toHaveLength(16);
    expect(Object.keys(NODE_RENDERERS).filter((k) => k !== "unknown").sort()).toEqual(types);
  });

  it("2/31 · an unknown block (fixture only: the schema is untouched) is detected, rendered visibly in the teacher view and makes the sheet not renderable", () => {
    const base = geografia();
    const broken = { ...base, pages: base.pages.map((p, i) => (i === 0 ? { blocks: p.blocks.map((b, j) => (j === 1 ? ({ ...b, type: "hologram" } as unknown as Block) : b)) } : p)) } as MaterialDocument;
    const student = build(broken);
    expect(student.validation.status).toBe("not_renderable");
    expect(student.validation.issues.map((i) => i.code)).toContain("unknown_block_type");
    expect(student.model.pages[0]!.nodes.some((n) => n.kind === "unknown")).toBe(true);
    expect(() => html(student.model)).not.toThrow();
    expect(visible(html(student.model))).not.toContain("hologram");
    const teacher = build(broken, { mode: "teacher_preview" });
    expect(visible(html(teacher.model))).toContain("hologram");
  });
});

describe("student view: separation of answers and internals", () => {
  const doc = primaria();
  const { model } = build(doc);
  const out = html(model);

  it("3 · the answer key (values, blanks, options) is in no part of the student model or markup, hidden or not", () => {
    expect(doc.answer_key.length).toBeGreaterThan(0);
    const dump = JSON.stringify(model) + out;
    expect(dump).not.toContain(ANSWER_KEY_SECRET);
    expect(dump).not.toContain(BLANK_SECRET);
    expect(dump).not.toMatch(/answer_key|correct_option|display:\s*none|(?<!aria-)hidden/i);
  });

  it("4 · an inferred answer of the analysis never reaches the sheet", () => {
    const analysis = analysisWithInferredAnswer();
    const context = contextFor(analysis, EXECUTIVE_EXPERIMENT_PROFILE);
    const built = buildDocument({ analysis, plan: planOf(analysis, context, []), context, generated: null, newBlockId: sequentialIds("i") });
    expect(JSON.stringify(built)).not.toContain(INFERRED_ANSWER);
    expect(html(build(built).model)).not.toContain(INFERRED_ANSWER);
  });

  it("5 · no trace, block, decision or source ids, and no debug data, in the student sheet", () => {
    expect(out).not.toMatch(/blk_|dec_\d|\bact_\d|\bctt_\d|\bvis_\d|\bprt_\d|trace|source_refs|origin|rendererVersion|material_renderer/);
    expect(JSON.stringify(model)).not.toMatch(/blk_|dec_\d|source_refs|trace/);
  });

  it("the header carries labels to fill in by hand, never a value", () => {
    expect(model.header.fields.length).toBeGreaterThan(0);
    expect(out).toContain('class="ms-field-line"');
    expect(model.header.grade).toBe("5.º Primaria");
    expect(gradeLabel("1-bachillerato")).toBe("1.º Bachillerato");
    expect(gradeLabel("x")).toBeNull();
  });

  it("fill-in-the-blank shows empty blanks, with the word bank but without the answers", () => {
    expect(out).toContain("ms-blank");
    expect(out).toContain("ms-wordbank");
    expect(visible(out)).not.toMatch(/\{\{/);
  });
});

describe("content fidelity", () => {
  it("6 · keeps the document's order; a writing help right after a writing activity travels inside it (before its answer space)", () => {
    const doc = bachillerato();
    const { model } = build(doc);
    // Flattened (an activity followed by its supports), the sheet is exactly the document, in order: nothing added or dropped.
    const kinds = model.pages.flatMap((p) => p.nodes.flatMap((n) => [n.kind, ...(n.kind === "activity" ? n.supports.map((s) => s.kind) : [])]));
    const blocks = doc.pages.flatMap((p) => p.blocks.map((b) => b.type));
    expect(kinds).toEqual(blocks);
    const top = model.pages.flatMap((p) => p.nodes);
    const w = top.map((n) => n.kind).lastIndexOf("activity");
    const writing = top[w]!;
    expect(writing.kind === "activity" && writing.supports.map((s) => s.kind)).toEqual(["planner"]);
    expect(top.slice(w + 1, w + 3).map((n) => n.kind)).toEqual(["checklist", "help_box"]);
    const out = html(model);
    expect(out.indexOf("ms-planner")).toBeLessThan(out.lastIndexOf('class="ms-answer"'));
  });

  it("12 · tables keep every header and cell exactly and in order", () => {
    const doc = geografia();
    const table = doc.pages.flatMap((p) => p.blocks).find((b) => b.type === "table")!;
    if (table.type !== "table") throw new Error("fixture");
    const out = html(build(doc).model);
    const cells = [...out.matchAll(/<(?:th|td)[^>]*>([^<]*)<\/(?:th|td)>/g)].map((m) => m[1]);
    const expected = [...table.headers, ...table.rows.flat()];
    let at = 0;
    for (const value of expected) {
      const found = cells.indexOf(value, at);
      expect(found, value).toBeGreaterThanOrEqual(0);
      at = found + 1;
    }
  });

  it("11/20 · unverified series never get a legend or an invented name; no data is lost; verified names are shown", () => {
    const single = html(build(primaria()).model);
    expect(single).not.toContain("ms-legend");
    const doc = geografia();
    const chart = doc.pages.flatMap((p) => p.blocks).find((b) => b.type === "chart" && b.series.length === 2)!;
    if (chart.type !== "chart") throw new Error("fixture");
    const geo = build(doc);
    const out = html(geo.model);
    expect(out).not.toMatch(/Serie \d|ms-legend/);
    expect(geo.validation.issues.map((i) => i.message).join(" ")).toContain("El material original no proporciona nombres verificados para estas series");
    expect(geo.validation.status).toBe("renderable_with_warnings");
    // Values, categories, unit/axis label and order all survive in the table.
    const table = out.slice(out.indexOf("ms-data"));
    for (const c of chart.categories) expect(table).toContain(`>${c}<`);
    const fmt = (n: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n);
    for (const s of chart.series) for (const v of s.values) expect(table).toContain(`>${fmt(v)}<`);
    expect(table).toContain(chart.y_label!);
    expect(table.indexOf(`>${fmt(chart.series[0]!.values[0]!)}<`)).toBeLessThan(table.indexOf(`>${fmt(chart.series[0]!.values[1]!)}<`));
    // Verified names do draw the chart and the legend.
    const named = withBlocks(geografia(), (b) => b.map((x) => (x.type === "chart" && x.series.length === 2 ? { ...x, series: [{ label: "Norte", values: x.series[0]!.values }, { label: "Sur", values: x.series[1]!.values }] } : x)));
    const namedOut = html(build(named).model);
    expect(namedOut).toContain("Norte");
    expect(namedOut).toContain("ms-legend");
    // Partially named series are ambiguous too.
    const partial = withBlocks(geografia(), (b) => b.map((x) => (x.type === "chart" && x.series.length === 2 ? { ...x, series: [{ label: "Norte", values: x.series[0]!.values }, { label: null, values: x.series[1]!.values }] } : x)));
    expect(html(build(partial).model)).not.toContain("ms-legend");
  });

  it("charts with data that cannot be plotted faithfully fall back to their data table", () => {
    const doc = withBlocks(geografia(), (b) => b.map((x) => (x.type === "chart" ? { ...x, series: [{ label: null, values: x.series[0]!.values.map((v) => -v) }] } : x)));
    const { model, validation } = build(doc);
    expect(validation.issues.map((i) => i.code)).toContain("chart_table_only");
    const chartHtml = html(model);
    expect(chartHtml).toContain("ms-data");
  });
});

describe("answer areas, planner and checklist are real writing and marking spaces", () => {
  it("13 · a long expected answer (150–180 palabras) gets room for it, bounded", () => {
    const { model } = build(bachillerato());
    const activity = model.pages.flatMap((p) => p.nodes).filter((n) => n.kind === "activity").at(-1)!;
    if (activity.kind !== "activity" || activity.response.kind !== "lines") throw new Error("fixture");
    expect(activity.response.lines).toBeGreaterThanOrEqual(Math.ceil(180 / 11));
    expect(activity.response.fromExpectedLength).toBe(true);
    const stressActivity = build(stress()).model.pages.flatMap((p) => p.nodes).find((n) => n.kind === "activity" && n.label === "Z")!;
    if (stressActivity.kind !== "activity" || stressActivity.response.kind !== "lines") throw new Error("fixture");
    expect(stressActivity.response.lines).toBe(40);
  });

  it("14 · a planner produces labelled writing areas with their lines, not running text", () => {
    const out = html(build(bachillerato()).model);
    expect(out).toContain("ms-planner");
    for (const label of ["Tesis", "Argumento 1", "Argumento 2", "Conclusión"]) expect(out).toContain(label);
    const planner = out.slice(out.indexOf("ms-planner"), out.indexOf('class="ms-answer"', out.indexOf("ms-planner")));
    expect(count(planner, /<div><\/div>/g)).toBe(2 + 3 + 3 + 2);
  });

  it("15 · a checklist produces one checkbox per item", () => {
    const out = html(build(bachillerato()).model);
    const checklist = out.slice(out.indexOf("ms-checklist"), out.indexOf('class="ms-help"'));
    expect(count(checklist, /class="ms-box"/g)).toBe(4);
    expect(checklist).toContain("He escrito una conclusión");
  });

  it("every response kind of the schema has an area with the right shape", () => {
    const out = html(build(primaria()).model);
    expect(out).toContain("ms-options"); // choice, order, true/false
    expect(out).toContain("ms-round"); // single choice
    expect(out).toContain("ms-tf");
    expect(out).toContain("ms-match");
    expect(out).toContain("ms-lines");
    const oral = withBlocks(geografia(), (b) => [...b, { id: "blk_o0001", type: "activity", prompt: "Cuéntalo.", response: { kind: "oral_or_alternative", mode: "oral", lines: 0 }, trace: { origin: "adapted", source_refs: [], decision_ids: [] } }], 1);
    expect(html(build(oral).model)).toContain("Respuesta oral");
    const none = withBlocks(geografia(), (b) => [...b, { id: "blk_n0001", type: "activity", prompt: "Solo lee.", response: { kind: "none" }, trace: { origin: "adapted", source_refs: [], decision_ids: [] } }], 1);
    expect(() => html(build(none).model)).not.toThrow();
  });
});

describe("deferred decisions and pagination", () => {
  const activityRef = (doc: MaterialDocument) => doc.pages.flatMap((p) => p.blocks).find((b) => b.type === "activity")!.trace.source_refs[0]!;

  it("7 · a supported deferred decision (segment/reorganize on an activity) is executed as presentation and reported as applied", () => {
    const doc = geografia();
    const ref = activityRef(doc);
    const { model, validation } = build(doc, { deferred: [{ id: "dec_4", target: ref, action: "segment" }] });
    expect(validation.deferred).toEqual([expect.objectContaining({ id: "dec_4", status: "applied", instruction: "isolate_activity" })]);
    expect(model.pages.flatMap((p) => p.nodes).filter((n) => n.kind === "activity" && n.isolate)).toHaveLength(1);
    expect(html(model)).toContain("data-isolate");
    // For the whole document: every activity is isolated, none is removed.
    const all = build(doc, { deferred: [{ id: "dec_9", target: "document", action: "reorganize" }] });
    const activities = doc.pages.flatMap((p) => p.blocks).filter((b) => b.type === "activity").length;
    expect(all.model.pages.flatMap((p) => p.nodes).filter((n) => n.kind === "activity" && n.isolate)).toHaveLength(activities);
  });

  it("8 · an unknown deferred decision does not break the sheet: it is reported as not applied (teacher view only)", () => {
    const doc = geografia();
    const { model, validation } = build(doc, { deferred: [{ id: "dec_7", target: activityRef(doc), action: "teleport" }, { id: "dec_8", target: "act_999", action: "segment" }] });
    expect(validation.deferred.map((d) => d.status)).toEqual(["unsupported", "not_applicable"]);
    expect(validation.status).toBe("renderable_with_warnings");
    expect(visible(html(model))).not.toMatch(/teleport|dec_7|no se ha podido aplicar/i);
    expect(model.pages.flatMap((p) => p.nodes).length).toBe(build(doc).model.pages.flatMap((p) => p.nodes).length);
  });

  it("an unknown set of deferred decisions is reported as unknown, never guessed", () => {
    expect(build(geografia(), { deferred: null }).validation.issues.map((i) => i.message).join(" ")).toMatch(/No se pudo comprobar/);
  });

  it("9/25 · max_tasks_per_page = 3 groups activities without removing any, and keeps a heading with its activity", () => {
    const base = geografia();
    const merged = MaterialDocumentSchema.parse({ ...base, pages: [{ blocks: base.pages.flatMap((p) => p.blocks) }] });
    const acts = merged.pages[0]!.blocks.filter((b) => b.type === "activity").length;
    expect(acts).toBeGreaterThanOrEqual(5);
    const { model } = build(withPresentation(merged, { max_tasks_per_page: 3 }));
    const perPage = model.pages.map((p) => p.nodes.filter((n) => n.kind === "activity").length);
    expect(Math.max(...perPage)).toBeLessThanOrEqual(3);
    expect(perPage.reduce((a, b) => a + b, 0)).toBe(acts);
    expect(model.pages.map((p) => p.number)).toEqual(model.pages.map((_, i) => i + 1));
    const withHeading = withBlocks(withPresentation(merged, { max_tasks_per_page: 1 }), (b) => {
      const i = b.findIndex((x, k) => x.type === "activity" && b.slice(0, k).some((y) => y.type === "activity"));
      return [...b.slice(0, i), { id: "blk_h0001", type: "heading", level: 2, text: "Segunda parte", trace: { origin: "structure", source_refs: [], decision_ids: [] } }, ...b.slice(i)];
    });
    const heading = build(withHeading).model.pages.find((p) => p.nodes.some((n) => n.kind === "heading" && n.text === "Segunda parte"))!;
    expect(heading.nodes.at(-1)!.kind).not.toBe("heading");
    expect(build(withPresentation(merged, { max_tasks_per_page: null })).model.pages).toHaveLength(1);
  });
});

describe("visuals and render status", () => {
  const fractions = primaria();
  const images = fractions.pages.flatMap((p) => p.blocks).filter((b) => b.type === "image");

  it("10 · a necessary original visual without an asset makes the sheet not renderable; a non-essential one only warns", () => {
    expect(images.length).toBeGreaterThan(0);
    const ref = (images[0]!.type === "image" && images[0]!.source.kind === "original" && images[0]!.source.visual_ref) as string;
    const required = build(fractions, { requiredVisuals: [ref] });
    expect(required.validation.status).toBe("not_renderable");
    expect(required.validation.issues.map((i) => i.code)).toContain("asset_missing");
    const optional = build(fractions, { requiredVisuals: [] });
    expect(optional.validation.status).toBe("renderable_with_warnings");
    // The student's sheet never invents a stand-in; the teacher's view marks the gap.
    expect(visible(html(build(fractions, { requiredVisuals: [ref] }).model))).not.toMatch(/Falta una imagen|<img/);
    expect(visible(html(build(fractions, { mode: "teacher_preview", requiredVisuals: [ref] }).model))).toContain("Falta una imagen necesaria");
  });

  it("an available asset is rendered with its description, a requested image is only pending (never faked on the student sheet)", () => {
    const ref = (images[0]!.type === "image" && images[0]!.source.kind === "original" && images[0]!.source.visual_ref) as string;
    const ok = build(fractions, { assets: { [ref]: { src: "/asset.png" } }, requiredVisuals: [ref] });
    expect(html(ok.model)).toContain('src="/asset.png"');
    expect(html(ok.model)).toMatch(/alt="(Figura \d|Tiras de fracciones|Recurso visual de la actividad)"/);
    expect(html(ok.model)).not.toContain("Rectángulo dividido"); // the analyzer's free description is never the text alternative
    expect(build(fractions, { assets: { [ref]: { src: "/asset.png" } }, requiredVisuals: [ref] }).validation.status).not.toBe("not_renderable");
    const requested = withBlocks(fractions, (b) => [...b, { id: "blk_r0001", type: "image", source: { kind: "requested", decision_id: "dec_1", purpose: "esquema", style: "diagram" }, alt_text: "Esquema previsto", trace: { origin: "support", source_refs: [], decision_ids: ["dec_1"] } }]);
    const pending = build(requested);
    expect(pending.validation.issues.map((i) => i.code)).toContain("image_pending");
    expect(html(pending.model)).not.toContain("Esquema previsto");
  });

  it("a clean document is renderable; a pedagogically approved one can still be not renderable (two separate dimensions)", () => {
    expect(build(bachillerato()).validation.status).toBe("renderable");
    expect(build(fractions, { requiredVisuals: images.flatMap((i) => (i.type === "image" && i.source.kind === "original" ? [i.source.visual_ref] : [])) }).validation.status).toBe("not_renderable");
  });
});

describe("overflow, tokens, determinism and print", () => {
  it("ten-column tables, very long words, long lists and big areas are accepted and flagged as flow risks, never dropped", () => {
    const { model, validation } = build(stress());
    const all = model.pages.flatMap((p) => p.nodes);
    expect(all.filter((n) => n.kind === "checklist").at(-1)).toMatchObject({ items: expect.any(Array) });
    expect(validation.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["overflow_risk"]));
    expect(validation.status).not.toBe("not_renderable");
    const out = html(model);
    expect(out).toContain("Supercalifragilistico");
    expect(count(out, /Elemento \d+ de una lista/g)).toBe(12);
    expect(count(out, /Apartado \d/g)).toBe(8);
  });

  it("is deterministic: the same document and options give the same model, twice", () => {
    const a = JSON.stringify(build(bachillerato()));
    expect(JSON.stringify(build(bachillerato()))).toBe(a);
    expect(build(bachillerato()).model.rendererVersion).toBe(MATERIAL_RENDERER_VERSION);
  });

  it("tokens modulate by presentation and stage; the document carries no CSS", () => {
    const doc = bachillerato();
    expect(JSON.stringify(doc)).not.toMatch(/\bpx\b|\bmm\b|font-size|grid-template|coordinates/);
    const base = renderTokens(doc.presentation, "bachillerato");
    const big = renderTokens({ ...doc.presentation, font_scale: 1.5, line_spacing: "loose", spacing: "wide" }, "primaria");
    expect(big.fontPt).toBeGreaterThan(base.fontPt);
    expect(big.lineHeight).toBeGreaterThan(base.lineHeight);
    expect(big.gapEm).toBeGreaterThan(base.gapEm);
    expect(big.answerLineMm).toBeGreaterThan(base.answerLineMm);
    expect(base.page).toEqual({ widthMm: 210, heightMm: 297, marginMm: 18 });
  });

  it("inline markup is parsed to runs, never to HTML; blanks lose their keys", () => {
    expect(parseInline("Organiza en **párrafos** y _revisa_.")).toEqual([{ text: "Organiza en " }, { text: "párrafos", bold: true }, { text: " y " }, { text: "revisa", italic: true }, { text: "." }]);
    expect(html(build(withBlocks(geografia(), (b) => [...b, { id: "blk_p0001", type: "paragraph", text: "<script>alert(1)</script> **negrita**", trace: { origin: "original", source_refs: [], decision_ids: [] } }])).model)).not.toContain("<script>");
    expect(parseBlanks("a {{x}} b")).toEqual([{ text: "a " }, { blank: true }, { text: " b" }]);
  });

  it("16 · print: app chrome, the teacher panel and the viewer controls are hidden; the sheet is A4 with page breaks and no colour dependence", () => {
    const css = readFileSync("src/components/material/material.css", "utf8");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toContain("size: A4");
    expect(print).toMatch(/\[data-app-chrome\], \.ms-chrome, \.ms-teacher \{ display: none !important/);
    expect(print).toMatch(/\.ms-sheet \{[^}]*break-after: page/);
    expect(css).not.toMatch(/#(?!fff|ececec|d9d9d9|888|555|222|bbb|000000|1a1a1a|4a4a4a|6b6b6b|e9eaec)[0-9a-f]{3,6}\b/i);
    const panel = renderToStaticMarkup(createElement(TeacherPanel, { validation: build(geografia(), { mode: "teacher_preview" }).validation, version: 1, observations: [] }));
    expect(panel).toContain("ms-teacher");
    expect(html(build(geografia(), { mode: "teacher_preview" }).model)).not.toContain("ms-teacher");
    expect(panel).not.toMatch(/prompt|razonamiento|diagn/i);
  });
});
