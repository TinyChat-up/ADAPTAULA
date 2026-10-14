import { activityAnchors } from "@/lib/materials/visuals/auto/locate";
import { iou, isLabel, textLines, type PageModel, type Rect, type TextBox, type TextLine } from "@/lib/materials/visuals/auto/page-model";
import type { FigureProposal, VerificationReport } from "../visual-location/contract";
import { verifyProposal, type PageActivity } from "../visual-location/verify";

/**
 * Pure metrics of the OCR pilot. Ground truth (the transcription and its boxes) is used HERE only, to score what the OCR read;
 * it is never handed to the engine. Synthetic fixtures and an authorised real corpus are scored by the same functions.
 */

export interface PilotVisual {
  id: string;
  activityId: string;
  kind: FigureProposal["kind"];
  labels: string[];
  /** The figure as a person would box it (px), or null when the page does not contain it. */
  truth: Rect | null;
  acceptable: boolean;
}

export interface PilotPage {
  id: string;
  docType: string;
  condition: string;
  dpi: number;
  /** Pixels only: `texts` is empty. The engine sees nothing else. */
  model: PageModel;
  sha256: string;
  /** Reference transcription (px): a vector PDF's text layer for fixtures, a human transcription for a real corpus. */
  truth: TextBox[];
  /** The same transcription on the deskewed page: reading order and anchors are compared there. */
  truthUpright: TextBox[];
  /** Known imposed synthetic rotation; unavailable/unused for a real corpus. */
  scanRotationDeg?: number;
  activities: PageActivity[];
  /** Human-designated first instruction box for a real corpus, independent of the locator's matcher. */
  anchorTruth?: Record<string, TextBox>;
  instructionTruth?: Record<string, TextBox[]>;
  visuals: PilotVisual[];
  /** Wrong places a proposal could point at (px). */
  distractors: Rect[];
}

export function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Page text in reading order (lines top to bottom, boxes left to right; pass deskewed boxes), whitespace collapsed. Runs of
 * underscores are fill-in rules (`Nombre: ______`), drawn lines rather than words: excluded on both sides.
 */
export const readingText = (boxes: readonly TextBox[]) =>
  textLines(boxes)
    .map((l) => l.text.normalize("NFC"))
    .join(" ")
    .split(/\s+/)
    .filter((w) => w !== "" && !/^_+$/.test(w))
    .join(" ");

/** Word and character edit distance between reference and OCR, both in reading order (deskewed boxes). */
export function textErrors(truthUpright: readonly TextBox[], ocrUpright: readonly TextBox[], annotatedOrder = false) {
  const t = annotatedOrder ? truthUpright.map((b) => b.text.normalize("NFC")).join(" ").split(/\s+/).filter((w) => w && !/^_+$/.test(w)).join(" ") : readingText(truthUpright);
  const o = readingText(ocrUpright);
  const tw = t ? t.split(" ") : [];
  const ow = o ? o.split(" ") : [];
  if ([...t].length > 10_000 || [...o].length > 10_000 || tw.length > 2000 || ow.length > 2000) throw new Error("ocr_text_limit");
  return { words: tw.length, wordErrors: levenshtein(tw, ow), chars: [...t].length, charErrors: levenshtein([...t], [...o]) };
}

const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const distMm = (model: PageModel, a: Rect, b: Rect) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y) * model.mmPerPx;
const overlaps = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

export type LabelStatus = "ok" | "confused" | "lost";
export interface LabelOutcome {
  text: string;
  status: LabelStatus;
  read: string | null;
  /** OCR label boxes for the same truth label beyond the first (duplicates). */
  duplicates: number;
  offsetMm: number | null;
  iou: number | null;
}

/** Greedy geometry-only one-to-one assignment: distance, then reference/OCR input index breaks ties. Never prefer matching text. */
export function labelOutcomes(model: PageModel, truth: readonly TextBox[], ocr: readonly TextBox[], radiusMm = 3) {
  const truthLabels = truth.filter((t) => isLabel(t.text));
  // Inline single-character words within a reference sentence are outside the isolated-label task, not blank-paper detections.
  const detections = ocr.filter((o) => isLabel(o.text) && (truthLabels.some((t) => distMm(model, o, t) <= radiusMm) ||
    !truth.some((t) => !isLabel(t.text) && overlaps(o, t))));
  const edges = truthLabels.flatMap((t, ti) => detections.map((o, oi) => ({ ti, oi, d: distMm(model, o, t) })).filter((e) => e.d <= radiusMm))
    .sort((a, b) => a.d - b.d || a.ti - b.ti || a.oi - b.oi);
  const matched = new Map<number, number>();
  const used = new Set<number>();
  for (const e of edges) if (!matched.has(e.ti) && !used.has(e.oi)) { matched.set(e.ti, e.oi); used.add(e.oi); }
  const duplicates = new Map<number, number>();
  const spurious: string[] = [];
  detections.forEach((o, oi) => {
    if (used.has(oi)) return;
    const nearest = edges.find((e) => e.oi === oi);
    const first = nearest ? matched.get(nearest.ti) : undefined;
    if (nearest && first !== undefined && detections[first]!.text.trim() === o.text.trim())
      duplicates.set(nearest.ti, (duplicates.get(nearest.ti) ?? 0) + 1);
    else spurious.push(o.text.trim());
  });
  const outcomes: LabelOutcome[] = truthLabels.map((t, ti) => {
    const oi = matched.get(ti);
    const first = oi === undefined ? undefined : detections[oi];
    return {
      text: t.text.trim(),
      status: !first ? "lost" : first.text.trim() === t.text.trim() ? "ok" : "confused",
      read: first ? first.text.trim() : null,
      duplicates: duplicates.get(ti) ?? 0,
      offsetMm: first ? distMm(model, first, t) : null,
      iou: first ? iou(first, t) : null,
    };
  });
  return { outcomes, spurious, detections: detections.length };
}

export type AnchorStatus = "correct" | "wrong" | "missed";
export interface InstructionOutcome {
  activityId: string;
  /** With the locator's exact matcher (`activityAnchors`). */
  anchor: AnchorStatus;
  /** With an edit-distance matcher (`tolerantAnchors`), not in production: would it recover OCR typos without confusions? */
  tolerant: AnchorStatus;
  /** Words of the printed instruction recovered at its place (share of truth words, order ignored). */
  recall: number;
  /** Two-dimensional offset of the OCR anchor line centre against reference (mm). */
  offsetMm: number | null;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const stripLabel = (s: string) => s.replace(/^\(?[0-9a-z]{1,3}[.)]?\s+/, "");

/**
 * Like `activityAnchors`, but a line matches when its first characters are within 20 % edits of the instruction's (≤ 40 chars
 * compared). A line that matches two activities equally is left unanchored for both: an ambiguity is never resolved by order.
 */
export function tolerantAnchors(lines: readonly TextLine[], activities: readonly PageActivity[]): Map<string, TextLine> {
  const anchors = new Map<string, TextLine>();
  const similarity = (t: string, ins: string) => {
    const n = Math.min(40, t.length, ins.length);
    return n < 8 ? 0 : 1 - levenshtein([...t.slice(0, n)], [...ins.slice(0, n)]) / n;
  };
  const score = (l: TextLine, a: PageActivity) => {
    const ins = normalize(a.instruction);
    return Math.max(similarity(normalize(l.text), ins), similarity(stripLabel(normalize(l.text)), ins));
  };
  for (const a of activities) {
    const best = lines.map((l) => ({ l, s: score(l, a) })).filter((x) => x.s >= 0.8).sort((x, y) => y.s - x.s)[0];
    if (!best) continue;
    const rival = activities.some((o) => o.id !== a.id && score(best.l, o) >= best.s);
    if (!rival && ![...anchors.values()].includes(best.l)) anchors.set(a.id, best.l);
  }
  return anchors;
}

const tokens = (s: string) => s.normalize("NFC").split(/\s+/).filter(Boolean);

/** Anchors found on the OCR text vs on the reference text, with the locator's own matcher; pass deskewed boxes for both. */
export function instructionOutcomes(model: PageModel, truth: readonly TextBox[], ocr: readonly TextBox[], activities: readonly PageActivity[], anchorTruth?: ReadonlyMap<string, TextBox>, instructionTruth?: ReadonlyMap<string, readonly TextBox[]>): InstructionOutcome[] {
  const reference = anchorTruth ?? activityAnchors(textLines(truth), activities);
  const ocrLines = textLines(ocr);
  const read = activityAnchors(ocrLines, activities);
  const tolerant = tolerantAnchors(ocrLines, activities);
  const status = (ref: TextLine | undefined, got: TextLine | undefined): AnchorStatus =>
    !got ? "missed" : ref && distMm(model, ref, got) <= 3 && overlaps(ref, got) ? "correct" : "wrong";
  return activities.map((a) => {
    const ref = reference.get(a.id);
    const got = read.get(a.id);
    const offsetMm = ref && got ? distMm(model, ref, got) : null;
    const anchor = status(ref, got);
    const printed = instructionTruth?.get(a.id) ?? truth.filter((t) => t.text.trim().length >= 8 && a.instruction.includes(t.text.trim()));
    const want = printed.flatMap((t) => tokens(t.text));
    const there = ocr.filter((o) => printed.some((t) => overlaps(o, { x0: t.x0 - 2, y0: t.y0 - 2, x1: t.x1 + 2, y1: t.y1 + 2 }))).flatMap((o) => tokens(o.text));
    const pool = [...there];
    const hits = want.filter((w) => {
      const i = pool.indexOf(w);
      if (i >= 0) pool.splice(i, 1);
      return i >= 0;
    }).length;
    return { activityId: a.id, anchor, tolerant: status(ref, tolerant.get(a.id)), recall: want.length ? hits / want.length : 0, offsetMm };
  });
}

export interface CandidateTrial {
  visualId: string;
  role: "oracle" | "distractor" | "page";
  eligible: boolean;
  candidate: boolean;
  /** The geometric candidate overlaps the human box (IoU ≥ 0.6). Says nothing about its content. */
  matchesTruth: boolean;
  /** First candidate check that did not pass (why no candidate). */
  blockedBy: string | null;
  decision: VerificationReport["decision"];
}

const loosen = (model: PageModel, r: Rect, d = 0.01): Rect => ({
  x0: Math.max(0, r.x0 - d * model.width),
  y0: Math.max(0, r.y0 - d * model.height),
  x1: Math.min(model.width, r.x1 + d * model.width),
  y1: Math.min(model.height, r.y1 + d * model.height),
});
const toRegion = (model: PageModel, r: Rect) => ({ x: r.x0 / model.width, y: r.y0 / model.height, w: (r.x1 - r.x0) / model.width, h: (r.y1 - r.y0) / model.height });

/**
 * The #31 geometric prefilter, fed with a text layer (the OCR's, or the reference for comparison). Proposals are scripted: the
 * human box ("oracle"), each distractor and the whole page. No proposal is ever accepted: semantic checks stay unverifiable.
 */
export function candidateTrials(page: PilotPage, texts: readonly TextBox[]): CandidateTrial[] {
  const model: PageModel = { ...page.model, texts: [...texts] };
  const proposal = (v: PilotVisual, r: Rect): FigureProposal => ({
    visual_id: v.id, activity_id: v.activityId, page: 1, region: toRegion(model, r), identity: "figura de la actividad", kind: v.kind, labels: v.labels, required_elements: [], limitations: [],
  });
  const scripted = page.visuals.flatMap((v) => [
    ...(v.truth ? [{ v, role: "oracle" as const, r: loosen(model, v.truth) }] : []),
    ...page.distractors.map((d) => ({ v, role: "distractor" as const, r: loosen(model, d) })),
    { v, role: "page" as const, r: { x0: 0.02 * model.width, y0: 0.02 * model.height, x1: 0.98 * model.width, y1: 0.98 * model.height } },
  ]);
  const siblings = scripted.filter((s) => s.role === "oracle").map((s) => proposal(s.v, s.r));
  return scripted.map(({ v, role, r }) => {
    const report = verifyProposal({ page: model, pageCount: 1, sourceSha256: page.sha256, proposalSourceSha256: page.sha256, activities: page.activities, proposal: proposal(v, r), siblings: siblings.filter((s) => s.visual_id !== v.id) });
    const cand = report.candidate;
    const candRect = cand ? { x0: cand.x * model.width, y0: cand.y * model.height, x1: (cand.x + cand.w) * model.width, y1: (cand.y + cand.h) * model.height } : null;
    const blocked = Object.entries(report.checks).find(([, c]) => c.status !== "verified" && c.detail !== "sin comprobar");
    return {
      visualId: v.id,
      role,
      eligible: role === "oracle" && v.acceptable,
      candidate: Boolean(cand),
      matchesTruth: Boolean(candRect && v.truth && iou(candRect, v.truth) >= 0.6),
      // Details can contain transcription/answer fragments; reports retain only the check name.
      blockedBy: cand ? null : blocked ? blocked[0] : null,
      decision: report.decision,
    };
  });
}

export function candidateSummary(trials: readonly CandidateTrial[]) {
  const eligible = trials.filter((t) => t.eligible);
  return {
    trials: trials.length,
    candidates: trials.filter((t) => t.candidate).length,
    negativeTrials: trials.filter((t) => !t.eligible).length,
    eligible: eligible.length,
    covered: eligible.filter((t) => t.candidate && t.matchesTruth).length,
    wrongCandidates: trials.filter((t) => t.candidate && !(t.eligible && t.matchesTruth)).length,
    accepted: trials.filter((t) => t.decision === "accepted").length,
  };
}
