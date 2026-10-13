import { describe, expect, it, vi } from "vitest";
import { applyVisualResolution } from "@/lib/adaptation/visual-policy";
import { allBlocks } from "@/lib/schemas/material-document";
import { resolveMagicVisuals, validateSubstitute } from "@/lib/materials/visuals/auto/policy";
import type { SubstituteDraft, VisualAssistants } from "@/lib/materials/visuals/auto/assistants";
import { generateEquivalentFigure } from "@/lib/visuals/from-task";
import { singleChoiceViolations, sourceSingleChoice, singleChoiceDocumentCompatible } from "@/lib/adaptation/single-choice";
import { substitutionFeedback } from "@/lib/adaptation/substitution-feedback";
import { singleChoiceCase, SINGLE_CHOICE_DRAFT } from "../support/single-choice-case";

const run = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "default", effort: "low" as const, promptKey: "visual_substitute", promptVersion: 3, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null };
const fixture = singleChoiceCase;
const check = (draft: SubstituteDraft = structuredClone(SINGLE_CHOICE_DRAFT), source = fixture()) => validateSubstitute(draft, { analysis: source.analysis, activity: source.analysis.activities[0]!, visual: source.analysis.visuals[0], signatures: [], functionalNeeds: [], drawable: true });

describe("selección única tras perder el visual", () => {
  it("reproduce la carencia: una clave por letra no permite generar la figura antes de la sustitución", () => {
    const s = fixture();
    expect(generateEquivalentFigure(s.analysis.visuals[0]!, s.analysis.activities)).toBeNull();
    expect(check()).toMatchObject({ ok: true, rewrite: { response: SINGLE_CHOICE_DRAFT.choice }, spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } });
  });

  it("resuelve sin aprobación y mantiene opciones, clave, identificadores y procedencia", async () => {
    const s = fixture();
    const substitute = vi.fn<VisualAssistants["substitute"]>().mockResolvedValue({ draft: SINGLE_CHOICE_DRAFT, run });
    const assistants: VisualAssistants = { substitute, support: async () => ({ draft: null, run }), rewrite: async () => ({ draft: null, run }) };
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), assistants }, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(plan.needs[0]!.resolution.action).toBe("substitute");
    const doc = applyVisualResolution(s.document, plan);
    expect(doc.answer_key).toEqual(s.document.answer_key);
    const before = allBlocks(s.document).find((b) => b.type === "activity")!;
    const after = allBlocks(doc).find((b) => b.type === "activity")!;
    expect(after).toMatchObject({ id: before.id, response: SINGLE_CHOICE_DRAFT.choice, trace: { origin: "adapted", source_refs: ["act_1", "vis_1"] } });
    expect(substitute).toHaveBeenCalledTimes(1);
    expect(applyVisualResolution(doc, plan)).toEqual(doc);
    expect(substitute.mock.calls[0]![0]).toMatchObject({ options: SINGLE_CHOICE_DRAFT.choice.options, responseFormat: "select_option" });
    expect(substitute.mock.calls[0]![0]).not.toHaveProperty("expected_answer");
  });

  it.each([
    ["pérdida de una alternativa", "choice_options_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.choice.options.pop(); }],
    ["duplicación de una alternativa", "choice_options_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.choice.options[2] = d.choice.options[1]!; }],
    ["orden alterado", "choice_options_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.choice.options.reverse(); }],
    ["cambio de objetivo", "choice_task_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.prompt = "Calcula la suma de las fracciones. Elige una opción."; }],
    ["pista textual", "choice_task_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.prompt += " La opción correcta es B."; }],
    ["dificultad incompatible", "choice_demand_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.figure.parts = 16; d.figure.shaded = 6; }],
    ["cambio de respuesta correcta", "choice_answer_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.figure.shaded = 4; }],
    ["ninguna respuesta correcta", "choice_correct_count", (d: typeof SINGLE_CHOICE_DRAFT) => { d.figure.shaded = 5; }],
    ["selección múltiple", "response_type_changed", (d: typeof SINGLE_CHOICE_DRAFT) => { d.choice.multiple = true; }],
  ])("rechaza %s", (_name, code, mutate) => {
    const draft = structuredClone(SINGLE_CHOICE_DRAFT);
    mutate(draft);
    const result = check(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain(code);
  });

  it("rechaza dos alternativas numéricamente correctas, aunque sus textos sean distintos", () => {
    const s = fixture();
    s.analysis.activities[0]!.context = "A) 1/4\nB) 3/8\nC) 6/16";
    const draft = structuredClone(SINGLE_CHOICE_DRAFT);
    draft.choice.options[2]!.text = "C) 6/16";
    const result = check(draft, s);
    expect(!result.ok && result.violations).toContain("choice_correct_count");
  });

  it("un apoyo que da la respuesta no puede hacerse pasar por la figura matemática", () => {
    const s = fixture();
    const violations = singleChoiceViolations(s.analysis.activities[0]!, { ...SINGLE_CHOICE_DRAFT, figure: { spec_version: 1, kind: "cards", items: [{ term: "Respuesta", hint: "La opción B es correcta" }] } });
    expect(violations).toContain("choice_figure_unverifiable");
  });

  it.each(["B y C", "Z", "No se sabe"])("no confía en una clave ambigua: %s", (value) => {
    const s = fixture();
    s.analysis.activities[0]!.expected_answer.value = value;
    const result = check(undefined, s);
    expect(!result.ok && result.violations).toContain("choice_key_unverifiable");
  });

  it.each(["A) 1/4\nC) 1/2", "A) 1/4\nB) 3/8\nB) 1/2", "1/4, 3/8, 1/2", "A) 1/4\nB) 3/8\nC) 1/2\nJustifica tu elección."])("no inventa estructura para alternativas ambiguas", (context) => {
    const a = fixture().analysis.activities[0]!;
    a.context = context;
    expect(sourceSingleChoice(a)).toBeNull();
  });

  it("conserva una restricción que cambia el significado: el complemento queda fuera del verificador", () => {
    const s = fixture();
    s.analysis.activities[0]!.instruction = SINGLE_CHOICE_DRAFT.prompt.replace("está coloreada", "no está coloreada");
    expect(check(undefined, s)).toMatchObject({ ok: false });
  });

  it("rechaza una clave del documento contradictoria o creada por una transformación anterior", () => {
    const s = fixture();
    expect(singleChoiceDocumentCompatible(s.analysis.activities[0]!, s.document)).toBe(true);
    s.document.answer_key[0]!.value = "A";
    expect(singleChoiceDocumentCompatible(s.analysis.activities[0]!, s.document)).toBe(false);
    s.document.answer_key[0]!.value = "B";
    s.document.answer_key[0]!.correct_option_ids = ["option_b", "option_c"];
    expect(singleChoiceDocumentCompatible(s.analysis.activities[0]!, s.document)).toBe(false);
  });

  it("conserva un círculo como círculo y rechaza sustituirlo por una barra", () => {
    const s = fixture();
    const prompt = SINGLE_CHOICE_DRAFT.prompt.replace("Observa la barra", "Observa el círculo").replace("de la barra", "del círculo");
    s.analysis.activities[0]!.instruction = prompt;
    s.analysis.visuals[0]!.description = "Círculo con ocho sectores iguales, tres pintados.";
    expect(check({ ...SINGLE_CHOICE_DRAFT, prompt, figure: { ...SINGLE_CHOICE_DRAFT.figure, kind: "circle" } }, s)).toMatchObject({ ok: true });
    const invalid = check({ ...SINGLE_CHOICE_DRAFT, prompt }, s);
    expect(!invalid.ok && invalid.violations).toContain("choice_figure_unverifiable");
    s.analysis.activities[0]!.instruction = prompt.replace("Observa el círculo", "Observa la barra");
    const mixed = check({ ...SINGLE_CHOICE_DRAFT, prompt: s.analysis.activities[0]!.instruction, figure: { ...SINGLE_CHOICE_DRAFT.figure, kind: "circle" } }, s);
    expect(!mixed.ok && mixed.violations).toContain("choice_source_unverifiable");
  });

  it("la clave inferida sirve para contrastar, pero nunca pasa a la clave docente ni a la entrada del modelo", async () => {
    const s = fixture();
    s.analysis.activities[0]!.expected_answer.basis = "inferred";
    s.document.answer_key = [];
    const substitute = vi.fn<VisualAssistants["substitute"]>().mockResolvedValue({ draft: SINGLE_CHOICE_DRAFT, run });
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), assistants: { substitute, support: async () => ({ draft: null, run }), rewrite: async () => ({ draft: null, run }) } }, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(plan.needs[0]!.resolution.action).toBe("substitute");
    expect(applyVisualResolution(s.document, plan).answer_key).toEqual([]);
    expect(Object.keys(substitute.mock.calls[0]![0]).sort()).toEqual(["activity", "functionalNeeds", "objective", "options", "rejectionCodes", "responseFormat", "stage", "visual"]);
  });

  it.each([true, false])("segundo intento informado: corrección válida=%s y nunca un tercer intento", async (correct) => {
    const s = fixture();
    const invalid = structuredClone(SINGLE_CHOICE_DRAFT);
    invalid.choice.options.pop();
    const substitute = vi.fn<VisualAssistants["substitute"]>()
      .mockResolvedValueOnce({ draft: invalid, run })
      .mockResolvedValueOnce({ draft: correct ? SINGLE_CHOICE_DRAFT : invalid, run });
    const recordAiRun = vi.fn().mockResolvedValue(undefined);
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), recordAiRun, assistants: { substitute, support: async () => ({ draft: null, run }), rewrite: async () => ({ draft: null, run }) } }, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(substitute).toHaveBeenCalledTimes(2);
    expect(substitute.mock.calls[1]![0].rejectionCodes).toEqual(["choice_options_changed"]);
    expect(plan.needs[0]!.resolution).toMatchObject(correct ? { action: "substitute" } : { action: "unresolved", reason: "no_equivalent_activity" });
    expect(recordAiRun.mock.calls.map(([r]) => r.attempt)).toEqual([1, 2]);
    expect(substitutionFeedback(["choice_answer_changed(B)", "choice_correct_count(3/8)"])).toEqual(["choice_answer_changed", "choice_correct_count"]);
  });
});
