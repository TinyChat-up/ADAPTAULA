import { describe, expect, it } from "vitest";
import { asciiName, pdfBaseName, pdfContentDisposition } from "@/lib/render/pdf-filename";
import { fetchAdaptationPdf, filenameFromDisposition, PDF_FALLBACK_NAME, PDF_GENERIC_ERROR } from "@/lib/render/pdf-download";

describe("PDF file name", () => {
  it("keeps a readable Spanish title and adds .pdf", () => {
    expect(pdfContentDisposition("Fracciones equivalentes: 4.º de Primaria").filename).toBe("Fracciones equivalentes 4.º de Primaria.pdf");
    expect(pdfBaseName("  Año   y   canción ")).toBe("Año y canción");
  });

  it("removes path separators, reserved and control characters: never a path, never a header injection", () => {
    for (const evil of ["../../etc/passwd", "a\\b/c", 'x"; filename="evil.exe', "línea\r\nSet-Cookie: a=b", "nul\u0000byte", "‮fdp.exe"]) {
      const { filename, header } = pdfContentDisposition(evil);
      expect(filename).not.toMatch(/[\\/:*?"<>|\r\n\u0000‮]/);
      expect(header).not.toMatch(/[\r\n]/);
      expect(header.split('filename="')[1]!.split('"')[0]).not.toMatch(/["\\/]/);
      expect(filename.endsWith(".pdf")).toBe(true);
    }
  });

  it("empty or dot-only titles fall back to a neutral name; long ones are cut", () => {
    expect(pdfBaseName("")).toBe("Ficha adaptada");
    expect(pdfBaseName(" ... ")).toBe("Ficha adaptada");
    expect([...pdfBaseName("ñ".repeat(500))].length).toBe(80);
  });

  it("the header carries an ASCII name and the exact UTF-8 name (RFC 8187), and the browser reads the exact one back", () => {
    const { header, filename } = pdfContentDisposition("Ñandú (repaso) *final*");
    expect(header.startsWith("attachment; ")).toBe(true);
    expect(header).toContain('filename="Nandu repaso final.pdf"');
    expect(header).toMatch(/filename\*=UTF-8''[A-Za-z0-9%._~-]+$/);
    expect(filenameFromDisposition(header)).toBe(filename);
    expect(asciiName("¿¡!?")).toBe("Ficha adaptada");
  });

  it("the browser never takes a path or a non-PDF name from the header", () => {
    expect(filenameFromDisposition(null)).toBe(PDF_FALLBACK_NAME);
    expect(filenameFromDisposition('attachment; filename="../x.pdf"')).toBe("x.pdf");
    expect(filenameFromDisposition('attachment; filename="x.exe"')).toBe(PDF_FALLBACK_NAME);
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A")).toBe(PDF_FALLBACK_NAME);
  });
});

describe("fetchAdaptationPdf (browser)", () => {
  const pdfResponse = () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF\n");
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": pdfContentDisposition("Mi ficha").header, "X-PDF-Page-Count": "1", "X-PDF-Byte-Length": String(bytes.length), "X-PDF-Revision": "generated" } });
  };

  it("a PDF answer gives the file and the server's name; the request is same-origin and never cached", async () => {
    let seen: RequestInit | undefined;
    const result = await fetchAdaptationPdf("0b6f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b", async (_url, init) => ((seen = init), pdfResponse()));
    expect(result).toMatchObject({ ok: true, filename: "Mi ficha.pdf" });
    expect(seen).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" });
  });

  it("an error answer shows the server's user-facing message; anything else a generic one", async () => {
    const json = (status: number, body: unknown) => async () => Response.json(body, { status });
    expect(await fetchAdaptationPdf("x", json(409, { error: { code: "not_ready", message: "Esta adaptación todavía no tiene una ficha entregada." } }))).toEqual({ ok: false, code: "not_ready", message: "Esta adaptación todavía no tiene una ficha entregada." });
    // A missing resource keeps its code, so the screen says «Falta completar la ficha» instead of «inténtalo más tarde».
    expect(await fetchAdaptationPdf("x", json(409, { error: { code: "resource_pending", message: "Falta completar un recurso de la ficha (una imagen)." } }))).toMatchObject({ ok: false, code: "resource_pending" });
    expect(await fetchAdaptationPdf("x", async () => new Response("<html>502</html>", { status: 502 }))).toEqual({ ok: false, message: PDF_GENERIC_ERROR });
    expect(await fetchAdaptationPdf("x", async () => new Response("no", { status: 200, headers: { "Content-Type": "text/html" } }))).toEqual({ ok: false, message: PDF_GENERIC_ERROR });
    expect((await fetchAdaptationPdf("x", async () => Promise.reject(new TypeError("offline")))).ok).toBe(false);
  });

  it("reports an interrupted PDF body instead of leaving the download pending", async () => {
    const interrupted = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
        controller.error(new Error("connection closed"));
      },
    }), { headers: { "Content-Type": "application/pdf", "X-PDF-Page-Count": "1", "X-PDF-Byte-Length": "80", "X-PDF-Revision": "generated" } });
    expect(await fetchAdaptationPdf("x", async () => interrupted)).toEqual({ ok: false, message: PDF_GENERIC_ERROR });
  });
});

describe("validated PDF preview contract", () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF\n");
  const response = (headers: Record<string, string> = {}) => new Response(bytes, { headers: {
    "Content-Type": "application/pdf", "X-PDF-Page-Count": "11", "X-PDF-Byte-Length": String(bytes.length), "X-PDF-Revision": "generated", ...headers,
  } });
  it("carries physical pages, never logical pages, and the complete bytes", async () => {
    const result = await fetchAdaptationPdf("id", async () => response());
    expect(result).toMatchObject({ ok: true, pageCount: 11 });
    if (result.ok) expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
  });
  it("refuses missing or invalid metadata, a truncated body and another saved revision", async () => {
    const invalid: Record<string, string>[] = [
      { "X-PDF-Page-Count": "" }, { "X-PDF-Page-Count": "0" }, { "X-PDF-Page-Count": "1.5" },
      { "X-PDF-Byte-Length": String(bytes.length + 2) }, { "X-PDF-Revision": "draft:2" },
    ];
    for (const headers of invalid) expect(await fetchAdaptationPdf("id", async () => response(headers))).toMatchObject({ ok: false });
    expect(await fetchAdaptationPdf("id", async () => response({ "X-PDF-Revision": "draft:3" }), 3)).toMatchObject({ ok: true, pageCount: 11 });
    expect(await fetchAdaptationPdf("id", async () => response({ "X-PDF-Revision": "draft:4" }), 3)).toMatchObject({ ok: false });
  });
});
