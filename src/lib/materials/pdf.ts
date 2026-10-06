import { PDFDocument } from "pdf-lib";
import type { ValidationCode } from "./file-validation";

export type PdfInspection = { ok: true; pages: number } | { ok: false; code: Extract<ValidationCode, "corrupt" | "encrypted"> };

/** Counts pages without rendering anything. Encrypted and unreadable PDFs are reported, not thrown. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    const pages = doc.getPageCount();
    return pages > 0 ? { ok: true, pages } : { ok: false, code: "corrupt" };
  } catch (error) {
    // pdf-lib compiles to ES5, where `instanceof EncryptedPDFError` is unreliable: match its message instead.
    const encrypted = error instanceof Error && /\bencrypted\b/i.test(error.message);
    return { ok: false, code: encrypted ? "encrypted" : "corrupt" };
  }
}
