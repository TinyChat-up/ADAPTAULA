import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { normalizeAnalysisV2 as normalizeAnalysis } from "@/lib/analysis/normalize-v2";
import { mockAnalysisDraft } from "@/lib/ai/providers/mock-analysis";
import { MaterialAnalysisDraftSchema, MaterialAnalysisSchema, type MaterialAnalysisDraft } from "@/lib/schemas/material-analysis-v2";

const subjects = [
  { slug: "matematicas", name: "Matemáticas" },
];

const draft = (patch?: (d: MaterialAnalysisDraft) => void): MaterialAnalysisDraft => {
  const d = structuredClone(mockAnalysisDraft());
  patch?.(d);
  return d;
};

/** The v2 contract (stored by material_analyzer@v1) is frozen: these tests pin it so historical analyses stay readable. */
describe("MaterialAnalysisDraftSchema (v2)", () => {
  it("accepts the mock analysis", () => expect(MaterialAnalysisDraftSchema.safeParse(mockAnalysisDraft()).success).toBe(true));

  it("is flat enough for providers: no optional or nullable properties anywhere", () => {
    const json = JSON.stringify(zodOutputFormat(MaterialAnalysisDraftSchema).schema);
    expect(json).not.toContain('"anyOf"');
    expect(json).not.toContain('"oneOf"');
    expect(json).not.toContain('"null"');
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { properties?: Record<string, unknown>; required?: string[]; items?: unknown };
      if (n.properties) {
        expect([...(n.required ?? [])].sort()).toEqual(Object.keys(n.properties).sort());
        Object.values(n.properties).forEach(walk);
      }
      if (n.items) walk(n.items);
    };
    walk(zodOutputFormat(MaterialAnalysisDraftSchema).schema);
  });

  it("rejects invented enum values (the model cannot create new activity types)", () => {
    const bad = draft((d) => {
      (d.activities[0] as { type: string }).type = "teleportation";
    });
    expect(MaterialAnalysisDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    const bad = draft((d) => {
      d.identification.subject.confidence = 1.5;
    });
    expect(MaterialAnalysisDraftSchema.safeParse(bad).success).toBe(false);
  });
});

describe("normalizeAnalysisV2", () => {
  it("assigns stable, server-owned ids and remaps every reference", () => {
    const { analysis, warnings } = normalizeAnalysis(draft(), { pageCount: 1, subjects });
    expect(analysis.activities.map((a) => a.id)).toEqual(["act_1", "act_2", "act_3", "act_4"]);
    expect(analysis.pedagogical_intent.learning_objectives.map((o) => o.id)).toEqual(["obj_1", "obj_2"]);
    expect(analysis.activities[2]!.visual_ids).toEqual(["vis_1"]);
    expect(analysis.activities[0]!.objective_ids).toEqual(["obj_2"]);
    expect(analysis.protected_elements[0]!.activity_ids).toEqual(["act_1", "act_3"]);
    expect(analysis.visual_elements[0]!.activity_ids).toEqual(["act_3"]);
    expect(warnings).toEqual([]);
    expect(MaterialAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("does not let the model choose ids: any model id becomes a server id", () => {
    const { analysis } = normalizeAnalysis(
      draft((d) => {
        d.activities[0]!.id = "act_999";
        d.protected_elements[0]!.activity_ids = ["act_999"];
      }),
      { pageCount: 1 },
    );
    expect(analysis.activities[0]!.id).toBe("act_1");
    expect(analysis.protected_elements[0]!.activity_ids).toEqual(["act_1"]);
  });

  it("drops dangling references and says so", () => {
    const { analysis, warnings } = normalizeAnalysis(
      draft((d) => {
        d.activities[0]!.objective_ids = ["o1", "nope"];
        d.uncertainties[0]!.activity_ids = ["a99"];
      }),
      { pageCount: 1 },
    );
    expect(analysis.activities[0]!.objective_ids).toEqual(["obj_1"]);
    expect(analysis.uncertainties[0]!.activity_ids).toEqual([]);
    expect(warnings).toContain("dropped_references:2");
  });

  it("turns sentinels into null and never invents values", () => {
    const { analysis } = normalizeAnalysis(
      draft((d) => {
        d.identification.stage = { value: "unknown", confidence: 0.1 };
        d.identification.grade = { value: "unknown", confidence: 0.1 };
        d.identification.topic = { value: "", confidence: 0 };
        d.uncertainties[0]!.page = 0;
      }),
      { pageCount: 1 },
    );
    expect(analysis.identification.stage.value).toBeNull();
    expect(analysis.identification.grade.value).toBeNull();
    expect(analysis.identification.topic.value).toBeNull();
    expect(analysis.uncertainties[0]!.page).toBeNull();
    expect(analysis.activities[3]!.expected_answer).toEqual({ value: null, basis: "not_inferable", confidence: 0.5 });
  });

  it("an answer declared 'not inferable' never carries a value", () => {
    const { analysis } = normalizeAnalysis(
      draft((d) => {
        d.activities[3]!.expected_answer = { value: "inventada", basis: "not_inferable", confidence: 0.9 };
      }),
      { pageCount: 1 },
    );
    expect(analysis.activities[3]!.expected_answer.value).toBeNull();
  });

  it("a value with basis 'not_inferable' and an empty value with another basis are reconciled", () => {
    const { analysis, warnings } = normalizeAnalysis(
      draft((d) => {
        d.activities[0]!.expected_answer = { value: "", basis: "inferred", confidence: 0.9 };
      }),
      { pageCount: 1 },
    );
    expect(analysis.activities[0]!.expected_answer.basis).toBe("not_inferable");
    expect(warnings).toContain("answer_basis_adjusted:1");
  });

  it("clamps pages the model claims beyond the real page count", () => {
    const { analysis, warnings } = normalizeAnalysis(
      draft((d) => {
        d.activities[0]!.page = 7;
      }),
      { pageCount: 2 },
    );
    expect(analysis.activities[0]!.page).toBe(2);
    expect(warnings).toContain("pages_clamped:1");
    expect(analysis.structure.page_count).toBe(2);
  });

  it("reconciles a visual that is necessary to solve with its function", () => {
    const { analysis, warnings } = normalizeAnalysis(
      draft((d) => {
        d.visual_elements[0]!.necessary_to_solve = true;
        d.visual_elements[0]!.pedagogical_function = "illustrative";
      }),
      { pageCount: 1 },
    );
    expect(analysis.visual_elements[0]).toMatchObject({ necessary_to_solve: true, pedagogical_function: "required_for_task" });
    expect(warnings).toContain("visual_function_adjusted:1");
  });

  it("computes the structure counts itself instead of trusting the model", () => {
    const { analysis } = normalizeAnalysis(draft(), { pageCount: 1 });
    expect(analysis.structure.counts).toEqual({ sections: 1, activities: 4, examples: 1, reading_texts: 0, tables: 1, formulas: 0, figures: 1, answer_spaces: 3 });
  });

  it("keeps decorative elements out of the figure count and tells them apart from pedagogical ones", () => {
    const { analysis } = normalizeAnalysis(draft(), { pageCount: 1 });
    expect(analysis.visual_elements.map((v) => v.pedagogical_function)).toEqual(["informative", "decorative"]);
    expect(analysis.structure.counts.figures).toBe(1);
  });

  it("keeps uncertainties and protected elements", () => {
    const { analysis } = normalizeAnalysis(draft(), { pageCount: 1 });
    expect(analysis.uncertainties).toHaveLength(1);
    expect(analysis.protected_elements.map((p) => p.kind)).toEqual(["target_operation", "concept"]);
  });

  it("maps the free-text subject to the catalog", () => {
    const { analysis } = normalizeAnalysis(draft(), { pageCount: 1, subjects });
    expect(analysis.identification.subject).toMatchObject({ value: "Matemáticas", slug: "matematicas" });
  });

  it("turns tables into structured data only when they have headers", () => {
    const { analysis } = normalizeAnalysis(draft(), { pageCount: 1 });
    expect(analysis.contents[2]!.table).toEqual({ headers: ["Fracción", "Equivalente"], rows: [["1/2", "2/4"], ["1/3", ""]] });
    expect(analysis.contents[0]!.table).toBeNull();
  });
});

describe("stored schema (referential integrity)", () => {
  const stored = () => normalizeAnalysis(draft(), { pageCount: 1 }).analysis;

  it("rejects a reference to an activity that does not exist", () => {
    const bad = stored();
    bad.protected_elements[0]!.activity_ids = ["act_42"];
    expect(MaterialAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects ids that the server did not assign", () => {
    const bad = stored();
    bad.activities[0]!.id = "a1";
    expect(MaterialAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("survives a JSON round-trip", () => {
    const analysis = stored();
    expect(MaterialAnalysisSchema.parse(JSON.parse(JSON.stringify(analysis)))).toEqual(analysis);
  });
});
