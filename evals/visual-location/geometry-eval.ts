/**
 * Phase II evaluation of figure geometry (prototype, NOT production).
 *
 *   pnpm eval:geometry -- --corpus /ruta/externa   ten synthetic sheets (development; their results were already seen)
 *   pnpm eval:geometry -- --cases dev|holdout      synthetic geometry sheets of `geometry-cases.ts`
 *
 * Each page goes through the Phase I OCR (unchanged) on its pixels. Then, per claimed visual:
 *   baseline  the #31 prefilter fed with the same OCR and the scripted oracle proposal (the Phase I metric);
 *   v2        `locateFigure`, which receives NO region: it must find the figure itself.
 * Reference boxes and labels are used here only to score. No crop is ever accepted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { area, intersection, iou, isLabel, type Rect, type TextBox } from "@/lib/materials/visuals/auto/page-model";
import { createOcr } from "../ocr-pilot/engine";
import { candidateTrials, type PilotPage } from "../ocr-pilot/metrics";
import { corpusPages, corpusRoot } from "../ocr-pilot/pages";
import { ocrLines } from "../ocr-pilot/recognition";
import { geometryPages } from "./geometry-cases";
import { LOCATOR_VERSION, locateFigure, type LocateReport } from "./locate-v2";

export type Outcome = "correcta" | "candidata_incompleta" | "candidata_erronea" | "incompleta" | "bloqueo_semantico" | "sin_verificar" | "no_encontrada" | "rechazada";

export interface VisualResult {
  page: string;
  visualId: string;
  kind: string;
  /** A reference figure exists and a person would accept its crop (denominator of coverage). */
  eligible: boolean;
  /** No figure, or one that must not be cropped (cut, ambiguous, overlapping): any candidate here is a false positive. */
  negative: boolean;
  baseline: { candidate: boolean; correct: boolean; blockedBy: string | null };
  v2: { candidate: boolean; regionIoU: number | null; candidateIoU: number | null; referenceLabelsInside: string; cut: number; zone: string | null;
    columns: boolean; anchor: string | null; shape: string | null; blockedBy: string | null; category: string | null; outcome: Outcome; distractor: boolean; decision: string };
}

const CATEGORY: Record<string, string> = {
  text_layer: "ocr", activity_anchor: "ocr", snap: "geometria", placement: "geometria", uniqueness: "geometria", integrity: "geometria",
  foreign_text: "geometria", answer_leak: "semantica", semantic_identity: "semantica", complete_content: "semantica", visual_answer_safety: "semantica",
};

function firstBlock(r: LocateReport): { check: string; category: string } | null {
  const order = ["provenance", "text_layer", "activity_anchor", "snap", "placement", "uniqueness", "integrity", "labels", "foreign_text", "answer_leak", "identity_evidence"] as const;
  for (const c of order) {
    const s = r.checks[c];
    if (s.status === "verified") continue;
    const category = c === "labels" ? (s.status === "unverifiable" ? "ocr" : "geometria") : c === "identity_evidence" ? (s.status === "unverifiable" ? "semantica" : "geometria") : CATEGORY[c] ?? "geometria";
    return { check: `${c}:${s.status}`, category };
  }
  return { check: "semantic_identity:unverifiable", category: "semantica" };
}

const toRect = (p: PilotPage, b: { x: number; y: number; w: number; h: number }): Rect => ({ x0: b.x * p.model.width, y0: b.y * p.model.height, x1: (b.x + b.w) * p.model.width, y1: (b.y + b.h) * p.model.height });

/** A candidate is correct only with IoU ≥ 0.6 AND every reference label of the figure inside it. */
export function classify(r: LocateReport, truth: Rect | null, eligible: boolean, candidateIoU: number | null, regionIoU: number | null, allLabelsInside = true): Outcome {
  if (!eligible) return r.candidate ? "candidata_erronea" : "rechazada";
  if (r.candidate) return (candidateIoU ?? 0) < 0.6 ? "candidata_erronea" : allLabelsInside ? "correcta" : "candidata_incompleta";
  const block = firstBlock(r)!;
  if (!truth || regionIoU === null) return block.check.startsWith("activity_anchor") || block.check.startsWith("uniqueness") ? "sin_verificar" : "no_encontrada";
  if (/^(integrity|placement|labels:failed)/.test(block.check) && regionIoU >= 0.3) return "incompleta";
  if (block.category === "semantica" && regionIoU >= 0.6) return "bloqueo_semantico";
  if (/^(activity_anchor|uniqueness|labels:unverifiable)/.test(block.check)) return "sin_verificar";
  return regionIoU >= 0.3 ? "incompleta" : "no_encontrada";
}

async function main() {
  const at = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  const corpus = at("--corpus");
  const split = at("--cases") as "dev" | "holdout" | undefined;
  if (!corpus && split !== "dev" && split !== "holdout") throw new Error("usage: --corpus <dir> | --cases dev|holdout");
  const out = corpus ? path.join(corpusRoot(corpus), "results-geometry") : path.join(import.meta.dirname, `results-geometry-${split}`);
  mkdirSync(out, { recursive: true });
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 25);
  const ocr = await createOcr();
  const results: VisualResult[] = [];
  const times: number[] = [];
  let pageNo = 0;
  try {
    for await (const page of corpus ? corpusPages(corpus) : geometryPages(split!)) {
      pageNo++;
      const read = await ocr.page(page.model, page.dpi);
      const labels = await ocr.labels(page.model, page.dpi, read);
      const words = [...read.words.filter((w) => !w.rerouted), ...labels];
      const boxes: TextBox[] = words.map(({ text, x0, y0, x1, y1 }) => ({ text, x0, y0, x1, y1 }));
      const lines = ocrLines(words.map(({ text, upright, line, confidence }) => ({ text, ...upright, line, confidence })), page.model.mmPerPx);
      const baseline = candidateTrials(page, boxes).filter((t) => t.role === "oracle");
      const t0 = performance.now();
      for (const v of page.visuals) {
        const r = locateFigure({ page: page.model, skewDeg: read.skewDeg, words, lines, activities: page.activities,
          visual: { id: v.id, activityId: v.activityId, kind: v.kind, labels: v.labels }, siblings: page.visuals.map((s) => ({ id: s.id, activityId: s.activityId })) });
        const eligible = Boolean(v.truth && v.acceptable);
        const cand = r.candidate ? toRect(page, r.candidate) : null;
        const candidateIoU = cand && v.truth ? iou(cand, v.truth) : null;
        const regionIoU = r.region && v.truth ? iou(r.region, v.truth) : null;
        const refLabels = v.truth ? page.truth.filter((t) => isLabel(t.text) && area(intersection(t, v.truth!)) >= 0.5 * area(t)) : [];
        // A reference box is the typographic box, larger than the ink: its centre must be inside the region.
        const centreIn = (t: Rect, z: Rect) => (t.x0 + t.x1) / 2 >= z.x0 && (t.x0 + t.x1) / 2 <= z.x1 && (t.y0 + t.y1) / 2 >= z.y0 && (t.y0 + t.y1) / 2 <= z.y1;
        const inside = r.region ? refLabels.filter((t) => centreIn(t, r.region!)).length : 0;
        const candidateHasLabels = cand ? refLabels.every((t) => centreIn(t, cand)) : false;
        const b = baseline.find((t) => t.visualId === v.id);
        const block = r.candidate ? null : firstBlock(r);
        results.push({
          page: corpus ? `page_${pageNo}` : page.id, visualId: v.id, kind: v.kind, eligible, negative: !eligible,
          baseline: { candidate: Boolean(b?.candidate), correct: Boolean(b?.candidate && b.matchesTruth && b.eligible), blockedBy: b?.blockedBy ?? null },
          v2: { candidate: Boolean(r.candidate), regionIoU: regionIoU === null ? null : Math.round(regionIoU * 100) / 100, candidateIoU: candidateIoU === null ? null : Math.round(candidateIoU * 100) / 100,
            referenceLabelsInside: `${inside}/${refLabels.length}`, cut: r.cut, zone: r.zone ? `${Math.round(r.zone.x0 * page.model.mmPerPx)}–${Math.round(r.zone.x1 * page.model.mmPerPx)} mm` : null,
            columns: Boolean(r.zone?.columns), anchor: r.anchor, shape: r.shape, blockedBy: block?.check ?? null, category: block?.category ?? null,
            outcome: classify(r, v.truth, eligible, candidateIoU, regionIoU, candidateHasLabels),
            distractor: Boolean(cand && page.distractors.some((d) => iou(cand, d) >= 0.3)), decision: r.decision },
        });
      }
      times.push(performance.now() - t0);
      process.stdout.write(`${corpus ? `page_${pageNo}` : page.id} ok\n`);
    }
  } finally {
    clearInterval(sampler);
    await ocr.terminate();
  }
  const count = (f: (r: VisualResult) => boolean) => results.filter(f).length;
  const summary = {
    locator: LOCATOR_VERSION, corpus: corpus ? "external_synthetic" : `geometry_${split}`, pages: pageNo, visuals: results.length,
    eligible: count((r) => r.eligible), negatives: count((r) => r.negative),
    baseline: { candidates: count((r) => r.baseline.candidate), correct: count((r) => r.baseline.correct), wrong: count((r) => r.baseline.candidate && !r.baseline.correct) },
    v2: {
      candidates: count((r) => r.v2.candidate), correct: count((r) => r.v2.outcome === "correcta"), wrong: count((r) => r.v2.outcome === "candidata_erronea"),
      incompleteCandidates: count((r) => r.v2.outcome === "candidata_incompleta"),
      incomplete: count((r) => r.v2.outcome === "incompleta"), semanticBlock: count((r) => r.v2.outcome === "bloqueo_semantico"),
      unverifiable: count((r) => r.v2.outcome === "sin_verificar"), notFound: count((r) => r.v2.outcome === "no_encontrada"),
      negativesRejected: count((r) => r.v2.outcome === "rechazada"), distractorsAccepted: count((r) => r.v2.distractor),
      accepted: count((r) => r.v2.decision === "accepted"),
    },
    geometryMsPerPage: { median: Math.round([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0), max: Math.round(Math.max(0, ...times)) },
    peakRssMb: Math.round(peak / 1e6),
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify({ summary, results }, null, 2) + "\n");
  const rows = results.map((r) => `| ${r.page} | ${r.visualId} | ${r.kind} | ${r.eligible ? "sí" : "no"} | ${r.baseline.correct ? "correcta" : r.baseline.candidate ? "errónea" : r.baseline.blockedBy ?? "—"} | ${r.v2.outcome} | ${r.v2.candidateIoU ?? r.v2.regionIoU ?? "—"} | ${r.v2.referenceLabelsInside} | ${r.v2.cut} | ${r.v2.zone ?? "—"}${r.v2.columns ? " (columna)" : ""} | ${r.v2.shape ?? "—"} | ${r.v2.blockedBy ?? "candidata"} | ${r.v2.category ?? "—"} |`);
  writeFileSync(path.join(out, "report.md"), [
    `# Geometría de figuras — ${summary.corpus}`, "",
    "Fichas sintéticas. Las cajas de referencia solo puntúan. Ninguna figura se aprueba: decisión siempre BLOCKED.", "",
    "```json", JSON.stringify(summary, null, 2), "```", "",
    "| página | visual | tipo | elegible | antes (#31) | después (v2) | IoU | etiquetas dentro | trazos cortados | zona | forma | bloqueo | categoría |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows, "",
  ].join("\n"));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1]?.endsWith("geometry-eval.ts")) main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
