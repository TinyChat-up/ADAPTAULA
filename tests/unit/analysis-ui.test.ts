import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivitiesList, IdentifiedCard, ProtectedList, ReviewNotice, VisualsList } from "@/components/materials/analysis-summary";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema } from "@/lib/schemas/material-analysis";
import { worksheetDraftV3 } from "../../evals/material-analysis/synthetic-analyses";

const analysis = normalizeAnalysis(MaterialAnalysisDraftSchema.parse(worksheetDraftV3()), { pageCount: 2 }).analysis;
const html = <P extends object>(component: FunctionComponent<P>, props: P) => renderToStaticMarkup(createElement(component, props));

describe("the results screen renders the v3 analysis", () => {
  it("identification: topic, number of activities, difficulty, purpose and objectives", () => {
    const out = html(IdentifiedCard, { analysis, reused: false });
    expect(out).toContain("Gestión de residuos a partir de datos");
    expect(out).toContain("Objetivos principales");
    expect(out).toContain("Calcular el aumento absoluto y relativo");
  });

  it("activities: instruction, optional context and the original answer area, never an answer", () => {
    const out = html(ActivitiesList, { analysis });
    expect(out).toContain("Actividad 5");
    expect(out).toContain("Espacio para responder: varias líneas (unas 4)");
    expect(out).not.toContain("26,8");
  });

  it("protected elements: typed, with their importance, and no explanation text", () => {
    const out = html(ProtectedList, { analysis });
    expect(out).toContain("Condición de razonamiento");
    expect(out).toContain("No basta con copiar un porcentaje");
    expect(out).toContain("Esencial");
    expect(out).toContain("Recurso necesario");
  });

  it("visuals: kind, role and what the structured data holds; decorative ones are marked as such", () => {
    const out = html(VisualsList, { analysis });
    expect(out).toContain("Documento 2. Composición de los residuos (2023)");
    expect(out).toContain("4 categorías");
    expect(out).toContain("1 filas");
    expect(out).toContain("Necesario para resolver");
    expect(out).toContain("Decorativo");
  });

  it("review notice: shows the note and the page of what it affects, and nothing when all is well", () => {
    expect(html(ReviewNotice, { analysis })).toContain("No está claro qué dato de apoyo se espera citar. ".trim());
    expect(html(ReviewNotice, { analysis })).toContain("página 2");
    const clean = { ...analysis, uncertainties: [] };
    expect(html(ReviewNotice, { analysis: clean })).toBe("");
  });
});
