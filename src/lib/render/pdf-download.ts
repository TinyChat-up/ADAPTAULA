/**
 * Browser side of "Descargar PDF": one awaited request, the file saved under the name the server chose. Free of React so it can be
 * tested without a DOM. The server message is shown as is (it is already user-facing copy); anything else gets a generic one.
 */

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

export type PdfFetchResult = { ok: true; blob: Blob; filename: string } | { ok: false; message: string };

export async function fetchAdaptationPdf(adaptationId: string, fetcher: typeof fetch = fetch): Promise<PdfFetchResult> {
  let response: Response;
  try {
    response = await fetcher(`/api/adaptations/${encodeURIComponent(adaptationId)}/pdf`, { method: "GET", credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, message: "No hemos podido conectar. Comprueba tu conexión y vuelve a intentarlo." };
  }
  if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") {
    const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : PDF_GENERIC_ERROR;
    return { ok: false, message };
  }
  return { ok: true, blob: await response.blob(), filename: filenameFromDisposition(response.headers.get("Content-Disposition")) };
}
