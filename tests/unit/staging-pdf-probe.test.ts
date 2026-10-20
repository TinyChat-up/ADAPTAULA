import { PDFDocument, PageSizes, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { inspectPdf } from "../../scripts/staging/pdf-probe.mjs";

async function sample(pageSize: readonly [number, number] = PageSizes.A4) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage(pageSize as [number, number]).drawText("FICHA SINTETICA TABLA ACTIVIDAD", { x: 40, y: 700, font });
  return new Uint8Array(await pdf.save());
}

describe("staging PDF response inspection", () => {
  it("checks pages, A4 and required synthetic text without writing the PDF", async () => {
    expect(await inspectPdf(await sample(), 1, ["FICHA SINTETICA", "TABLA", "ACTIVIDAD"])).toMatchObject({ pages: 1, imageOps: 0 });
  });
  it("rejects a missing marker, wrong page count and wrong paper size", async () => {
    await expect(inspectPdf(await sample(), 1, ["FIGURA"])).rejects.toThrow("pdf_missing_synthetic_marker");
    await expect(inspectPdf(await sample(), 2, ["TABLA"])).rejects.toThrow("pdf_pages_or_encryption");
    await expect(inspectPdf(await sample(PageSizes.Letter), 1, ["TABLA"])).rejects.toThrow("pdf_not_a4");
  });
});
