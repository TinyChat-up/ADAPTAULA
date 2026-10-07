import { PDFDocument, PDFName, PageSizes, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { validatePdf } from "@/lib/render/print/validation";

/** PdfValidation: technical checks of a produced PDF (no pedagogy, no render rules), with pdf-lib only. */

const expectations = { fontPrefix: "Inter", minImages: 0, minPages: 1 };

async function pdf(build: (doc: PDFDocument) => Promise<void> | void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await build(doc);
  return doc.save();
}

describe("validatePdf", () => {
  it("rejects bytes that are not a PDF and PDFs over the size limit", async () => {
    expect((await validatePdf(new TextEncoder().encode("<html>no</html>"), expectations)).issues).toEqual(["not_pdf"]);
    const ok = await pdf((d) => void d.addPage(PageSizes.A4));
    expect((await validatePdf(ok, expectations, { maxPages: 60, maxBytes: 100 })).issues).toEqual(["too_large"]);
  });

  it("reports an encrypted PDF without trying to read it", async () => {
    const bytes = await pdf((d) => {
      d.addPage(PageSizes.A4);
      d.context.trailerInfo.Encrypt = d.context.obj({ Filter: PDFName.of("Standard") });
    });
    expect((await validatePdf(bytes, expectations)).issues).toEqual(["encrypted"]);
  });

  it("measures A4 with tolerance; Letter, rotated, blank and too many pages are issues", async () => {
    const letter = await validatePdf(await pdf((d) => void d.addPage(PageSizes.Letter)), expectations);
    expect(letter.issues).toEqual(expect.arrayContaining(["not_a4", "empty_page"]));
    const many = await validatePdf(await pdf((d) => { for (let i = 0; i < 3; i++) d.addPage(PageSizes.A4).drawRectangle({ x: 10, y: 10, width: 5, height: 5 }); }), { ...expectations, minPages: 4 }, { maxPages: 2, maxBytes: 1e7 });
    expect(many.issues).toEqual(expect.arrayContaining(["too_many_pages", "fewer_pages_than_model"]));
    const rotated = await validatePdf(await pdf((d) => { const p = d.addPage(PageSizes.A4); p.setRotation({ type: "degrees", angle: 90 } as never); p.drawRectangle({ x: 1, y: 1, width: 2, height: 2 }); p.drawRectangle({ x: 5, y: 5, width: 2, height: 2 }); }), expectations);
    expect(rotated.issues).toContain("rotated_page");
    expect(rotated.pages[0]).toEqual({ widthPt: 595.28, heightPt: 841.89 });
  });

  it("fonts must be embedded and of the sheet's family; images are counted; untagged is reported", async () => {
    const bytes = await pdf(async (d) => {
      const font = await d.embedFont(StandardFonts.Helvetica);
      d.addPage(PageSizes.A4).drawText("Hola", { x: 50, y: 700, font, size: 12 });
    });
    const out = await validatePdf(bytes, { ...expectations, minImages: 1 });
    expect(out.issues).toEqual(expect.arrayContaining(["font_not_embedded", "font_unexpected", "images_missing", "not_tagged"]));
    expect(out.issues).not.toContain("empty_page");
    expect(out.fonts).toEqual(["Helvetica"]);
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.ok).toBe(false);
  });
});
