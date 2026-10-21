import { expect, it } from "vitest";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema, MaterialAnalysisSchema } from "@/lib/schemas/material-analysis";
import { withoutChoiceTableLinks } from "../e2e/adaptation-seed";

/**
 * The «Hacer magia» E2E reaches the delivered sheet by unlinking the mock's single-choice activity from its table (a choice that
 * relies on a table needs a model-made equivalent, ADR-023). The stored analysis must stay VALID after that edit, or the material
 * page shows «El análisis guardado es de una versión anterior» and the E2E tests nothing.
 */
it("el análisis simulado sin el vínculo elección–tabla sigue siendo válido y ya no liga ninguna elección a una tabla", () => {
  const analysis = normalizeAnalysis(MaterialAnalysisDraftSchema.parse(mockAnalysisDraftV3()), { pageCount: 1 }).analysis;
  const choiceOnTable = (a: typeof analysis) => a.activities.some((x) => x.response_format === "select_option" && x.resource_ids.some((r) => a.visuals.find((v) => v.id === r)?.kind === "table"));
  expect(choiceOnTable(analysis)).toBe(true);
  const unlinked = withoutChoiceTableLinks(analysis);
  expect(MaterialAnalysisSchema.safeParse(unlinked).success).toBe(true);
  expect(choiceOnTable(unlinked)).toBe(false);
  // Only that link changes: the table and the activity's own printed options stay.
  expect(unlinked.visuals.map((v) => v.id)).toEqual(analysis.visuals.map((v) => v.id));
  expect(unlinked.activities.map((a) => [a.instruction, a.context])).toEqual(analysis.activities.map((a) => [a.instruction, a.context]));
});
