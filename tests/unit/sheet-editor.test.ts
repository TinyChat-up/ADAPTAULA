import { describe, expect, it } from "vitest";
import { applyEditorChanges, emptyChanges, EditorChangesSchema } from "@/lib/editor/changes";
import { changeHistory, historyOf, undoHistory, redoHistory } from "@/lib/editor/history";
import { sheetModel } from "@/lib/render/sheet-model";
import { flatNodes } from "@/lib/render/model";
import { editorDocument } from "../support/editor-document";
import { geografia, primaria, ANSWER_KEY_SECRET } from "../support/render-fixtures";

describe("teacher editor: restricted edits", () => {
  const original = geografia();
  const activity = original.pages.flatMap((p) => p.blocks).find((b) => b.type === "activity")!;
  it("changes only the requested text and preserves every other block, resource and the original", () => {
    const before = structuredClone(original);
    const result = applyEditorChanges(original, { presentation: { font_scale: 1.3 }, activities: [{ blockId: activity.id, prompt: "Lee los datos y explica tu decisión." }] });
    expect(original).toEqual(before);
    expect(result.contentBlocks).toEqual([activity.id]);
    expect(result.document.answer_key).toEqual(original.answer_key);
    const oldBlocks = original.pages.flatMap((p) => p.blocks), next = result.document.pages.flatMap((p) => p.blocks);
    expect(next.map((b) => b.id)).toEqual(oldBlocks.map((b) => b.id));
    for (const b of oldBlocks.filter((b) => b.id !== activity.id)) expect(next.find((n) => n.id === b.id)).toEqual(b);
    expect(result.document.presentation.font_scale).toBe(1.3);
    expect(next.find((b) => b.id === activity.id)!.trace.teacher_edited).toBe(true);
  });
  it("presentation edits do not claim a content change or an automatic review", () => {
    const result = applyEditorChanges(original, { presentation: { spacing: "wide", contrast: "high" }, activities: [] });
    expect(result.contentBlocks).toEqual([]);
    expect(result.document.pages).toEqual(original.pages);
    expect(result).not.toHaveProperty("validated");
  });
  it.each([
    { ...emptyChanges(), answer_key: [] },
    { ...emptyChanges(), pages: [] },
    { ...emptyChanges(), activities: [{ blockId: activity.id, response: { kind: "none" } }] },
    { ...emptyChanges(), activities: [{ blockId: activity.id, resource_block_ids: [] }] },
    { ...emptyChanges(), presentation: { text_alternatives_for_visuals: false } },
    { ...emptyChanges(), activities: [{ blockId: activity.id }, { blockId: activity.id }] },
  ])("rejects forged edits to protected structure or unsupported fields", (input) => {
    expect(EditorChangesSchema.safeParse(input).success).toBe(false);
  });
  it("rejects a missing block and changes to another response format", () => {
    expect(() => applyEditorChanges(original, { ...emptyChanges(), activities: [{ blockId: "blk_missing", prompt: "Otro texto" }] })).toThrow();
    const closed = primaria();
    const choice = closed.pages.flatMap((p) => p.blocks).find((b) => b.type === "activity" && b.response.kind !== "lines");
    if (!choice) throw new Error("fixture requires a non-lines activity");
    expect(() => applyEditorChanges(closed, { ...emptyChanges(), activities: [{ blockId: choice.id, lines: 10 }] })).toThrow();
  });
  it("a change to a number is always a content change, never silently presentation", () => {
    const result = applyEditorChanges(original, { ...emptyChanges(), activities: [{ blockId: activity.id, prompt: activity.prompt + " Usa 25 km." }] });
    expect(result.contentBlocks).toEqual([activity.id]);
  });
  it("the shared student projection still excludes answers and notes", () => {
    const edited = applyEditorChanges(original, { presentation: { font_scale: 1.15 }, activities: [] });
    const { model } = sheetModel({ document: edited.document, subjectName: null }, "student");
    expect(JSON.stringify(model)).not.toContain(ANSWER_KEY_SECRET);
    expect(model.design).toBe("claro");
  });
  it("can resize a box without changing its response format or the original", () => {
    const doc = editorDocument(), block = doc.pages[0]!.blocks.find((b) => b.type === "activity")!;
    block.response = { kind: "box", size: "small" };
    const result = applyEditorChanges(doc, { ...emptyChanges(), activities: [{ blockId: block.id, box: "large" }] });
    expect(result.document.pages[0]!.blocks.find((b) => b.id === block.id)).toMatchObject({ response: { kind: "box", size: "large" } });
    expect(block.response).toEqual({ kind: "box", size: "small" });
    expect(result.contentBlocks).toEqual([]);
  });
  it("reducing answer lines keeps the renderer's space for an explicit writing requirement", () => {
    const doc = editorDocument(), block = doc.pages[0]!.blocks.find((b) => b.type === "activity")!;
    block.requirements = ["Escribe entre 150 y 180 palabras."];
    const edited = applyEditorChanges(doc, { ...emptyChanges(), activities: [{ blockId: block.id, lines: 1 }] });
    const { model } = sheetModel({ document: edited.document, subjectName: null }, "student");
    const task = model.pages.flatMap((p) => flatNodes(p.nodes)).find((n) => n.kind === "activity" && n.response.kind === "lines");
    expect(task).toMatchObject({ response: { kind: "lines", fromExpectedLength: true } });
    if (task?.kind !== "activity" || task.response.kind !== "lines") throw new Error("missing task");
    expect(task.response.lines).toBeGreaterThan(1);
    expect(edited.document.pages[0]!.blocks.find((b) => b.id === block.id)).toMatchObject({ requirements: block.requirements });
  });
});

describe("undo, redo and recovery", () => {
  it("returns exactly to the original and redoes both text and presentation", () => {
    const a = emptyChanges(), b = { ...a, presentation: { font_scale: 1.3 as const } };
    const c = { ...b, activities: [{ blockId: "blk_test1", prompt: "Enunciado corregido" }] };
    const history = changeHistory(changeHistory(historyOf(a), b), c);
    expect(undoHistory(undoHistory(history)).present).toEqual(a);
    expect(redoHistory(redoHistory(undoHistory(undoHistory(history)))).present).toEqual(c);
    expect(redoHistory(undoHistory(history)).present).toEqual(c);
  });
  it("a new edit after undo clears redo; recovering a saved draft remains undoable", () => {
    const h = changeHistory(changeHistory(historyOf(0), 1), 2);
    expect(changeHistory(undoHistory(h), 3).future).toEqual([]);
    const recovered = changeHistory(h, 1);
    expect(undoHistory(recovered).present).toBe(2);
    expect(redoHistory(recovered).present).toBe(1);
  });
  it("keeps a bounded history without redundant snapshots", () => {
    let h = historyOf(0);
    for (let i = 1; i <= 100; i++) h = changeHistory(h, i);
    expect(h.past).toHaveLength(50);
    expect(changeHistory(h, 100)).toBe(h);
  });
});
