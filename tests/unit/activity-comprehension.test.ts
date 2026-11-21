import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { analyzeMaterialFile } from "@/lib/ai/pipeline/analyze";
import { activeMaterialAnalyzer, getMaterialAnalyzer } from "@/lib/ai/prompts";
import { MockProvider } from "@/lib/ai/providers/mock";
import { parseStructured } from "@/lib/ai/structured";
import { normalizeActivityComprehension } from "@/lib/analysis/activity-comprehension";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { pickReusableAnalysis } from "@/lib/materials/cache";
import { recreationInput } from "@/lib/recreation/input";
import { MaterialAnalysisV4DraftSchema } from "@/lib/schemas/activity-comprehension";
import { emptyFunctionalProfile } from "@/lib/schemas/functional-profile";
import { MaterialAnalysisDraftSchema } from "@/lib/schemas/material-analysis";
import { pedagogicalOriginalDraft, pedagogicalOriginalPdf } from "../support/pedagogical-original";

const options = { pageCount: 2 };

describe("analizador v4 de la demanda pedagógica", () => {
  it("registra actividades variadas con decisiones, datos, condiciones y referencias al original", async () => {
    const draft = pedagogicalOriginalDraft();
    const result = await analyzeMaterialFile({
      analyzer: getMaterialAnalyzer(4),
      file: { kind: "pdf", data: await pedagogicalOriginalPdf(draft) },
      ...options,
      teacherContext: {},
      provider: new MockProvider({ fixtures: { material_analysis_v4: (request) => {
        expect(request.messages[0]?.content.map((part) => part.type)).toEqual(["text", "pdf", "text"]);
        expect(request.system).toContain("No resuelvas la actividad");
        return draft;
      } } }),
      selection: { alias: "STANDARD", provider: "mock", model: "default", effort: "medium" },
      maxRepairAttempts: 0,
      maxOutputTokens: 10_000,
    });
    expect(result.runs).toHaveLength(1);
    expect(result.meta).toMatchObject({ schema_version: 4, prompt_version: 4, provider: "mock" });
    const loaded = parseStoredAnalysis(result.analysis);
    expect(loaded).toMatchObject({ storedVersion: 4, outdated: false, comprehension: { version: 1 } });
    const [math, reading, writing, classification, chart, ambiguous] = loaded.comprehension!.activities;

    expect(math!.objectives[0]).toMatchObject({ objective_ref: "obj_1", basis: "interpreted", evidence: { source_ref: "act_1", page: 1 } });
    expect(math!.student_decisions.map((decision) => decision.kind)).toEqual(["choose_procedure", "order_steps"]);
    expect(math!.information.map((item) => item.quote)).toEqual(["Hay 150 plazas", "75 por la mañana y 32 por la tarde"]);
    expect(math!.conditions[0]?.evidence.quote).toBe("Hay 150 plazas");

    expect(reading!.operations.map((operation) => operation.kind)).toEqual(["infer", "locate_evidence"]);
    expect(reading!.student_decisions.map((decision) => decision.kind)).toEqual(["infer_conclusion", "select_evidence"]);
    expect(reading!.essential_resources[0]).toMatchObject({ resource_ref: "ctt_1", evidence: { source_ref: "act_2" } });

    expect(writing!.response).toMatchObject({ format: "write_text", format_role: { kind: "assessed" } });
    expect(writing!.evaluation.map((criterion) => criterion.kind)).toEqual(["written_production", "argumentation"]);
    expect(writing!.conditions[0]?.evidence.quote).toBe("con dos argumentos");
    expect(writing!.uncertainties).toEqual([]);

    expect(classification!.student_decisions[0]).toMatchObject({ kind: "choose_criterion", evidence: { quote: "Decide un criterio propio" } });
    expect(chart!.information).toEqual([{ source_ref: "vis_1", page: 2, quote: null }]);
    expect(chart!.essential_resources).toMatchObject([{ resource_ref: "vis_1", evidence: { source_ref: "act_5", page: 2, quote: "Usa el gráfico" } }]);
    expect(ambiguous).toMatchObject({
      activity_id: "act_6", objectives: [], operations: [], essential_resources: [], original_uncertainty_ids: ["unc_1"],
    });
    expect(ambiguous!.uncertainties).toContainEqual({ field: "operations", reason: "ambiguous" });
    expect(ambiguous!.uncertainties).toContainEqual({ field: "essential_resources", reason: "ambiguous" });
    expect(result.canonical.activities.every((activity) => activity.expected_answer.value === null)).toBe(true);

    const source = { id: "source", status: "analyzed", analysis: result.analysis, analysis_meta: result.meta, analysis_prompt_version: "material_analyzer@v4" };
    expect(pickReusableAnalysis([source], { promptVersion: "material_analyzer@v4", schemaVersion: 4 })?.stored).toEqual(result.analysis);
    expect(pickReusableAnalysis([source], { promptVersion: "material_analyzer@v3", schemaVersion: 3 })).toBeNull();
  });

  it("retira una cita inventada, un fragmento numérico y evidencia de otra actividad aunque el texto exista", () => {
    const draft = pedagogicalOriginalDraft();
    const math = draft.activities[0]!.comprehension;
    math.information.push({ source_ref: "a1", quote: "50 plazas" }, { source_ref: "a1", quote: "77 por la mañana" });
    math.operations.push({ kind: "compose", evidence: { source_ref: "a3", quote: "Escribe un texto" } });
    math.objectives.push({ objective_ref: "o3", basis: "explicit", evidence: { source_ref: "a1", quote: "Justifica el procedimiento" } });
    math.objectives.push({ objective_ref: "o1", basis: "explicit", evidence: { source_ref: "a1", quote: "Justifica el procedimiento" } });
    const { stored, warnings } = normalizeActivityComprehension(draft, options);
    const activity = stored.comprehension.activities[0]!;
    expect(activity.objectives).toHaveLength(1);
    expect(activity.operations).toHaveLength(2);
    expect(activity.information).toHaveLength(2);
    expect(activity.uncertainties).toEqual(expect.arrayContaining(["information", "operations", "objectives"].map((field) => ({ field, reason: "unverified_evidence" }))));
    expect(warnings).toContain("comprehension_evidence_withheld:5");
    expect(JSON.stringify(warnings)).not.toContain("77");
  });

  it("una cita numérica conserva el signo, los decimales y la fracción", () => {
    const draft = pedagogicalOriginalDraft();
    const math = draft.activities[0]!;
    math.context += " La variación fue de −5,5 °C y la proporción fue 2/3.";
    math.comprehension.information.push(
      { source_ref: "a1", quote: "−5,5 °C" },
      { source_ref: "a1", quote: "5,5 °C" },
      { source_ref: "a1", quote: "5 °C" },
      { source_ref: "a1", quote: "2" },
      { source_ref: "a1", quote: "3" },
    );
    const row = normalizeActivityComprehension(draft, options).stored.comprehension.activities[0]!;
    expect(row.information.map(({ quote }) => quote)).toEqual(["Hay 150 plazas", "75 por la mañana y 32 por la tarde", "−5,5 °C"]);
    expect(row.uncertainties).toContainEqual({ field: "information", reason: "unverified_evidence" });
  });

  it("registra gráficos sin datos y rechaza usar un adorno o un identificador ambiguo como evidencia", () => {
    const draft = pedagogicalOriginalDraft();
    delete draft.visuals[0]!.chart;
    draft.visuals.push({ id: "decor", kind: "decorative", page: 2, role: "decorative", description: "Un marco." });
    const chart = draft.activities[4]!;
    chart.resources.push("decor");
    chart.comprehension.essential_resources.push({ resource_ref: "decor", evidence: { source_ref: "decor", quote: null } });
    const { stored } = normalizeActivityComprehension(draft, options);
    expect(stored.comprehension.activities[4]!.essential_resources.map((resource) => resource.resource_ref)).toEqual(["vis_1"]);
    expect(stored.comprehension.activities[4]!.uncertainties).toEqual(expect.arrayContaining([
      { field: "information", reason: "unavailable_resource_data" },
      { field: "essential_resources", reason: "unavailable_resource_data" },
      { field: "essential_resources", reason: "unverified_evidence" },
    ]));

    draft.texts.push({ id: "chart", text: "Un pie que no permite desambiguar.", page: 2, kind: "note" });
    const ambiguous = normalizeActivityComprehension(draft, options).stored.comprehension.activities[4]!;
    expect(ambiguous.information).toEqual([]);
    expect(ambiguous.uncertainties).toContainEqual({ field: "information", reason: "unverified_evidence" });
  });

  it("conserva la exigencia de producción aunque el borrador etiquete como acceso el formato de una argumentación escrita", () => {
    const draft = pedagogicalOriginalDraft();
    const writing = draft.activities[2]!.comprehension;
    writing.response_format_role = { ...writing.response_format_role!, kind: "access" };
    const activity = normalizeActivityComprehension(draft, options).stored.comprehension.activities[2]!;
    expect(activity.response.format_role).toBeNull();
    expect(activity.evaluation.map((criterion) => criterion.kind)).toContain("argumentation");
    expect(activity.uncertainties).toContainEqual({ field: "response_format_role", reason: "ambiguous" });
  });

  it("rechaza respuestas en el borrador y evidencias guardadas que ya no corresponden al análisis base", () => {
    const draft = pedagogicalOriginalDraft();
    expect(MaterialAnalysisV4DraftSchema.safeParse({ ...draft, activities: [{ ...draft.activities[0], answer: { basis: "inferred", value: "43" } }] }).success).toBe(false);
    const { stored } = normalizeActivityComprehension(draft, options);
    const missing = structuredClone(stored);
    missing.comprehension.activities[5]!.uncertainties = [];
    expect(parseStoredAnalysis(missing)).toMatchObject({ storedVersion: 4, analysis: null, outdated: true });
    stored.comprehension.activities[4]!.information[0]!.page = 1;
    expect(parseStoredAnalysis(stored)).toMatchObject({ storedVersion: 4, analysis: null, outdated: true });
  });

  it("el diagnóstico de un campo inventado omite el texto de su clave", () => {
    const draft = pedagogicalOriginalDraft();
    const unexpected = "Un fragmento del original como nombre de campo";
    const activities = [{ ...draft.activities[0], [unexpected]: true }, ...draft.activities.slice(1)];
    const result = parseStructured(JSON.stringify({ ...draft, activities }), MaterialAnalysisV4DraftSchema);
    expect(result).toMatchObject({ ok: false, kind: "schema", issues: ["activities.0: Campos inesperados: 1"] });
  });

  it("conserva la proyección y la huella históricas de v3 para el motor actual", () => {
    const draft = pedagogicalOriginalDraft();
    const historical = normalizeAnalysis(MaterialAnalysisDraftSchema.parse(draft), options).analysis;
    const before = JSON.stringify(historical);
    const { stored } = normalizeActivityComprehension(draft, options);
    const parsed = parseStoredAnalysis(stored);
    const legacy = parseStoredAnalysis(historical);
    expect(legacy.comprehension).toBeUndefined();
    expect(JSON.stringify(historical)).toBe(before);
    expect(parsed.analysis).toEqual(historical);
    expect(fingerprint(parsed.analysis)).toBe(fingerprint(historical));
    const { context } = buildAdaptationContext({ profile: emptyFunctionalProfile(), education: { stage: "primaria", grade: "5-primaria", subject: null }, analysis: historical, adaptationType: "accessibility" });
    expect(recreationInput(parsed.analysis!, context, "methodological")).toEqual(recreationInput(historical, context, "methodological"));
    expect(activeMaterialAnalyzer().version).toBe(3);
  });
});
