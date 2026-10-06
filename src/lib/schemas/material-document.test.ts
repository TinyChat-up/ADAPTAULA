import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeneratedSegmentsSchema, ImageBriefSchema, RevisedBlockSchema } from "./ai-contracts";
import { AdaptationPlanSchema, DraftAdaptationPlanSchema } from "./adaptation-plan";
import { BlockIdSchema, DraftMaterialDocumentSchema, MaterialDocumentSchema, createBlockId, finalizeDocument, type DraftMaterialDocument } from "./material-document";
import { AiReviewDraftSchema, PedagogicalReviewSchema } from "./pedagogical-review";

const presentation = { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "reduced", max_tasks_per_page: null, color_independent: false, text_alternatives_for_visuals: false } as const;
const trace = { origin: "original", source_refs: ["act_1"], decision_ids: [] } as const;

function draft(blocks: unknown[], answer_key: unknown[] = []): DraftMaterialDocument {
  return DraftMaterialDocumentSchema.parse({
    schema_version: 1,
    meta: { title: "Fracciones", language: "es", stage: "primaria", grade: "5-primaria", subject: "Matemáticas", topic: null },
    presentation,
    admin_fields: [{ type: "student_name", label: "Nombre" }],
    pages: [{ blocks }],
    answer_key,
  });
}

const choiceActivity = {
  id: "q1",
  type: "activity",
  label: "1",
  prompt: "¿Qué fracción es igual a 1/2?",
  response: { kind: "choice", options: [{ id: "a", text: "2/4" }, { id: "b", text: "1/3" }], multiple: false },
  trace,
};

describe("MaterialDocument v1 (semantic, renderable, traceable)", () => {
  it("separates the answer key from student content: blocks have no answer fields at all", () => {
    const doc = draft([choiceActivity], [{ block_id: "q1", basis: "new_item", correct_option_ids: ["a"] }]);
    const block = doc.pages[0]!.blocks[0]!;
    expect(Object.keys(block)).not.toEqual(expect.arrayContaining(["answer", "correct_option_ids", "solution"]));
    expect(doc.answer_key[0]).toMatchObject({ basis: "new_item", correct_option_ids: ["a"] });
  });

  it("rejects an answer key that points to a missing option or to something that is not an activity", () => {
    expect(() => draft([choiceActivity], [{ block_id: "q1", basis: "new_item", correct_option_ids: ["z"] }])).toThrow(/Opción correcta inexistente/);
    expect(() => draft([{ id: "p", type: "paragraph", text: "Hola", trace }], [{ block_id: "p", basis: "source", value: "x" }])).toThrow(/no es una actividad/);
  });

  it("keeps presentation semantic: no CSS, no coordinates, no HTML", () => {
    const schema = JSON.stringify(z.toJSONSchema(MaterialDocumentSchema, { io: "input" }));
    for (const property of ["css", "class", "x", "y", "top", "width", "height", "position", "html", "color", "font_family"]) expect(schema).not.toContain(`"${property}":{`);
    expect(schema.toLowerCase()).not.toContain("<div");
  });

  it("checks cross-field rules: table width, chart values per category, resource references", () => {
    expect(() => draft([{ id: "t", type: "table", headers: ["A", "B"], rows: [["1"]], trace }])).toThrow(/cabeceras/);
    expect(() => draft([{ id: "c", type: "chart", chart_type: "bar", categories: ["x", "y"], series: [{ label: null, values: [1] }], trace }])).toThrow(/valor por categoría/);
    expect(() => draft([{ ...choiceActivity, resource_block_ids: ["nope"] }])).toThrow(/recurso inexistente/);
  });

  it("finalizeDocument re-keys local ids with server ids, also inside resources and the answer key", () => {
    const table = { id: "t", type: "table", headers: ["A"], rows: [["1"]], trace: { ...trace, source_refs: ["vis_1"] } };
    const doc = finalizeDocument(draft([table, { ...choiceActivity, resource_block_ids: ["t"] }], [{ block_id: "q1", basis: "new_item", correct_option_ids: ["a"] }]));
    const [t, q] = doc.pages[0]!.blocks;
    expect(BlockIdSchema.safeParse(t!.id).success && BlockIdSchema.safeParse(q!.id).success).toBe(true);
    expect(q!.type === "activity" && q!.resource_block_ids).toEqual([t!.id]);
    expect(doc.answer_key[0]!.block_id).toBe(q!.id);
    expect(createBlockId()).toMatch(/^blk_[a-z0-9]{12}$/);
  });

  it("every block carries a trace; a support block without origin cannot be represented", () => {
    expect(() => draft([{ id: "x", type: "paragraph", text: "Sin traza" }])).toThrow();
  });
});

describe("the other versioned contracts parse their minimal valid shape", () => {
  it("AdaptationPlan v1, PedagogicalReview v1 and the model-facing contracts", () => {
    const fp = "a".repeat(64);
    expect(AdaptationPlanSchema.safeParse({ schema_version: 1, analysis: { schema_version: 3, fingerprint: fp }, context_fingerprint: fp, adaptation_type: "accessibility", decisions: [], summary: [] }).success).toBe(true);
    expect(DraftAdaptationPlanSchema.safeParse({ decisions: [{ target: "act_1", action: "segment", strategies: ["task_sequencing"], dimensions: ["tdah"], intensity: "light", preserves: [], supports: [], flags: [] }], summary: [] }).success).toBe(false);
    expect(PedagogicalReviewSchema.safeParse({ schema_version: 1, document_fingerprint: fp, plan_fingerprint: fp, checks: [], verdict: "approved", blocks_to_revise: [] }).success).toBe(true);
    expect(AiReviewDraftSchema.safeParse({ checks: [{ check: "required_data_preserved", status: "PASS", targets: [], detail: "" }] }).success).toBe(false);
    expect(AiReviewDraftSchema.safeParse({ checks: [{ check: "answers_not_leaked", status: "PASS", targets: [], detail: "" }] }).success).toBe(true);
    expect(AiReviewDraftSchema.safeParse({ checks: [{ check: "age_appropriate", status: "PASS", targets: [], detail: "" }] }).success).toBe(true);
    expect(GeneratedSegmentsSchema.safeParse({ segments: [{ target: "act_1", decision_ids: ["dec_1"], blocks: [choiceActivity], new_item_answers: [] }], change_summary: ["Instrucción en pasos"] }).success).toBe(true);
    expect(RevisedBlockSchema.safeParse({ block: choiceActivity }).success).toBe(true);
    expect(ImageBriefSchema.safeParse({}).success).toBe(false);
  });
});
