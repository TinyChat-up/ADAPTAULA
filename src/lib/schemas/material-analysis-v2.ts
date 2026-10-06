import { z } from "zod";

/**
 * Structured understanding of an uploaded material. NOT an adaptation: it only describes what the
 * material contains, what it teaches and what must survive a future adaptation.
 *
 * Two schemas, same pattern as MaterialDocument (ADR-008):
 * - `MaterialAnalysisDraftSchema`: what the model is asked for. Deliberately flat and free of optional /
 *   nullable fields (unknown = "" or "unknown" or 0): providers limit schema complexity, and an
 *   unambiguous sentinel is easier for a model than `null` vs missing. Ids are local ("a1", "o2").
 * - `MaterialAnalysisSchema`: what we store. Ids are server-assigned and stable, unknown is `null`,
 *   references are checked, and the server adds `structure`.
 */

export const MATERIAL_ANALYSIS_SCHEMA_VERSION = 2;

/** FROZEN: the contract of analyses stored by `material_analyzer@v1` (schema v2). Never edited; the current contract is `material-analysis.ts` (v3). */

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
export const ANSWER_BASIS = ["stated_in_material", "inferred", "not_inferable"] as const;
export const CONTENT_KINDS = ["heading", "general_instruction", "reading_text", "example", "table", "formula", "definition", "note", "other"] as const;
export const VISUAL_KINDS = ["photo", "illustration", "diagram", "chart_or_graph", "map", "table_image", "scheme", "icon", "decorative_border", "logo", "other"] as const;
export const VISUAL_FUNCTIONS = ["required_for_task", "informative", "illustrative", "decorative"] as const;
export const PROTECTED_KINDS = [
  "scientific_vocabulary", "target_operation", "concept", "grammar_structure", "necessary_figure",
  "inference_question", "units_or_magnitudes", "formula", "other",
] as const;
export const UNCERTAINTY_KINDS = ["illegible", "cut_off", "ambiguous", "answer_not_inferable", "low_quality", "unsupported_content", "embedded_instructions", "other"] as const;
export const READABILITY = ["good", "partial", "poor"] as const;

const Confidence = z.number().min(0).max(1);
const Text = (max: number) => z.string().trim().min(1).max(max);
/** May be empty: "" means "not present / unknown". */
const MaybeText = (max: number) => z.string().trim().max(max);
const Page = z.number().int().min(1).max(500);

// ---------------------------------------------------------------------------
// Draft (model-facing)
// ---------------------------------------------------------------------------

const LocalId = z.string().trim().min(1).max(24);
const LocalRefs = (max: number) => z.array(LocalId).max(max);

const DraftDetected = <T extends z.ZodType>(value: T) => z.object({ value, confidence: Confidence });

export const MaterialAnalysisDraftSchema = z.object({
  identification: z.object({
    title: DraftDetected(MaybeText(200)).describe('Título de la ficha tal como aparece. "" si no tiene.'),
    stage: DraftDetected(z.enum([...STAGE_SLUGS, "unknown"])).describe('Etapa probable. "unknown" si no hay indicios suficientes.'),
    grade: DraftDetected(z.enum([...GRADE_SLUGS, "unknown"])).describe('Curso probable. "unknown" si no hay indicios suficientes.'),
    subject: DraftDetected(MaybeText(80)).describe('Asignatura, p. ej. "Matemáticas". "" si no se puede determinar.'),
    topic: DraftDetected(MaybeText(200)).describe('Tema concreto, p. ej. "Fracciones equivalentes". "" si no se puede determinar.'),
    language: DraftDetected(MaybeText(2)).describe('Idioma del material en ISO 639-1 (es, en, ca…). "" si no se sabe.'),
  }),
  pedagogical_intent: z.object({
    purpose: Text(500).describe("Qué pretende enseñar o evaluar la ficha, en una o dos frases."),
    learning_objectives: z
      .array(z.object({ id: LocalId, text: Text(300), confidence: Confidence }))
      .max(8)
      .describe("Objetivos de aprendizaje que se deducen del propio material. No inventes referencias curriculares oficiales."),
    knowledge_involved: z.array(Text(160)).max(20).describe("Conocimientos o competencias que se ponen en juego."),
    prerequisites: z.array(Text(200)).max(10).describe("Conocimientos previos que el alumno necesita."),
    difficulty: z.enum(DIFFICULTY),
    difficulty_rationale: Text(400),
    complexity: Confidence.describe("0 = muy sencillo, 1 = muy complejo (densidad, número de pasos, notación, páginas)."),
  }),
  sections: z
    .array(z.object({ id: LocalId, title: MaybeText(160), page_start: Page, page_end: Page, summary: Text(300) }))
    .max(40)
    .describe('Secciones del material en orden. title "" si la sección no tiene título.'),
  contents: z
    .array(
      z.object({
        id: LocalId,
        section_id: z.string().trim().max(24).describe('Id de la sección o "".'),
        page: Page,
        kind: z.enum(CONTENT_KINDS),
        text: Text(6000).describe("Transcripción fiel. Fórmulas en LaTeX sencillo. Para una tabla, un título o descripción breve."),
        table_headers: z.array(MaybeText(120)).max(12).describe("Cabeceras si kind es table; si no, []."),
        table_rows: z.array(z.array(MaybeText(300)).max(12)).max(40).describe("Filas si kind es table; si no, []. Celda vacía = espacio para rellenar."),
        legible: z.boolean().describe("false si no has podido leerlo con seguridad."),
      }),
    )
    .max(120)
    .describe("Contenido que NO es una actividad: títulos, instrucciones generales, textos, ejemplos, tablas, fórmulas, definiciones."),
  activities: z
    .array(
      z.object({
        id: LocalId,
        section_id: z.string().trim().max(24).describe('Id de la sección o "".'),
        page: Page,
        label: MaybeText(20).describe('Numeración visible ("3", "3.b"). "" si no hay.'),
        type: z.enum(ACTIVITY_TYPES),
        instruction: Text(1500).describe("Consigna tal como aparece."),
        content: Text(6000).describe("Enunciado completo y fiel: subapartados, opciones, datos. Nada resumido ni reescrito."),
        response_format: z.enum(RESPONSE_FORMATS),
        has_answer_space: z.boolean(),
        expected_answer: z.object({
          value: MaybeText(1000).describe('La respuesta esperable. "" si no puede determinarse.'),
          basis: z.enum(ANSWER_BASIS).describe("stated_in_material: figura en el material; inferred: la has deducido con confianza alta; not_inferable: no se puede saber."),
          confidence: Confidence,
        }),
        difficulty: z.enum(DIFFICULTY),
        knowledge_required: z.array(Text(160)).max(8),
        objective_ids: LocalRefs(8),
        visual_ids: LocalRefs(6).describe("Elementos visuales que la actividad usa."),
        confidence: Confidence.describe("Seguridad de haber extraído bien esta actividad."),
      }),
    )
    .max(150),
  visual_elements: z
    .array(
      z.object({
        id: LocalId,
        page: Page,
        kind: z.enum(VISUAL_KINDS),
        description: Text(500),
        pedagogical_function: z.enum(VISUAL_FUNCTIONS).describe(
          "required_for_task: hace falta para resolver; informative: aporta información pedagógica; illustrative: acompaña sin ser necesario; decorative: adorno sin valor pedagógico.",
        ),
        necessary_to_solve: z.boolean(),
        activity_ids: LocalRefs(10),
        text_in_image: MaybeText(1000).describe('Texto legible dentro del elemento, o "".'),
        confidence: Confidence,
      }),
    )
    .max(60),
  protected_elements: z
    .array(
      z.object({
        id: LocalId,
        kind: z.enum(PROTECTED_KINDS),
        description: Text(300),
        rationale: Text(400).describe("Por qué una adaptación posterior debe cuidar este elemento."),
        activity_ids: LocalRefs(10),
        visual_ids: LocalRefs(6),
        importance: z.enum(["essential", "important"]),
      }),
    )
    .max(40),
  uncertainties: z
    .array(
      z.object({
        id: LocalId,
        kind: z.enum(UNCERTAINTY_KINDS),
        page: z.number().int().min(0).max(500).describe("Página, o 0 si no aplica."),
        description: Text(400),
        activity_ids: LocalRefs(10),
        confidence: Confidence.describe("Tu confianza en lo que has entendido de esta parte."),
      }),
    )
    .max(40),
  quality: z.object({ overall_confidence: Confidence, readability: z.enum(READABILITY) }),
});

export type MaterialAnalysisDraft = z.infer<typeof MaterialAnalysisDraftSchema>;

// ---------------------------------------------------------------------------
// Stored (server-normalized)
// ---------------------------------------------------------------------------

export const ID_PREFIXES = { objective: "obj", section: "sec", content: "ctt", activity: "act", visual: "vis", protected: "prt", uncertainty: "unc" } as const;
const StoredId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9]{1,4}$`), "Identificador no válido");
const Refs = (prefix: string, max: number) => z.array(StoredId(prefix)).max(max);

const StoredDetected = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), confidence: Confidence });

const StoredSchemaBase = z.object({
  schema_version: z.literal(MATERIAL_ANALYSIS_SCHEMA_VERSION),
  identification: z.object({
    title: StoredDetected(Text(200)),
    stage: StoredDetected(z.enum(STAGE_SLUGS)),
    grade: StoredDetected(z.enum(GRADE_SLUGS)),
    subject: StoredDetected(Text(80)).extend({ slug: z.string().regex(/^[a-z0-9-]+$/).nullable() }),
    topic: StoredDetected(Text(200)),
    language: StoredDetected(z.string().regex(/^[a-z]{2}$/)),
  }),
  pedagogical_intent: z.object({
    purpose: Text(500),
    learning_objectives: z.array(z.object({ id: StoredId("obj"), text: Text(300), confidence: Confidence })).max(8),
    knowledge_involved: z.array(Text(160)).max(20),
    prerequisites: z.array(Text(200)).max(10),
    difficulty: z.enum(DIFFICULTY),
    difficulty_rationale: Text(400),
    complexity: Confidence,
  }),
  structure: z.object({
    page_count: z.number().int().min(1).max(500).nullable(),
    counts: z.object({
      sections: z.number().int().min(0),
      activities: z.number().int().min(0),
      examples: z.number().int().min(0),
      reading_texts: z.number().int().min(0),
      tables: z.number().int().min(0),
      formulas: z.number().int().min(0),
      figures: z.number().int().min(0),
      answer_spaces: z.number().int().min(0),
    }),
  }),
  sections: z.array(z.object({ id: StoredId("sec"), title: Text(160).nullable(), page_start: Page, page_end: Page, summary: Text(300) })).max(40),
  contents: z
    .array(
      z.object({
        id: StoredId("ctt"),
        section_id: StoredId("sec").nullable(),
        page: Page,
        kind: z.enum(CONTENT_KINDS),
        text: Text(6000),
        table: z.object({ headers: z.array(MaybeText(120)).max(12), rows: z.array(z.array(MaybeText(300)).max(12)).max(40) }).nullable(),
        legible: z.boolean(),
      }),
    )
    .max(120),
  activities: z
    .array(
      z.object({
        id: StoredId("act"),
        section_id: StoredId("sec").nullable(),
        page: Page,
        label: Text(20).nullable(),
        type: z.enum(ACTIVITY_TYPES),
        instruction: Text(1500),
        content: Text(6000),
        response_format: z.enum(RESPONSE_FORMATS),
        has_answer_space: z.boolean(),
        expected_answer: z.object({ value: Text(1000).nullable(), basis: z.enum(ANSWER_BASIS), confidence: Confidence }),
        difficulty: z.enum(DIFFICULTY),
        knowledge_required: z.array(Text(160)).max(8),
        objective_ids: Refs("obj", 8),
        visual_ids: Refs("vis", 6),
        confidence: Confidence,
      }),
    )
    .max(150),
  visual_elements: z
    .array(
      z.object({
        id: StoredId("vis"),
        page: Page,
        kind: z.enum(VISUAL_KINDS),
        description: Text(500),
        pedagogical_function: z.enum(VISUAL_FUNCTIONS),
        necessary_to_solve: z.boolean(),
        activity_ids: Refs("act", 10),
        text_in_image: Text(1000).nullable(),
        confidence: Confidence,
      }),
    )
    .max(60),
  protected_elements: z
    .array(
      z.object({
        id: StoredId("prt"),
        kind: z.enum(PROTECTED_KINDS),
        description: Text(300),
        rationale: Text(400),
        activity_ids: Refs("act", 10),
        visual_ids: Refs("vis", 6),
        importance: z.enum(["essential", "important"]),
      }),
    )
    .max(40),
  uncertainties: z
    .array(
      z.object({
        id: StoredId("unc"),
        kind: z.enum(UNCERTAINTY_KINDS),
        page: Page.nullable(),
        description: Text(400),
        activity_ids: Refs("act", 10),
        confidence: Confidence,
      }),
    )
    .max(40),
  quality: z.object({ overall_confidence: Confidence, readability: z.enum(READABILITY) }),
});

function referenceIssues(a: z.infer<typeof StoredSchemaBase>): string[] {
  const issues: string[] = [];
  const ids = {
    sec: new Set(a.sections.map((s) => s.id)),
    obj: new Set(a.pedagogical_intent.learning_objectives.map((o) => o.id)),
    act: new Set(a.activities.map((x) => x.id)),
    vis: new Set(a.visual_elements.map((v) => v.id)),
  };
  const check = (refs: readonly (string | null)[], set: Set<string>, where: string) => {
    for (const ref of refs) if (ref !== null && !set.has(ref)) issues.push(`${where} apunta a un id inexistente: ${ref}`);
  };
  const unique = (list: { id: string }[], where: string) => {
    if (new Set(list.map((x) => x.id)).size !== list.length) issues.push(`${where} tiene ids duplicados`);
  };
  unique(a.sections, "sections");
  unique(a.contents, "contents");
  unique(a.activities, "activities");
  unique(a.visual_elements, "visual_elements");
  unique(a.protected_elements, "protected_elements");
  unique(a.uncertainties, "uncertainties");
  unique(a.pedagogical_intent.learning_objectives, "learning_objectives");

  for (const c of a.contents) check([c.section_id], ids.sec, "contents.section_id");
  for (const x of a.activities) {
    check([x.section_id], ids.sec, "activities.section_id");
    check(x.objective_ids, ids.obj, "activities.objective_ids");
    check(x.visual_ids, ids.vis, "activities.visual_ids");
    if (x.expected_answer.basis === "not_inferable" && x.expected_answer.value !== null) {
      issues.push(`La actividad ${x.id} declara la respuesta como no deducible pero incluye un valor`);
    }
  }
  for (const v of a.visual_elements) {
    check(v.activity_ids, ids.act, "visual_elements.activity_ids");
    if (v.necessary_to_solve && v.pedagogical_function !== "required_for_task") {
      issues.push(`El elemento ${v.id} es necesario para resolver pero no figura como required_for_task`);
    }
  }
  for (const p of a.protected_elements) {
    check(p.activity_ids, ids.act, "protected_elements.activity_ids");
    check(p.visual_ids, ids.vis, "protected_elements.visual_ids");
  }
  for (const u of a.uncertainties) check(u.activity_ids, ids.act, "uncertainties.activity_ids");
  return issues;
}

export const MaterialAnalysisSchema = StoredSchemaBase.superRefine((analysis, ctx) => {
  for (const message of referenceIssues(analysis)) ctx.addIssue({ code: "custom", message });
});

export type MaterialAnalysisV2 = z.infer<typeof MaterialAnalysisSchema>;
export type AnalysisActivityV2 = MaterialAnalysisV2["activities"][number];
export type AnalysisVisualV2 = MaterialAnalysisV2["visual_elements"][number];
