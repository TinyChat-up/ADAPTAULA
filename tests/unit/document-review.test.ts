import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { DocumentComparison } from "@/components/workspace/document-comparison";
import { sheetModel } from "@/lib/render/sheet-model";
import { activityLocations } from "@/lib/editor/selection";
import { applyEditorChanges } from "@/lib/editor/changes";
import { editorDocument } from "../support/editor-document";

const project = (document = editorDocument()) => sheetModel({ document, subjectName: "Matemáticas" }, "student").model;
describe("selección contextual sobre la proyección CLARO", () => {
  it("relaciona las actividades por orden preservado, con tablas y figuras agrupadas", () => {
    const doc = editorDocument();
    const model = project(doc);
    expect(activityLocations(doc, model).map((l) => l.id)).toEqual(["blk_task1", "blk_task2"]);
    expect(model.pages[0]!.nodes.find((n) => n.kind === "activity")).toMatchObject({ figures: expect.arrayContaining([expect.objectContaining({ kind: "table" }), expect.objectContaining({ kind: "image" })]) });
  });
  it("conserva la asociación al distribuir tareas en páginas y editar el enunciado", () => {
    const doc = editorDocument();
    doc.presentation.max_tasks_per_page = 1;
    const edited = applyEditorChanges(doc, { presentation: { font_scale: 1.3 }, activities: [{ blockId: "blk_task2", prompt: "Elige entre 25 cm y 40 cm." }] }).document;
    expect(activityLocations(edited, project(edited)).map((l) => [l.id, l.page])).toEqual([["blk_task1", 1], ["blk_task2", 2]]);
  });
  it("no busca por texto o etiqueta cuando se repiten", () => {
    const doc = editorDocument();
    for (const block of doc.pages[0]!.blocks) if (block.type === "activity") { block.label = "A"; block.prompt = "Explica tu elección."; }
    const locations = activityLocations(doc, project(doc));
    expect(locations.map((l) => l.id)).toEqual(["blk_task1", "blk_task2"]);
    expect(new Set(locations.map((l) => l.key)).size).toBe(2);
  });
  it.each(["missing", "changed", "reordered"])("rechaza una proyección discordante (%s)", (kind) => {
    const doc = editorDocument();
    const model = project(doc);
    const nodes = model.pages[0]!.nodes;
    if (kind === "missing") model.pages[0]!.nodes = nodes.filter((n) => n.kind !== "activity");
    else if (kind === "reordered") nodes.reverse();
    else { const task = nodes.find((n) => n.kind === "activity")!; task.prompt = [[{ text: "Otra actividad" }]]; }
    expect(activityLocations(doc, model)).toEqual([]);
  });
  it("la interacción de pantalla no se incluye en el render imprimible ni elimina páginas", () => {
    const doc = editorDocument(); doc.presentation.max_tasks_per_page = 1;
    const model = project(doc), before = JSON.stringify(model);
    const locations = activityLocations(doc, model);
    const selection = { targets: Object.fromEntries(locations.map((l) => [l.key, l])), selected: "blk_task2", onSelect: () => {} };
    const interactive = renderToStaticMarkup(createElement(MaterialSheet, { model, selection, visiblePage: 2 }));
    expect(interactive).toContain('aria-pressed="true"');
    expect(interactive).toContain('hidden=""');
    expect(interactive).toContain('Página 2 de 2');
    const printable = renderToStaticMarkup(createElement(MaterialSheet, { model }));
    expect(printable.match(/class="ms-sheet"/g)).toHaveLength(2);
    expect(printable).not.toMatch(/role="button"|data-editor-selected|aria-pressed|hidden=""|CLAVE_RESERVADA|NOTA_RESERVADA/);
    expect(JSON.stringify(model)).toBe(before);
  });
});
describe("comparación de revisiones guardadas", () => {
  it("no ofrece edición en solo lectura ni un borrador que no se ha podido cargar", () => {
    const html = renderToStaticMarkup(createElement(DocumentComparison, { adaptationId: "id", original: "Original", generated: { model: project(), printable: true }, draft: null, draftError: true, canWrite: false, baseVersion: 1 }));
    expect(html).toContain("No se puede mostrar el borrador guardado.");
    expect(html).not.toContain("/editar");
    expect(html).not.toContain('value="draft"');
  });
  it("no ofrece PDF cuando la ficha está bloqueada", () => {
    const html = renderToStaticMarkup(createElement(DocumentComparison, { adaptationId: "id", original: "Original", generated: { model: project(), printable: false }, draft: null, draftError: false, canWrite: false, baseVersion: 1 }));
    expect(html).toContain("todavía no se puede mostrar completa");
    expect(html).not.toContain("Descargar PDF");
  });
});
