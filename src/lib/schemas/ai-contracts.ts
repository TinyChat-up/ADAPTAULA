import { z } from "zod";
import { DraftBlockSchema } from "./material-document";

/**
 * Model-facing contracts of the adaptation pipeline that are not documents in their own right. The plan, the document and
 * the review have their own versioned modules (`adaptation-plan.ts`, `material-document.ts`, `pedagogical-review.ts`).
 */

export { ADAPTATION_TYPES, AdaptationTypeSchema, OBJECTIVES_MAY_CHANGE, type AdaptationType } from "./adaptation-type";

const Text = z.string().trim().min(1).max(1000);

/**
 * Step D — material_generator. The generator does NOT write the whole sheet: what is kept is copied deterministically from
 * the analysis (`adaptation/skeleton.ts`). It writes only the blocks of the targets that a decision changes or supports.
 */
export const GeneratedSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        target: z.string().regex(/^(act|ctt|vis|sec)_[0-9]{1,4}$|^document$/),
        decision_ids: z.array(z.string().regex(/^dec_[0-9]{1,4}$/)).min(1).max(6),
        blocks: z.array(DraftBlockSchema).min(1).max(20),
        /** Answers of NEW closed items the generator created (options, blanks). Never an answer of an original task. */
        new_item_answers: z
          .array(
            z.object({
              block_id: z.string().max(40),
              correct_option_ids: z.array(z.string().max(40)).max(8).optional(),
              blanks: z.array(z.object({ key: z.string().max(40), answer: z.string().max(300) })).max(20).optional(),
            }),
          )
          .max(20),
      }),
    )
    .max(80),
  /** 3-6 short points shown to the teacher as "¿Qué hemos adaptado?". */
  change_summary: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
});
export type GeneratedSegments = z.infer<typeof GeneratedSegmentsSchema>;

/**
 * What `material_generator` is actually asked to write (docs/ADAPTATION.md § Generador). Lean on purpose: no ids, no trace, no
 * answer areas, no resource links. The server fills them from the effective decision and from the original activity, and
 * only accepts the block types an approved decision authorises. `GeneratedSegmentsSchema` above is the assembled form.
 */
const GText = (max: number) => z.string().trim().min(1).max(max);
export const GeneratedBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activity"), label: GText(20).optional(), prompt: GText(3000), steps: z.array(GText(300)).max(10).optional(), requirements: z.array(GText(300)).max(8).optional() }),
  z.object({ type: z.literal("checklist"), title: GText(300).optional(), items: z.array(GText(300)).min(1).max(12) }),
  z.object({ type: z.literal("planner"), title: GText(300).optional(), slots: z.array(z.object({ label: GText(80), lines: z.number().int().min(1).max(12) })).min(1).max(8) }),
  z.object({ type: z.literal("help_box"), variant: z.enum(["key_idea", "reminder", "tip", "strategy"]), title: GText(300).optional(), text: GText(3000) }),
  z.object({ type: z.literal("list"), style: z.enum(["bullet", "numbered"]), items: z.array(GText(300)).min(1).max(20) }),
  z.object({ type: z.literal("vocabulary"), title: GText(300).optional(), items: z.array(z.object({ term: GText(80), definition: GText(300) })).min(1).max(20) }),
  z.object({ type: z.literal("worked_example"), title: GText(300).optional(), problem: GText(3000), steps: z.array(GText(300)).min(1).max(12), result: GText(300) }),
  z.object({ type: z.literal("sentence_starters"), items: z.array(GText(80)).min(1).max(8) }),
  z.object({ type: z.literal("paragraph"), text: GText(3000) }),
]);
export type GeneratedBlock = z.infer<typeof GeneratedBlockSchema>;

/** Why the generator declines to execute a decision. It never improvises another adaptation instead. */
export const GENERATION_BLOCK_REASONS = ["would_alter_protected_element", "would_reveal_answer", "outside_target", "needs_source_content", "unsupported"] as const;

export const DraftGeneratedSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        decision_id: z.string().regex(/^dec_[0-9]{1,4}$/),
        target: z.string().regex(/^(act|ctt|vis|sec)_[0-9]{1,4}$|^document$/),
        blocks: z.array(GeneratedBlockSchema).min(1).max(10),
      }),
    )
    .max(40),
  /** Decisions it could not execute without breaking a rule: a structured result, so the transformation can be blocked. */
  blocked: z.array(z.object({ decision_id: z.string().regex(/^dec_[0-9]{1,4}$/), reason: z.enum(GENERATION_BLOCK_REASONS), note: GText(160) })).max(20),
  /** 1-6 short points for the teacher ("¿Qué hemos adaptado?"). */
  change_summary: z.array(GText(160)).max(6),
});
export type DraftGeneratedSegments = z.infer<typeof DraftGeneratedSegmentsSchema>;

// block_reviser: one block in, the same block (same id and trace) out.
export const RevisedBlockSchema = z.object({ block: DraftBlockSchema });
export type RevisedBlock = z.infer<typeof RevisedBlockSchema>;

// image_brief (images are not implemented; kept as the contract a future visual request turns into)
export const ImageBriefSchema = z.object({
  pedagogical_purpose: Text,
  target_age: z.string().max(40),
  concept: Text,
  objects: z.array(z.string().max(120)).min(1).max(12),
  composition: Text,
  background: z.string().max(200),
  complexity: z.enum(["minimal", "simple", "moderate"]),
  labels: z.array(z.string().max(60)).max(12),
  prohibited_elements: z.array(z.string().max(120)).max(15),
  accessibility_notes: Text,
  alt_text: z.string().trim().min(1).max(300),
});
export type ImageBrief = z.infer<typeof ImageBriefSchema>;
