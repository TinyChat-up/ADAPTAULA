import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pdfObjectUrl } from "@/lib/render/pdf-object-url";
import { PdfPreviewDialog } from "@/components/material/pdf-preview-dialog";

afterEach(() => vi.useRealTimers());
describe("private PDF object lifecycle", () => {
  const urls = () => ({ createObjectURL: vi.fn(() => "blob:private"), revokeObjectURL: vi.fn() });
  it("one URL references the complete file; close releases it once", () => {
    const api = urls(), blob = new Blob(["complete bytes"]);
    const file = pdfObjectUrl(blob, api);
    expect(api.createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    file.release(); file.release();
    expect(api.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:private");
  });
  it("closing immediately after download keeps a bounded grace period for the browser", () => {
    vi.useFakeTimers();
    const api = urls(), file = pdfObjectUrl(new Blob(["bytes"]), api);
    file.markDownloaded(); file.release(); file.release();
    expect(api.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(api.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:private");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PDF presentation", () => {
  const props = { versionLabel: "Borrador guardado · revisión 3", inEditor: true, onClose() {}, onRetry() {}, onDownload() {} };
  it("shows physical sheets and an explicitly saved revision, downloads the exact viewer URL", () => {
    const html = renderToStaticMarkup(createElement(PdfPreviewDialog, { ...props, state: { kind: "ready", url: "blob:private", filename: "Ficha.pdf", pageCount: 11, nativeViewer: true } }));
    expect(html).toContain("11 hojas A4");
    expect(html).toContain("revisión 3");
    expect(html).toContain('href="blob:private" download="Ficha.pdf"');
    expect(html).toContain('src="blob:private#view=FitH"');
    expect(html).toContain("Volver a editar");
  });
  it("provides an accessible download without an empty iframe when a native viewer is unavailable", () => {
    const html = renderToStaticMarkup(createElement(PdfPreviewDialog, { ...props, state: { kind: "ready", url: "blob:private", filename: "Ficha.pdf", pageCount: 2, nativeViewer: false } }));
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Tu navegador no ofrece un visor PDF integrado");
    expect(html).toContain("Descargar PDF");
  });
  it("never offers a download of an unfinished or failed body", () => {
    for (const state of [{ kind: "preparing" } as const, { kind: "error", message: "Conexión interrumpida" } as const]) {
      const html = renderToStaticMarkup(createElement(PdfPreviewDialog, { ...props, state }));
      expect(html).not.toContain('download=');
      expect(html).not.toContain("<iframe");
    }
  });
});
