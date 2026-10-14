import { area, intersection, type PageModel, type Rect, type TextBox, type TextLine } from "@/lib/materials/visuals/auto/page-model";
import type { PageActivity } from "../visual-location/verify";

export const normalizeAnchorText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

type Association = { status: "correct" | "wrong" | "unverifiable"; reason: "matched_support" | "other_location" | "reference_unverified" | "mixed_regions" | "insufficient_text"; offsetMm: number | null };
const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const overlap = (a: Rect, b: Rect) => area(intersection(a, b)) > 0;
const cleanReference = (text: string, a: PageActivity) => {
  const t = normalizeAnchorText(text), label = normalizeAnchorText(a.label ?? "");
  return label && t.startsWith(label + " ") && !normalizeAnchorText(a.instruction).startsWith(label + " ") ? t.slice(label.length + 1) : t;
};

/** Checks reference consistency without changing the annotation or deriving it from the OCR being scored. */
export function coherentAnchorReference(a: PageActivity, ref: TextBox | undefined, printed?: readonly TextBox[]): boolean {
  if (!ref) return false;
  const instruction = normalizeAnchorText(a.instruction), head = instruction.slice(0, 28);
  if (head.length < 8 || !cleanReference(ref.text, a).startsWith(head)) return false;
  if (!printed) return true; // Synthetic fallback: the reference matcher remains an explicit limitation.
  const first = printed[0];
  return Boolean(first && ["x0", "x1", "y0", "y1"].every((k) => first[k as keyof Rect] === ref[k as keyof Rect]) &&
    cleanReference(printed.map((t) => t.text).join(" "), a) === instruction);
}

/** Scores the location of the SAME instruction prefix, not centres of differently numbered/extended line envelopes. */
export function associateAnchor(model: PageModel, a: PageActivity, got: TextLine, ref: TextBox | undefined,
  ocr: readonly TextBox[], references: ReadonlyMap<string, TextBox>, printed?: readonly TextBox[], tolerant = false): Association {
  const unknown = (reason: Association["reason"]): Association => ({ status: "unverifiable", reason, offsetMm: null });
  if (!coherentAnchorReference(a, ref, printed) || !ref) return unknown("reference_unverified");
  // A merged line is not independently associated to one activity just because its first words fit.
  if (overlap(got, ref) && [...references].some(([id, other]) => id !== a.id && area(intersection(got, other)) >= .5 * area(other))) return unknown("mixed_regions");
  const boxes = ocr.filter((b) => normalizeAnchorText(b.text) && area(intersection(b, got)) >= .9 * area(b))
    .sort((x, y) => x.x0 - y.x0);
  let content = "";
  const spans = boxes.map((b) => { const start = content.length; content += normalizeAnchorText(b.text) + " "; return { b, start, end: content.length - 1 }; });
  content = content.trimEnd();
  const ins = normalizeAnchorText(a.instruction), minimum = Math.min(28, ins.length);
  const matches: Array<{ start: number; end: number; errorRate: number }> = [];
  const starts = [0, ...[...content.matchAll(/ /g)].map((m) => m.index + 1)];
  for (const start of starts) {
    // Same evidence length as activityAnchors; a short generic prefix is found, but not verified.
    const n = Math.min(tolerant ? 40 : 28, ins.length, content.length - start);
    if (n < minimum) continue;
    const observed = content.slice(start, start + n), expected = ins.slice(0, n);
    const errorRate = editDistance(observed, expected) / n;
    if (tolerant ? errorRate <= .2 : observed === expected) matches.push({ start, end: start + n, errorRate });
  }
  const bestRate = Math.min(...matches.map((m) => m.errorRate));
  const best = matches.filter((m) => m.errorRate === bestRate);
  if (best.length !== 1) return unknown("insufficient_text");
  const match = best[0]!;
  const support = spans.filter((s) => s.end > match.start && s.start < match.end).map((s) => s.b);
  if (!support.length) return unknown("insufficient_text");
  const offsetMm = Math.max(...support.map((b) => {
    const c = centre(b);
    return Math.hypot(Math.max(ref.x0 - c.x, 0, c.x - ref.x1), c.y - centre(ref).y) * model.mmPerPx;
  }));
  // X must lie in the annotated region; keep the existing 3 mm vertical bound, without widening it.
  const located = support.every((b) => overlap(b, ref) && centre(b).x >= ref.x0 && centre(b).x <= ref.x1 && Math.abs(centre(b).y - centre(ref).y) * model.mmPerPx <= 3);
  return { status: located ? "correct" : "wrong", reason: located ? "matched_support" : "other_location", offsetMm };
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(prev[j]! + 1, next[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length]!;
}
