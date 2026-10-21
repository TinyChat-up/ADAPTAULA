import { describe, expect, it } from "vitest";
import { buildRenderModel, flatNodes } from "@/lib/render/model";
import { VisualSpecSchema } from "@/lib/visuals/spec";
import { editorDocument } from "../support/editor-document";

describe("CLARO: coherencia estructural en la salida compartida", () => {
  it("rechaza 0/0 incluso en la marca de valor cero", () => {
    expect(VisualSpecSchema.safeParse({ spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 0, text: "0/0" }] }).success).toBe(false);
  });
  it("no dibuja una reconstrucción resuelta con celdas inexistentes", () => {
    const doc = editorDocument();
    const image = doc.pages[0]!.blocks.find(b => b.type === "image")!;
    if (image.type !== "image") throw Error("fixture");
    image.source = { kind: "original", visual_ref: "vis_1" };
    const result = buildRenderModel(doc, { mode: "student", figures: { vis_1: { spec_version: 1, kind: "grid", rows: 2, cols: 2, shaded: [4] } } });
    expect(result.validation.status).toBe("not_renderable");
    expect(flatNodes(result.model.pages.flatMap(p => p.nodes)).some(n => n.kind === "image" && n.spec)).toBe(false);
  });
  it("agrupa la figura de uso exclusivo aunque haya un título entre ella y su consigna", () => {
    const doc = editorDocument();
    doc.pages[0]!.blocks.splice(3, 0, { id: "blk_section", type: "heading", level: 2, text: "Observa y explica", trace: { origin: "structure", source_refs: [], decision_ids: [] } });
    const result = buildRenderModel(doc, { mode: "student", design: "claro" });
    const task = flatNodes(result.model.pages.flatMap(p => p.nodes)).find(n => n.kind === "activity");
    expect(task?.kind === "activity" && task.figures.map(n => n.kind)).toEqual(["table", "image"]);
    expect(flatNodes(result.model.pages.flatMap(p => p.nodes)).filter(n => n.kind === "image")).toHaveLength(1);
  });
  it("no duplica recursos compartidos ni traslada figuras entre páginas lógicas", () => {
    const doc = editorDocument();
    const tasks = doc.pages[0]!.blocks.filter(b => b.type === "activity");
    if (tasks[1]?.type !== "activity") throw Error("fixture");
    tasks[1].resource_block_ids = ["blk_figure1"];
    const snapshot = JSON.stringify(doc);
    const out = buildRenderModel(doc, { mode: "student", design: "claro" });
    expect(flatNodes(out.model.pages.flatMap(p => p.nodes)).filter(n => n.kind === "image")).toHaveLength(1);
    expect(JSON.stringify(doc)).toBe(snapshot);
    const image = doc.pages[0]!.blocks.find(b => b.type === "image")!;
    doc.pages[0]!.blocks = doc.pages[0]!.blocks.filter(b => b !== image);
    doc.pages.unshift({ blocks: [image] });
    const separated = buildRenderModel(doc, { mode: "student", design: "claro" });
    expect(separated.model.pages[0]!.nodes.some(n => n.kind === "image")).toBe(true);
  });
});
