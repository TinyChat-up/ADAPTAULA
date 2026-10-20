/**
 * Browser side of "Descargar PDF": one awaited request, the file saved under the name the server chose. Free of React so it can be
 * tested without a DOM. The server message is shown as is (it is already user-facing copy); anything else gets a generic one.
 */

import { PDF_HEADERS, pdfRevision } from "./pdf-contract";

export const PDF_FALLBACK_NAME = "Ficha adaptada.pdf";
export const PDF_GENERIC_ERROR = "No hemos podido preparar el PDF. Inténtalo de nuevo en unos minutos.";

/** The name in `filename*` (UTF-8) or, failing that, `filename`; never a path. */
export function filenameFromDisposition(header: string | null): string {
  if (!header) return PDF_FALLBACK_NAME;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  let name: string | undefined;
  try {
    name = star ? decodeURIComponent(star.trim()) : undefined;
  } catch {
    name = undefined;
  }
  name ??= /filename\s*=\s*"([^"]*)"/i.exec(header)?.[1];
  const safe = name?.split(/[\\/]/).pop()?.trim();
  return safe && safe.toLowerCase().endsWith(".pdf") ? safe : PDF_FALLBACK_NAME;
}

export type PdfFetchResult = { ok: true; blob: Blob; filename: string; pageCount: number } | { ok: false; message: string; code?: string };

export async function fetchAdaptationPdf(adaptationId: string, fetcher: typeof fetch = fetch, draftRevision?: number, options: { signal?: AbortSignal; baseVersion?: number } = {}): Promise<PdfFetchResult> {
  let response: Response;
  try {
    const query = new URLSearchParams();
    if (draftRevision !== undefined) query.set("borrador", String(draftRevision));
    if (options.baseVersion !== undefined) query.set("version", String(options.baseVersion));
    response = await fetcher(`/api/adaptations/${encodeURIComponent(adaptationId)}/pdf${query.size ? `?${query}` : ""}`, { method: "GET", credentials: "same-origin", cache: "no-store", ...(options.signal ? { signal: options.signal } : {}) });
  } catch {
    return { ok: false, message: "No hemos podido conectar. Comprueba tu conexión y vuelve a intentarlo." };
  }
  if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") {
    const body = (await response.json().catch(() => null)) as { error?: { message?: unknown; code?: unknown } } | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : PDF_GENERIC_ERROR;
    return { ok: false, message, ...(typeof body?.error?.code === "string" ? { code: body.error.code } : {}) };
  }
  try {
    const pageCount = Number(response.headers.get(PDF_HEADERS.pages));
    const byteLength = Number(response.headers.get(PDF_HEADERS.bytes));
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 60 || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 20 * 1024 * 1024 || response.headers.get(PDF_HEADERS.revision) !== pdfRevision(draftRevision)) {
      await response.body?.cancel();
      return { ok: false, message: PDF_GENERIC_ERROR };
    }
    const blob = await response.blob();
    const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    const tail = new TextDecoder().decode(await blob.slice(-1024).arrayBuffer());
    if (blob.size !== byteLength || signature !== "%PDF-" || !tail.trimEnd().endsWith("%%EOF")) return { ok: false, message: PDF_GENERIC_ERROR };
    return { ok: true, blob, pageCount, filename: filenameFromDisposition(response.headers.get("Content-Disposition")) };
  } catch {
    // A connection can close after the PDF headers arrive. Never report a partial download as successful.
    return { ok: false, message: PDF_GENERIC_ERROR };
  }
}
