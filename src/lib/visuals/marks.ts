/** Literal letter marks, shared by recovery of originals and validation of generated illustrations. No inferred labels. */
export function lettersIn(text: string): string[] {
  const alphabet = "ABCDEFGH";
  const r = /\b(?:de la\s+)?([A-H])\s*(?:[–—-]|\s+a\s+(?:la\s+)?)\s*([A-H])\b/.exec(text);
  if (r) {
    const a = alphabet.indexOf(r[1]!), b = alphabet.indexOf(r[2]!);
    return a >= 0 && b > a && b - a <= 7 ? alphabet.slice(a, b + 1).split("") : [];
  }
  const list = /\b([A-H](?:\s*,\s*[A-H])+(?:\s+y\s+[A-H])?|[A-H]\s+y\s+[A-H])\b/.exec(text);
  if (list) return list[1]!.split(/\s*,\s*|\s+y\s+/);
  const named = /\bletras?\s+((?:[A-H]\s*\([^)]{1,40}\)\s*(?:,|\by\b)\s*)+[A-H]\s*\([^)]{1,40}\))/.exec(text);
  return named ? [...named[1]!.replace(/\([^)]*\)/g, "").matchAll(/\b([A-H])\b/g)].map((m) => m[1]!) : [];
}

export const letterMarkersIn = (activity: string): string[] => /\b(?:letras?|etiquetas?|v[eé]rtices?|columnas?)\b/i.test(activity) ? lettersIn(activity) : [];
