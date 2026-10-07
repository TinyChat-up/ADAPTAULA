import "server-only";
import { createHash } from "node:crypto";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject, type PDFPage } from "pdf-lib";

/**
 * Technical checks of a produced PDF. Not a pedagogical review (`PedagogicalReview`) and not a render check (`RenderValidation`):
 * it only answers "is this file a complete, A4, self-contained print of the sheet?". Light on purpose (pdf-lib, already a
 * dependency, no rasteriser): the deep checks (text extraction, rasterising pages) belong to `smoke:pdf` and the tests.
 */

export const A4_PT = { width: 595.28, height: 841.89 } as const;
const SIZE_TOLERANCE_PT = 2;

export interface PdfLimits {
  maxPages: number;
  maxBytes: number;
}
export const DEFAULT_PDF_LIMITS: PdfLimits = { maxPages: 60, maxBytes: 20 * 1024 * 1024 };

export interface PdfExpectations {
  /** PostScript name prefix every embedded font must have (`Inter` → `Inter-Regular`, `Inter-Bold`…). */
  fontPrefix: string;
  /** Pinned visuals the sheet shows: the PDF must contain at least as many images. */
  minImages: number;
  /** Logical pages of the model: there can be more physical pages, never fewer. */
  minPages: number;
}

export type PdfIssueCode =
  | "not_pdf"
  | "unreadable"
  | "encrypted"
  | "too_large"
  | "no_pages"
  | "too_many_pages"
  | "fewer_pages_than_model"
  | "not_a4"
  | "rotated_page"
  | "font_not_embedded"
  | "font_type3"
  | "font_unexpected"
  | "images_missing"
  | "empty_page"
  | "not_tagged";

export interface PdfValidation {
  ok: boolean;
  issues: PdfIssueCode[];
  sha256: string;
  byteSize: number;
  pageCount: number;
  pages: Array<{ widthPt: number; heightPt: number }>;
  fonts: string[];
  imageCount: number;
  tagged: boolean;
}

const lookupDict = (doc: PDFDocument, obj: PDFObject | undefined): PDFDict | undefined => {
  const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return resolved instanceof PDFDict ? resolved : resolved instanceof PDFStream ? resolved.dict : undefined;
};

function contentOf(doc: PDFDocument, page: PDFPage): string {
  const raw = page.node.get(PDFName.of("Contents"));
  const resolved = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  const streams = resolved instanceof PDFArray ? resolved.asArray().map((r) => doc.context.lookup(r)) : [resolved];
  return streams
    .map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : s instanceof PDFStream ? Buffer.from(s.getContents()).toString("latin1") : ""))
    .join("\n");
}

/** A page with no text, no image and no drawing is an accidental blank page (Chromium's own white background is one fill). */
function pageHasMarks(content: string): boolean {
  if (/(?:^|\s)(?:Tj|TJ|'|")(?:\s|$)/.test(content) || /(?:^|\s)Do(?:\s|$)/.test(content)) return true;
  return (content.match(/(?:^|\s)(?:f\*?|F|S|s|B\*?|b\*?)(?=\s|$)/g) ?? []).length > 1;
}

interface FontInfo {
  name: string;
  type3: boolean;
  embedded: boolean;
}

function fontsOf(doc: PDFDocument): FontInfo[] {
  const fonts: FontInfo[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const subtype = obj.get(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Type0")) continue; // its descendant CIDFont is checked on its own
    const name = obj.get(PDFName.of("BaseFont"))?.toString().replace(/^\//, "").replace(/^[A-Z]{6}\+/, "") ?? "";
    const descriptor = lookupDict(doc, obj.get(PDFName.of("FontDescriptor")));
    const embedded = Boolean(descriptor && ["FontFile", "FontFile2", "FontFile3"].some((k) => descriptor.get(PDFName.of(k))));
    fonts.push({ name, type3: subtype === PDFName.of("Type3"), embedded });
  }
  return fonts;
}

/** Pictures on the sheet. An image's alpha channel is stored as a second image (its `SMask`): it is not another picture. */
function imageCount(doc: PDFDocument): number {
  const images: PDFStream[] = [];
  const masks = new Set<PDFObject>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream) || obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    images.push(obj);
    const mask = obj.dict.get(PDFName.of("SMask"));
    if (mask instanceof PDFRef) masks.add(doc.context.lookup(mask)!);
  }
  return images.filter((img) => !masks.has(img)).length;
}

export async function validatePdf(bytes: Uint8Array, expect: PdfExpectations, limits: PdfLimits = DEFAULT_PDF_LIMITS): Promise<PdfValidation> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base = { sha256, byteSize: bytes.length, pageCount: 0, pages: [], fonts: [], imageCount: 0, tagged: false };
  const fail = (...issues: PdfIssueCode[]): PdfValidation => ({ ok: false, issues, ...base });

  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-" || !Buffer.from(bytes.subarray(-1024)).toString("latin1").includes("%%EOF")) return fail("not_pdf");
  if (bytes.length > limits.maxBytes) return fail("too_large");

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return fail("unreadable");
  }
  if (doc.isEncrypted) return fail("encrypted");

  const issues = new Set<PdfIssueCode>();
  const pages = doc.getPages();
  if (pages.length === 0) issues.add("no_pages");
  if (pages.length > limits.maxPages) issues.add("too_many_pages");
  if (pages.length < expect.minPages) issues.add("fewer_pages_than_model");
  const sizes = pages.map((page) => {
    const { width, height } = page.getMediaBox();
    if (Math.abs(width - A4_PT.width) > SIZE_TOLERANCE_PT || Math.abs(height - A4_PT.height) > SIZE_TOLERANCE_PT) issues.add("not_a4");
    if (page.getRotation().angle % 360 !== 0) issues.add("rotated_page");
    if (!pageHasMarks(contentOf(doc, page))) issues.add("empty_page");
    return { widthPt: Math.round(width * 100) / 100, heightPt: Math.round(height * 100) / 100 };
  });

  const fonts = fontsOf(doc);
  if (fonts.some((f) => f.type3)) issues.add("font_type3");
  if (fonts.some((f) => !f.type3 && !f.embedded)) issues.add("font_not_embedded");
  if (fonts.some((f) => !f.name.startsWith(expect.fontPrefix))) issues.add("font_unexpected");

  const images = imageCount(doc);
  if (images < expect.minImages) issues.add("images_missing");

  const markInfo = lookupDict(doc, doc.catalog.get(PDFName.of("MarkInfo")));
  const tagged = Boolean(doc.catalog.get(PDFName.of("StructTreeRoot"))) && markInfo?.get(PDFName.of("Marked"))?.toString() === "true";
  if (!tagged) issues.add("not_tagged");

  return { ...base, ok: issues.size === 0, issues: [...issues], pageCount: pages.length, pages: sizes, fonts: [...new Set(fonts.map((f) => f.name))].sort(), imageCount: images, tagged };
}
