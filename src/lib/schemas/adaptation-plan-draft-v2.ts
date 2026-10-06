import { z } from "zod";
import {
  ADAPTATION_ACTIONS,
  IntensitySchema,
  ProtectedRefSchema,
  ResponseTargetSchema,
  ReviewFlagSchema,
  StrategyKeySchema,
  SupportKindSchema,
  TargetRefSchema,
  VISUAL_REQUEST_MODES,
} from "./adaptation-plan";

/**
 * DraftAdaptationPlan v2: what `adaptation_planner@v2` writes. The CANONICAL plan stays `AdaptationPlan v1`; only the form the
 * model writes changes, and the server turns one into the other (`adaptation/plan-v2.ts`):
 *  - the model never names a catalog dimension. It cites `need_refs` (`need_1`, `need_2`…), local references that the server
 *    assigns, in order, to the ACTIVE needs of the context it sends. The server resolves them to dimension keys, so a decision
 *    can only rest on a need the profile really has and the 69-key enum disappears from the schema the model sees;
 *  - `preserves`, `supports` and `flags` may be absent: absence means "none" and normalises to `[]`, so the model can no longer
 *    fail a whole answer by omitting an empty list. A WRONG value is still an error: nothing invalid is silenced;
 *  - `keep` does not exist: no adaptation needed means no decision.
 * `uses_task_data` stays, but only as auxiliary metadata of the model: it never makes a support safe by itself.
 */

export const DRAFT_PLAN_V2_VERSION = 2;

const Note = z.string().trim().min(1).max(160);
export const NeedRefSchema = z.string().regex(/^need_[0-9]{1,2}$/, "Referencia a una necesidad no válida");

export const ACTIONS_V2 = ADAPTATION_ACTIONS.filter((a) => a !== "keep") as Exclude<(typeof ADAPTATION_ACTIONS)[number], "keep">[];

const SupportRequestV2 = z.object({ kind: SupportKindSchema, uses_task_data: z.boolean() });

const VisualRequestV2 = z
  .object({
    mode: z.enum(VISUAL_REQUEST_MODES),
    source_visual: z.string().regex(/^vis_[0-9]{1,4}$/).nullable(),
    purpose: z.string().trim().min(1).max(120),
    essential: z.boolean(),
  })
  .refine((v) => (v.mode === "reuse_original" || v.mode === "transform_original" ? v.source_visual !== null : true), { message: "Reutilizar o transformar un visual exige indicar cuál" });

export const DraftDecisionV2Schema = z.object({
  target: TargetRefSchema,
  action: z.enum(ACTIONS_V2),
  strategies: z.array(StrategyKeySchema).min(1).max(3),
  need_refs: z.array(NeedRefSchema).min(1).max(4),
  intensity: IntensitySchema,
  preserves: z.array(ProtectedRefSchema).max(12).optional(),
  supports: z.array(SupportRequestV2).max(4).optional(),
  response_target: ResponseTargetSchema.optional(),
  visual: VisualRequestV2.optional(),
  flags: z.array(ReviewFlagSchema).max(4).optional(),
  note: Note.optional(),
});
export type DraftDecisionV2 = z.infer<typeof DraftDecisionV2Schema>;

export const DraftAdaptationPlanV2Schema = z.object({
  decisions: z.array(DraftDecisionV2Schema).max(30),
  /** 0-5 short points for the teacher. With no decisions, one line saying that no adaptation is needed. */
  summary: z.array(Note).max(5),
});
export type DraftAdaptationPlanV2 = z.infer<typeof DraftAdaptationPlanV2Schema>;
