/**
 * Download name of an exported sheet: the sheet's own title (what the teacher already sees on it), made safe for every OS and for
 * the `Content-Disposition` header. Never an id, a learner or a date: nothing that the sheet itself does not show.
 */

const FALLBACK = "Ficha adaptada";
const MAX_CHARS = 80;

export function pdfBaseName(title: string): string {
  const cleaned = title
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, "");
  const cut = [...cleaned].slice(0, MAX_CHARS).join("").trim();
  return cut.length > 0 ? cut : FALLBACK;
}

/** ASCII-only twin for the plain `filename=` parameter (old clients); the exact name travels in `filename*`. */
export function asciiName(base: string): string {
  const ascii = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return ascii.length > 0 ? ascii : "Ficha adaptada";
}

// `encodeURIComponent` leaves ' ( ) * ! as they are; RFC 8187 does not allow them unescaped.
const rfc5987 = (s: string) => encodeURIComponent(s).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function pdfContentDisposition(title: string): { filename: string; header: string } {
  const base = pdfBaseName(title);
  const filename = `${base}.pdf`;
  return { filename, header: `attachment; filename="${asciiName(base)}.pdf"; filename*=UTF-8''${rfc5987(filename)}` };
}
