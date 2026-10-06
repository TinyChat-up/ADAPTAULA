import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  ACCEPT_ATTRIBUTE,
  HARD_LIMITS,
  buildStoragePath,
  effectiveLimits,
  sanitizeOriginalName,
  titleFromFileName,
} from "@/lib/materials/config";
import { describeValidationError, formatFromExtension, sniffFormat, validateDeclaredFile, validateFileContent } from "@/lib/materials/file-validation";
import { sha256Hex } from "@/lib/materials/hash";
import { inspectPdf } from "@/lib/materials/pdf";

const MIB = 1024 * 1024;
const limits = effectiveLimits({ max_file_mb: 15, max_pages_per_material: 5 });

async function makePdf(pages: number, options: { encrypted?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  const bytes = await doc.save({ useObjectStreams: false });
  if (!options.encrypted) return bytes;
  const text = Buffer.from(bytes).toString("latin1").replace(/trailer\s*<<\s*/, "trailer\n<< /Encrypt 1 0 R ");
  return new Uint8Array(Buffer.from(text, "latin1"));
}

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);

describe("limits", () => {
  it("never exceed the hard caps, whatever the plan says", () => {
    const l = effectiveLimits({ max_file_mb: 500, max_pages_per_material: 999 });
    expect(l).toEqual({ maxPdfBytes: HARD_LIMITS.maxPdfBytes, maxImageBytes: HARD_LIMITS.maxImageBytes, maxPages: HARD_LIMITS.maxPdfPages });
  });

  it("follow the plan when it is stricter", () => {
    expect(effectiveLimits({ max_file_mb: 2, max_pages_per_material: 3 })).toEqual({ maxPdfBytes: 2 * MIB, maxImageBytes: 2 * MIB, maxPages: 3 });
  });

  it("fall back to conservative values when a plan carries no limits", () => {
    expect(effectiveLimits({}).maxPages).toBe(5);
  });

  it("accept exactly PDF, JPG, PNG and WEBP", () => {
    expect(ACCEPT_ATTRIBUTE).toContain("application/pdf");
    expect(ACCEPT_ATTRIBUTE).toContain(".jpeg");
    for (const extension of ["docx", "pptx", "zip", "mp4", "mp3", "txt", "gif", "svg"]) {
      expect(formatFromExtension(`x.${extension}`), extension).toBeNull();
    }
  });
});

describe("declared file validation (UX gate before the signed URL)", () => {
  it.each([
    ["ficha.pdf", "application/pdf"],
    ["foto.JPG", "image/jpeg"],
    ["foto.jpeg", "image/jpeg"],
    ["captura.png", "image/png"],
    ["scan.webp", "image/webp"],
    ["sin-mime.pdf", ""],
  ])("accepts %s", (name, mime) => {
    expect(validateDeclaredFile({ name, size: 1000, mime }, limits).ok).toBe(true);
  });

  it.each(["ficha.docx", "diapositivas.pptx", "todo.zip", "video.mp4", "audio.mp3", "sin-extension"])("rejects %s as unsupported", (name) => {
    expect(validateDeclaredFile({ name, size: 1000, mime: "" }, limits)).toEqual({ ok: false, code: "unsupported_type" });
  });

  it("rejects a declared MIME that contradicts the extension", () => {
    expect(validateDeclaredFile({ name: "ficha.pdf", size: 10, mime: "application/zip" }, limits)).toEqual({ ok: false, code: "unsupported_type" });
  });

  it("applies the size limit per kind", () => {
    expect(validateDeclaredFile({ name: "a.pdf", size: 14 * MIB, mime: "" }, limits).ok).toBe(true);
    expect(validateDeclaredFile({ name: "a.pdf", size: 16 * MIB, mime: "" }, limits)).toEqual({ ok: false, code: "too_large" });
    expect(validateDeclaredFile({ name: "a.png", size: 6 * MIB, mime: "" }, limits)).toEqual({ ok: false, code: "too_large" });
    expect(validateDeclaredFile({ name: "a.pdf", size: 0, mime: "" }, limits)).toEqual({ ok: false, code: "empty" });
    expect(validateDeclaredFile({ name: "a.pdf", size: Number.NaN, mime: "" }, limits)).toEqual({ ok: false, code: "empty" });
  });
});

describe("content validation by magic bytes (authoritative)", () => {
  it("identifies each format from its signature", () => {
    expect(sniffFormat(new TextEncoder().encode("%PDF-1.7\n"))).toBe("pdf");
    expect(sniffFormat(jpeg)).toBe("jpeg");
    expect(sniffFormat(png)).toBe("png");
    expect(sniffFormat(webp)).toBe("webp");
    expect(sniffFormat(new TextEncoder().encode("PK\u0003\u0004"))).toBeNull();
    expect(sniffFormat(new Uint8Array())).toBeNull();
  });

  it("rejects an executable renamed as .pdf", () => {
    const exe = new TextEncoder().encode("MZ\u0090\u0000 not a pdf");
    expect(validateFileContent(exe, "pdf", limits)).toEqual({ ok: false, code: "unsupported_type" });
  });

  it("rejects a PNG uploaded as .pdf and vice versa", () => {
    expect(validateFileContent(png, "pdf", limits)).toEqual({ ok: false, code: "type_mismatch" });
    expect(validateFileContent(new TextEncoder().encode("%PDF-1.4 x"), "png", limits)).toEqual({ ok: false, code: "type_mismatch" });
  });

  it("does not trust the size the browser reported: it measures the received bytes", () => {
    const big = new Uint8Array(6 * MIB);
    big.set(png);
    expect(validateFileContent(big, "png", limits)).toEqual({ ok: false, code: "too_large" });
  });

  it("returns the canonical mime and extension", () => {
    expect(validateFileContent(jpeg, "jpeg", limits)).toMatchObject({ ok: true, mime: "image/jpeg", extension: "jpg", kind: "image" });
  });
});

describe("pdf inspection", () => {
  it("counts pages", async () => {
    expect(await inspectPdf(await makePdf(3))).toEqual({ ok: true, pages: 3 });
  });

  it("reports an encrypted PDF", async () => {
    expect(await inspectPdf(await makePdf(1, { encrypted: true }))).toEqual({ ok: false, code: "encrypted" });
  });

  it("reports garbage that only looks like a PDF as corrupt", async () => {
    expect(await inspectPdf(new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf"))).toEqual({ ok: false, code: "corrupt" });
  });
});

describe("hash", () => {
  it("is deterministic and content-sensitive", () => {
    const a = new TextEncoder().encode("misma ficha");
    expect(sha256Hex(a)).toBe(sha256Hex(Uint8Array.from(a)));
    expect(sha256Hex(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex(a)).not.toBe(sha256Hex(new TextEncoder().encode("otra ficha")));
  });

  it("matches the known SHA-256 of an empty input", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("storage paths and names", () => {
  it("never use the original name as an identifier", () => {
    const path = buildStoragePath({ workspaceId: "w", userId: "u", materialId: "m", fileId: "f", extension: "pdf" });
    expect(path).toBe("w/u/m/f.pdf");
  });

  it("neutralize hostile original names, which are only metadata", () => {
    expect(sanitizeOriginalName("../../etc/passwd\u0000.pdf")).not.toMatch(/[/\\\u0000]/);
    expect(sanitizeOriginalName("a".repeat(400)).length).toBeLessThanOrEqual(255);
    expect(titleFromFileName("Ficha_fracciones 5A.pdf")).toBe("Ficha fracciones 5A");
  });

  it("gives human messages and never mentions technical details", () => {
    for (const code of ["unsupported_type", "type_mismatch", "empty", "too_large", "corrupt", "encrypted", "too_many_pages"] as const) {
      expect(describeValidationError(code, limits)).not.toMatch(/stack|exception|undefined|null|Error/i);
    }
    expect(describeValidationError("unsupported_type")).toBe("Este formato todavía no es compatible. Sube un archivo PDF, JPG, PNG o WEBP.");
    expect(describeValidationError("too_large", limits)).toContain("supera el tamaño máximo permitido");
  });
});
