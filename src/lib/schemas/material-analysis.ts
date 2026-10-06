import { z } from "zod";

/**
 * MaterialAnalysis v3: structured understanding of an uploaded material. NOT an adaptation: it only describes what the
 * material contains, what it teaches and what must survive a future adaptation. The v2 contract (stored by
 * `material_analyzer@v1`) is frozen in `material-analysis-v2.ts` and is still readable: `analysis/upgrade.ts` lifts it to this
 * shape in memory. Historical rows are never rewritten.
 *
 * Two schemas, same pattern as before (ADR-008):
 * - `MaterialAnalysisDraftSchema`: what the model is asked for. Compact on purpose: every field here is something only the
 *   model can know. Ids are local ("a1", "v2"), every relation is written ONCE (child → parent) and everything calculable
 *   (counts, inverse links, persistent ids, "has an answer space", "needs a response"…) is left to the normalizer.
 * - `MaterialAnalysisSchema`: what we store and the app consumes. Ids are server-assigned, relations are verified and
 *   symmetric, and `structure.counts` is computed from the final graph.
 *
 * ARCHITECTURE DECISION (visuals): a table is ONE entity. Tables, charts, figures and images all live in `visuals`; a table
 * carries its structured data in `table`, a chart in `chart`. There is no separate "table content" next to a "table image" any
 * more, so nothing can be counted twice. Answer areas are an attribute of each activity (`answer_area`), not visuals: an
 * answer line is part of the activity, not a figure that could be dropped as decoration. Administrative fields
 * (name, date…) are their own list, not text.
 */

export const MATERIAL_ANALYSIS_SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS = [2, 3] as const;

export const STAGE_SLUGS = ["primaria", "eso", "bachillerato"] as const;
export const GRADE_SLUGS = [
  "1-primaria", "2-primaria", "3-primaria", "4-primaria", "5-primaria", "6-primaria",
  "1-eso", "2-eso", "3-eso", "4-eso",
  "1-bachillerato", "2-bachillerato",
] as const;

export const DIFFICULTY = ["low", "medium", "high"] as const;
export const ACTIVITY_TYPES = [
  "open_question", "short_answer", "multiple_choice", "true_false", "fill_blank", "matching", "classification",
  "sequencing", "calculation", "problem_solving", "writing", "reading_comprehension", "table_completion",
  "graph_interpretation", "drawing", "experiment", "other",
] as const;
export const RESPONSE_FORMATS = ["write_text", "write_number", "select_option", "mark", "draw", "fill_blanks", "match", "order", "calculate", "none"] as const;
export const TEXT_KINDS = ["heading", "instruction", "reading_text", "example", "definition", "formula", "note", "other"] as const;
export const VISUAL_KINDS = ["image", "diagram", "chart", "table", "number_line", "geometric_figure", "map", "decorative", "other"] as const;
/** required: needed to solve the activity · informative: teaches something · illustrative: accompanies · decorative: adornment. */
export const VISUAL_ROLES = ["required", "informative", "illustrative", "decorative"] as const;
export const CHART_TYPES = ["bar", "line", "pie", "other"] as const;
/** What the ORIGINAL sheet offers to answer on. `unknown` = could not be told (legacy analyses, unreadable scans). */
export const ANSWER_AREA_TYPES = ["none", "line", "lines", "box", "grid", "large_space", "table_cells", "other", "unknown"] as const;
export const ANSWER_BASIS = ["source", "inferred", "not_inferable"] as const;
export const IMPORTANCE = ["essential", "important", "optional"] as const;
export const PROTECTED_TYPES = [
  "learning_objective", "target_operation", "concept", "required_data", "units_or_magnitudes", "necessary_visual",
  "response_constraint", "reasoning_constraint", "evaluation_criterion", "required_vocabulary", "format_requirement", "formula", "other",
] as const;
export const UNCERTAINTY_KINDS = [
  "illegible", "cut_off", "ambiguous", "answer_not_inferable", "low_quality", "unsupported_content", "embedded_instructions", "unstructured_data", "other",
] as const;
/** What the model may report. `answer_not_inferable` is not asked for any more: it is already the activity's `expected_answer.basis`. */
export const DRAFT_UNCERTAINTY_KINDS = ["illegible", "cut_off", "ambiguous", "low_quality", "unsupported_content", "embedded_instructions", "unstructured_data", "other"] as const;
export const ADMIN_FIELD_TYPES = ["student_name", "date", "class_group", "list_number", "student_id", "score", "signature", "other"] as const;
export const READABILITY = ["good", "partial", "poor"] as const;

const Confidence = z.number().min(0).max(1);
const Text = (max: number) => z.string().trim().min(1).max(max);
/** May be empty: "" means "not present / unknown". */
const MaybeText = (max: number) => z.string().trim().max(max);
const Page = z.number().int().min(1).max(500);

// ---------------------------------------------------------------------------
// Draft (model-facing)
// ---------------------------------------------------------------------------

const LocalId = z.string().trim().min(1).max(12);

const DraftTable = z.object({
  headers: z.array(MaybeText(120)).max(12),
  rows: z.array(z.array(MaybeText(300)).max(12)).max(40),
  unit: MaybeText(40).optional(),
});

const DraftChart = z.object({
  type: z.enum(CHART_TYPES),
  categories: z.array(MaybeText(80)).min(1).max(30),
  series: z
    .array(z.object({ name: MaybeText(80), values: z.array(z.number()).min(1).max(30).describe("Un valor por categoría, en el mismo orden.") }))
    .min(1)
    .max(6),
  x_label: MaybeText(80).optional(),
  y_label: MaybeText(80).optional(),
  unit: MaybeText(40).optional(),
});

export const MaterialAnalysisDraftSchema = z.object({
  identification: z.object({
    title: MaybeText(200),
    language: MaybeText(2),
    stage: z.enum([...STAGE_SLUGS, "unknown"]),
    grade: z.enum([...GRADE_SLUGS, "unknown"]),
    subject: MaybeText(80),
    topic: MaybeText(200),
    confidence: z.object({ stage: Confidence, grade: Confidence, subject: Confidence, topic: Confidence }),
  }),
  intent: z.object({
    purpose: Text(300),
    objectives: z
      .array(z.object({ id: LocalId, text: Text(200) }))
      .max(6)
      ,
    knowledge: z.array(Text(120)).max(12),
    prerequisites: z.array(Text(120)).max(8),
    difficulty: z.enum(DIFFICULTY),
  }),
  sections: z.array(z.object({ id: LocalId, title: MaybeText(120), page_start: Page, page_end: Page })).max(20),
  texts: z
    .array(
      z.object({
        id: LocalId,
        kind: z.enum(TEXT_KINDS),
        page: Page,
        text: Text(6000),
        section: LocalId.optional(),
      }),
    )
    .max(100)
    ,
  visuals: z
    .array(
      z.object({
        id: LocalId,
        kind: z.enum(VISUAL_KINDS),
        page: Page,
        role: z.enum(VISUAL_ROLES),
        title: MaybeText(160).optional(),
        description: MaybeText(300),
        text: MaybeText(600).optional(),
        table: DraftTable.optional(),
        chart: DraftChart.optional(),
        section: LocalId.optional(),
      }),
    )
    .max(60)
    ,
  admin: z
    .array(z.object({ type: z.enum(ADMIN_FIELD_TYPES), label: Text(60), page: Page }))
    .max(10)
    ,
  activities: z
    .array(
      z.object({
        id: LocalId,
        label: MaybeText(20),
        page: Page,
        section: LocalId.optional(),
        type: z.enum(ACTIVITY_TYPES),
        instruction: Text(1500),
        context: MaybeText(3000).optional(),
        resources: z.array(LocalId).max(8).default([]),
        objectives: z.array(LocalId).max(6).default([]),
        response: z.enum(RESPONSE_FORMATS),
        answer_area: z.enum(ANSWER_AREA_TYPES),
        answer_lines: z.number().int().min(0).max(40).optional(),
        answer: z
          .object({ basis: z.enum(["source", "inferred"]), value: Text(500) })
          .optional()
          ,
        difficulty: z.enum(DIFFICULTY),
        confidence: Confidence,
      }),
    )
    .max(150),
  protected: z
    .array(
      z.object({
        type: z.enum(PROTECTED_TYPES),
        importance: z.enum(IMPORTANCE),
        value: Text(200),
        activities: z.array(LocalId).max(12).default([]),
        resources: z.array(LocalId).max(8).default([]),
      }),
    )
    .max(40),
  uncertainties: z
    .array(
      z.object({
        kind: z.enum(DRAFT_UNCERTAINTY_KINDS),
        targets: z.array(LocalId).max(10).default([]),
        note: Text(160),
        confidence: Confidence,
      }),
    )
    .max(30),
  quality: z.object({ confidence: Confidence, readability: z.enum(READABILITY) }),
});

export type MaterialAnalysisDraft = z.infer<typeof MaterialAnalysisDraftSchema>;
export type MaterialAnalysisDraftInput = z.input<typeof MaterialAnalysisDraftSchema>;

// ---------------------------------------------------------------------------
// Stored (server-normalized)
// ---------------------------------------------------------------------------

export const ID_PREFIXES = { objective: "obj", section: "sec", text: "ctt", visual: "vis", activity: "act", protected: "prt", uncertainty: "unc" } as const;
const StoredId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9]{1,4}$`), "Identificador no válido");
const Refs = (pattern: string, max: number) => z.array(z.string().regex(new RegExp(`^(${pattern})_[0-9]{1,4}$`), "Identificador no válido")).max(max);

const StoredDetected = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), confidence: Confidence });

const StoredTable = z.object({ headers: z.array(MaybeText(120)).max(12), rows: z.array(z.array(MaybeText(300)).max(12)).max(40), unit: Text(40).nullable() });
/**
 * `series[].name` is potentially INFERRED metadata, not text known to be printed in the material: the model sometimes
 * names a single series after the chart title ("Población 2025") even when the prompt says to leave it empty, and the
 * contract carries no provenance. Consumers (Fase 4 included) must NOT show it to the student automatically, turn it into
 * a protected element, use it as textual evidence of the material or require an adaptation to keep it. Rely on
 * categories, values, `unit`, the explicit `title`/axis labels and verifiable relations. It is deliberately not stripped:
 * some documents do print series names.
 */
const StoredChart = z.object({
  type: z.enum(CHART_TYPES),
  categories: z.array(MaybeText(80)).min(1).max(30),
  series: z.array(z.object({ name: MaybeText(80), values: z.array(z.number()).min(1).max(30) })).min(1).max(6),
  x_label: Text(80).nullable(),
  y_label: Text(80).nullable(),
  unit: Text(40).nullable(),
});

const StoredSchemaBase = z.object({
  schema_version: z.literal(MATERIAL_ANALYSIS_SCHEMA_VERSION),
  identification: z.object({
    title: Text(200).nullable(),
    language: z.string().regex(/^[a-z]{2}$/).nullable(),
    stage: StoredDetected(z.enum(STAGE_SLUGS)),
    grade: StoredDetected(z.enum(GRADE_SLUGS)),
    subject: StoredDetected(Text(80)).extend({ slug: z.string().regex(/^[a-z0-9-]+$/).nullable() }),
    topic: StoredDetected(Text(200)),
  }),
  pedagogical_intent: z.object({
    purpose: Text(500),
    objectives: z.array(z.object({ id: StoredId("obj"), text: Text(300) })).max(8),
    knowledge: z.array(Text(160)).max(20),
    prerequisites: z.array(Text(200)).max(10),
    difficulty: z.enum(DIFFICULTY),
  }),
  structure: z.object({
    page_count: z.number().int().min(1).max(500).nullable(),
    /** Computed by the normalizer from the final graph (never by the model). Semantics in `analysis/counts.ts`. */
    counts: z.object({
      sections: z.number().int().min(0),
      activities: z.number().int().min(0),
      responses_required: z.number().int().min(0),
      answer_spaces: z.number().int().min(0),
      reading_texts: z.number().int().min(0),
      examples: z.number().int().min(0),
      formulas: z.number().int().min(0),
      tables: z.number().int().min(0),
      charts: z.number().int().min(0),
      images: z.number().int().min(0),
      figures: z.number().int().min(0),
      decorative: z.number().int().min(0),
    }),
  }),
  sections: z.array(z.object({ id: StoredId("sec"), title: Text(160).nullable(), page_start: Page, page_end: Page })).max(20),
  texts: z
    .array(
      z.object({
        id: StoredId("ctt"),
        section_id: StoredId("sec").nullable(),
        page: Page,
        kind: z.enum(TEXT_KINDS),
        text: Text(6000),
        /** Derived: the activities that need this text (inverse of `activity.resource_ids`). */
        activity_ids: Refs("act", 150),
      }),
    )
    .max(100),
  visuals: z
    .array(
      z.object({
        id: StoredId("vis"),
        section_id: StoredId("sec").nullable(),
        page: Page,
        kind: z.enum(VISUAL_KINDS),
        role: z.enum(VISUAL_ROLES),
        title: Text(200).nullable(),
        description: MaybeText(500),
        text: Text(1000).nullable(),
        table: StoredTable.nullable(),
        chart: StoredChart.nullable(),
        /** Derived: the activities that need this visual (inverse of `activity.resource_ids`). */
        activity_ids: Refs("act", 150),
      }),
    )
    .max(60),
  administrative_fields: z.array(z.object({ type: z.enum(ADMIN_FIELD_TYPES), label: Text(60), page: Page })).max(10),
  activities: z
    .array(
      z.object({
        id: StoredId("act"),
        section_id: StoredId("sec").nullable(),
        page: Page,
        label: Text(20).nullable(),
        type: z.enum(ACTIVITY_TYPES),
        instruction: Text(1500),
        context: Text(6000).nullable(),
        resource_ids: Refs("ctt|vis", 8),
        objective_ids: Refs("obj", 6),
        response_format: z.enum(RESPONSE_FORMATS),
        answer_area: z.object({ type: z.enum(ANSWER_AREA_TYPES), lines: z.number().int().min(1).max(40).nullable() }),
        /**
         * source: it is in the sheet. inferred: the model deduced it (NEVER original content, never shown to the student,
         * never a protected element; only a hint to check that an adaptation stays solvable). not_inferable: no value.
         */
        expected_answer: z.object({ basis: z.enum(ANSWER_BASIS), value: Text(500).nullable() }),
        difficulty: z.enum(DIFFICULTY),
        confidence: Confidence,
      }),
    )
    .max(150),
  protected_elements: z
    .array(
      z.object({
        id: StoredId("prt"),
        type: z.enum(PROTECTED_TYPES),
        importance: z.enum(IMPORTANCE),
        value: Text(300),
        activity_ids: Refs("act", 150),
        resource_ids: Refs("ctt|vis", 60),
      }),
    )
    .max(40),
  uncertainties: z
    .array(
      z.object({
        id: StoredId("unc"),
        kind: z.enum(UNCERTAINTY_KINDS),
        target_ids: Refs("act|ctt|vis", 10),
        note: Text(400),
        confidence: Confidence,
        /** Page of the first target when it has one (display only). */
        page: Page.nullable(),
      }),
    )
    .max(30),
  quality: z.object({ confidence: Confidence, readability: z.enum(READABILITY) }),
});

type Stored = z.infer<typeof StoredSchemaBase>;

/** Invariants of the graph. Violations are what the normalizer repairs; a stored analysis must never carry them. */
export function referenceIssues(a: Stored): string[] {
  const issues: string[] = [];
  const unique = (list: Array<{ id: string }>, where: string) => {
    if (new Set(list.map((x) => x.id)).size !== list.length) issues.push(`${where} tiene ids duplicados`);
  };
  unique(a.sections, "sections");
  unique(a.texts, "texts");
  unique(a.visuals, "visuals");
  unique(a.activities, "activities");
  unique(a.protected_elements, "protected_elements");
  unique(a.uncertainties, "uncertainties");
  unique(a.pedagogical_intent.objectives, "objectives");

  const ids = {
    sec: new Set(a.sections.map((s) => s.id)),
    obj: new Set(a.pedagogical_intent.objectives.map((o) => o.id)),
    act: new Set(a.activities.map((x) => x.id)),
    resource: new Set([...a.texts.map((t) => t.id), ...a.visuals.map((v) => v.id)]),
  };
  const check = (refs: readonly (string | null)[], set: Set<string>, where: string) => {
    for (const ref of refs) if (ref !== null && !set.has(ref)) issues.push(`${where} apunta a un id inexistente: ${ref}`);
  };

  for (const t of a.texts) check([t.section_id], ids.sec, "texts.section_id");
  for (const v of a.visuals) check([v.section_id], ids.sec, "visuals.section_id");
  for (const x of a.activities) {
    check([x.section_id], ids.sec, "activities.section_id");
    check(x.objective_ids, ids.obj, "activities.objective_ids");
    check(x.resource_ids, ids.resource, "activities.resource_ids");
    if (x.expected_answer.basis === "not_inferable" && x.expected_answer.value !== null) issues.push(`La actividad ${x.id} declara la respuesta como no deducible pero incluye un valor`);
    if (x.expected_answer.basis !== "not_inferable" && x.expected_answer.value === null) issues.push(`La actividad ${x.id} declara una respuesta (${x.expected_answer.basis}) sin valor`);
    if (x.answer_area.lines !== null && !["line", "lines"].includes(x.answer_area.type)) issues.push(`La actividad ${x.id} indica líneas en un área que no es de líneas`);
  }

  // Symmetry: activity ↔ text and activity ↔ visual always agree, whichever side was written.
  const resources = [...a.texts, ...a.visuals];
  for (const x of a.activities) {
    for (const r of x.resource_ids) {
      const resource = resources.find((candidate) => candidate.id === r);
      if (resource && !resource.activity_ids.includes(x.id)) issues.push(`${r} no declara que la actividad ${x.id} lo usa (relación asimétrica)`);
    }
  }
  for (const r of resources) {
    check(r.activity_ids, ids.act, `${r.id}.activity_ids`);
    for (const actId of r.activity_ids) {
      const activity = a.activities.find((candidate) => candidate.id === actId);
      if (activity && !activity.resource_ids.includes(r.id)) issues.push(`La actividad ${actId} no declara que usa ${r.id} (relación asimétrica)`);
    }
  }

  for (const v of a.visuals) {
    if (v.kind === "decorative" && v.role !== "decorative") issues.push(`El elemento ${v.id} es decorativo pero su función es ${v.role}`);
    if (v.table && v.chart) issues.push(`El elemento ${v.id} tiene a la vez tabla y gráfico`);
    if (v.table && v.kind !== "table") issues.push(`El elemento ${v.id} tiene datos de tabla pero es de tipo ${v.kind}`);
    if (v.chart && v.kind !== "chart") issues.push(`El elemento ${v.id} tiene datos de gráfico pero es de tipo ${v.kind}`);
    if (v.chart && v.chart.series.some((s) => s.values.length !== v.chart!.categories.length)) issues.push(`El gráfico ${v.id} tiene series con distinto número de valores que de categorías`);
  }
  for (const p of a.protected_elements) {
    check(p.activity_ids, ids.act, "protected_elements.activity_ids");
    check(p.resource_ids, ids.resource, "protected_elements.resource_ids");
  }
  const anyId = new Set([...ids.act, ...ids.resource]);
  for (const u of a.uncertainties) check(u.target_ids, anyId, "uncertainties.target_ids");
  return issues;
}

export const MaterialAnalysisSchema = StoredSchemaBase.superRefine((analysis, ctx) => {
  for (const message of referenceIssues(analysis)) ctx.addIssue({ code: "custom", message });
});

export type MaterialAnalysis = z.infer<typeof MaterialAnalysisSchema>;
export type AnalysisActivity = MaterialAnalysis["activities"][number];
export type AnalysisVisual = MaterialAnalysis["visuals"][number];
export type AnalysisText = MaterialAnalysis["texts"][number];
export type AnalysisProtected = MaterialAnalysis["protected_elements"][number];
export type AnalysisUncertainty = MaterialAnalysis["uncertainties"][number];

/** Provenance of a stored analysis. Never contains material content. Shared by every schema version. */
export const AnalysisMetaSchema = z.object({
  schema_version: z.union([z.literal(2), z.literal(3)]),
  prompt_key: z.string(),
  prompt_version: z.number().int().positive(),
  source: z.enum(["model", "reused"]),
  /** True when no model was called because an earlier analysis of the same file was reused. */
  cache_hit: z.boolean().default(false),
  /** True when the teacher explicitly asked to ignore the cache ("Volver a analizar"). */
  forced_reanalysis: z.boolean().default(false),
  model_alias: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.string(),
  analyzed_at: z.string(),
  attempts: z.number().int().min(0),
  /** Sum of the runs' estimated cost; null when any run had no known price (never a made-up 0). */
  cost_usd: z.number().nonnegative().nullable(),
  warnings: z.array(z.string().max(120)).max(40),
  reused_from_material_id: z.uuid().nullable(),
});
export type AnalysisMeta = z.infer<typeof AnalysisMetaSchema>;
