import { refersToPicture } from "@/lib/adaptation/visual-policy";
import { normalizeText } from "@/lib/adaptation/text";
import { AnalysisReadinessSchema, READINESS_ENGINE, READINESS_VERSION, type AnalysisReadiness, type ReadinessFinding } from "@/lib/schemas/analysis-readiness";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { flowClaim, specFromAnalysis } from "@/lib/visuals/from-analysis";

/**
 * The analysis READINESS report (shadow mode): what can be checked about a finished analysis WITHOUT a model, from the analysis
 * and the original file alone, so that «Hacer magia» later meets as few surprises as possible. Pure and deterministic.
 *
 * It is NOT a verdict. A scanned file, a complex sheet or a figure with no route yet are facts, never «not viable»; nothing reads
 * this report to block or to change what the system does. It never holds the material's words: codes, technical ids and counts.
 * It knows nothing about any learner: the profile-specific feasibility is a separate check (a later step).
 */

export interface ReadinessSource {
  kind: "pdf" | "image";
  pages: number;
  /** The PDF's printed strings, page by page (the first `maxPages` pages); null when they could not be read. */
  strings: readonly (readonly string[])[] | null;
  /** Why `strings` is null for a PDF that should have them. */
  unavailable?: "pdf_unreadable" | "timeout" | "extraction_failed";
}

/** Folded form for comparing the analysis with the original: no case, accents, ligatures, punctuation, spaces or hyphenation. */
export const fold = (value: string): string => normalizeText(value.normalize("NFKC")).replace(/[^a-z0-9]/g, "");

const MATH = /[\\$^]|_\{/;
/** A page with fewer printed characters than this has no usable text layer (a scan, a drawing). */
const MIN_PAGE_CHARS = 20;
const MAX_FINDINGS = 30;
const WHOLE_MAX = 120;
const WINDOW = 40;
const COVERAGE_OK = 0.8;

/**
 * Share of an item's printed characters that the original also prints. The item is cut into sentences (a worksheet often splits one
 * statement around a quotation or a table, and the analysis joins the pieces), each sentence is looked up as a whole when short or by
 * windows when long, and the share is weighted by length.
 */
function coverage(raw: string, corpus: string): number {
  const pieces = raw.split(/[.!?¿¡\n;:·]+/).map(fold).filter((p) => p.length >= 4);
  const total = pieces.reduce((n, p) => n + p.length, 0);
  if (total === 0) return 1;
  let found = 0;
  for (const piece of pieces) {
    if (piece.length <= WHOLE_MAX) {
      if (corpus.includes(piece)) found += piece.length;
      continue;
    }
    for (let i = 0; i < piece.length; i += WINDOW) {
      const part = piece.slice(i, i + WINDOW);
      if (part.length < 8 || corpus.includes(part)) found += part.length;
    }
  }
  return found / total;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;
/** The numbers of a text that are worth looking for (two or more digits, so a lone «3» does not match by chance). */
const numbersOf = (text: string): string[] => [...new Set((text.match(NUMBER) ?? []).map((n) => n.replace(/[.,]/g, "")).filter((n) => n.length >= 2))];

type Counts = { texts: number; activities: number; cells: number; labels: number; numbers: number };
const zero = (): Counts => ({ texts: 0, activities: 0, cells: 0, labels: 0, numbers: 0 });

export function buildReadiness(analysis: MaterialAnalysis, source: ReadinessSource): AnalysisReadiness {
  const findings: ReadinessFinding[] = [];
  const add = (f: ReadinessFinding) => void findings.push(f);

  // 1 · The original: does it have a text layer? (a fact, never a judgement)
  const read = source.strings ?? [];
  const charsPerPage = read.map((page) => page.join("").trim().length);
  const withoutText = charsPerPage.filter((n) => n < MIN_PAGE_CHARS).length;
  const textLayer: AnalysisReadiness["source"]["text_layer"] =
    source.kind === "image" || source.strings === null ? "not_applicable" : read.length === 0 || withoutText === read.length ? "absent" : withoutText > 0 ? "partial" : "present";
  if (textLayer === "absent") add({ code: "source_no_text_layer", severity: "info" });
  if (textLayer === "partial") add({ code: "source_partial_text_layer", severity: "info", count: withoutText });

  // 2 · Fidelity of the analysis against what the original prints.
  const checked = zero();
  const missing = zero();
  let skippedMath = 0;
  let fidelityStatus: AnalysisReadiness["fidelity"]["status"] = "not_applicable";
  let fidelityReason: AnalysisReadiness["fidelity"]["reason"];
  if (source.kind === "image") fidelityReason = "image_source";
  else if (source.strings === null) fidelityReason = "unavailable";
  else if (textLayer === "absent") fidelityReason = "no_text_layer";
  else {
    const corpus = fold(read.flat().join(" "));
    // Only pages that print text are compared: a scanned page inside a mixed file is a fact (partial layer), not a pile of «missing» text.
    const inScope = (page: number) => (charsPerPage[page - 1] ?? 0) >= MIN_PAGE_CHARS;
    const item = (kind: Exclude<keyof Counts, "numbers">, text: string | null | undefined, target: string, code: ReadinessFinding["code"], page: number) => {
      if (!text || !inScope(page)) return;
      if (MATH.test(text)) {
        skippedMath++;
        return;
      }
      const folded = fold(text);
      if (folded.length < 4) return;
      checked[kind]++;
      if (coverage(text, corpus) < COVERAGE_OK) {
        missing[kind]++;
        add({ code, severity: "review", target: target as ReadinessFinding["target"] });
      }
    };
    const numbers = (text: string, target: string | undefined, page: number) => {
      if (!inScope(page) || MATH.test(text)) return;
      const wanted = numbersOf(text);
      if (wanted.length === 0) return;
      checked.numbers += wanted.length;
      const absent = wanted.filter((n) => !corpus.includes(n));
      if (absent.length > 0) {
        missing.numbers += absent.length;
        add({ code: "number_not_in_source", severity: "review", ...(target ? { target: target as ReadinessFinding["target"] } : {}), count: absent.length });
      }
    };
    for (const t of analysis.texts) {
      item("texts", t.text, t.id, "text_not_in_source", t.page);
      numbers(t.text, t.id, t.page);
    }
    for (const a of analysis.activities) {
      item("activities", a.instruction, a.id, "activity_not_in_source", a.page);
      item("activities", a.context, a.id, "activity_not_in_source", a.page);
      if (a.expected_answer.basis === "source") item("activities", a.expected_answer.value, a.id, "activity_not_in_source", a.page);
      numbers(`${a.instruction} ${a.context ?? ""}`, a.id, a.page);
    }
    for (const v of analysis.visuals) {
      if (v.table) for (const cell of [...v.table.headers, ...v.table.rows.flat()]) item("cells", cell, v.id, "table_cell_not_in_source", v.page);
      for (const label of v.text ? v.text.split(/\s*(?:→|->|⟶|=>)\s*/) : []) item("labels", label.trim(), v.id, "visual_label_not_in_source", v.page);
      if (v.table) numbers([...v.table.headers, ...v.table.rows.flat()].join(" "), v.id, v.page);
    }
    for (const p of analysis.protected_elements) if (p.type === "required_data" || p.type === "units_or_magnitudes") numbers(p.value, p.activity_ids[0] ?? p.resource_ids[0], 1);
    const total = Object.values(checked).reduce((a, b) => a + b, 0);
    fidelityStatus = total === 0 ? "not_applicable" : Object.values(missing).some((n) => n > 0) ? "review" : "ok";
    if (total === 0) fidelityReason = "nothing_to_check";
  }

  // 3 · References inside the analysis itself (no file needed).
  const visualIds = new Set(analysis.visuals.map((v) => v.id));
  let withResources = 0;
  let pictureRefs = 0;
  let answerAreaUnknown = 0;
  let inferred = 0;
  for (const a of analysis.activities) {
    const linked = a.resource_ids.filter((id) => visualIds.has(id));
    if (a.resource_ids.length > 0) withResources++;
    const samePageVisual = analysis.visuals.some((v) => v.page === a.page && v.role !== "decorative");
    if (linked.length === 0 && !samePageVisual && refersToPicture(`${a.instruction} ${a.context ?? ""}`)) {
      pictureRefs++;
      add({ code: "picture_reference_without_resource", severity: "review", target: a.id });
    }
    if (a.answer_area.type === "unknown") {
      answerAreaUnknown++;
      add({ code: "answer_area_unknown", severity: "info", target: a.id });
    }
    if (a.expected_answer.basis === "inferred") {
      inferred++;
      add({ code: "inferred_answer", severity: "info", target: a.id });
    }
  }
  const unused = analysis.visuals.filter((v) => v.role === "required" && v.activity_ids.length === 0);
  for (const v of unused) add({ code: "required_visual_unused", severity: "info", target: v.id });

  // 4 · What the analysis alone says about getting each visual back (a hint, never a promise).
  const visuals = analysis.visuals.slice(0, 40).map((v) => ({
    id: v.id,
    required: v.role === "required",
    hint: (v.kind === "decorative" || v.role === "decorative"
      ? "not_needed"
      : (v.table && v.table.rows.flat().some((c) => c.trim() !== "")) || v.chart
        ? "data_in_analysis"
        : flowClaim(v)
          ? "flow_claim"
          : specFromAnalysis(v)
            ? "structured_claim"
            : "needs_original") as AnalysisReadiness["visuals"][number]["hint"],
  }));

  // The most important findings survive the cap.
  const ranked = [...findings.filter((f) => f.severity === "review"), ...findings.filter((f) => f.severity === "info")].slice(0, MAX_FINDINGS);
  const report: AnalysisReadiness = {
    version: READINESS_VERSION,
    engine: READINESS_ENGINE,
    status: "computed",
    source: { kind: source.kind, pages: Math.min(source.pages, 9999), pages_read: read.length, text_layer: textLayer, pages_without_text: withoutText },
    fidelity: { status: fidelityStatus, ...(fidelityReason ? { reason: fidelityReason } : {}), checked, missing, skipped_math: skippedMath },
    references: {
      activities: analysis.activities.length,
      activities_with_resources: withResources,
      picture_references_without_resource: pictureRefs,
      required_visuals_unused: unused.length,
      answer_area_unknown: answerAreaUnknown,
      inferred_answers: inferred,
    },
    visuals,
    findings: ranked,
  };
  return AnalysisReadinessSchema.parse(report);
}

/** The report when the original could not be read: the analysis-only parts still hold, the file-dependent ones say why not. */
export function unavailableReadiness(analysis: MaterialAnalysis, source: Pick<ReadinessSource, "kind" | "pages">, reason: NonNullable<ReadinessSource["unavailable"]> | "not_pdf"): AnalysisReadiness {
  const base = buildReadiness(analysis, { kind: source.kind, pages: source.pages, strings: null });
  return AnalysisReadinessSchema.parse({ ...base, status: "unavailable", reason });
}
