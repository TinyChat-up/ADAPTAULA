import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { runRecreation } from "@/lib/recreation/pilot";
import { buildRenderModel } from "@/lib/render/model";
import { POND_PILOT_PROFILE, POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { pondAnalysis } from "../support/pond-case";
import { printPdf } from "./harness";

/**
 * The recreation pilot printed by the product's renderer and engine (docs/qa/recreacion-pedagogica): the student's sheet and the
 * teacher's guide, every page. Output in `.pdf-smoke/recreation-pond-*`.
 */
const analysis = pondAnalysis();
const context = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" }).context;
const outcome = runRecreation(async () => POND_RECREATION_PLAN, { analysis, context, scope: "methodological" });
const printed = (async () => {
  const result = await outcome;
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  const student = buildRenderModel(result.compiled.student, { mode: "student", deferred: [] });
  const guide = buildRenderModel(result.compiled.guide, { mode: "student", deferred: [] });
  return { student: { ...student, pdf: await printPdf("recreation-pond-student", student.model) }, guide: { ...guide, pdf: await printPdf("recreation-pond-guide", guide.model) } };
})();

describe("piloto de recreación del estanque · PDF", () => {
  it("la ficha del alumno se imprime sin avisos, sin páginas casi vacías y sin la clave", async () => {
    const { student } = await printed;
    expect(student.validation.status).toBe("renderable");
    expect(student.pdf.validation.issues).toEqual([]);
    const pages = student.pdf.pages;
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.length).toBeLessThanOrEqual(5);
    // The last page may be short; none before it is almost empty (a page with one stray line is ≈ 1 % ink).
    for (const page of pages.slice(0, -1)) expect(page.ink).toBeGreaterThan(0.03);
    const text = pages.map((p) => p.body).join("\n");
    for (const prompt of ["ser vivo o un elemento no vivo", "Numera del 1 al 3", "Calcula cuántos centímetros bajó", "Piensa una medida"]) expect(text).toContain(prompt);
    expect(text).not.toMatch(/30 − 18|\b12 cm\b|Criterios|Guía docente/);
    // The flow is drawn from data with the original's four labels.
    for (const label of ["Algas", "Larvas de insectos", "Ranas", "Garzas"]) expect(text).toContain(label);
  }, 180_000);

  it("la guía docente lleva la trazabilidad, las soluciones y las tarjetas para recortar", async () => {
    const { guide } = await printed;
    expect(guide.validation.status).toBe("renderable");
    expect(guide.pdf.validation.issues).toEqual([]);
    expect(guide.pdf.pages.length).toBeLessThanOrEqual(4);
    const text = guide.pdf.pages.map((p) => p.body).join("\n");
    expect(text.toLowerCase()).toContain("solo para el profesorado");
    // pdf.js drops the «−» and «=» glyphs of Inter when it extracts text (pdftotext keeps them): match the numbers.
    expect(text).toMatch(/Solución: 30\D{1,6}18\D{1,6}12 cm/);
    for (const needle of ["Comprobada por el sistema", "Tarjetas para recortar", "Temperatura"]) expect(text).toContain(needle);
  }, 180_000);
});
