import { describe, expect, it } from "vitest";
import { buildRenderModel } from "@/lib/render/model";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";

/** With a task limit per page, a worked example travels with the activity it belongs to, never with the next one. */
const sheet = (exampleRef: string) => {
  const example = { id: "blk_0003", type: "worked_example", problem: "Calcula 1/7 + 3/7.", steps: ["Sumo los numeradores."], result: "4/7", trace: { origin: "support", source_refs: [exampleRef], decision_ids: ["dec_2"] } };
  const act = (id: string, ref: string, label: string) => ({ id, type: "activity", label, prompt: `Actividad ${label}.`, response: { kind: "lines", lines: 1 }, trace: { origin: "original", source_refs: [ref], decision_ids: [] } });
  const blocks = [act("blk_0001", "act_1", "1"), example, act("blk_0002", "act_2", "2")];
  return MaterialDocumentSchema.parse({
    schema_version: 1,
    meta: { title: "Ficha", language: "es", stage: "primaria", grade: "4-primaria", subject: "matematicas", topic: "Fracciones" },
    presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: 1, color_independent: true, text_alternatives_for_visuals: true },
    admin_fields: [],
    pages: [{ blocks }],
    answer_key: [],
  });
};
const pages = (doc: ReturnType<typeof sheet>) => buildRenderModel(doc, { mode: "student" }).model.pages.map((p) => p.nodes.map((n) => n.kind));

describe("pagination of a worked example", () => {
  it("an example of the NEXT activity (placed before it) moves to its page with it", () => {
    expect(pages(sheet("act_2"))).toEqual([["activity"], ["worked_example", "activity"]]);
  });

  it("an example of the PREVIOUS activity (sheets assembled before this change) stays where it was", () => {
    expect(pages(sheet("act_1"))).toEqual([["activity", "worked_example"], ["activity"]]);
  });
});
