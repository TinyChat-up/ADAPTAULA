import { z } from "zod";
import { GENERATION_BLOCK_REASONS } from "./ai-contracts";

/**
 * DraftGeneratedSegments v2: what `material_generator@v2` writes. v1 let the model write, per activity, a prompt, steps AND
 * requirements and then supports that repeated them (×3.3-×7.1 visible words in both real experiments). v2 removes the
 * overlap by construction:
 *   - no `prompt` and no `requirements`: the original instruction and its requirements are canonical and are kept by the
 *     server; the model only writes a `rewrite` when a long instruction really needs one (`lead` + `steps`, never both
 *     restating the whole thing);
 *   - supports are tagged with the SUPPORT KIND the decision authorises (no block-type table to translate), each with a
 *     single function and hard structural caps (few, short items);
 *   - a support that would only repeat something already visible is declined in `skipped` instead of written.
 * Ids, trace, answer areas, resources and original content never come from the model. v1 stays valid and readable.
 */

export const GENERATED_SEGMENTS_V2_VERSION = 2;

const T = (max: number) => z.string().trim().min(1).max(max);

export const SUPPORT_V2_KINDS = ["checklist", "planner", "reminder", "key_idea", "step_list", "guiding_questions", "glossary", "worked_example", "sentence_starters", "extension_task"] as const;
export type SupportV2Kind = (typeof SUPPORT_V2_KINDS)[number];

export const SupportV2Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("checklist"), title: T(60).optional(), items: z.array(T(90)).min(1).max(4) }),
  z.object({ kind: z.literal("planner"), title: T(60).optional(), slots: z.array(z.object({ label: T(36), lines: z.number().int().min(1).max(6) })).min(1).max(5) }),
  z.object({ kind: z.literal("reminder"), text: T(160) }),
  z.object({ kind: z.literal("key_idea"), text: T(160) }),
  z.object({ kind: z.literal("step_list"), items: z.array(T(70)).min(2).max(4) }),
  z.object({ kind: z.literal("guiding_questions"), items: z.array(T(90)).min(1).max(3) }),
  z.object({ kind: z.literal("glossary"), items: z.array(z.object({ term: T(60), definition: T(140) })).min(1).max(6) }),
  z.object({ kind: z.literal("worked_example"), problem: T(300), steps: z.array(T(120)).min(1).max(5), result: T(100) }),
  z.object({ kind: z.literal("sentence_starters"), items: z.array(T(50)).min(1).max(5) }),
  z.object({ kind: z.literal("extension_task"), text: T(200) }),
]);
export type SupportV2 = z.infer<typeof SupportV2Schema>;

/** Replaces the activity's instruction. `lead` is context or a neutral lead-in; `steps` are the actions, in order. */
export const RewriteV2Schema = z.object({ lead: T(160), steps: z.array(T(140)).min(2).max(5) });

export const SKIP_REASONS = ["already_visible", "no_new_function", "would_reveal_answer", "would_alter_protected_element", "unsupported"] as const;

export const DraftGeneratedSegmentsV2Schema = z.object({
  segments: z
    .array(
      z
        .object({
          decision_id: z.string().regex(/^dec_[0-9]{1,4}$/),
          target: z.string().regex(/^(act|ctt|vis|sec)_[0-9]{1,4}$|^document$/),
          rewrite: RewriteV2Schema.optional(),
          supports: z.array(SupportV2Schema).max(4),
        })
        .refine((s) => s.rewrite !== undefined || s.supports.length > 0, { message: "Un segmento necesita una reescritura o al menos un apoyo" }),
    )
    .max(40),
  /** A support the decision authorises that the model declines because it would add nothing (or break a rule). */
  skipped: z.array(z.object({ decision_id: z.string().regex(/^dec_[0-9]{1,4}$/), support: z.enum(SUPPORT_V2_KINDS), reason: z.enum(SKIP_REASONS) })).max(20),
  /** A whole decision it cannot execute without breaking a rule (same contract as v1). */
  blocked: z.array(z.object({ decision_id: z.string().regex(/^dec_[0-9]{1,4}$/), reason: z.enum(GENERATION_BLOCK_REASONS), note: T(160) })).max(20),
  change_summary: z.array(T(160)).max(5),
});
export type DraftGeneratedSegmentsV2 = z.infer<typeof DraftGeneratedSegmentsV2Schema>;
