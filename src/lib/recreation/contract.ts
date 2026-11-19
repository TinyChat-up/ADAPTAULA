import { z } from "zod";
import { DimensionKeySchema } from "@/lib/schemas/functional-profile";

/**
 * recreation_plan@v1: the contract of the pedagogical recreation engine (ADR-049, docs/RECREATION.md). The original sheet is a SOURCE
 * of content, objectives and cognitive demand, not a layout to keep: the plan designs new activities and the server builds, verifies
 * and prints them. Seven parts, kept apart so each can be checked on its own:
 *
 *   scope       objectives and authorised level        → `objectives`, `scope`
 *   operations  cognitive operations each objective evaluates
 *   strategies  methodological strategies, tied to the profile's needs
 *   activities  new activities, each traced to objectives, operations and strategies
 *   executors   response format + how its solution is obtained (deterministic when it can be)
 *   materials   visual resources and printable manipulatives
 *   guide       indications for the teacher
 *
 * What a model may write is only this plan. It never writes a solution that the server can compute: closed answers are derived by
 * the executors from FACTS quoted from the original (`facts[].quote`, checked word for word), never trusted because a model said so.
 * Plain text everywhere (no markup); the original's words arrive as untrusted data and stay data.
 */

export const RECREATION_CONTRACT = "recreation_plan@v1";

const Text = (max: number) =>
  z.string().trim().min(1).max(max).refine((t) => !/[<>{}`]/.test(t), { message: "Texto sin marcas" });
const Id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9]{1,3}$`));
const SourceRef = z.string().regex(/^(ctt|vis|act)_[0-9]{1,4}$/);
const ObjectiveRef = z.string().regex(/^obj_[0-9]{1,4}$/);

/** What the student has to DO with the content. The engine keeps these per objective (methodological scope never removes one). */
export const COGNITIVE_OPERATIONS = ["identify", "locate_evidence", "classify", "sequence", "interpret_relation", "predict", "calculate", "evaluate_claim", "justify", "propose"] as const;
export type CognitiveOperation = (typeof COGNITIVE_OPERATIONS)[number];
export const CognitiveOperationSchema = z.enum(COGNITIVE_OPERATIONS);

/** Methodologies of this first delivery. A strategy is a way of working, never a reduction of what is evaluated. */
export const METHODS = ["selection_response", "guided_sequence", "segmented_reading", "visual_organizer", "sentence_frames", "manipulative_sorting", "worked_contrast"] as const;
export type Method = (typeof METHODS)[number];

/** Scope of THIS sheet. `curricular` exists in the contract but the pilot refuses it without a per-sheet authorisation (verify.ts). */
export const RecreationScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("accessibility") }),
  z.object({ type: z.literal("methodological") }),
  z.object({ type: z.literal("curricular"), authorized_objective_ids: z.array(ObjectiveRef).min(1).max(8) }),
]);
export type RecreationScope = z.infer<typeof RecreationScopeSchema>;

/**
 * A piece of content taken from the original, with its words. `quote` must appear in the cited source (normalised); a fact that is
 * not found there is rejected, so nothing an activity relies on is invented. Kinds carry what the executors need.
 */
export const FactSchema = z.discriminatedUnion("kind", [
  /** «Las algas son seres vivos»: an item belongs to a category of a classification. */
  z.object({ id: Id("f"), kind: z.literal("membership"), source_ref: SourceRef, quote: Text(300), item: Text(60), category_id: Id("cat") }),
  /** Something that happens: its position in the original's text gives the order of a sequence. */
  z.object({ id: Id("f"), kind: z.literal("event"), source_ref: SourceRef, quote: Text(300), label: Text(120) }),
  /**
   * A number with its unit, read from the original. The quote must carry that very number followed by that unit and no other number;
   * otherwise the server cannot tell which figure is meant and nothing computed from it is «verified».
   */
  z.object({ id: Id("f"), kind: z.literal("quantity"), source_ref: SourceRef, quote: Text(300), value: z.number().finite(), unit: Text(20), label: Text(80) }),
  /** A statement of the original that supports (or contradicts) an option or a true/false item. */
  z.object({ id: Id("f"), kind: z.literal("statement"), source_ref: SourceRef, quote: Text(300) }),
]);
export type Fact = z.infer<typeof FactSchema>;

const Category = z.object({ id: Id("cat"), label: Text(40) });

/** What a requested picture is FOR in the activity. Decoration is not a function. */
export const VISUAL_FUNCTIONS = ["context", "observation", "vocabulary", "process", "comparison"] as const;

export const VisualRequestSchema = z.object({
  id: Id("vr"),
  /** The activities that use it (it prints right before the first one) and the objectives they work. */
  activity_ids: z.array(Id("ra")).min(1).max(3),
  objective_ids: z.array(ObjectiveRef).min(1).max(3),
  function: z.enum(VISUAL_FUNCTIONS),
  purpose: Text(200),
  concepts: z.array(Text(60)).min(1).max(6),
  /** What must be recognisable in it (no text, numbers or arrows: those are placed by the renderer). */
  must_show: z.array(Text(60)).min(1).max(8),
  /** What must not appear: answers, hints, misleading details. The server always adds text, numbers, labels and arrows. */
  prohibited: z.array(Text(120)).min(1).max(8),
  /** Whether the activity depends on exact labels, arrows (relations) or numbers in the picture: then only code may draw it. */
  needs_exact: z.object({ labels: z.boolean(), arrows: z.boolean(), numbers: z.boolean() }),
  style: z.enum(["realistic_drawing", "simple_illustration", "schematic"]),
  detail: z.enum(["minimal", "simple", "moderate"]),
  alt_text: Text(300),
  /** Accessibility notes for the drawing (contrast, size of the parts, nothing understood only by colour). */
  accessibility: Text(200),
  /** An original picture that already serves (option A), when there is one. */
  original_ref: z.string().regex(/^vis_[0-9]{1,4}$/).nullable(),
  /** Without it the activity cannot be done: its absence is reported, never hidden. */
  essential: z.boolean(),
  /**
   * The cut-out cards this request illustrates (a `cut_out_cards` material): one picture PER CARD, each showing that card's item,
   * all in the material's style. The card's name is printed by the renderer under its picture, never drawn by the image model.
   */
  for_cards: Id("rm").nullable(),
});
export type VisualRequest = z.infer<typeof VisualRequestSchema>;

/**
 * Executors: the response format and how its solution is obtained.
 *  · compute — DETERMINISTIC when its quantities are unambiguous: the server does the arithmetic.
 *  · sequence — DETERMINISTIC only for the order IN THE TEXT, or for a temporal/causal order whose every step is stated by a connector
 *    of the text (`links`). Order of appearance alone never proves what happened first or what caused what.
 *  · classify, select, true_false — ANCHORED: every item or claimed answer cites a fact and the format is unique by construction;
 *    whether the claim is RIGHT (which group, which option) is not checked by the server: the teacher reviews it.
 *  · short_answer — OPEN: criteria for the teacher, never a model answer presented as the solution.
 */
export const ExecutorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("classify"), categories: z.array(Category).min(2).max(4), item_fact_ids: z.array(Id("f")).min(3).max(10) }),
  z.object({
    kind: z.literal("sequence"),
    /** What the order means: where the events are told (`text_order`), when they happen (`temporal`) or what causes what (`causal`). */
    basis: z.enum(["text_order", "temporal", "causal"]),
    event_fact_ids: z.array(Id("f")).min(3).max(8),
    /** For `temporal`/`causal`: the statement of the text that says each event comes before (or causes) the next. */
    links: z.array(z.object({ from_fact_id: Id("f"), to_fact_id: Id("f"), evidence_fact_id: Id("f") })).max(7),
  }),
  z.object({ kind: z.literal("compute"), operation: z.literal("difference"), minuend_fact_id: Id("f"), subtrahend_fact_id: Id("f") }),
  z.object({
    kind: z.literal("select"),
    /** How many options are correct; the prompt must say it when it is more than one. */
    correct_count: z.number().int().min(1).max(3),
    options: z.array(z.object({ text: Text(140), correct: z.boolean(), evidence_fact_id: Id("f").nullable() })).min(3).max(6),
  }),
  z.object({ kind: z.literal("true_false"), statements: z.array(z.object({ text: Text(160), value: z.boolean(), evidence_fact_id: Id("f") })).min(2).max(6) }),
  z.object({
    kind: z.literal("short_answer"),
    lines: z.number().int().min(1).max(4),
    // Without a final «…»: the renderer prints one after every starter.
    starters: z.array(Text(80).refine((t) => !/(…|\.\.\.)$/.test(t), { message: "Sin puntos suspensivos finales" })).max(3), criteria: z.array(Text(160)).min(1).max(4),
  }),
]);
export type Executor = z.infer<typeof ExecutorSchema>;

export const RecreationPlanSchema = z.object({
  contract: z.literal(RECREATION_CONTRACT),
  scope: RecreationScopeSchema,
  title: Text(120),
  /** Objectives of the ORIGINAL (by id) and what each evaluates. `level: kept` is the only level outside a curricular authorisation. */
  objectives: z.array(z.object({ objective_id: ObjectiveRef, level: z.enum(["kept", "adjusted"]), operations: z.array(CognitiveOperationSchema).min(1).max(6) })).min(1).max(8),
  /** How the reading is presented: the original's own paragraphs, split in labelled parts (never rewritten in this delivery). */
  reading: z.object({ source_ref: z.string().regex(/^ctt_[0-9]{1,4}$/), part_titles: z.array(Text(60)).min(1).max(6) }).nullable(),
  facts: z.array(FactSchema).max(40),
  strategies: z.array(z.object({ id: Id("st"), method: z.enum(METHODS), needs: z.array(DimensionKeySchema).min(1).max(4), rationale: Text(200) })).min(1).max(8),
  activities: z
    .array(
      z.object({
        id: Id("ra"),
        objective_ids: z.array(ObjectiveRef).min(1).max(3),
        operations: z.array(CognitiveOperationSchema).min(1).max(3),
        strategy_ids: z.array(Id("st")).max(3),
        prompt: Text(300),
        /** Short steps shown with the prompt (instruction chunking). Never the answer. */
        steps: z.array(Text(90)).max(4),
        visual_ids: z.array(Id("rv")).max(2),
        executor: ExecutorSchema,
      }),
    )
    .min(1)
    .max(12),
  /** Visual resources drawn by our own renderer from data (no image model). `flow`: labelled boxes joined by arrows, from the original. */
  visuals: z.array(z.object({ id: Id("rv"), kind: z.literal("flow"), title: Text(60), items: z.array(Text(40)).min(2).max(6), source_ref: z.string().regex(/^vis_[0-9]{1,4}$/) })).max(4),
  /**
   * Pictures the planner ASKS for. It never decides how they are made: the server reuses a valid original (A), draws an exact scheme
   * with code (B) or, only when nothing exact is needed and generation is authorised, asks the illustration pipeline (C). Text,
   * arrows, numbers and labels are never asked of an image model: `needs_exact` sends them to code or to nothing.
   */
  // Up to 5 (ADR-054: comparisons need one scene per situation); the cap on generated pictures stays `RECREATION_VISUAL_LIMITS`.
  visual_requests: z.array(VisualRequestSchema).max(5),
  /**
   * One illustration style for the whole material (consistency between pictures): drawing technique, palette, level of detail.
   * Never text inside the pictures. Sent to every illustration brief of this material.
   */
  visual_style: Text(200),
  /**
   * Printable manipulatives, each tied to ONE activity: cards to cut out, and a board with one column per group to sort them on.
   * Nothing on a card or board says where an item goes: the board's columns are the groups the activity already names.
   */
  materials: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ id: Id("rm"), kind: z.literal("cut_out_cards"), activity_id: Id("ra"), purpose: Text(160), instructions: Text(120), cards: z.array(Text(40)).min(2).max(12) }),
        z.object({ id: Id("rm"), kind: z.literal("sorting_board"), activity_id: Id("ra"), purpose: Text(160), instructions: Text(120), columns: z.array(Text(30)).min(2).max(4) }),
      ]),
    )
    .max(4),
  /**
   * What the teacher reads on screen, written in plain language in the same call (no second call): what was adapted, why (each reason
   * tied to the context's functional needs, never a diagnosis or a label), and how to use the materials step by step. It never
   * contains an answer: the server checks it like any student-facing text.
   */
  explanation: z.object({
    adapted: z.array(Text(260)).min(2).max(4),
    why: z.array(z.object({ text: Text(260), needs: z.array(DimensionKeySchema).min(1).max(4) })).min(1).max(4),
    how_to_use: z.array(Text(180)).min(3).max(6),
  }),
  /** What to watch in each activity while the student works (one short sentence each; shown with «Cómo utilizar»). */
  guide: z.object({ per_activity: z.array(z.object({ activity_id: Id("ra"), observe: Text(200) })).max(12) }),
});
export type RecreationPlan = z.infer<typeof RecreationPlanSchema>;
export type RecreationActivity = RecreationPlan["activities"][number];
