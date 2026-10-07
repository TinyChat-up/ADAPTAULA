import type { Block, MaterialDocument, ResponseSpec } from "@/lib/schemas/material-document";
import { FAILURE_COPY, type VisualAssetFailure } from "./visual-assets";
import { planDeferred, type DeferredInput, type DeferredOutcome } from "./deferred";
import { parseBlanks, parseInline, parseParagraphs, type BlankPart, type Run } from "./inline";
import { renderTokens, type RenderTokens } from "./tokens";
import { MATERIAL_RENDERER_VERSION } from "./version";

/**
 * The presentation-oriented projection of a `MaterialDocument`: what the sheet shows, in the order it shows it, and nothing else.
 * Pure and deterministic (no model, no clock, no randomness): the same document and options always give the same model, which
 * is what the HTML viewer renders today and a PDF exporter will consume tomorrow.
 *
 * What it deliberately leaves out: the answer key (never part of any model: a future solutions view is another builder),
 * trace and decision ids, block ids, review data. Student content only. Layout is decided by the renderer: the model carries
 * semantic hints (`keepTogether`, `isolate`, `keepWithNext`), CSS turns them into breaks (docs/ADAPTATION.md § Renderer).
 */

export type RenderMode = "student" | "teacher_preview";
export type RenderStatus = "renderable" | "renderable_with_warnings" | "not_renderable";

export type RenderResponse =
  | { kind: "lines"; lines: number; fromExpectedLength: boolean }
  | { kind: "box"; rows: number }
  | { kind: "grid"; rows: number }
  | { kind: "table_cells"; rows: number }
  | { kind: "choice"; multiple: boolean; options: string[] }
  | { kind: "fill_blank"; parts: BlankPart[]; wordBank: string[] }
  | { kind: "match"; left: string[]; right: string[] }
  | { kind: "order"; items: string[] }
  | { kind: "true_false"; statements: string[] }
  | { kind: "oral"; mode: "oral" | "keyboard" | "other"; lines: number }
  | { kind: "none" };

export type RenderNode = { key: string } & (
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; paragraphs: Run[][] }
  | { kind: "reading_text"; title?: string; paragraphs: Array<{ label?: string; runs: Run[] }> }
  | { kind: "instruction"; paragraphs: Run[][]; steps: string[] }
  | { kind: "activity"; label?: string; prompt: Run[][]; steps: string[]; requirements: string[]; response: RenderResponse; keepTogether: boolean; isolate: boolean }
  | { kind: "list"; ordered: boolean; items: Run[][] }
  | { kind: "table"; caption?: string; unit?: string; headers: string[]; rows: string[][] }
  | { kind: "chart"; title?: string; chartType: "bar" | "line" | "pie" | "other"; categories: string[]; series: Array<{ label: string | null; values: number[] }>; unit?: string; xLabel?: string; yLabel?: string }
  | { kind: "image"; state: "available" | "missing" | "pending"; src?: string; alt: string; caption?: string; essential: boolean; failure?: VisualAssetFailure }
  | { kind: "help_box"; variant: "key_idea" | "reminder" | "tip" | "strategy"; title?: string; paragraphs: Run[][] }
  | { kind: "checklist"; title?: string; items: string[]; keepTogether: boolean }
  | { kind: "vocabulary"; title?: string; items: Array<{ term: string; definition: string }> }
  | { kind: "worked_example"; title?: string; problem: Run[][]; steps: string[]; result: string }
  | { kind: "sentence_starters"; items: string[] }
  | { kind: "planner"; title?: string; slots: Array<{ label: string; lines: number }> }
  | { kind: "math"; latex: string; display: "inline" | "block"; spoken: string }
  | { kind: "unknown"; type: string }
);

export interface RenderPage {
  number: number;
  nodes: RenderNode[];
}

export interface RenderHeader {
  subject: string | null;
  grade: string | null;
  /** Blank fields to fill in by hand ("Nombre", "Fecha"): labels only, never a value. */
  fields: string[];
}

export interface RenderModel {
  rendererVersion: string;
  mode: RenderMode;
  title: string;
  language: string;
  header: RenderHeader;
  tokens: RenderTokens;
  pages: RenderPage[];
}

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCode =
  | "unknown_block_type"
  | "asset_missing"
  | "asset_unsupported"
  | "image_pending"
  | "deferred_unsupported"
  | "deferred_not_applicable"
  | "deferred_applied"
  | "chart_series_unverified"
  | "math_source_only"
  | "chart_table_only"
  | "overflow_risk"
  | "structure_inconsistent";

export interface RenderIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** Teacher-facing, safe, short. Shown only in the teacher view, never on the student's sheet. */
  message: string;
}

/** Purely technical/presentational checks of one render. It is not a second pedagogical review and never changes one. */
export interface RenderValidation {
  status: RenderStatus;
  issues: RenderIssue[];
  deferred: DeferredOutcome[];
}

export interface PlottableChart {
  chartType: "bar" | "line" | "pie" | "other";
  series: Array<{ label: string | null; values: number[] }>;
}
const hasNegative = (n: PlottableChart) => n.series.some((s) => s.values.some((v) => !Number.isFinite(v) || v < 0));
/** Several series are told apart only by their verified names: without them the plot would be ambiguous, so the data table stands alone. */
export const seriesAmbiguous = (n: PlottableChart): boolean => n.series.length > 1 && n.series.some((s) => s.label === null);
/** A chart is drawn only when its data allows a faithful, unambiguous plot; otherwise only its data table is shown. */
export const chartPlottable = (n: PlottableChart): boolean => !hasNegative(n) && !seriesAmbiguous(n) && !(n.chartType === "pie" && n.series.length > 1);

export interface AssetSource {
  src: string;
}

export interface BuildRenderOptions {
  mode: RenderMode;
  /** Resolved assets of original visuals by `vis_N`. The pipeline stores none today: images render only when this provides them. */
  assets?: Readonly<Record<string, AssetSource>>;
  /** Why a visual has no asset, when it is known (e.g. the analysis stores no position to crop). Unknown reasons are plain `asset_missing`. */
  assetFailures?: Readonly<Record<string, VisualAssetFailure>>;
  /** `vis_N` that the adaptation must preserve (from the pinned context): a missing one makes the sheet not renderable. */
  requiredVisuals?: readonly string[];
  /** The deferred decisions of the review this version came from; null/undefined = unknown (reported, never guessed). */
  deferred?: readonly DeferredInput[] | null;
  /**
   * How the subject reads on the sheet. The stored document carries the catalogue key (`matematicas`); the loader resolves its
   * name. Absent → the document's own value, unchanged.
   */
  subjectLabel?: string | null;
}

export const NEUTRAL_VISUAL_LABEL = "Recurso visual de la actividad";
const LONG_TOKEN = 45;
const WORDS_PER_LINE = 11;
const MAX_LINES = 40;
const BOX_ROWS = { small: 4, medium: 7, large: 12 } as const;
const GRID_ROWS = 10;
const TABLE_CELL_ROWS = 6;
const COMPACT_ROWS = 14;
const MAX_CHECKLIST = 12;
const WIDE_TABLE_COLUMNS = 8;

const wordsRange = /(\d{2,4})\s*(?:[-–]|y|a)\s*(\d{2,4})\s*palabras/i;
/** Lines needed for the longest expected answer stated in the requirements ("150-180 palabras"), conservative and bounded. */
function expectedLines(requirements: readonly string[]): number | null {
  let max = 0;
  for (const r of requirements) {
    const m = wordsRange.exec(r);
    if (m) max = Math.max(max, Number(m[2]));
  }
  return max > 0 ? Math.min(MAX_LINES, Math.ceil(max / WORDS_PER_LINE)) : null;
}

function responseOf(spec: ResponseSpec, requirements: readonly string[]): RenderResponse {
  switch (spec.kind) {
    case "lines": {
      const wanted = expectedLines(requirements);
      return { kind: "lines", lines: Math.max(spec.lines, wanted ?? 0), fromExpectedLength: wanted !== null && wanted > spec.lines };
    }
    case "box":
      return { kind: "box", rows: BOX_ROWS[spec.size] };
    case "grid":
      return { kind: "grid", rows: GRID_ROWS };
    case "table_cells":
      return { kind: "table_cells", rows: TABLE_CELL_ROWS };
    case "choice":
      return { kind: "choice", multiple: spec.multiple, options: spec.options.map((o) => o.text) };
    case "fill_blank":
      return { kind: "fill_blank", parts: parseBlanks(spec.text), wordBank: spec.word_bank ?? [] };
    case "match":
      return { kind: "match", left: spec.left.map((c) => c.text), right: spec.right.map((c) => c.text) };
    case "order":
      return { kind: "order", items: spec.items.map((c) => c.text) };
    case "true_false":
      return { kind: "true_false", statements: spec.statements.map((c) => c.text) };
    case "oral_or_alternative":
      return { kind: "oral", mode: spec.mode, lines: spec.lines };
    case "none":
      return { kind: "none" };
  }
}

/** Rough number of text rows an activity takes, to decide whether keeping it on one page is reasonable. CSS does the breaking. */
function activityRows(prompt: Run[][], steps: readonly string[], requirements: readonly string[], response: RenderResponse): number {
  const chars = (runs: Run[]) => runs.reduce((n, r) => n + r.text.length, 0);
  const text = prompt.reduce((n, p) => n + Math.max(1, Math.ceil(chars(p) / 90)), 0) + steps.length + requirements.length;
  const answer =
    response.kind === "lines" ? response.lines
    : response.kind === "box" || response.kind === "grid" || response.kind === "table_cells" ? response.rows
    : response.kind === "choice" ? response.options.length
    : response.kind === "match" ? Math.max(response.left.length, response.right.length)
    : response.kind === "order" ? response.items.length
    : response.kind === "true_false" ? response.statements.length
    : response.kind === "oral" ? response.lines
    : response.kind === "fill_blank" ? 3 + Math.ceil(response.wordBank.length / 6)
    : 0;
  return text + answer;
}

const STAGE_NAMES: Record<string, string> = { primaria: "Primaria", eso: "ESO", bachillerato: "Bachillerato" };
/** `1-bachillerato` → «1.º Bachillerato»; anything else is not shown rather than guessed. */
export function gradeLabel(slug: string | null): string | null {
  const m = /^(\d)-(primaria|eso|bachillerato)$/.exec(slug ?? "");
  return m ? `${m[1]}.º ${STAGE_NAMES[m[2]!]}` : null;
}

interface Ctx {
  options: BuildRenderOptions;
  isolate: Set<string>;
  issues: RenderIssue[];
  next: () => string;
}

function nodeOf(block: Block, ctx: Ctx): RenderNode {
  const key = ctx.next();
  switch (block.type) {
    case "heading":
      return { key, kind: "heading", level: block.level, text: block.text };
    case "paragraph":
      return { key, kind: "paragraph", paragraphs: parseParagraphs(block.text) };
    case "reading_text":
      return { key, kind: "reading_text", ...(block.title ? { title: block.title } : {}), paragraphs: block.paragraphs.map((p, i) => ({ ...(block.segment_labels?.[i] ? { label: block.segment_labels[i] } : {}), runs: parseInline(p) })) };
    case "instruction":
      return { key, kind: "instruction", paragraphs: parseParagraphs(block.text), steps: block.steps ?? [] };
    case "activity": {
      const requirements = block.requirements ?? [];
      const steps = block.steps ?? [];
      const prompt = parseParagraphs(block.prompt);
      const response = responseOf(block.response, requirements);
      return { key, kind: "activity", ...(block.label ? { label: block.label } : {}), prompt, steps, requirements, response, keepTogether: activityRows(prompt, steps, requirements, response) <= COMPACT_ROWS, isolate: ctx.isolate.has(block.id) };
    }
    case "list":
      return { key, kind: "list", ordered: block.style === "numbered", items: block.items.map(parseInline) };
    case "table":
      return { key, kind: "table", ...(block.caption ? { caption: block.caption } : {}), ...(block.unit ? { unit: block.unit } : {}), headers: block.headers, rows: block.rows };
    case "chart":
      return { key, kind: "chart", ...(block.title ? { title: block.title } : {}), chartType: block.chart_type, categories: block.categories, series: block.series.map((s) => ({ label: s.label, values: s.values })), ...(block.unit ? { unit: block.unit } : {}), ...(block.x_label ? { xLabel: block.x_label } : {}), ...(block.y_label ? { yLabel: block.y_label } : {}) };
    case "image": {
      if (block.source.kind === "requested") return { key, kind: "image", state: "pending", alt: block.alt_text, ...(block.caption ? { caption: block.caption } : {}), essential: false };
      const ref = block.source.visual_ref;
      const asset = ctx.options.assets?.[ref];
      const essential = ctx.options.requiredVisuals?.includes(ref) ?? false;
      const failure = asset ? undefined : ctx.options.assetFailures?.[ref];
      // The accessible name is the printed caption of the original when there is one; otherwise a neutral label. The analyzer's
      // free description of the image is not verified, so it is never used as the student's text alternative.
      return { key, kind: "image", state: asset ? "available" : "missing", ...(asset ? { src: asset.src } : {}), alt: block.caption ?? NEUTRAL_VISUAL_LABEL, ...(block.caption ? { caption: block.caption } : {}), essential, ...(failure ? { failure } : {}) };
    }
    case "help_box":
      return { key, kind: "help_box", variant: block.variant, ...(block.title ? { title: block.title } : {}), paragraphs: parseParagraphs(block.text) };
    case "checklist":
      return { key, kind: "checklist", ...(block.title ? { title: block.title } : {}), items: block.items, keepTogether: block.items.length <= 8 };
    case "vocabulary":
      return { key, kind: "vocabulary", ...(block.title ? { title: block.title } : {}), items: block.items };
    case "worked_example":
      return { key, kind: "worked_example", ...(block.title ? { title: block.title } : {}), problem: parseParagraphs(block.problem), steps: block.steps, result: block.result };
    case "sentence_starters":
      return { key, kind: "sentence_starters", items: block.items };
    case "planner":
      return { key, kind: "planner", ...(block.title ? { title: block.title } : {}), slots: block.slots };
    case "math":
      return { key, kind: "math", latex: block.latex, display: block.display, spoken: block.spoken_text };
    default: {
      // Compile-time exhaustiveness: a new block type in the schema without a case above makes `block` not `never` and stops the
      // build here. At run time (data that does not match the schema) it becomes a visible `unknown` node, never a silent omission.
      const unexpected: never = block;
      return { key, kind: "unknown", type: String((unexpected as { type?: unknown }).type) };
    }
  }
}

const textsOf = (n: RenderNode): string[] => {
  const runs = (p: Run[][]) => p.map((r) => r.map((x) => x.text).join(""));
  switch (n.kind) {
    case "heading": return [n.text];
    case "paragraph": return runs(n.paragraphs);
    case "reading_text": return n.paragraphs.map((p) => p.runs.map((r) => r.text).join(""));
    case "instruction": return [...runs(n.paragraphs), ...n.steps];
    case "activity": return [...runs(n.prompt), ...n.steps, ...n.requirements];
    case "list": return runs(n.items);
    case "table": return [...n.headers, ...n.rows.flat()];
    case "help_box": return runs(n.paragraphs);
    case "checklist": return n.items;
    case "vocabulary": return n.items.flatMap((i) => [i.term, i.definition]);
    case "worked_example": return [...runs(n.problem), ...n.steps, n.result];
    case "sentence_starters": return n.items;
    case "planner": return n.slots.map((s) => s.label);
    default: return [];
  }
};

function validate(nodes: RenderNode[], ctx: Ctx, outcomes: DeferredOutcome[], deferredKnown: boolean): RenderValidation {
  const issues = [...ctx.issues];
  const add = (code: IssueCode, severity: IssueSeverity, message: string) => issues.push({ code, severity, message });
  for (const n of nodes) {
    if (n.kind === "unknown") add("unknown_block_type", "error", `Hay un bloque de un tipo que el visor no conoce («${n.type}»): la ficha no se puede mostrar completa`);
    if (n.kind === "image" && n.state === "missing") {
      const code: IssueCode = n.failure && n.failure !== "asset_missing" ? "asset_unsupported" : "asset_missing";
      const why = n.failure ? ` (${FAILURE_COPY[n.failure]})` : "";
      if (n.essential) add(code, "error", `Falta una imagen del material original que es necesaria para resolver la actividad${why}`);
      else add(code, "warning", `Falta una imagen del material original; no se muestra en la ficha${why}`);
    }
    if (n.kind === "image" && n.state === "pending") add("image_pending", "warning", "Hay una imagen prevista que todavía no existe; la ficha del alumno no la muestra");
    if (n.kind === "chart" && seriesAmbiguous(n)) add("chart_series_unverified", "warning", "El material original no proporciona nombres verificados para estas series: se muestran sus datos en tabla, sin leyenda ni nombres inventados");
    if (n.kind === "chart" && n.series.some((s) => s.values.length !== n.categories.length)) add("structure_inconsistent", "error", "Un gráfico tiene series con distinto número de valores que categorías");
    if (n.kind === "table" && n.rows.some((r) => r.length !== n.headers.length)) add("structure_inconsistent", "error", "Una tabla tiene filas con distinto número de celdas que cabeceras");
    if (n.kind === "table" && n.headers.length > WIDE_TABLE_COLUMNS) add("overflow_risk", "warning", "Una tabla es muy ancha: se ajusta al ancho de la hoja con celdas más estrechas");
    if (n.kind === "checklist" && n.items.length > MAX_CHECKLIST) add("structure_inconsistent", "warning", "Una lista de comprobación tiene más elementos de los esperados; se muestra entera");
    if (n.kind === "chart" && hasNegative(n)) add("chart_table_only", "info", "Un gráfico tiene valores negativos: se muestran solo sus datos en tabla, sin dibujarlo");
    if (n.kind === "math") add("math_source_only", "info", "Una fórmula se muestra como texto con su lectura en voz alta: el visor aún no compone fórmulas");
    if (n.kind === "activity" && n.response.kind === "lines" && n.response.lines >= 30) add("overflow_risk", "info", "Una respuesta pide muchas líneas: la actividad puede continuar en la página siguiente");
    for (const t of textsOf(n)) if (t.split(/\s+/).some((w) => w.length > LONG_TOKEN)) {
      add("overflow_risk", "info", "Hay una palabra muy larga: se parte al final de la línea para que no salga de la hoja");
      break;
    }
  }
  if (!deferredKnown) add("deferred_unsupported", "info", "No se pudo comprobar qué decisiones quedaban para la presentación; no se ha aplicado ninguna");
  for (const o of outcomes) {
    if (o.status === "unsupported") add("deferred_unsupported", "warning", `Un cambio pendiente para la presentación no se ha podido aplicar: ${o.reason}`);
    else if (o.status === "not_applicable") add("deferred_not_applicable", "info", `Un cambio pendiente para la presentación ya no corresponde: ${o.reason}`);
    else add("deferred_applied", "info", o.reason);
  }
  const unique = issues.filter((i, idx) => issues.findIndex((j) => j.code === i.code && j.message === i.message) === idx);
  const status: RenderStatus = unique.some((i) => i.severity === "error") ? "not_renderable" : unique.some((i) => i.severity === "warning") ? "renderable_with_warnings" : "renderable";
  return { status, issues: unique, deferred: outcomes };
}

/** `MaterialDocument` → `RenderModel` + `RenderValidation`. Pure; never rewrites, adds or drops content. */
export function buildRenderModel(doc: MaterialDocument, options: BuildRenderOptions): { model: RenderModel; validation: RenderValidation } {
  const deferredKnown = options.deferred !== null && options.deferred !== undefined;
  const plan = planDeferred(doc, options.deferred ?? []);
  let counter = 0;
  const ctx: Ctx = { options, isolate: plan.isolate, issues: [], next: () => `n${++counter}` };
  const tokens = renderTokens(doc.presentation, doc.meta.stage);
  const max = tokens.maxTasksPerPage;

  const pages: RenderPage[] = [];
  for (const logical of doc.pages) {
    let current: RenderNode[] = [];
    let tasks = 0;
    const flush = () => {
      if (current.length > 0) pages.push({ number: pages.length + 1, nodes: current });
      current = [];
      tasks = 0;
    };
    for (const block of logical.blocks) {
      const node = nodeOf(block, ctx);
      // max_tasks_per_page groups, it never removes: a new page starts BEFORE the activity that would exceed it, and a heading
      // that would be left alone at the bottom travels with it.
      if (node.kind === "activity" && max !== null && tasks >= max) {
        const orphan = current.at(-1)?.kind === "heading" ? current.pop() : undefined;
        flush();
        if (orphan) current.push(orphan);
      }
      current.push(node);
      if (node.kind === "activity") tasks += 1;
    }
    flush();
  }

  const allNodes = pages.flatMap((p) => p.nodes);
  const validation = validate(allNodes, ctx, plan.outcomes, deferredKnown);
  const model: RenderModel = {
    rendererVersion: MATERIAL_RENDERER_VERSION,
    mode: options.mode,
    title: doc.meta.title,
    language: doc.meta.language,
    header: { subject: options.subjectLabel ?? doc.meta.subject, grade: gradeLabel(doc.meta.grade), fields: doc.admin_fields.map((f) => f.label) },
    tokens,
    pages,
  };
  return { model, validation };
}
