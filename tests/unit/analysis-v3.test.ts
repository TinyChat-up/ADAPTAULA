import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActivitiesList } from "@/components/materials/analysis-summary";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import { extractAdministrative, isPageNumberOnly } from "@/lib/analysis/admin-fields";
import { solvabilityHint, statedAnswer } from "@/lib/analysis/answers";
import { detectedContextUpdate, resolveContext, stageOfGrade } from "@/lib/analysis/context";
import { computeCounts } from "@/lib/analysis/counts";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { matchSubjectSlug } from "@/lib/analysis/subjects";
import { MaterialAnalysisDraftSchema, MaterialAnalysisSchema, type MaterialAnalysisDraft, type MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";
import { worksheetDraftV3 } from "../../evals/material-analysis/synthetic-analyses";

const subjects = [
  { slug: "matematicas", name: "Matemáticas" },
  { slug: "lengua-castellana", name: "Lengua Castellana y Literatura" },
  { slug: "biologia-geologia", name: "Biología y Geología" },
  { slug: "biologia", name: "Biología" },
  { slug: "geografia-historia", name: "Geografía e Historia" },
  { slug: "otra", name: "Otra asignatura" },
];

type Patch = (d: MaterialAnalysisDraftInput) => void;
const input = (base: () => MaterialAnalysisDraftInput, patch?: Patch): MaterialAnalysisDraftInput => {
  const d = structuredClone(base());
  patch?.(d);
  return d;
};
const parsed = (patch?: Patch, base = worksheetDraftV3): MaterialAnalysisDraft => MaterialAnalysisDraftSchema.parse(input(base, patch));
const run = (patch?: Patch, options: { pageCount: number | null } = { pageCount: 2 }, base = worksheetDraftV3) => normalizeAnalysis(parsed(patch, base), { ...options, subjects });
const mock = (patch?: Patch) => normalizeAnalysis(parsed(patch, mockAnalysisDraftV3), { pageCount: 1, subjects });

describe("MaterialAnalysisDraftSchema (v3): the contract asked of the model", () => {
  it("accepts the mock and the reference worksheet", () => {
    expect(MaterialAnalysisDraftSchema.safeParse(mockAnalysisDraftV3()).success).toBe(true);
    expect(MaterialAnalysisDraftSchema.safeParse(worksheetDraftV3()).success).toBe(true);
  });

  it("does not ask for anything the server can compute", () => {
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { properties?: Record<string, unknown>; items?: unknown; [key: string]: unknown };
      for (const [name, child] of Object.entries(n.properties ?? {})) {
        names.add(name);
        walk(child);
      }
      if (n.items) walk(n.items);
      for (const value of Object.values(n)) if (Array.isArray(value)) value.forEach(walk);
    };
    walk(z.toJSONSchema(MaterialAnalysisDraftSchema, { io: "input" }));
    for (const derived of ["structure", "counts", "has_answer_space", "necessary_to_solve", "activity_ids", "visual_ids", "objective_ids", "section_id", "rationale", "complexity", "difficulty_rationale", "knowledge_required", "legible", "summary", "content", "schema_version"]) {
      expect(names.has(derived), `${derived} no debería pedirse al modelo`).toBe(false);
    }
  });

  it("rejects invented enum values and confidence outside 0-1", () => {
    expect(MaterialAnalysisDraftSchema.safeParse(input(worksheetDraftV3, (d) => void ((d.activities[0] as { type: string }).type = "teleportation"))).success).toBe(false);
    expect(MaterialAnalysisDraftSchema.safeParse(input(worksheetDraftV3, (d) => void (d.identification.confidence.stage = 1.5))).success).toBe(false);
    expect(MaterialAnalysisDraftSchema.safeParse(input(worksheetDraftV3, (d) => void ((d.visuals[0] as { kind: string }).kind = "table_image"))).success).toBe(false);
  });

  it("no longer asks for answer_not_inferable: an open activity is just an activity without `answer`", () => {
    const bad = input(worksheetDraftV3, (d) => void ((d.uncertainties[0] as { kind: string }).kind = "answer_not_inferable"));
    expect(MaterialAnalysisDraftSchema.safeParse(bad).success).toBe(false);
  });
});

describe("normalizeAnalysis (v3): ids, relations and derived data", () => {
  it("assigns server-owned ids and derives the inverse relations", () => {
    const { analysis, warnings } = run();
    expect(analysis.activities.map((a) => a.id)).toEqual(["act_1", "act_2", "act_3", "act_4", "act_5", "act_6"]);
    expect(analysis.visuals.map((v) => v.id)).toEqual(["vis_1", "vis_2", "vis_3", "vis_4"]);
    expect(analysis.activities[0]!.resource_ids).toEqual(["vis_1"]);
    expect(analysis.visuals[0]!.activity_ids).toEqual(["act_1", "act_6"]);
    expect(analysis.visuals[2]!.activity_ids).toEqual(["act_3", "act_4", "act_5", "act_6"]);
    expect(analysis.activities[0]!.objective_ids).toEqual(["obj_1"]);
    expect(warnings.filter((w) => w.startsWith("dropped"))).toEqual([]);
    expect(MaterialAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("an activity ↔ resource link can never be asymmetric: the stored schema refuses one that is", () => {
    const { analysis } = run();
    const broken = structuredClone(analysis);
    broken.activities[0]!.resource_ids = [];
    expect(MaterialAnalysisSchema.safeParse(broken).success).toBe(false);
    const other = structuredClone(analysis);
    other.visuals[0]!.activity_ids = ["act_1"];
    expect(MaterialAnalysisSchema.safeParse(other).success).toBe(false);
  });

  it("links an activity to the TEXT it needs, not only to visuals", () => {
    const { analysis } = run((d) => void (d.activities[1]!.resources = ["v2", "c1"]));
    expect(analysis.activities[1]!.resource_ids).toEqual(["vis_2", "ctt_1"]);
    expect(analysis.texts[0]!.activity_ids).toEqual(["act_2"]);
  });

  it("drops dangling references and says so; an id that exists as text and as visual is ambiguous and is dropped, not guessed", () => {
    const { analysis, warnings } = run((d) => {
      d.activities[0]!.objectives = ["o1", "nope"];
      d.activities[1]!.resources = ["v2", "x9"];
      d.uncertainties[0]!.targets = ["a99"];
      d.texts[0]!.id = "v2"; // same local id as a visual
      d.activities[2]!.resources = ["v2"];
    });
    expect(analysis.activities[0]!.objective_ids).toEqual(["obj_1"]);
    expect(analysis.activities[1]!.resource_ids).toEqual([]);
    expect(analysis.activities[2]!.resource_ids).toEqual([]);
    expect(analysis.uncertainties[0]!.target_ids).toEqual([]);
    expect(warnings).toEqual(expect.arrayContaining(["dropped_references:3", "ambiguous_references:4"]));
  });

  it("the model cannot choose persistent ids", () => {
    const { analysis } = run((d) => {
      d.activities[0]!.id = "act_999";
      d.protected[0]!.activities = ["act_999"];
    });
    expect(analysis.activities[0]!.id).toBe("act_1");
    expect(analysis.protected_elements[0]!.activity_ids).toEqual(["act_1"]);
  });

  it("clamps pages beyond the real count and infers the section of each item from its page when the model omitted it (multi-page)", () => {
    const { analysis, warnings } = run((d) => void (d.activities[0]!.page = 9));
    expect(analysis.activities[0]!.page).toBe(2);
    expect(warnings).toContain("pages_clamped:1");
    expect(analysis.structure.page_count).toBe(2);
    expect(analysis.texts[0]!.section_id).toBe("sec_1");
    expect(analysis.activities.every((a) => a.section_id === "sec_2")).toBe(true);
    expect(analysis.visuals.every((v) => v.section_id === "sec_1")).toBe(true);
  });

  it("does not guess a section when two sections cover the same page", () => {
    const { analysis, warnings } = run((d) => {
      d.sections = [
        { id: "s1", title: "A", page_start: 1, page_end: 2 },
        { id: "s2", title: "B", page_start: 2, page_end: 2 },
      ];
    });
    expect(analysis.activities[0]!.section_id).toBeNull();
    expect(warnings.some((w) => w.startsWith("section_unassigned"))).toBe(true);
  });

  it("turns sentinels into null and never invents values", () => {
    const { analysis } = run((d) => {
      d.identification.stage = "unknown";
      d.identification.grade = "unknown";
      d.identification.topic = "";
      d.identification.title = "";
      d.identification.language = "";
    });
    expect(analysis.identification).toMatchObject({ title: null, language: null, stage: { value: null }, grade: { value: null }, topic: { value: null } });
  });

  it("maps the free-text subject to the catalog", () => {
    expect(run().analysis.identification.subject).toMatchObject({ value: "Biología y Geología", slug: "biologia-geologia" });
  });

  it("survives a JSON round-trip", () => {
    const { analysis } = run();
    expect(MaterialAnalysisSchema.parse(JSON.parse(JSON.stringify(analysis)))).toEqual(analysis);
  });
});

describe("one entity, one count (tables, charts, figures, images, answer areas)", () => {
  it("a table with structured data is ONE table: it is not also a figure or a second table", () => {
    const { analysis } = run();
    expect(analysis.visuals[0]).toMatchObject({ kind: "table", table: { headers: ["Año", "2019", "2021", "2023"], unit: "toneladas" }, chart: null });
    expect(analysis.texts.some((t) => /Documento 1/.test(t.text))).toBe(false);
    expect(analysis.structure.counts).toMatchObject({ tables: 1, charts: 2, figures: 0, images: 0, decorative: 1 });
  });

  it("table data on a visual typed as something else makes it a table (once), with a warning", () => {
    const { analysis, warnings } = run((d) => void (d.visuals[0]!.kind = "image"));
    expect(analysis.visuals[0]!.kind).toBe("table");
    expect(analysis.structure.counts).toMatchObject({ tables: 1, images: 0 });
    expect(warnings).toContain("visual_kind_adjusted:1");
  });

  it("table AND chart data on one visual keeps the data that matches its kind", () => {
    const { analysis, warnings } = run((d) => void (d.visuals[1]!.table = { headers: ["x"], rows: [["1"]] }));
    expect(analysis.visuals[1]).toMatchObject({ kind: "chart", table: null });
    expect(analysis.visuals[1]!.chart).not.toBeNull();
    expect(warnings).toContain("visual_data_dropped:1");
  });

  it("decorative elements are counted apart and never as images or figures", () => {
    const { analysis } = mock();
    expect(analysis.structure.counts).toMatchObject({ images: 1, tables: 1, figures: 0, decorative: 1 });
    const counts = computeCounts({
      sections: [],
      texts: [],
      activities: [],
      visuals: [
        { ...analysis.visuals[1]!, role: "decorative" },
        { ...analysis.visuals[2]! },
      ],
    });
    expect(counts).toMatchObject({ images: 0, decorative: 2 });
  });

  it("counts each category exactly (reading texts, examples, formulas, sections, responses and answer spaces)", () => {
    const { analysis } = mock();
    expect(analysis.structure.counts).toEqual({
      sections: 1, activities: 4, responses_required: 4, answer_spaces: 3, reading_texts: 0, examples: 1, formulas: 0, tables: 1, charts: 0, images: 1, figures: 0, decorative: 1,
    });
  });

  it("figures are drawn or structured non-decorative visuals other than images, tables and charts", () => {
    const { analysis } = mock((d) => {
      d.visuals.push({ id: "v4", kind: "number_line", page: 1, role: "required", description: "Recta de 0 a 1" });
      d.visuals.push({ id: "v5", kind: "geometric_figure", page: 1, role: "informative", description: "Triángulo" });
    });
    expect(analysis.structure.counts).toMatchObject({ figures: 2, images: 1 });
  });
});

describe("answers and answer areas", () => {
  it("separates 'a response is required' from 'the sheet offers a place to write it'", () => {
    const { analysis } = mock();
    const mc = analysis.activities[1]!; // multiple choice: a response is required, there is no writing area
    expect(mc.response_format).toBe("select_option");
    expect(mc.answer_area).toEqual({ type: "none", lines: null });
    expect(analysis.structure.counts.responses_required).toBe(4);
    expect(analysis.structure.counts.answer_spaces).toBe(3);
  });

  it("keeps the physical answer area of the original: type and approximate number of lines", () => {
    const { analysis } = run();
    expect(analysis.activities.map((a) => a.answer_area)).toEqual([
      { type: "lines", lines: 2 }, { type: "lines", lines: 3 }, { type: "lines", lines: 2 }, { type: "lines", lines: 4 }, { type: "lines", lines: 4 }, { type: "lines", lines: 5 },
    ]);
  });

  it("an activity with no answer area at all is recorded as such, and a line count on another kind of area is ignored", () => {
    const { analysis, warnings } = run((d) => {
      d.activities[0]!.answer_area = "none";
      d.activities[0]!.answer_lines = 4;
      d.activities[1]!.answer_area = "box";
      d.activities[1]!.answer_lines = 0;
    });
    expect(analysis.activities[0]!.answer_area).toEqual({ type: "none", lines: null });
    expect(analysis.activities[1]!.answer_area).toEqual({ type: "box", lines: null });
    expect(warnings).toContain("answer_lines_ignored:1");
    expect(analysis.structure.counts.answer_spaces).toBe(5);
  });

  it("source / inferred / not_inferable stay distinct, and nothing is ever promoted to source", () => {
    const { analysis } = run((d) => void (d.activities[1]!.answer = { basis: "source", value: "El orgánico es el 40 %" }));
    expect(analysis.activities.map((a) => a.expected_answer.basis)).toEqual(["inferred", "source", "inferred", "not_inferable", "not_inferable", "not_inferable"]);
    expect(analysis.activities[3]!.expected_answer.value).toBeNull();
  });

  it("an inferred answer is never original content: `statedAnswer` ignores it and `solvabilityHint` is its only use", () => {
    const { analysis } = run((d) => void (d.activities[1]!.answer = { basis: "source", value: "El orgánico es el 40 %" }));
    const [inferred, source, open] = [analysis.activities[0]!, analysis.activities[1]!, analysis.activities[3]!];
    expect(statedAnswer(inferred)).toBeNull();
    expect(solvabilityHint(inferred)).toBe("110 toneladas; aproximadamente un 26,8 %");
    expect(statedAnswer(source)).toBe("El orgánico es el 40 %");
    expect(solvabilityHint(source)).toBeNull();
    expect(statedAnswer(open)).toBeNull();
    expect(solvabilityHint(open)).toBeNull();
  });

  it("an inferred answer is never turned into a protected element just because it exists", () => {
    const { analysis, warnings } = run((d) => void d.protected.push({ type: "required_data", importance: "essential", value: "110 toneladas; aproximadamente un 26,8 %", activities: ["a1"], resources: [] }));
    expect(analysis.protected_elements.some((p) => p.value.includes("26,8"))).toBe(false);
    expect(warnings).toContain("protected_inferred_answer_dropped:1");
  });

  it("the activity list never shows an expected answer to the reader", () => {
    const { analysis } = run();
    const html = renderToStaticMarkup(createElement(ActivitiesList, { analysis }));
    expect(html).toContain("Actividad 1");
    expect(html).not.toContain("26,8");
    expect(html).not.toContain("10 puntos porcentuales (55");
  });

  it("asks for an answer only when the activity is not open: a missing answer means not_inferable", () => {
    const { analysis } = run((d) => void delete d.activities[0]!.answer);
    expect(analysis.activities[0]!.expected_answer).toEqual({ basis: "not_inferable", value: null });
  });
});

describe("protected elements (compact, typed, with importance)", () => {
  it("keeps explicit reasoning constraints as protected elements, typed and targeted", () => {
    const { analysis } = run();
    expect(analysis.protected_elements).toContainEqual(expect.objectContaining({ type: "reasoning_constraint", importance: "essential", value: "No basta con copiar un porcentaje", activity_ids: ["act_2"] }));
    expect(analysis.protected_elements).toContainEqual(expect.objectContaining({ type: "reasoning_constraint", value: "Sin reducir la cantidad total de residuos", activity_ids: ["act_5"] }));
  });

  it("keeps length and data requirements of a written answer ('4-5 líneas', 'al menos dos datos')", () => {
    const { analysis } = run();
    const constraint = analysis.protected_elements.find((p) => p.type === "response_constraint" && p.activity_ids.includes("act_6"));
    expect(constraint?.value).toMatch(/4-5 líneas/);
    expect(constraint?.value).toMatch(/al menos dos datos/);
    expect(constraint?.importance).toBe("essential");
  });

  it("keeps a mandatory unit as a protected element", () => {
    const { analysis } = run((d) => void d.protected.push({ type: "units_or_magnitudes", importance: "important", value: "La respuesta debe llevar unidad (litros)", activities: ["a1"], resources: [] }));
    expect(analysis.protected_elements.at(-1)).toMatchObject({ type: "units_or_magnitudes", value: "La respuesta debe llevar unidad (litros)", activity_ids: ["act_1"] });
  });

  it("offers the three importance levels, without explanations", () => {
    const { analysis } = run((d) => void d.protected.push({ type: "other", importance: "optional", value: "Orden de las preguntas", activities: [], resources: [] }));
    expect(new Set(analysis.protected_elements.map((p) => p.importance))).toEqual(new Set(["essential", "important", "optional"]));
    expect(Object.keys(analysis.protected_elements[0]!).sort()).toEqual(["activity_ids", "id", "importance", "resource_ids", "type", "value"]);
  });

  it("a protected visual protects it for EVERY activity that uses it, and the completion is reported", () => {
    const { analysis, warnings } = run();
    const visual = analysis.protected_elements.find((p) => p.type === "necessary_visual")!;
    expect(visual.resource_ids).toEqual(["vis_1", "vis_2", "vis_3"]);
    expect(visual.activity_ids).toEqual(["act_1", "act_2", "act_3", "act_4", "act_5", "act_6"]);
    expect(warnings).toContain("protected_activities_completed:6");
  });

  it("merges two protected elements that say the same thing", () => {
    const { analysis, warnings } = run((d) => void d.protected.push({ type: "reasoning_constraint", importance: "essential", value: "no basta con copiar un porcentaje", activities: ["a4"], resources: [] }));
    const merged = analysis.protected_elements.filter((p) => p.type === "reasoning_constraint" && /copiar/.test(p.value));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.activity_ids).toEqual(["act_2", "act_4"]);
    expect(warnings).toContain("protected_duplicates_merged:1");
  });
});

describe("activities: instruction and context do not repeat each other", () => {
  it("drops a context that repeats the instruction", () => {
    const { analysis, warnings } = run((d) => void (d.activities[0]!.context = d.activities[0]!.instruction));
    expect(analysis.activities[0]!.context).toBeNull();
    expect(warnings).toContain("context_duplicates_instruction:1");
  });

  it("trims the instruction out of a context that contains it, keeping only the extra text", () => {
    const { analysis, warnings } = run((d) => void (d.activities[0]!.context = `Datos del enunciado. ${d.activities[0]!.instruction}`));
    expect(analysis.activities[0]!.context).toBe("Datos del enunciado.");
    expect(warnings).toContain("context_overlap_trimmed:1");
  });

  it("keeps a genuine context (statement, data or options)", () => {
    expect(mock().analysis.activities[1]).toMatchObject({ instruction: "Marca la fracción equivalente a 1/2.", context: "a) 2/4  b) 2/3  c) 3/4" });
  });
});

describe("administrative fields and noise leave the text", () => {
  it("moves 'Nombre y apellidos / Fecha' lines out of a heading, once, and drops bare page numbers", () => {
    const { analysis, warnings } = run((d) => {
      d.texts.push({ id: "c9", kind: "heading", page: 1, text: "Reciclaje\nNombre y apellidos: ____ Fecha: ____" }, { id: "c10", kind: "note", page: 2, text: "Página 2 de 2" });
    });
    expect(analysis.texts.map((t) => t.text)).toEqual([expect.stringContaining("ayuntamiento"), expect.stringContaining("Cada hogar"), "Reciclaje"]);
    expect(analysis.administrative_fields).toEqual([
      { type: "student_name", label: "Nombre y apellidos", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
    ]);
    expect(warnings).toEqual(expect.arrayContaining(["admin_fields_moved:2", "page_number_dropped:1"]));
  });

  it("never stores a student's name written on a filled-in sheet: only the existence of the field is kept", () => {
    const { analysis, warnings } = run((d) => {
      d.texts.push({ id: "c9", kind: "heading", page: 1, text: "Reciclaje\nNombre y apellidos: Ana López García\nDNI: 12345678Z" });
      d.admin.push({ type: "student_name", label: "Nombre: Luis Pérez", page: 2 });
    });
    const everything = JSON.stringify(analysis);
    expect(everything).not.toMatch(/Ana López|12345678Z|Luis Pérez/);
    expect(analysis.administrative_fields.map((f) => f.type)).toEqual(expect.arrayContaining(["student_name", "student_id"]));
    expect(analysis.texts.map((t) => t.text)).toContain("Reciclaje");
    expect(warnings).toContain("admin_value_dropped:3");
  });

  it("a bare 'Nombre: …' line is NOT removed (in a language worksheet it can be content), and a delivery date stays", () => {
    expect(extractAdministrative("Nombre: sustantivo propio").rest).toBe("Nombre: sustantivo propio");
    expect(extractAdministrative("Fecha de entrega: 12 de mayo").valuesDropped).toBe(0);
    expect(extractAdministrative("Alumno/a: María").valuesDropped).toBe(1);
  });

  it("drops a heading that only repeats the document title", () => {
    const { analysis, warnings } = run((d) => void d.texts.push({ id: "c9", kind: "heading", page: 1, text: "Reciclaje en una ciudad mediana" }));
    expect(analysis.texts.some((t) => t.text === "Reciclaje en una ciudad mediana")).toBe(false);
    expect(warnings).toContain("title_text_dropped:1");
  });

  it("a text that is ONLY administrative disappears entirely", () => {
    const { analysis } = run((d) => void d.texts.push({ id: "c9", kind: "note", page: 1, text: "Nombre y apellidos: ____\nFecha: ____" }));
    expect(analysis.texts).toHaveLength(2);
  });

  it("extractAdministrative only removes blank fields: a filled field or other text stays", () => {
    expect(extractAdministrative("Nombre y apellidos: ____ Fecha: ____")).toEqual({
      rest: "",
      fields: [{ type: "student_name", label: "Nombre y apellidos" }, { type: "date", label: "Fecha" }],
      valuesDropped: 0,
    });
    expect(extractAdministrative("Fecha de entrega: 12 de mayo").rest).toBe("Fecha de entrega: 12 de mayo");
    expect(extractAdministrative("Nota: cada hogar indica un único destino").rest).toBe("Nota: cada hogar indica un único destino");
    expect(extractAdministrative("Curso: ______ Grupo: ______").fields.map((f) => f.type)).toEqual(["class_group", "class_group"]);
    expect(extractAdministrative("Nombre").fields).toEqual([]);
    expect(extractAdministrative("Lee el texto.\nFirma: ______").rest).toBe("Lee el texto.");
    expect(isPageNumberOnly("Pág. 3")).toBe(true);
    expect(isPageNumberOnly("3 puntos")).toBe(false);
  });
});

describe("charts and tables: structured when legible, honest when not", () => {
  it("keeps the structured data of a chart (categories, series, unit)", () => {
    const { analysis } = run();
    expect(analysis.visuals[1]).toMatchObject({ kind: "chart", title: "Documento 2. Composición de los residuos (2023)", chart: { type: "bar", categories: ["Papel", "Vidrio", "Envases", "Orgánico"], series: [{ name: "", values: [28, 12, 20, 40] }], unit: "%" } });
  });

  it("a chart whose series do not match its categories is not stored as data: it is dropped, reported and flagged as an uncertainty", () => {
    const { analysis, warnings } = run((d) => void (d.visuals[1]!.chart!.series[0]!.values = [28, 12]));
    expect(analysis.visuals[1]).toMatchObject({ kind: "chart", chart: null });
    expect(analysis.uncertainties.at(-1)).toMatchObject({ kind: "unstructured_data", target_ids: ["vis_2"], page: 1 });
    expect(warnings).toContain("chart_data_dropped:1");
    expect(analysis.structure.counts.charts).toBe(2);
  });

  it("an illegible chart keeps its description and the model's uncertainty; nothing is invented", () => {
    const { analysis } = run((d) => {
      delete d.visuals[2]!.chart;
      d.visuals[2]!.description = "Gráfico de barras con valores ilegibles.";
      d.uncertainties.push({ kind: "unstructured_data", targets: ["v3"], note: "No se leen los valores de las barras.", confidence: 0.4 });
    });
    expect(analysis.visuals[2]).toMatchObject({ kind: "chart", chart: null, description: "Gráfico de barras con valores ilegibles." });
    expect(analysis.uncertainties.at(-1)).toMatchObject({ kind: "unstructured_data", target_ids: ["vis_3"], confidence: 0.4 });
    expect(analysis.structure.counts.charts).toBe(2);
  });

  it("a decorative kind always has a decorative role", () => {
    const { analysis, warnings } = run((d) => void (d.visuals[3]!.role = "informative"));
    expect(analysis.visuals[3]).toMatchObject({ kind: "decorative", role: "decorative" });
    expect(warnings).toContain("visual_role_adjusted:1");
  });
});

describe("uncertainties are compact and point at what they affect", () => {
  it("keeps only kind, targets, a short note and confidence (plus the page of the first target)", () => {
    const { analysis } = run();
    expect(analysis.uncertainties).toEqual([{ id: "unc_1", kind: "ambiguous", target_ids: ["act_5"], note: "No está claro qué dato de apoyo se espera citar.", confidence: 0.6, page: 2 }]);
  });
});

describe("stored schema (invariants)", () => {
  const stored = () => run().analysis;
  const rejects = (mutate: (a: ReturnType<typeof stored>) => void) => {
    const bad = stored();
    mutate(bad);
    expect(MaterialAnalysisSchema.safeParse(bad).success).toBe(false);
  };

  it("rejects references to entities that do not exist", () => {
    rejects((a) => void (a.protected_elements[0]!.activity_ids = ["act_42"]));
    rejects((a) => void (a.uncertainties[0]!.target_ids = ["vis_42"]));
    rejects((a) => void (a.activities[0]!.objective_ids = ["obj_42"]));
  });

  it("rejects ids the server did not assign", () => {
    rejects((a) => void (a.activities[0]!.id = "a1"));
  });

  it("rejects a decorative element with a pedagogical role, and table data on a chart", () => {
    rejects((a) => void (a.visuals[3]!.role = "required"));
    rejects((a) => void (a.visuals[1]!.table = { headers: ["x"], rows: [], unit: null }));
  });

  it("rejects a chart whose series length differs from its categories", () => {
    rejects((a) => void (a.visuals[1]!.chart!.series[0]!.values = [1]));
  });

  it("rejects an answer basis without a value, and a value without a basis", () => {
    rejects((a) => void (a.activities[0]!.expected_answer = { basis: "inferred", value: null }));
    rejects((a) => void (a.activities[3]!.expected_answer = { basis: "not_inferable", value: "inventada" }));
  });
});

describe("context: the teacher always prevails over the model", () => {
  const analysis = run().analysis;
  const catalog = { stages: new Set(["primaria", "eso"]), grades: new Set(["2-eso", "1-eso"]), subjects: new Set(["biologia-geologia"]) };

  it("fills only unconfirmed, confident, valid fields", () => {
    expect(detectedContextUpdate(analysis, [], catalog)).toEqual({
      title: "Reciclaje en una ciudad mediana",
      stage: "eso",
      grade: "2-eso",
      subject: "biologia-geologia",
      topic: "Gestión de residuos a partir de datos",
    });
    expect(detectedContextUpdate(analysis, ["stage", "topic", "title"], catalog)).toEqual({ grade: "2-eso", subject: "biologia-geologia" });
  });

  it("never applies a grade that contradicts the stage, and ignores low-confidence detections", () => {
    const primaria = structuredClone(analysis);
    primaria.identification.stage.value = "primaria";
    expect(detectedContextUpdate(primaria, [], catalog).grade).toBeUndefined();
    const weak = structuredClone(analysis);
    weak.identification.subject.confidence = 0.4;
    weak.identification.stage.confidence = 0.59;
    const update = detectedContextUpdate(weak, [], catalog);
    expect(update.subject).toBeUndefined();
    expect(update.stage).toBeUndefined();
  });

  it("reports provenance: teacher-confirmed vs AI-detected", () => {
    const resolved = resolveContext(
      { title: "Mi ficha", stage_slug: "primaria", grade_slug: "1-primaria", subject_slug: "biologia-geologia", topic: null, confirmed_fields: ["stage", "title"] },
      analysis,
    );
    expect(resolved.stage).toMatchObject({ value: "primaria", source: "teacher" });
    expect(resolved.title).toMatchObject({ value: "Mi ficha", source: "teacher" });
    expect(resolved.subject.source).toBe("ai");
    expect(resolved.topic).toMatchObject({ value: null, source: "none" });
    expect(stageOfGrade("2-bachillerato")).toBe("bachillerato");
  });
});

describe("subject matching", () => {
  it.each([
    ["Matemáticas", "matematicas"],
    ["matematicas", "matematicas"],
    ["Lengua", "lengua-castellana"],
    ["Biología", "biologia"],
    ["Geografía e Historia", "geografia-historia"],
  ])("maps %s", (text, slug) => expect(matchSubjectSlug(text, subjects)).toBe(slug));

  it("returns null for unknown, ambiguous or too short text", () => {
    expect(matchSubjectSlug("Cocina", subjects)).toBeNull();
    expect(matchSubjectSlug("Ma", subjects)).toBeNull();
    expect(matchSubjectSlug("", subjects)).toBeNull();
  });
});
