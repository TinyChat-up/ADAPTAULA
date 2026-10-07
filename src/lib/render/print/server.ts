import "server-only";
import { createChromiumPdfEngine, type PdfEngine } from "./engine";

/** Production engine. Stateless (one browser per render): sharing the object only avoids rebuilding its options. */
let engine: PdfEngine | null = null;
export const pdfEngine = (): PdfEngine => (engine ??= createChromiumPdfEngine());
