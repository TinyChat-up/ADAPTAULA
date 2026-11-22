import { describe, expect, it, vi } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import type { RecreationPlan } from "@/lib/recreation/contract";
import { planRecreation, runRecreation, type RecreationRequest } from "@/lib/recreation/pilot";
import { NOT_NEW_SIMILARITY, similarity, verifyPlan } from "@/lib/recreation/verify";
import { allBlocks } from "@/lib/schemas/material-document";
import { emptyFunctionalProfile } from "@/lib/schemas/functional-profile";

type Executor = RecreationPlan["activities"][number]["executor"];

function fixture(kind: "select" | "compute") {
  const seed = mockAnalysisDraftV3();
  const data = "En abril la biblioteca del barrio prestó 48 libros de aventuras y en marzo la misma biblioteca prestó 25 libros de aventuras.";
  const source = kind === "compute" ? data : "La biblioteca del barrio abre el lunes. También abre el miércoles.";
  const instruction = kind === "compute" ? `${data} Calcula la diferencia. Escribe la operación.` : "Identifica los días de apertura de la biblioteca.";
  const executor: Executor = kind === "compute"
    ? { kind: "compute", operation: "difference", minuend_fact_id: "f_1", subtrahend_fact_id: "f_2" }
    : { kind: "select", correct_count: 2, options: [
        { text: "Lunes", correct: true, evidence_fact_id: "f_1" },
        { text: "Miércoles", correct: true, evidence_fact_id: "f_2" },
        { text: "Domingo", correct: false, evidence_fact_id: null },
      ] };
  const operation = kind === "compute" ? "calculate" : "identify";
  const analysis = normalizeAnalysis({
    identification: seed.identification,
    quality: seed.quality,
    intent: { ...seed.intent, objectives: [{ id: "o1", text: kind === "compute" ? "Calcular la diferencia entre dos cantidades de libros" : "Identificar los días de apertura" }] },
    admin: [], sections: [], visuals: [], uncertainties: [],
    texts: [{ id: "t1", page: 1, kind: "note", text: source }],
    activities: [{ id: "a1", label: "1", page: 1, type: kind === "compute" ? "calculation" : "multiple_choice",
      instruction, context: kind === "compute" ? undefined : source, resources: [], objectives: ["o1"],
      response: kind === "compute" ? "calculate" : "select_option", answer_area: "line", difficulty: "low", confidence: 1 }],
    protected: kind === "compute" ? [
      { type: "required_data", importance: "essential", value: data, activities: ["a1"], resources: [] },
      { type: "response_constraint", importance: "essential", value: "Escribe la operación.", activities: ["a1"], resources: [] },
    ] : [],
  }, { pageCount: 1 }).analysis;
  const profile = { ...emptyFunctionalProfile(), supports: { decoding_support: "high" as const } };
  const context = buildAdaptationContext({ profile, analysis, education: { stage: "primaria", grade: "5-primaria", subject: null },
    adaptationType: "methodological" }).context;
  const request: RecreationRequest = { analysis, context, scope: "methodological", plannerLabel: "fixture", visualPolicy: "designed", diagrams: true };
  const plan: RecreationPlan = {
    contract: "recreation_plan@v1", scope: { type: "methodological" }, title: "En la biblioteca",
    objectives: [{ objective_id: "obj_1", level: "kept", operations: [operation] }],
    reading: null, strategies: [{ id: "st_1", method: "segmented_reading", needs: ["decoding_support"], rationale: "Separa la consigna de los datos." }],
    facts: kind === "compute" ? [
      { id: "f_1", kind: "quantity", source_ref: "ctt_1", quote: "48 libros", value: 48, unit: "libros", label: "Abril" },
      { id: "f_2", kind: "quantity", source_ref: "ctt_1", quote: "25 libros", value: 25, unit: "libros", label: "Marzo" },
    ] : [
      { id: "f_1", kind: "statement", source_ref: "ctt_1", quote: "La biblioteca del barrio abre el lunes." },
      { id: "f_2", kind: "statement", source_ref: "ctt_1", quote: "También abre el miércoles." },
    ],
    activities: [{ id: "ra_1", objective_ids: ["obj_1"], operations: [operation], strategy_ids: ["st_1"], visual_ids: [],
      prompt: kind === "compute" ? `${data} ¿En cuánto difieren ambas cantidades?` : "Prepara el cartel de atención al público.",
      steps: kind === "compute" ? ["Escribe la operación."] : ["Marca las dos opciones correctas."], executor }],
    visuals: [], visual_requests: [], materials: [], visual_style: "Sobrio",
    explanation: { adapted: ["Consigna breve.", "Datos separados."], why: [{ text: "Facilita la lectura.", needs: ["decoding_support"] }],
      how_to_use: ["Presenta el material.", "Lee la consigna.", "Deja tiempo para responder."] },
    guide: { per_activity: [{ activity_id: "ra_1", observe: "Observar cómo usa los datos." }] },
  };
  const check = () => verifyPlan(plan, analysis, { needs: ["decoding_support"] });
  return { request, plan, check, row: plan.activities[0]!, original: analysis.activities[0]! };
}

describe("rechazos de la planificación de recreación", () => {
  it("acepta el recuento inequívoco en un paso que se imprime, con una única llamada simulada", async () => {
    const { request, plan } = fixture("select");
    const planner = vi.fn(async () => ({ draft: plan, run: null }));
    const result = await runRecreation(planner, request);
    if (result.status !== "ready") throw new Error(JSON.stringify(result));
    expect(result.calls).toBe(1);
    expect(planner).toHaveBeenCalledTimes(1);
    expect(allBlocks(result.compiled.student)).toContainEqual(expect.objectContaining({
      type: "activity", steps: ["Marca las dos opciones correctas."], response: expect.objectContaining({ kind: "choice", multiple: true }),
    }));
  });

  it.each([
    ["Hay dos turnos. Marca las opciones correctas.", []],
    ["Marca las dos opciones correctas.", ["Selecciona tres respuestas."]],
    ["Marca al menos dos respuestas.", []],
    ["No marques dos opciones.", []],
    ["Marca dos opciones. Selecciona una respuesta.", []],
    ["Marca 2,5 opciones.", []],
  ])("bloquea una cantidad incidental, contradictoria o no exacta (%s)", (prompt, steps) => {
    const { row, check } = fixture("select");
    Object.assign(row, { prompt, steps });
    expect(check().issues).toContainEqual(expect.objectContaining({ code: "count_not_stated", severity: "error" }));
  });

  it("el texto sobre la cantidad no compensa una clave con otro número de respuestas", () => {
    const { row, check } = fixture("select");
    if (row.executor.kind !== "select") throw new Error("fixture");
    row.executor.options[1]!.correct = false;
    expect(check().issues).toContainEqual(expect.objectContaining({ code: "correct_count_mismatch", severity: "error" }));
  });

  it("la coincidencia causada por repetir los datos exactos de una resta no cuenta como copia de la consigna", () => {
    const { row, original, check } = fixture("compute");
    expect(similarity(original.instruction, row.prompt)).toBeGreaterThanOrEqual(NOT_NEW_SIMILARITY);
    expect(check()).toMatchObject({ ok: true, review_required: true, activities: [{ status: "verified" }] });
  });

  it.each(["copy", "required condition", "changed quantity", "unsupported fact", "learner decision", "different operation", "wrong comparison", "given result"] as const)(
    "mantiene el bloqueo cuando falta evidencia de una diferencia válida (%s)", (reason) => {
      const { row, original, request, plan, check } = fixture("compute");
      if (reason === "copy") row.prompt = original.instruction;
      if (reason === "required condition") row.steps = [];
      if (reason === "changed quantity") row.prompt = row.prompt.replace("48 libros", "49 libros");
      if (reason === "unsupported fact") plan.facts[0]!.quote = "49 libros";
      if (reason === "different operation") row.prompt = row.prompt.replace("¿En cuánto difieren ambas cantidades?", "¿Cuántos préstamos hubo en total?");
      if (reason === "wrong comparison") row.prompt = row.prompt.replace("¿En cuánto difieren ambas cantidades?", "¿Cuántos préstamos más hubo en marzo?");
      if (reason === "given result") row.steps.push("El resultado es 23.");
      if (reason === "learner decision") request.analysis.protected_elements.push({
        id: "prt_3", type: "reasoning_constraint", importance: "essential", value: "Elige qué operación realizar.", activity_ids: ["act_1"], resource_ids: [],
      });
      expect(check().issues).toContainEqual(expect.objectContaining({ code: "activity_not_new", severity: "error" }));
    },
  );

  it("usa la única reparación existente y nunca descarta una actividad para eludir el recuento", async () => {
    const { request, row, plan } = fixture("select");
    row.steps = [];
    plan.activities.push({ ...row, id: "ra_2", prompt: "Prepara una nota breve para las familias sobre el horario semanal.",
      executor: { kind: "short_answer", lines: 2, starters: [], criteria: ["Indica los días de apertura del local."] }, steps: [] });
    plan.guide.per_activity.push({ activity_id: "ra_2", observe: "Observar cómo prepara la nota." });
    const planner = vi.fn<Parameters<typeof planRecreation>[0]>(async () => ({ draft: plan, run: null }));
    const outcome = await planRecreation(planner, request);
    expect(outcome).toMatchObject({ status: "rejected", calls: 2, issues: [{ code: "count_not_stated", path: "activities.ra_1" }] });
    expect(planner).toHaveBeenCalledTimes(2);
    expect(planner.mock.calls[1]?.[2]).toMatchObject({ activities: [{ id: "ra_1" }, { id: "ra_2" }] });

    const deletingPlanner = vi.fn<Parameters<typeof planRecreation>[0]>(async (_input, issues) => ({
      draft: issues ? { ...plan, activities: plan.activities.slice(1) } : plan, run: null,
    }));
    await expect(planRecreation(deletingPlanner, request)).resolves.toMatchObject({
      status: "rejected", calls: 2, issues: [{ code: "repair_activity_removed", path: "activities.ra_1" }],
    });

    const wrongScope = vi.fn<Parameters<typeof planRecreation>[0]>(async (_input, issues) => ({
      draft: issues ? {
        ...plan, activities: [{ ...row, steps: ["Marca dos opciones."], operations: ["justify"] }, plan.activities[1]!],
      } : plan,
      run: null,
    }));
    await expect(planRecreation(wrongScope, request)).resolves.toMatchObject({
      status: "rejected", calls: 2, issues: [{ code: "repair_activity_scope_changed", path: "activities.ra_1" }],
    });

    const invalidAfterRepair = vi.fn<Parameters<typeof planRecreation>[0]>(async (_input, issues) => {
      if (!issues) return { draft: plan, run: null };
      const draft = structuredClone(plan);
      const a = draft.activities[0]!;
      a.steps = ["Marca dos opciones."];
      if (a.executor.kind === "select") a.executor.options[0]!.evidence_fact_id = null;
      return { draft, run: null };
    });
    await expect(planRecreation(invalidAfterRepair, request)).resolves.toMatchObject({
      status: "rejected", calls: 2, issues: expect.arrayContaining([expect.objectContaining({ code: "option_unanchored", path: "activities.ra_1" })]),
    });

    const fixingPlanner = vi.fn<Parameters<typeof planRecreation>[0]>(async (_input, issues) => ({
      draft: issues ? { ...plan, activities: [{ ...row, steps: ["Marca dos opciones."] }, plan.activities[1]!] } : plan, run: null,
    }));
    await expect(planRecreation(fixingPlanner, request)).resolves.toMatchObject({
      status: "planned", calls: 2, plan: { activities: [{ id: "ra_1", steps: ["Marca dos opciones."] }, { id: "ra_2" }] },
    });
  });
});
