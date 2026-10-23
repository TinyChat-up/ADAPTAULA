import type { Block, MaterialDocument, ResponseSpec } from "@/lib/schemas/material-document";
import { VisualSpecSchema, describeSpec, type ComparisonSpec, type VisualSpec } from "@/lib/visuals/spec";
import { FAILURE_COPY, type VisualAssetFailure } from "./visual-assets";
import { planDeferred, type DeferredInput, type DeferredOutcome } from "./deferred";
import { parseBlanks, parseInline, parseParagraphs, type BlankPart, type Run } from "./inline";
import { composeMath, type MathPart } from "./math";
import { GRID_ZONE_ROWS, renderTokens, type RenderTokens } from "./tokens";
import { taskGroups } from "./task-groups";
export { taskGroups } from "./task-groups";
import { withAdjacentFigures } from "./figure-order";
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
  /** `rows`: squares high (answer_space@v1); null = a document from before it, drawn at the old default height. */
  /** `columns`: the whole squares that fit the answer column (drawn as real lines, never more than fit). */
  | { kind: "grid"; rows: number | null; cellMm: number; columns: number }
  /** `inTable`: the activity points at a table of the sheet, whose empty cells ARE the answer space (no second box is drawn). */
  | { kind: "table_cells"; rows: number; inTable: boolean }
  | { kind: "choice"; multiple: boolean; options: string[] }
  | { kind: "fill_blank"; parts: BlankPart[]; wordBank: string[] }
  | { kind: "match"; left: string[]; right: string[] }
  | { kind: "order"; items: string[] }
  | { kind: "fields"; fields: Array<{ label: string; space: "lines" | "box" | "grid"; lines: number; unit: boolean }>; cellMm: number; columns: number }
  | { kind: "sequence"; items: string[] }
  | { kind: "true_false"; statements: string[] }
  | { kind: "oral"; mode: "oral" | "keyboard" | "other"; lines: number }
  /** One empty box between the two numbers of each printed pair (drawn by the VisualSpec renderer). */
  | { kind: "comparison"; spec: ComparisonSpec }
  | { kind: "none" };

export type RenderNode = { key: string } & (
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; paragraphs: Run[][] }
  | { kind: "reading_text"; title?: string; paragraphs: Array<{ label?: string; runs: Run[] }> }
  | { kind: "instruction"; paragraphs: Run[][]; steps: string[] }
  /**
   * `supports`: writing helps the document places right after a writing activity (an organiser, sentence starters). They are its
   * helps, so the sheet shows them between the prompt and the answer space: enunciado → apoyos → espacio de respuesta.
   */
  /**
   * `leads`: what the student needs BEFORE the task (the original example it uses, an analogous worked example). `figures`: the
   * original figures it asks about, right after its prompt. Both are resolved from the document's references, so a figure can never
   * be printed away from its instruction: enunciado → figura → apoyos → espacio de respuesta.
   */
  | { kind: "activity"; label?: string; prompt: Run[][]; steps: string[]; requirements: string[]; response: RenderResponse; keepTogether: boolean; isolate: boolean; supports: RenderNode[]; leads: RenderNode[]; figures: RenderNode[]; checks?: RenderNode[]; keepUnitTogether?: boolean }
  | { kind: "list"; ordered: boolean; items: Run[][] }
  | { kind: "table"; caption?: string; unit?: string; headers: string[]; rows: string[][] }
  | { kind: "chart"; title?: string; chartType: "bar" | "line" | "pie" | "other"; categories: string[]; series: Array<{ label: string | null; values: number[] }>; unit?: string; xLabel?: string; yLabel?: string }
  /**
   * `spec`: a verified reconstruction of the original figure, drawn by our SVG renderer instead of the crop. `widthMm`: the crop's
   * physical width in the original, so it prints at its own size (never stretched to the column).
   */
  /** `repeated`: a copy of a figure already printed on an earlier page, shown again next to another activity that compares it. */
  | { kind: "image"; state: "available" | "missing" | "pending" | "omitted"; src?: string; spec?: VisualSpec; widthMm?: number; heightMm?: number; alt: string; caption?: string; essential: boolean; failure?: VisualAssetFailure; origin: "original" | "requested"; repeated?: boolean }
  | { kind: "help_box"; variant: "key_idea" | "reminder" | "tip" | "strategy"; title?: string; paragraphs: Run[][] }
  | { kind: "checklist"; title?: string; items: string[]; keepTogether: boolean }
  | { kind: "vocabulary"; title?: string; items: Array<{ term: string; definition: string }> }
  | { kind: "worked_example"; title?: string; problem: Run[][]; steps: string[]; result: string }
  | { kind: "sentence_starters"; items: string[] }
  | { kind: "planner"; title?: string; slots: Array<{ label: string; lines: number }> }
  /** `parts`: the formula composed (stacked fractions…) when it is within what the sheet can typeset; otherwise its source is shown. */
  | { kind: "math"; latex: string; display: "inline" | "block"; spoken: string; parts: MathPart[] | null }
  | { kind: "unknown"; type: string }
);

export interface RenderPage {
  number: number;
  nodes: RenderNode[];
  /** Two short closing activities may travel together, avoiding a lone short task on the last sheet. */
  keepLastPair?: boolean;
}

export interface RenderHeader {
  subject: string | null;
  grade: string | null;
  /** Blank fields to fill in by hand ("Nombre", "Fecha"): labels only, never a value. */
  fields: string[];
}

/** The educational stage, only when the document states a known one: it modulates density and tone, never content. */
export type RenderStage = "primaria" | "eso" | "bachillerato";

/**
 * The visual system of the sheet. `claro` («Adaptaula · Sistema CLARO») is THE design of the product and the default
 * (docs/EDITORIAL.md): every sheet of every subject is printed with it. `standard` is the earlier layer (material_renderer@v3),
 * kept only so historical renders and the tests that compare against it can still ask for it explicitly. Never part of
 * `MaterialDocument`, and never chosen by a model.
 */
export type RenderDesign = "standard" | "claro";

export interface RenderModel {
  rendererVersion: string;
  mode: RenderMode;
  title: string;
  language: string;
  stage: RenderStage | null;
  design: RenderDesign;
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
  | "image_omitted"
  | "deferred_unsupported"
  | "deferred_not_applicable"
  | "deferred_applied"
  | "chart_series_unverified"
  | "math_source_only"
  | "chart_table_only"
  | "overflow_risk"
  | "structure_inconsistent"
  | "visual_semantics_unverified";

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
  /** Physical width of the figure in the original (mm), when known. */
  widthMm?: number;
  /** Physical height (mm), when known: what the figure really takes on the page when it is paginated. */
  heightMm?: number;
}

export interface BuildRenderOptions {
  mode: RenderMode;
  /** Resolved assets of original visuals by `vis_N`. The pipeline stores none today: images render only when this provides them. */
  assets?: Readonly<Record<string, AssetSource>>;
  /** Why a visual has no asset, when it is known (e.g. the analysis stores no position to crop). Unknown reasons are plain `asset_missing`. */
  assetFailures?: Readonly<Record<string, VisualAssetFailure>>;
  /** `vis_N` that the adaptation must preserve (from the pinned context): a missing one makes the sheet not renderable. */
  requiredVisuals?: readonly string[];
  /**
   * The teacher's answer to each visual a decision asked for (`requested`, by `dec_N`): the image they provided, or their explicit
   * decision to go on without it. Absent → still pending (an essential one makes the sheet not renderable).
   */
  resources?: Readonly<Record<string, AssetSource | { omitted: true }>>;
  /** The deferred decisions of the review this version came from; null/undefined = unknown (reported, never guessed). */
  deferred?: readonly DeferredInput[] | null;
  /**
   * How the subject reads on the sheet. The stored document carries the catalogue key (`matematicas`); the loader resolves its
   * name. Absent → the document's own value, unchanged.
   */
  subjectLabel?: string | null;
  /** Visual system (default `claro`, the product's). See `RenderDesign`. */
  design?: RenderDesign;
  /** Verified reconstructions of original visuals by `vis_N` (choice C): drawn instead of their crop. */
  figures?: Readonly<Record<string, VisualSpec>>;
  /** Approved generated illustrations by asset id (their bytes verified against the sha-256 the document pins). */
  generated?: Readonly<Record<string, AssetSource>>;
}

export const NEUTRAL_VISUAL_LABEL = "Recurso visual de la actividad";
const LONG_TOKEN = 45;
const WORDS_PER_LINE = 11;
const MAX_LINES = 40;
const BOX_ROWS = { small: 4, medium: 7, large: 12 } as const;
const TABLE_CELL_ROWS = 6;
/** Height of a grid stored before answer_space@v1 (it had none), in rows of the activity estimate. */
const LEGACY_GRID_ROWS = 10;
const COMPACT_ROWS = 14;
const MAX_CHECKLIST = 12;
const WIDE_TABLE_COLUMNS = 8;
/** Blocks that introduce what follows: they stay with the next activity when a page is closed before it (a reading placed right
 * before an activity is the part of the text that activity asks about). */
const LEADS_INTO = new Set<RenderNode["kind"]>(["heading", "instruction", "help_box", "reading_text"]);
/** What an activity shows after its prompt when it uses it (an original figure, a table, a chart). */
const FIGURE_KINDS = new Set<RenderNode["kind"]>(["image", "table", "chart"]);
/** What an activity shows before its prompt when it uses it (the original example, a formula). Never a long reading. */
const LEAD_KINDS = new Set<RenderNode["kind"]>(["paragraph", "math"]);
/** Rows a figure is allowed to add to a compact activity before it may split (the figure itself never leaves its prompt: CSS). */
const FIGURE_ALLOWANCE = 6;
const MM_PER_ROW = 8;
/** The tallest a figure prints (CSS: 60 % of the printable height of an A4 page). */
const MAX_FIGURE_MM = (297 - 2 * 18) * 0.6;
/** A calculation square is a little smaller than a row of text. */
const GRID_ROW_FACTOR = 0.9;
function figureRows(n: RenderNode): number {
  if (n.kind === "table") return n.rows.length + 1;
  if (n.kind === "chart") return 8;
  if (n.kind !== "image") return 0;
  if (n.spec) return n.spec.kind === "number_line" ? 4 : n.spec.kind === "part_whole" ? 6 : 3;
  if (n.heightMm) return Math.ceil(Math.min(n.heightMm, MAX_FIGURE_MM) / MM_PER_ROW) + 1;
  return n.widthMm ? Math.ceil(n.widthMm / 3 / MM_PER_ROW) + 1 : 8;
}
function leadRows(n: RenderNode): number {
  if (n.kind === "worked_example") return 2 + n.problem.length + n.steps.length;
  if (n.kind === "paragraph") return n.paragraphs.reduce((r, p) => r + Math.max(1, Math.ceil(p.reduce((c, x) => c + x.text.length, 0) / 90)), 0);
  return 2;
}

/** Printable height of an A4 page (297 − 2 × 18 mm) and what the header, the title and the gaps take on the first one. */
const PAGE_MM = 297 - 2 * 18;
const HEADER_MM = 40;
/** The tallest figure repeated for a single activity (a third of the page). */
const REPEAT_MAX_MM = PAGE_MM / 3;
/** A rough, deterministic height of a node in mm, only to tell on which sheet of paper it will land (never to lay it out). */
function estimatedMm(n: RenderNode): number {
  if (n.kind === "activity") {
    const rows = activityRows(n.prompt, n.steps, n.requirements, n.response) + n.leads.reduce((r, l) => r + leadRows(l), 0) + n.supports.reduce((r, x) => r + leadRows(x), 0) + (n.checks ?? []).reduce((r, x) => r + leadRows(x), 0);
    return rows * MM_PER_ROW + n.figures.reduce((mm, f) => mm + (f.kind === "image" && f.heightMm ? Math.min(f.heightMm, MAX_FIGURE_MM) + 8 : figureRows(f) * MM_PER_ROW), 0) + 6;
  }
  if (FIGURE_KINDS.has(n.kind)) return n.kind === "image" && n.heightMm ? Math.min(n.heightMm, MAX_FIGURE_MM) + 8 : figureRows(n) * MM_PER_ROW;
  if (n.kind === "heading") return n.level === 1 ? 14 : 9;
  return Math.max(1, textsOf(n).reduce((r, t) => r + Math.ceil(t.length / 90), 0)) * 7 + 6;
}

/**
 * The start of an activity that never splits (its prompt, its figures and the first part of its answer: the first zone of squares,
 * the first field, the first two lines): where the browser must find room on a sheet or carry the whole start to the next one.
 */
function leadMm(n: RenderNode): number {
  if (n.kind !== "activity") return Math.min(estimatedMm(n), 40);
  const r = n.response;
  const zone = (rows: number, cellMm: number) => Math.min(rows, GRID_ZONE_ROWS) * cellMm;
  const first = r.kind === "fields" ? r.fields[0] : undefined;
  const answer =
    r.kind === "grid" ? zone(r.rows ?? LEGACY_GRID_ROWS, r.cellMm)
    : r.kind === "fields" && first ? MM_PER_ROW + (first.space === "grid" ? zone(first.lines, r.cellMm) : first.space === "box" ? first.lines * MM_PER_ROW : Math.min(first.lines, 2) * MM_PER_ROW)
    : r.kind === "lines" || r.kind === "oral" ? Math.min(r.lines, 2) * MM_PER_ROW
    : 0;
  const head = activityRows(n.prompt, n.steps, n.requirements, { kind: "none" }) * MM_PER_ROW + n.leads.reduce((mm, l) => mm + leadRows(l) * MM_PER_ROW, 0);
  const figures = n.figures.reduce((mm, f) => mm + (f.kind === "image" && f.heightMm ? Math.min(f.heightMm, MAX_FIGURE_MM) + 8 : figureRows(f) * MM_PER_ROW), 0);
  return Math.max(40, head + figures + answer + 6);
}

/** Every node of a sheet, including those inside an activity (its leads, figures and supports), in reading order. */
export function flatNodes(nodes: readonly RenderNode[]): RenderNode[] {
  return nodes.flatMap((n) => (n.kind === "activity" ? [...flatNodes(n.leads), n, ...flatNodes(n.figures), ...flatNodes(n.supports), ...flatNodes(n.checks ?? [])] : [n]));
}

/** The same tree with `f` applied to every node, nested ones included (a print transform, never a content change). */
export function mapNodes(nodes: readonly RenderNode[], f: (n: RenderNode) => RenderNode): RenderNode[] {
  return nodes.map((n) => {
    const mapped = f(n);
    return mapped.kind === "activity" ? { ...mapped, leads: mapNodes(mapped.leads, f), figures: mapNodes(mapped.figures, f), supports: mapNodes(mapped.supports, f), ...(mapped.checks ? { checks: mapNodes(mapped.checks, f) } : {}) } : mapped;
  });
}

/** Responses that are written (where an organiser or sentence starters help). */
const WRITING = new Set<RenderResponse["kind"]>(["lines", "box", "oral"]);

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

function responseOf(spec: ResponseSpec, requirements: readonly string[], tokens: Pick<RenderTokens, "gridCellMm" | "answerWidthMm">, answersInTable = false): RenderResponse {
  const cellMm = tokens.gridCellMm;
  const columns = Math.floor(tokens.answerWidthMm / cellMm);
  switch (spec.kind) {
    case "lines": {
      const wanted = expectedLines(requirements);
      return { kind: "lines", lines: Math.max(spec.lines, wanted ?? 0), fromExpectedLength: wanted !== null && wanted > spec.lines };
    }
    case "box":
      return { kind: "box", rows: BOX_ROWS[spec.size] };
    case "grid":
      return { kind: "grid", rows: spec.rows ?? null, cellMm, columns };
    case "table_cells":
      return { kind: "table_cells", rows: TABLE_CELL_ROWS, inTable: answersInTable };
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
    case "comparison":
      return { kind: "comparison", spec: spec.spec };
    case "fields":
      return { kind: "fields", fields: spec.fields.map((f) => ({ label: f.label, space: f.space, lines: f.lines, unit: f.unit === true })), cellMm, columns };
    case "sequence":
      return { kind: "sequence", items: spec.items };
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
    : response.kind === "table_cells" ? (response.inTable ? 0 : response.rows)
    : response.kind === "box" ? response.rows
    : response.kind === "grid" ? Math.ceil((response.rows ?? LEGACY_GRID_ROWS) * GRID_ROW_FACTOR)
    : response.kind === "choice" ? response.options.length
    : response.kind === "match" ? Math.max(response.left.length, response.right.length)
    : response.kind === "order" || response.kind === "sequence" ? response.items.length
    : response.kind === "fields" ? response.fields.reduce((n, f) => n + 1 + (f.space === "grid" ? Math.ceil(f.lines * GRID_ROW_FACTOR) : f.space === "box" ? f.lines : f.lines > 1 ? f.lines : 0), 0)
    : response.kind === "true_false" ? response.statements.length
    : response.kind === "oral" ? response.lines
    : response.kind === "fill_blank" ? 3 + Math.ceil(response.wordBank.length / 6)
    : response.kind === "comparison" ? 2 * Math.ceil(response.spec.items.length / 3)
    : 0;
  return text + answer;
}

const STAGE_NAMES: Record<string, string> = { primaria: "Primaria", eso: "ESO", bachillerato: "Bachillerato" };
/** `1-bachillerato` → «1.º Bachillerato»; anything else is not shown rather than guessed. */
export function gradeLabel(slug: string | null): string | null {
  const m = /^(\d)-(primaria|eso|bachillerato)$/.exec(slug ?? "");
  return m ? `${m[1]}.º ${STAGE_NAMES[m[2]!]}` : null;
}

/**
 * The subject as the sheet prints it when the loader resolved no name: a readable name stays; a catalogue key (`matematicas`,
 * `conocimiento-medio`) is never printed as such (it is not shown rather than shown as a code).
 */
export function subjectName(subject: string | null): string | null {
  if (!subject) return null;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subject) ? null : subject;
}

interface Ctx {
  options: BuildRenderOptions;
  tokens: RenderTokens;
  /** Ids of the document's table blocks: an activity that points at one is answered in its cells. */
  tables: Set<string>;
  isolate: Set<string>;
  issues: RenderIssue[];
  next: () => string;
}

function checkedFigure(node: Extract<RenderNode, { kind: "image" }>, spec: VisualSpec, ctx: Ctx): RenderNode {
  const parsed = VisualSpecSchema.safeParse(spec);
  if (!parsed.success) {
    ctx.issues.push({ code: "structure_inconsistent", severity: "error", message: "Una figura contiene divisiones, celdas o etiquetas incoherentes. Revisa el recurso antes de imprimir." });
    return { ...node, state: "missing" };
  }
  return { ...node, spec: parsed.data, alt: node.caption ?? describeSpec(parsed.data) };
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
      const response = responseOf(block.response, requirements, ctx.tokens, (block.resource_block_ids ?? []).some((ref) => ctx.tables.has(ref)));
      return { key, kind: "activity", ...(block.label ? { label: block.label } : {}), prompt, steps, requirements, response, keepTogether: activityRows(prompt, steps, requirements, response) <= COMPACT_ROWS, isolate: ctx.isolate.has(block.id), supports: [], leads: [], figures: [] };
    }
    case "list":
      return { key, kind: "list", ordered: block.style === "numbered", items: block.items.map(parseInline) };
    case "table":
      return { key, kind: "table", ...(block.caption ? { caption: block.caption } : {}), ...(block.unit ? { unit: block.unit } : {}), headers: block.headers, rows: block.rows };
    case "chart":
      return { key, kind: "chart", ...(block.title ? { title: block.title } : {}), chartType: block.chart_type, categories: block.categories, series: block.series.map((s) => ({ label: s.label, values: s.values })), ...(block.unit ? { unit: block.unit } : {}), ...(block.x_label ? { xLabel: block.x_label } : {}), ...(block.y_label ? { yLabel: block.y_label } : {}) };
    case "image": {
      if (block.source.kind === "requested") {
        const resource = ctx.options.resources?.[block.source.decision_id];
        const essential = block.source.essential === true;
        const base = { key, kind: "image" as const, alt: block.caption ?? NEUTRAL_VISUAL_LABEL, ...(block.caption ? { caption: block.caption } : {}), essential, origin: "requested" as const };
        if (resource && "omitted" in resource) return { ...base, state: "omitted" };
        return resource ? { ...base, state: "available", src: resource.src } : { ...base, state: "pending" };
      }
      if (block.source.kind === "figure") {
        const located = block.source.visual_ref ? (ctx.options.figures?.[block.source.visual_ref] ?? ctx.options.assets?.[block.source.visual_ref]) : undefined;
        const essential = block.source.visual_ref ? (ctx.options.requiredVisuals?.includes(block.source.visual_ref) ?? false) : false;
        const origin = block.source.visual_ref ? ("original" as const) : ("requested" as const);
        // A figure a person (or the locator) found later in the original wins over the one rebuilt from the analysis's words.
        if (located && "src" in located) return { key, kind: "image", state: "available", src: located.src, ...(located.widthMm ? { widthMm: located.widthMm } : {}), ...(located.heightMm ? { heightMm: located.heightMm } : {}), alt: block.caption ?? block.alt_text, ...(block.caption ? { caption: block.caption } : {}), essential, origin };
        const spec = located && !("src" in located) ? located : block.source.spec;
        return checkedFigure({ key, kind: "image", state: "available", alt: block.caption ?? block.alt_text, ...(block.caption ? { caption: block.caption } : {}), essential, origin }, spec, ctx);
      }
      if (block.source.kind === "generated") {
        const asset = ctx.options.generated?.[block.source.asset_id];
        // It stands for something the sheet needs: a required original, or the picture an activity refers to; a support counts too.
        const essential = block.source.visual_ref ? (ctx.options.requiredVisuals?.includes(block.source.visual_ref) ?? true) : true;
        const origin = block.source.decision_id ? ("requested" as const) : ("original" as const);
        // Its text alternative is the illustration's own description, written and reviewed with it (never the answer).
        return { key, kind: "image", state: asset ? "available" : "missing", ...(asset ? { src: asset.src, ...(asset.widthMm ? { widthMm: asset.widthMm } : {}), ...(asset.heightMm ? { heightMm: asset.heightMm } : {}) } : {}), alt: block.caption ?? block.alt_text, ...(block.caption ? { caption: block.caption } : {}), essential, origin };
      }
      const ref = block.source.visual_ref;
      const spec = ctx.options.figures?.[ref];
      const asset = ctx.options.assets?.[ref];
      const essential = ctx.options.requiredVisuals?.includes(ref) ?? false;
      const failure = asset || spec ? undefined : ctx.options.assetFailures?.[ref];
      // The accessible name is the printed caption of the original when there is one; otherwise a neutral label (or, for a
      // reconstruction, the description of what it draws). The analyzer's free description of the image is not verified, so it is
      // never used as the student's text alternative.
      const alt = block.caption ?? NEUTRAL_VISUAL_LABEL;
      if (spec) return checkedFigure({ key, kind: "image", state: "available", alt, ...(block.caption ? { caption: block.caption } : {}), essential, origin: "original" }, spec, ctx);
      return { key, kind: "image", state: asset ? "available" : "missing", ...(asset ? { src: asset.src, ...(asset.widthMm ? { widthMm: asset.widthMm } : {}), ...(asset.heightMm ? { heightMm: asset.heightMm } : {}) } : {}), alt, ...(block.caption ? { caption: block.caption } : {}), essential, ...(failure ? { failure } : {}), origin: "original" };
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
      return { key, kind: "math", latex: block.latex, display: block.display, spoken: block.spoken_text, parts: composeMath(block.latex) };
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
    case "activity": return [...n.leads.flatMap(textsOf), ...runs(n.prompt), ...n.steps, ...n.requirements, ...n.supports.flatMap(textsOf), ...(n.checks ?? []).flatMap(textsOf)];
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
    if (n.kind === "image" && n.state === "available" && n.src && !n.spec) add("visual_semantics_unverified", "info", "La impresión comprueba la disponibilidad de la imagen, no sus etiquetas ni su contenido. Comprueba su correspondencia con la consigna.");
    if (n.kind === "unknown") add("unknown_block_type", "error", `Hay un bloque de un tipo que el visor no conoce («${n.type}»): la ficha no se puede mostrar completa`);
    if (n.kind === "image" && n.state === "missing") {
      const code: IssueCode = n.failure && n.failure !== "asset_missing" ? "asset_unsupported" : "asset_missing";
      const why = n.failure ? ` (${FAILURE_COPY[n.failure]})` : "";
      if (n.essential) add(code, "error", `Falta una imagen del material original que es necesaria para resolver la actividad${why}`);
      else add(code, "warning", `Falta una imagen del material original; no se muestra en la ficha${why}`);
    }
    if (n.kind === "image" && n.state === "pending") {
      if (n.essential) add("image_pending", "error", "Falta un recurso visual imprescindible que no está en el material original: añádelo o decide continuar sin él");
      else add("image_pending", "warning", "Hay un apoyo visual opcional sin recurso; la ficha del alumno no lo muestra");
    }
    if (n.kind === "image" && n.state === "omitted") add("image_omitted", "info", "Se decidió continuar sin un recurso visual que no estaba en el material original");
    if (n.kind === "chart" && seriesAmbiguous(n)) add("chart_series_unverified", "warning", "El material original no proporciona nombres verificados para estas series: se muestran sus datos en tabla, sin leyenda ni nombres inventados");
    if (n.kind === "chart" && n.series.some((s) => s.values.length !== n.categories.length)) add("structure_inconsistent", "error", "Un gráfico tiene series con distinto número de valores que categorías");
    if (n.kind === "table" && n.rows.some((r) => r.length !== n.headers.length)) add("structure_inconsistent", "error", "Una tabla tiene filas con distinto número de celdas que cabeceras");
    if (n.kind === "table" && n.headers.length > WIDE_TABLE_COLUMNS) add("overflow_risk", "warning", "Una tabla es muy ancha: se ajusta al ancho de la hoja con celdas más estrechas");
    if (n.kind === "checklist" && n.items.length > MAX_CHECKLIST) add("structure_inconsistent", "warning", "Una lista de comprobación tiene más elementos de los esperados; se muestra entera");
    if (n.kind === "chart" && hasNegative(n)) add("chart_table_only", "info", "Un gráfico tiene valores negativos: se muestran solo sus datos en tabla, sin dibujarlo");
    if (n.kind === "math" && n.parts === null) add("math_source_only", "info", "Una fórmula se muestra como texto con su lectura en voz alta: el visor aún no compone fórmulas");
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
  const tables = new Set(doc.pages.flatMap((p) => p.blocks).filter((bl) => bl.type === "table").map((bl) => bl.id));
  const design: RenderDesign = options.design ?? "claro";
  const tokens = renderTokens(doc.presentation, doc.meta.stage, design);
  const ctx: Ctx = { options, tokens, tables, isolate: plan.isolate, issues: [], next: () => `n${++counter}` };
  const max = tokens.maxTasksPerPage;

  const uses = new Map<string, number>();
  for (const block of doc.pages.flatMap(p => p.blocks)) if (block.type === "activity") {
    for (const ref of new Set(block.resource_block_ids ?? [])) uses.set(ref, (uses.get(ref) ?? 0) + 1);
  }
  const pages: RenderPage[] = [];
  // Where each figure was printed (estimated sheet of paper): an activity that uses a figure printed on an EARLIER sheet shows it again.
  const figureHome = new Map<string, { node: RenderNode; page: number }>();
  // The estimated sheet of paper and how much of it is used: every logical page starts a new one; a node kept together that does not
  // fit opens the next; a long one that may split carries its overflow on.
  let sheet = 0;
  let used = HEADER_MM;
  // The sheet before each node was placed: a figure or an example that then moves INSIDE its activity is counted there, not twice.
  const before = new WeakMap<RenderNode, { sheet: number; used: number }>();
  let pageStart = 0;
  const place = (n: RenderNode, keep: boolean): number => {
    before.set(n, { sheet, used });
    const mm = estimatedMm(n);
    if (used > 0 && used + mm > PAGE_MM && (keep || used + Math.min(mm, leadMm(n)) > PAGE_MM)) {
      sheet += 1;
      used = 0;
    }
    const at = sheet;
    used += mm;
    while (used > PAGE_MM) {
      sheet += 1;
      used -= PAGE_MM;
    }
    return at;
  };
  for (const logical of doc.pages) {
    let current: RenderNode[] = [];
    let tasks = 0;
    const quotas = max === null ? [] : taskGroups(logical.blocks.filter((bl) => bl.type === "activity").length, max);
    let group = 0;
    const flush = () => {
      if (current.length > 0) {
        pages.push({ number: pages.length + 1, nodes: current });
        sheet += 1;
        used = 0;
        pageStart = sheet;
      }
      current = [];
      tasks = 0;
    };
    // The source of each node of the page being built, to tell what leads into the next activity.
    const sources: string[][] = [];
    const blockIds: string[] = [];
    for (const block of withAdjacentFigures(logical.blocks, uses)) {
      const node = nodeOf(block, ctx);
      // The figures and the example an activity uses travel INSIDE it (see `leads` / `figures`): the document places them right
      // before the activity, and their link is the activity's own references, never their position on the page.
      const moved: string[] = [];
      if (node.kind === "activity" && block.type === "activity") {
        const own = new Set(block.resource_block_ids ?? []);
        while (current.length > 0) {
          const previous = current.at(-1)!;
          const id = blockIds.at(-1)!;
          const refs = sources.at(-1) ?? [];
          const figure = FIGURE_KINDS.has(previous.kind) && own.has(id);
          const lead = !figure && ((LEAD_KINDS.has(previous.kind) && own.has(id)) || (previous.kind === "worked_example" && refs.some((r) => block.trace.source_refs.includes(r))));
          if (!figure && !lead) break;
          current.pop();
          sources.pop();
          blockIds.pop();
          const was = before.get(previous);
          if (was && was.sheet >= pageStart) ({ sheet, used } = was);
          if (figure) moved.unshift(id);
          (figure ? node.figures : node.leads).unshift(previous);
        }
        // Its leads (an example before it) are outside the activity's own box and travel with it by their own rule (CSS): only
        // what is inside the box decides whether the box is kept whole.
        node.keepTogether = activityRows(node.prompt, node.steps, node.requirements, node.response) + node.figures.reduce((n, f) => n + figureRows(f), 0) <= COMPACT_ROWS + FIGURE_ALLOWANCE;
      }
      // max_tasks_per_page groups, it never removes: a new page starts BEFORE the activity that would exceed its group (see
      // `taskGroups`), and what leads into that activity (a heading, an orientation, a help, its part of the reading, its own
      // worked example) travels with it. A worked example of ANOTHER activity (sheets assembled before examples went first) stays.
      if (node.kind === "activity" && max !== null && tasks >= (quotas[group] ?? max)) {
        const lead: RenderNode[] = [];
        const leads = (kind: RenderNode["kind"], refs: string[] | undefined) => LEADS_INTO.has(kind) || (kind === "worked_example" && (refs ?? []).some((r) => block.trace.source_refs.includes(r)));
        while (current.length > 0 && leads(current.at(-1)!.kind, sources.at(current.length - 1))) {
          lead.unshift(current.pop()!);
          sources.splice(current.length, 1);
        }
        const leadSources = sources.splice(current.length);
        const leadIds = blockIds.splice(current.length);
        flush();
        sources.length = 0;
        blockIds.length = 0;
        group += 1;
        current.push(...lead);
        sources.push(...lead.map((_, i) => leadSources[i] ?? []));
        blockIds.push(...lead.map((_, i) => leadIds[i] ?? ""));
      }
      // A writing help placed right after a writing activity is that activity's help (see `supports`): it travels inside it.
      const previous = current.at(-1);
      if ((node.kind === "planner" || node.kind === "sentence_starters") && previous?.kind === "activity" && WRITING.has(previous.response.kind)) {
        previous.supports.push(node);
        // An organised essay is long: its writing space may continue on the next page (the prompt and the organiser never leave
        // its first lines: CSS), rather than pushing the whole activity on and leaving half a page empty.
        if (node.kind === "planner") previous.keepTogether = false;
        continue;
      }
      // A help or the vocabulary written FOR the activity right before it is used while doing it: it goes inside, after what to do and
      // before where to answer (after the answer lines it is read too late). A checklist stays after (it is for checking the work);
      // a support of another activity or of the whole sheet stays where it is.
      const own = (previous?.kind === "activity" && block.trace.origin !== "original" && block.trace.source_refs.length > 0 && block.trace.source_refs.every((r) => (sources.at(-1) ?? []).includes(r))) || false;
      if (node.kind === "checklist" && previous?.kind === "activity" && own) {
        (previous.checks ??= []).push(node);
        continue;
      }
      if ((node.kind === "help_box" || node.kind === "vocabulary") && previous?.kind === "activity" && own) {
        previous.supports.push(node);
        if (previous.keepTogether && activityRows(previous.prompt, previous.steps, previous.requirements, previous.response) + previous.figures.reduce((n, f) => n + figureRows(f), 0) + previous.supports.reduce((n, x) => n + leadRows(x), 0) > COMPACT_ROWS + FIGURE_ALLOWANCE) previous.keepTogether = false;
        continue;
      }
      let at: number | null = null;
      if (node.kind === "activity" && block.type === "activity") {
        // A figure it asks about that is printed on an earlier sheet (a comparison of A and B after both were used): shown again here,
        // so the student never has to turn back. Only available images: a missing one is reported once, where it belongs.
        const starts = used + Math.min(estimatedMm(node), leadMm(node)) > PAGE_MM || (node.keepTogether && used + estimatedMm(node) > PAGE_MM) ? sheet + 1 : sheet;
        // A large figure is repeated only for an activity that compares several: turning back once costs less than a second half page.
        const images = (block.resource_block_ids ?? []).filter((ref) => figureHome.get(ref)?.node.kind === "image").length;
        const repeated: string[] = [];
        for (const ref of block.resource_block_ids ?? []) {
          const home = figureHome.get(ref);
          if (!home || home.page >= starts || moved.includes(ref) || home.node.kind !== "image" || home.node.state !== "available") continue;
          if (images < 2 && (home.node.heightMm ?? MAX_FIGURE_MM) > REPEAT_MAX_MM) continue;
          node.figures.push({ ...home.node, key: ctx.next(), repeated: true });
          repeated.push(ref);
        }
        if (node.figures.some((f) => f.kind === "image" && f.repeated)) {
          node.keepTogether = activityRows(node.prompt, node.steps, node.requirements, node.response) + node.figures.reduce((n, f) => n + figureRows(f), 0) <= COMPACT_ROWS + FIGURE_ALLOWANCE;
        }
        at = place(node, node.keepTogether);
        for (const id of moved) {
          const figure = node.figures[moved.indexOf(id)];
          if (figure) figureHome.set(id, { node: figure, page: at });
        }
        // The copy is now the nearest print of that figure: the next activity on this sheet needs no third one.
        for (const id of repeated) figureHome.set(id, { node: figureHome.get(id)!.node, page: at });
      } else {
        at = place(node, FIGURE_KINDS.has(node.kind));
      }
      if (FIGURE_KINDS.has(node.kind)) figureHome.set(block.id, { node, page: at });
      current.push(node);
      sources.push(block.trace.source_refs);
      blockIds.push(block.id);
      if (node.kind === "activity") tasks += 1;
    }
    flush();
  }

  const allNodes = flatNodes(pages.flatMap((p) => p.nodes));
  const validation = validate(allNodes, ctx, plan.outcomes, deferredKnown);
  const model: RenderModel = {
    rendererVersion: MATERIAL_RENDERER_VERSION,
    mode: options.mode,
    title: doc.meta.title,
    language: doc.meta.language,
    stage: doc.meta.stage === "primaria" || doc.meta.stage === "eso" || doc.meta.stage === "bachillerato" ? doc.meta.stage : null,
    design,
    header: { subject: options.subjectLabel ?? subjectName(doc.meta.subject), grade: gradeLabel(doc.meta.grade), fields: doc.admin_fields.map((f) => f.label) },
    tokens,
    pages: pages.map((page) => {
      const nodes = mapNodes(page.nodes, n => n.kind === "activity" ? {
        ...n,
        // Oversized units must flow immediately, not be pushed onto a blank page by Chromium before it abandons avoidance.
        keepUnitTogether: estimatedMm(n) * Math.max(tokens.answerLineMm / MM_PER_ROW, tokens.fontPt / 12.5) <= PAGE_MM,
      } : n);
      const pair = nodes.slice(-2);
      const keepLastPair = pair.length === 2 && pair.every(n => n.kind === "activity") && pair.reduce((mm, n) => mm + estimatedMm(n), 0) <= PAGE_MM / 2;
      return keepLastPair ? { ...page, nodes, keepLastPair: true } : { ...page, nodes };
    }),
  };
  return { model, validation };
}
