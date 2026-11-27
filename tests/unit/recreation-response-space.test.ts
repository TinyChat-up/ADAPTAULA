import { describe, expect, it } from "vitest";
import { calculationResponse, isCalculationField, MIN_CALCULATION_MM, writtenResponse } from "@/lib/recreation/response-space";
import { buildRenderModel, flatNodes } from "@/lib/render/model";
import { runMockRecreation } from "../support/recreation-mocks";
import { compileRecreation } from "@/lib/recreation/compile";
import { POND_PILOT_PROFILE } from "../../evals/recreation/pond-plan";
import { pondAnalysis } from "../support/pond-case";
import { answerSpace, spaceContextOf } from "@/lib/adaptation/answer-space";
import { buildAdaptationContext } from "@/lib/adaptation/context";

describe("recreación: área de respuesta que se puede escribir", () => {
  it("las operaciones antiguas de una línea también se renderizan en al menos 34 mm y la unidad queda vacía", async () => {
    const { outcome } = await runMockRecreation({ imagesAuthorized: false });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    const doc = structuredClone(outcome.compiled.student);
    const calculation = doc.pages.flatMap((page) => page.blocks).find((b) => b.type === "activity" && b.response.kind === "fields" && b.response.fields[0]?.space === "grid");
    if (calculation?.type !== "activity") throw new Error("missing calculation");
    expect(calculation.response).toEqual(calculationResponse());
    calculation.response = { kind: "fields", fields: [{ label: "Operación", space: "lines", lines: 1 }, { label: "Resultado", space: "lines", lines: 1, unit: true }] };
    const { model } = buildRenderModel(doc, { mode: "student", deferred: [] });
    const fields = model.pages.flatMap((p) => flatNodes(p.nodes)).find((b) => b.kind === "activity" && b.label === calculation.label);
    if (fields?.kind !== "activity" || fields.response.kind !== "fields") throw new Error("fields missing");
    const { cellMm } = fields.response;
    expect(fields.response.fields[0]).toMatchObject({ label: "Operación", space: "grid", lines: expect.any(Number) });
    expect(cellMm * fields.response.fields[0]!.lines).toBeGreaterThanOrEqual(MIN_CALCULATION_MM);
    expect(fields.response.fields[1]).toEqual({ label: "Resultado", space: "lines", lines: 1, unit: true });
    expect(isCalculationField("Tipo de operación")).toBe(false);
    expect(JSON.stringify(model)).not.toMatch(/30 − 18 = 12/);
  });

  it("separar dos evidencias explícitas no añade una exigencia al razonamiento", async () => {
    const { outcome } = await runMockRecreation({ imagesAuthorized: false });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    const task = outcome.plan.activities.find((a) => a.executor.kind === "short_answer");
    if (!task || task.executor.kind !== "short_answer") throw new Error("missing open task");
    const common = { ...task, executor: { ...task.executor, lines: 1 }, operations: ["justify" as const], steps: [] };
    expect(writtenResponse({ ...common, prompt: "¿Estás de acuerdo? Justifica con dos evidencias." })).toMatchObject({
      kind: "fields", fields: [{ label: "Mi postura", lines: 2 }, { label: "Evidencia 1", lines: 3 }, { label: "Evidencia 2", lines: 3 }],
    });
    expect(writtenResponse({ ...common, prompt: "Explica qué muestran los dos instrumentos." })).toEqual({ kind: "lines", lines: 3 });
    expect(writtenResponse({ ...common, operations: ["identify"], prompt: "Identifica dos datos." })).toEqual({ kind: "lines", lines: 1 });
  });

  it("comprensión lectora convencional: defender una postura con dos evidencias no se queda en una línea", () => {
    const analysis = pondAnalysis();
    const { context } = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" });
    const original = { ...analysis.activities[0]!, type: "reading_comprehension" as const, response_format: "write_text" as const,
      instruction: "Defiende tu postura con dos evidencias del texto.", context: null };
    const sizing = spaceContextOf(analysis, context);
    const area = answerSpace(original, { kind: "lines", lines: 1 }, sizing);
    expect(area.response).toMatchObject({ kind: "fields", fields: [{ label: "Mi postura", lines: 2 }, { label: "Evidencia 1", lines: 3 }, { label: "Evidencia 2", lines: 3 }] });
    const approvedOral = { kind: "oral_or_alternative" as const, mode: "oral" as const, lines: 0 };
    expect(answerSpace(original, approvedOral, sizing, true).response).toEqual(approvedOral);
  });

  it("el visual opcional de vocabulario llega a la lectura y no se fabrica cuando no hay recurso", async () => {
    const { outcome } = await runMockRecreation({ imagesAuthorized: true });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    const plan = structuredClone(outcome.plan);
    const reading = plan.reading;
    if (!reading) throw new Error("fixture has no reading");
    const illustration = outcome.visuals.find((v) => v.source?.kind === "generated");
    const request = plan.visual_requests.find((r) => r.id === illustration?.request_id);
    if (!request || !illustration) throw new Error("missing mock image");
    request.function = "vocabulary";
    request.essential = false;
    const analysis = pondAnalysis();
    const { context } = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" });
    const input = { plan, verification: outcome.verification, analysis, presentation: context.presentation, designed: true };
    const withImage = compileRecreation({ ...input, visuals: [{ ...illustration, essential: false }] }).student.pages[0]!.blocks;
    expect(withImage.findIndex((b) => b.type === "image" && b.source.kind === "generated")).toBeGreaterThanOrEqual(0);
    expect(withImage.findIndex((b) => b.type === "image" && b.source.kind === "generated")).toBeLessThan(withImage.findIndex((b) => b.type === "reading_text"));
    const withoutImage = compileRecreation({ ...input, visuals: [] }).student.pages[0]!.blocks;
    expect(withoutImage.some((b) => b.type === "image" && b.source.kind === "generated")).toBe(false);
  });
});
