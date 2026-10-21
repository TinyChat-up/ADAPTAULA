import { expect, it } from "vitest";
import { corroboratesTable } from "@/lib/materials/visuals/auto/table";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import { makePdf, MOCK_TABLE } from "../e2e/helpers";

/**
 * The E2E material and the mock analysis must describe the same sheet: the table the analysis reads (and a choice activity relies
 * on) is printed in the PDF the E2E uploads, so «Hacer magia» can corroborate it and deliver. Without it, the visual policy
 * rightly stops with `table_uncorroborated`, and the E2E would test an incoherent material instead of the delivered path.
 */
it("la tabla del análisis simulado está impresa en el PDF de las E2E y se corrobora; sin ella, no", async () => {
  const mock = mockAnalysisDraftV3().visuals.find((v) => v.title === "Tabla de equivalencias")!;
  expect(mock.table).toMatchObject(MOCK_TABLE);
  const printed = await readPage(new Uint8Array(await makePdf({ table: true })), "application/pdf", 1, 100);
  expect(corroboratesTable(printed.model, { ...MOCK_TABLE, unit: null })).toBe(true);
  const plain = await readPage(new Uint8Array(await makePdf()), "application/pdf", 1, 100);
  expect(corroboratesTable(plain.model, { ...MOCK_TABLE, unit: null })).toBe(false);
});
