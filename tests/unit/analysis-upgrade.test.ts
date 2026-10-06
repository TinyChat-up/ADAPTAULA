import { describe, expect, it } from "vitest";
import { normalizeAnalysisV2 } from "@/lib/analysis/normalize-v2";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { upgradeAnalysisV2 } from "@/lib/analysis/upgrade";
import { mockAnalysisDraft } from "@/lib/ai/providers/mock-analysis";
import { pickReusableAnalysis } from "@/lib/materials/cache";
import { MaterialAnalysisSchema } from "@/lib/schemas/material-analysis";
import type { MaterialAnalysisDraft, MaterialAnalysisV2 } from "@/lib/schemas/material-analysis-v2";
import { worksheetDraftV2 } from "../../evals/material-analysis/synthetic-analyses";

const v2 = (patch?: (d: MaterialAnalysisDraft) => void): MaterialAnalysisV2 => {
  const draft = structuredClone(worksheetDraftV2());
  patch?.(draft);
  return normalizeAnalysisV2(draft, { pageCount: 2 }).analysis;
};

describe("what schema v2 got wrong (the reason for v3), on a synthetic worksheet with the same defects as a real analysis", () => {
  const old = v2();

  it("counted one table twice, because it was stored as content AND as a table image", () => {
    expect(old.contents.filter((c) => c.kind === "table")).toHaveLength(1);
    expect(old.visual_elements.filter((v) => v.kind === "table_image")).toHaveLength(1);
    expect(old.structure.counts.tables).toBe(2);
  });

  it("had an asymmetric activity ↔ visual link: the visual said act_1 used it, act_1 did not say so", () => {
    expect(old.visual_elements[0]!.activity_ids).toContain("act_1");
    expect(old.activities[0]!.visual_ids).toEqual([]);
  });

  it("repeated the instruction in `content` for every activity, mixed administrative lines into headings and left a constraint-bearing activity unprotected", () => {
    expect(old.activities.every((a) => a.content === a.instruction)).toBe(true);
    expect(old.contents[0]!.text).toContain("Nombre y apellidos");
    expect(old.protected_elements.find((p) => p.kind === "necessary_figure")!.activity_ids).not.toContain("act_4");
    expect(old.structure.counts.answer_spaces).toBe(6);
  });
});

describe("upgradeAnalysisV2: old analyses are read as v3, in memory", () => {
  const old = v2();
  const { analysis, warnings } = upgradeAnalysisV2(old);

  it("produces a valid v3 analysis that survives a JSON round-trip", () => {
    expect(analysis.schema_version).toBe(3);
    expect(MaterialAnalysisSchema.parse(JSON.parse(JSON.stringify(analysis)))).toEqual(analysis);
  });

  it("merges the table that existed twice into ONE entity with its data, and recomputes the counts from the resulting graph", () => {
    const tables = analysis.visuals.filter((v) => v.kind === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ role: "required", table: { headers: ["Año", "2019", "2021", "2023"], rows: [["Envases (t)", "410", "470", "520"]], unit: null }, title: "Documento 1: toneladas de envases por año" });
    expect(analysis.texts.some((t) => /toneladas de envases por año/.test(t.text))).toBe(false);
    expect(analysis.structure.counts).toMatchObject({ tables: 1, charts: 2, figures: 0, images: 0, decorative: 1 });
    expect(warnings).toContain("table_merged:1");
  });

  it("completes the asymmetric link and reports it", () => {
    const table = analysis.visuals.find((v) => v.kind === "table")!;
    expect(analysis.activities[0]!.resource_ids).toContain(table.id);
    expect(table.activity_ids).toEqual(["act_1", "act_6"]);
    expect(warnings).toContain("relation_completed:1");
    expect(MaterialAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("moves administrative lines out of the headings and drops the page number note", () => {
    expect(analysis.administrative_fields).toEqual([
      { type: "student_name", label: "Nombre y apellidos", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
      { type: "student_name", label: "Nombre y apellidos", page: 2 },
      { type: "date", label: "Fecha", page: 2 },
    ]);
    expect(analysis.texts.map((t) => t.text).join("\n")).not.toMatch(/Nombre y apellidos|Página 2 de 2/);
    expect(warnings).toEqual(expect.arrayContaining(["admin_fields_moved:4", "page_number_dropped:1"]));
  });

  it("a student's name already written in a v2 heading does not survive the upgrade", () => {
    const filled = upgradeAnalysisV2(v2((d) => void (d.contents[0]!.text = "Reciclaje en una ciudad mediana\n2.º de ESO · Biología y Geología\nNombre y apellidos: Ana López"))).analysis;
    expect(JSON.stringify(filled)).not.toContain("Ana López");
    expect(filled.administrative_fields.some((f) => f.type === "student_name" && f.page === 1)).toBe(true);
  });

  it("drops the `content` that repeated the instruction and keeps a genuine one", () => {
    expect(analysis.activities.every((a) => a.context === null)).toBe(true);
    expect(warnings).toContain("context_duplicates_instruction:6");
    const extra = upgradeAnalysisV2(v2((d) => void (d.activities[0]!.content = "Datos de apoyo del enunciado."))).analysis;
    expect(extra.activities[0]!.context).toBe("Datos de apoyo del enunciado.");
  });

  it("maps answers without ever promoting an inferred one to source, and v2's unknown answer space stays unknown", () => {
    expect(analysis.activities.map((a) => a.expected_answer.basis)).toEqual(["inferred", "not_inferable", "inferred", "not_inferable", "not_inferable", "not_inferable"]);
    expect(analysis.activities.every((a) => a.answer_area.type === "unknown" && a.answer_area.lines === null)).toBe(true);
    expect(analysis.structure.counts).toMatchObject({ answer_spaces: 0, responses_required: 6 });
    const stated = upgradeAnalysisV2(v2((d) => void (d.activities[1]!.expected_answer = { value: "El orgánico", basis: "stated_in_material", confidence: 0.9 }))).analysis;
    expect(stated.activities[1]!.expected_answer).toEqual({ basis: "source", value: "El orgánico" });
  });

  it("maps protected kinds to the new types and completes a protected visual for every activity that uses it", () => {
    expect(analysis.protected_elements.map((p) => p.type)).toEqual(["target_operation", "units_or_magnitudes", "concept", "necessary_visual", "other"]);
    const visual = analysis.protected_elements.find((p) => p.type === "necessary_visual")!;
    expect(visual.activity_ids).toContain("act_4");
    expect(warnings).toContain("protected_activities_completed:1");
    expect(Object.keys(visual).sort()).toEqual(["activity_ids", "id", "importance", "resource_ids", "type", "value"]);
  });

  it("keeps uncertainties (v2's `answer_not_inferable` stays readable) with their targets", () => {
    expect(analysis.uncertainties[0]).toMatchObject({ kind: "answer_not_inferable", target_ids: ["act_2", "act_4", "act_5", "act_6"], page: 2 });
  });

  it("does not carry a v2 title the system had not trusted (confidence below 0.6)", () => {
    expect(upgradeAnalysisV2(v2((d) => void (d.identification.title = { value: "Ficha", confidence: 0.4 }))).analysis.identification.title).toBeNull();
    expect(analysis.identification.title).toBe("Reciclaje en una ciudad mediana");
  });

  it("does not guess when two tables on a page cannot be paired with their images: it keeps both and says so", () => {
    const messy = upgradeAnalysisV2(
      v2((d) => {
        d.contents.push({ id: "c10", section_id: "s1", page: 1, kind: "table", text: "Otra tabla", table_headers: ["a"], table_rows: [["1"]], legible: true });
      }),
    );
    expect(messy.warnings).toContain("table_duplicate_unresolved:1");
    expect(messy.analysis.visuals.filter((v) => v.kind === "table")).toHaveLength(3);
  });

  it("lifts the mock analysis too (the one the whole app runs on with no API key)", () => {
    const lifted = upgradeAnalysisV2(normalizeAnalysisV2(mockAnalysisDraft(), { pageCount: 1 }).analysis).analysis;
    expect(lifted.structure.counts).toMatchObject({ activities: 4, tables: 1, images: 1, decorative: 1, examples: 1 });
    expect(lifted.activities[2]!.resource_ids).toEqual(["vis_1"]);
  });
});

describe("parseStoredAnalysis: whatever `materials.analysis` holds", () => {
  it("reads a v2 row as v3 without touching it", () => {
    const stored = v2();
    const before = JSON.stringify(stored);
    const result = parseStoredAnalysis(JSON.parse(before));
    expect(result).toMatchObject({ storedVersion: 2, outdated: false });
    expect(result.analysis?.schema_version).toBe(3);
    expect(result.warnings).toContain("table_merged:1");
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("reads a v3 row as it is", () => {
    const lifted = upgradeAnalysisV2(v2()).analysis;
    expect(parseStoredAnalysis(JSON.parse(JSON.stringify(lifted)))).toMatchObject({ storedVersion: 3, outdated: false, warnings: [] });
  });

  it("nothing stored is not 'outdated'; an unknown version or a damaged analysis is", () => {
    expect(parseStoredAnalysis(null)).toEqual({ analysis: null, storedVersion: null, outdated: false, warnings: [] });
    expect(parseStoredAnalysis(undefined).outdated).toBe(false);
    expect(parseStoredAnalysis({ schema_version: 1 })).toMatchObject({ analysis: null, outdated: true });
    expect(parseStoredAnalysis({ schema_version: 2, nonsense: true })).toMatchObject({ analysis: null, storedVersion: 2, outdated: true });
    expect(parseStoredAnalysis({ schema_version: 3 })).toMatchObject({ analysis: null, storedVersion: 3, outdated: true });
    expect(parseStoredAnalysis("texto")).toMatchObject({ analysis: null, outdated: true });
  });
});

describe("cache identity across schema versions (content_hash + prompt_version + schema_version)", () => {
  const v2Meta = { schema_version: 2, prompt_key: "material_analyzer", prompt_version: 1, source: "model", cache_hit: false, forced_reanalysis: false, model_alias: "STANDARD", provider: "anthropic", model: "m", effort: "medium", analyzed_at: "2026-10-05T08:00:00.000Z", attempts: 1, cost_usd: 0.05, warnings: [], reused_from_material_id: null };
  const candidate = (analysis: unknown, meta: object, promptVersion: string) => ({ id: "m1", status: "analyzed", analysis_prompt_version: promptVersion, analysis, analysis_meta: meta });

  it("reuses a v2 analysis only for the prompt/schema that made it, and keeps the stored value as it is", () => {
    const stored = v2();
    const hit = pickReusableAnalysis([candidate(stored, v2Meta, "material_analyzer@v1")], { promptVersion: "material_analyzer@v1", schemaVersion: 2 });
    expect(hit?.stored).toBe(stored);
    expect(hit?.analysis.schema_version).toBe(3);
    expect(pickReusableAnalysis([candidate(stored, v2Meta, "material_analyzer@v1")], { promptVersion: "material_analyzer@v2", schemaVersion: 3 })).toBeNull();
    expect(pickReusableAnalysis([candidate(stored, v2Meta, "material_analyzer@v1")], { promptVersion: "material_analyzer@v1", schemaVersion: 3 })).toBeNull();
  });

  it("reuses a v3 analysis for prompt v2 and never for prompt v1", () => {
    const lifted = upgradeAnalysisV2(v2()).analysis;
    const meta = { ...v2Meta, schema_version: 3, prompt_version: 2 };
    expect(pickReusableAnalysis([candidate(lifted, meta, "material_analyzer@v2")], { promptVersion: "material_analyzer@v2", schemaVersion: 3 })?.sourceId).toBe("m1");
    expect(pickReusableAnalysis([candidate(lifted, meta, "material_analyzer@v2")], { promptVersion: "material_analyzer@v1", schemaVersion: 2 })).toBeNull();
  });

  it("a mismatch between the row's meta and the shape of its analysis is never reused", () => {
    const stored = v2();
    expect(pickReusableAnalysis([candidate(stored, { ...v2Meta, schema_version: 3 }, "material_analyzer@v2")], { promptVersion: "material_analyzer@v2", schemaVersion: 3 })).toBeNull();
  });
});
