import { z } from "zod";
import { PresentationSchema } from "./adaptation-context";
import { ADMIN_FIELD_TYPES, CHART_TYPES } from "./material-analysis";
import { ComparisonSpecSchema, VisualSpecSchema } from "@/lib/visuals/spec";

/**
 * MaterialDocument v1: the adapted sheet as semantic blocks, rendered by our own components with any template and printed
 * without calling the AI again (ADR-008, ADR-020). No HTML, CSS or coordinates: presentation is a handful of semantic
 * settings, layout belongs to the renderer.
 *
 * Replaces the Fase 0 draft of the same name, which was never produced or persisted by any code path. Three rules:
 * - Student content and the answer key are separate. No student-facing block carries a solution; closed formats keep their
 *   correct options in `answer_key`, which is never rendered for the student.
 * - Every block is traceable: `trace.source_refs` (ids of the MaterialAnalysis) and `trace.decision_ids` (ids of the
 *   AdaptationPlan). Text is never an identity.
 * - Block ids are server-assigned (`blk_…`); the model's local ids are re-keyed by `finalizeDocument`.
 */

export const MATERIAL_DOCUMENT_SCHEMA_VERSION = 1;

const Text = (max: number) => z.string().trim().min(1).max(max);
const ShortText = Text(300);
/** Inline text with a restricted markup subset (`**bold**`, `_italic_`) parsed by our renderer, never as HTML. */
const RichText = Text(3000);
const ItemId = z.string().trim().min(1).max(40);

export const BlockIdSchema = z.string().regex(/^blk_[a-z0-9]{4,24}$/, "Identificador de bloque no válido");
const DraftBlockIdSchema = z.string().trim().min(1).max(40);
export const SourceRefSchema = z.string().regex(/^(obj|sec|ctt|vis|act|prt)_[0-9]{1,4}$/, "Referencia al original no válida");

/** original: copied from the material · adapted: transformed by a decision · support/extension: added by a decision · structure: layout (headings, page titles). */
export const BLOCK_ORIGINS = ["original", "adapted", "support", "extension", "structure"] as const;

export const TraceSchema = z.object({
  origin: z.enum(BLOCK_ORIGINS),
  source_refs: z.array(SourceRefSchema).max(12),
  decision_ids: z.array(z.string().regex(/^dec_[0-9]{1,4}$/)).max(6),
  teacher_edited: z.boolean().optional(),
});
export type Trace = z.infer<typeof TraceSchema>;

const Choice = z.object({ id: ItemId, text: ShortText });

export const RESPONSE_KINDS = ["lines", "box", "grid", "table_cells", "choice", "fill_blank", "match", "order", "true_false", "oral_or_alternative", "none", "comparison", "fields", "sequence"] as const;
export const CLOSED_RESPONSE_KINDS = ["choice", "fill_blank", "match", "order", "true_false"] as const;

// The variants before and after `grid`, which the stored contract widens: split so the published order stays the same.
const WRITING_VARIANTS = [
  z.object({ kind: z.literal("lines"), lines: z.number().int().min(1).max(40) }),
  z.object({ kind: z.literal("box"), size: z.enum(["small", "medium", "large"]) }),
] as const;
const OTHER_VARIANTS = [
  z.object({ kind: z.literal("table_cells") }),
  z.object({ kind: z.literal("choice"), options: z.array(Choice).min(2).max(8), multiple: z.boolean() }),
  // `text` marks blanks as `{{key}}`; the answers live in `answer_key`.
  z.object({ kind: z.literal("fill_blank"), text: RichText, word_bank: z.array(ShortText).max(20).optional() }),
  z.object({ kind: z.literal("match"), left: z.array(Choice).min(2).max(10), right: z.array(Choice).min(2).max(10) }),
  z.object({ kind: z.literal("order"), items: z.array(Choice).min(2).max(12) }),
  z.object({ kind: z.literal("true_false"), statements: z.array(Choice).min(1).max(12) }),
  z.object({ kind: z.literal("oral_or_alternative"), mode: z.enum(["oral", "keyboard", "other"]), lines: z.number().int().min(0).max(40) }),
  z.object({ kind: z.literal("none") }),
] as const;
const RESPONSE_VARIANTS = [...WRITING_VARIANTS, z.object({ kind: z.literal("grid") }), ...OTHER_VARIANTS] as const;
/** What a model may write (generator, block revision): the published contracts, unchanged. */
const ResponseSchema = z.discriminatedUnion("kind", RESPONSE_VARIANTS);
/**
 * What a stored document may hold: also the answer areas only the server builds from the original's printed words. `comparison`:
 * one EMPTY box between the two numbers of each item («2/3 ☐ 3/5»), drawn by our own renderer; the sign is never stored.
 */
const StoredResponseSchema = z.discriminatedUnion("kind", [
  ...WRITING_VARIANTS,
  /**
   * A squared area to calculate in. `rows`: its height in squares, set by the server's answer-space rules (answer_space@v1) from what
   * the activity asks for; the square's size is the sheet's (tokens), never stored. Absent (documents before v1, what a model writes):
   * the renderer's default height.
   */
  z.object({ kind: z.literal("grid"), rows: z.number().int().min(3).max(30).optional() }),
  ...OTHER_VARIANTS,
  z.object({ kind: z.literal("comparison"), spec: ComparisonSpecSchema }),
  /**
   * The labelled answer fields the original prints («Sujeto:» / «Predicado:», «Operaciones y unidades:» / «Respuesta:»): each label
   * with its own space (lines, or a box to calculate in). Built by the server from the original's words, never by a model.
   */
  z.object({
    kind: z.literal("fields"),
    // `grid` (answer_space@v1): a squared area under the label, `lines` = its rows of squares. `unit`: an empty slot for the unit
    // next to the answer (never the unit itself: it may be what the activity evaluates).
    fields: z.array(z.object({ label: Text(60), space: z.enum(["lines", "box", "grid"]), lines: z.number().int().min(1).max(30), unit: z.boolean().optional() })).min(1).max(12),
  }),
  /** The items of an ordering task in their PRINTED order, one empty box each for the number: the order is the student's work. */
  z.object({ kind: z.literal("sequence"), items: z.array(ShortText).min(2).max(12) }),
]);
export type ResponseSpec = z.infer<typeof StoredResponseSchema>;

const IMAGE_SOURCE_VARIANTS = [
  /** A visual of the original material, reused as it is. */
  z.object({ kind: z.literal("original"), visual_ref: z.string().regex(/^vis_[0-9]{1,4}$/) }),
  /**
   * A visual a plan decision asks for that the original does not have. Nothing draws it: the teacher provides it (an image of
   * theirs, later an authorised catalogue) or decides explicitly to go on without it (docs/VISUAL_RESOURCES.md). `purpose` is
   * for the teacher, never the student's text alternative. `essential` (absent = false): the printed sheet waits for it.
   */
  z.object({
    kind: z.literal("requested"),
    decision_id: z.string().regex(/^dec_[0-9]{1,4}$/),
    purpose: ShortText,
    style: z.enum(["diagram", "chart", "icon", "photo_like", "illustration"]),
    essential: z.boolean().optional(),
  }),
] as const;
const ImageSourceSchema = z.discriminatedUnion("kind", IMAGE_SOURCE_VARIANTS);
/**
 * Only the server writes this one («Hacer magia», docs/VISUAL_RESOURCES.md § Política visual): a figure drawn by our own renderer
 * from verified data — the reconstruction of an original visual (`visual_ref`) or a new support for a decision (`decision_id`).
 */
const StoredImageSourceSchema = z.discriminatedUnion("kind", [
  ...IMAGE_SOURCE_VARIANTS,
  z.object({
    kind: z.literal("figure"),
    spec: VisualSpecSchema,
    provenance: z.enum(["reconstruction", "generated"]),
    visual_ref: z.string().regex(/^vis_[0-9]{1,4}$/).optional(),
    decision_id: z.string().regex(/^dec_[0-9]{1,4}$/).optional(),
  }),
  /**
   * A NEW educational illustration made by an image model for «Hacer magia» and approved by a review before it was stored
   * (docs/VISUAL_RESOURCES.md § Ilustraciones generadas): a private PNG of the workspace (`generated_assets`), pinned by its
   * sha-256. Never an exact representation (those are `figure`). It stands for an original visual (`visual_ref`), a support a
   * decision asked for (`decision_id`), or the picture an activity refers to that the analysis could not find (`activity_ref`).
   * The document stays semantic: the picture's size is read from its row when it is shown, never stored here.
   */
  z.object({
    kind: z.literal("generated"),
    asset_id: z.string().uuid(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    visual_ref: z.string().regex(/^vis_[0-9]{1,4}$/).optional(),
    decision_id: z.string().regex(/^dec_[0-9]{1,4}$/).optional(),
    activity_ref: z.string().regex(/^act_[0-9]{1,4}$/).optional(),
  }),
]);

type Variant = { response: typeof ResponseSchema | typeof StoredResponseSchema; image: typeof ImageSourceSchema | typeof StoredImageSourceSchema };
const STORED: Variant = { response: StoredResponseSchema, image: StoredImageSourceSchema };
const DRAFT: Variant = { response: ResponseSchema, image: ImageSourceSchema };

function buildBlockSchema(idSchema: z.ZodString, variant: Variant) {
  const block = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
    z.object({ id: idSchema, type: z.literal(type), trace: TraceSchema, ...shape });

  return z.discriminatedUnion("type", [
    block("heading", { level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: ShortText }),
    block("paragraph", { text: RichText }),
    /** `literal: true` means the paragraphs are the original words: a protected source text may be segmented, never rewritten. */
    block("reading_text", {
      title: ShortText.optional(),
      paragraphs: z.array(RichText).min(1).max(60),
      literal: z.boolean(),
      segment_labels: z.array(ShortText).max(60).optional(),
    }),
    block("instruction", { text: RichText, steps: z.array(ShortText).max(10).optional() }),
    block("activity", {
      label: Text(20).optional(),
      prompt: RichText,
      steps: z.array(ShortText).max(10).optional(),
      /** Requirements the student must see (extension, number of data, conditions). Never the answer. */
      requirements: z.array(ShortText).max(8).optional(),
      resource_block_ids: z.array(idSchema).max(8).optional(),
      response: variant.response,
    }),
    block("list", { style: z.enum(["bullet", "numbered"]), items: z.array(ShortText).min(1).max(20) }),
    block("table", {
      caption: ShortText.optional(),
      headers: z.array(z.string().max(120)).min(1).max(12),
      rows: z.array(z.array(z.string().max(300)).max(12)).min(1).max(40),
      unit: Text(40).optional(),
    }),
    /** Series labels are null unless verified: the analysis may have inferred them (docs/AI_PIPELINE.md). */
    block("chart", {
      title: ShortText.optional(),
      chart_type: z.enum(CHART_TYPES),
      categories: z.array(z.string().max(80)).min(1).max(30),
      series: z.array(z.object({ label: Text(80).nullable(), values: z.array(z.number()).min(1).max(30) })).min(1).max(6),
      unit: Text(40).optional(),
      x_label: Text(80).optional(),
      y_label: Text(80).optional(),
    }),
    block("image", { source: variant.image, alt_text: ShortText, caption: ShortText.optional() }),
    block("help_box", { variant: z.enum(["key_idea", "reminder", "tip", "strategy"]), title: ShortText.optional(), text: RichText }),
    block("checklist", { title: ShortText.optional(), items: z.array(ShortText).min(1).max(12) }),
    block("vocabulary", { title: ShortText.optional(), items: z.array(z.object({ term: Text(80), definition: ShortText })).min(1).max(20) }),
    /** Always analogous to the task (different data): an example on the task's own data would be its answer. */
    block("worked_example", {
      title: ShortText.optional(),
      problem: RichText,
      steps: z.array(ShortText).min(1).max(12),
      result: ShortText,
    }),
    block("sentence_starters", { items: z.array(Text(80)).min(1).max(8) }),
    block("planner", { title: ShortText.optional(), slots: z.array(z.object({ label: Text(80), lines: z.number().int().min(1).max(12) })).min(1).max(8) }),
    block("math", { latex: Text(1000), display: z.enum(["inline", "block"]), spoken_text: ShortText }),
  ]);
}

export const BlockSchema = buildBlockSchema(BlockIdSchema, STORED);
export const DraftBlockSchema = buildBlockSchema(DraftBlockIdSchema, DRAFT);
export type Block = z.infer<typeof BlockSchema>;
export type DraftBlock = z.infer<typeof DraftBlockSchema>;
export type BlockType = Block["type"];

const AnswerKeyEntrySchema = (idSchema: z.ZodString) =>
  z.object({
    block_id: idSchema,
    /** source: stated in the original sheet · new_item: an item created by the adaptation (e.g. options of a new choice). Inferred answers never get here. */
    basis: z.enum(["source", "new_item"]),
    value: Text(500).optional(),
    correct_option_ids: z.array(ItemId).max(8).optional(),
    blanks: z.array(z.object({ key: ItemId, answer: ShortText })).max(20).optional(),
  });

function buildDocumentSchema(idSchema: z.ZodString, variant: Variant) {
  const blockSchema = buildBlockSchema(idSchema, variant);
  return z
    .object({
      schema_version: z.literal(MATERIAL_DOCUMENT_SCHEMA_VERSION),
      meta: z.object({
        title: ShortText,
        language: z.string().regex(/^[a-z]{2}$/),
        stage: z.string().max(40),
        grade: z.string().max(40).nullable(),
        subject: z.string().max(80).nullable(),
        topic: z.string().max(200).nullable(),
      }),
      presentation: PresentationSchema,
      /** Field labels only (name, date…). Never a value: the sheet is filled in by hand. */
      admin_fields: z.array(z.object({ type: z.enum(ADMIN_FIELD_TYPES), label: Text(60) })).max(10),
      /** Logical pages (the renderer may still split them); never absolute positions. */
      pages: z.array(z.object({ blocks: z.array(blockSchema).min(1).max(120) })).min(1).max(30),
      answer_key: z.array(AnswerKeyEntrySchema(idSchema)).max(150),
      teacher_notes: z.string().max(2000).optional(),
    })
    .superRefine((doc, ctx) => {
      const blocks = doc.pages.flatMap((p) => p.blocks);
      const ids = new Set(blocks.map((b) => b.id));
      if (ids.size !== blocks.length) ctx.addIssue({ code: "custom", path: ["pages"], message: "Hay identificadores de bloque duplicados" });
      for (const b of blocks) {
        for (const message of blockConsistencyIssues(b)) ctx.addIssue({ code: "custom", path: ["pages"], message: `${b.id}: ${message}` });
        if (b.type === "activity") {
          for (const ref of b.resource_block_ids ?? []) if (!ids.has(ref)) ctx.addIssue({ code: "custom", path: ["pages"], message: `${b.id} usa un recurso inexistente: ${ref}` });
        }
      }
      for (const entry of doc.answer_key) {
        const target = blocks.find((b) => b.id === entry.block_id);
        if (!target || target.type !== "activity") ctx.addIssue({ code: "custom", path: ["answer_key"], message: `La clave apunta a un bloque que no es una actividad: ${entry.block_id}` });
        else if (entry.correct_option_ids && target.response.kind === "choice") {
          const options = new Set(target.response.options.map((o) => o.id));
          for (const id of entry.correct_option_ids) if (!options.has(id)) ctx.addIssue({ code: "custom", path: ["answer_key"], message: `Opción correcta inexistente: ${id}` });
        }
      }
    });
}

/** Stored, renderable document: the single source of truth for screen, editor and print. */
export const MaterialDocumentSchema = buildDocumentSchema(BlockIdSchema, STORED);
export const DraftMaterialDocumentSchema = buildDocumentSchema(DraftBlockIdSchema, DRAFT);
export type MaterialDocument = z.infer<typeof MaterialDocumentSchema>;
export type DraftMaterialDocument = z.infer<typeof DraftMaterialDocumentSchema>;

/** Cross-field rules a JSON Schema cannot express; reused by the deterministic review. */
export function blockConsistencyIssues(b: Block | DraftBlock): string[] {
  const issues: string[] = [];
  if (b.type === "table" && b.rows.some((r) => r.length !== b.headers.length)) issues.push("Todas las filas deben tener tantas celdas como cabeceras");
  if (b.type === "chart" && b.series.some((s) => s.values.length !== b.categories.length)) issues.push("Cada serie necesita un valor por categoría");
  if (b.type === "reading_text" && b.segment_labels && b.segment_labels.length > b.paragraphs.length) issues.push("Hay más etiquetas de segmento que párrafos");
  if (b.type === "activity" && b.response.kind === "match") {
    const ids = [...b.response.left, ...b.response.right].map((c) => c.id);
    if (new Set(ids).size !== ids.length) issues.push("Las opciones de relacionar repiten identificador");
  }
  if (b.type === "activity" && b.response.kind === "choice" && new Set(b.response.options.map((o) => o.id)).size !== b.response.options.length) {
    issues.push("Las opciones repiten identificador");
  }
  return issues;
}

export function allBlocks(doc: Pick<MaterialDocument, "pages">): Block[] {
  return doc.pages.flatMap((p) => p.blocks);
}

export function createBlockId(): string {
  return `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Re-keys local block ids with server ids (also inside `resource_block_ids` and the answer key) and re-validates strictly. */
export function finalizeDocument(draft: DraftMaterialDocument, newBlockId: () => string = createBlockId): MaterialDocument {
  const ids = new Map<string, string>();
  for (const b of draft.pages.flatMap((p) => p.blocks)) ids.set(b.id, newBlockId());
  const rekey = (id: string) => ids.get(id) ?? id;
  return MaterialDocumentSchema.parse({
    ...draft,
    pages: draft.pages.map((p) => ({
      blocks: p.blocks.map((b) => (b.type === "activity" ? { ...b, id: rekey(b.id), resource_block_ids: b.resource_block_ids?.map(rekey) } : { ...b, id: rekey(b.id) })),
    })),
    answer_key: draft.answer_key.map((e) => ({ ...e, block_id: rekey(e.block_id) })),
  });
}
