import { z } from "zod";
import { AdaptationActionSchema, DecisionIdSchema, IntensitySchema, ResponseTargetSchema, StrategyKeySchema } from "./adaptation-plan";

/**
 * PlanReview v1: the teacher's (or an eval's) review of the planner's decisions. It is a layer on top of the raw plan, never
 * a rewrite of it: raw decision → validator result → review → effective decision → generated blocks stay distinguishable
 * (docs/ADAPTATION.md). Nothing is applied without an explicit approval; a blocked decision cannot be approved.
 */

export const PLAN_REVIEW_SCHEMA_VERSION = 1;

export const REVIEW_ACTIONS = ["approved", "rejected", "edited"] as const;

const SupportKindSchema = z.enum(["glossary", "key_idea", "reminder", "checklist", "planner", "sentence_starters", "worked_example", "guiding_questions", "step_list", "self_check", "visual_cue", "extension_task"]);

/** The fields a reviewer may change. `target`, `dimensions` and `preserves` are never editable: they tie the decision to the profile and to the protected elements. */
export const DecisionEditsSchema = z
  .object({
    action: AdaptationActionSchema,
    intensity: IntensitySchema,
    strategies: z.array(StrategyKeySchema).max(3),
    // `uses_task_data` is never the browser's to declare: a teacher's edit is normalised on the server (`normalizeTeacherEdits`).
    // A missing value (a client that does not send it) means "unknown", which is read as the conservative `true`.
    supports: z.array(z.object({ kind: SupportKindSchema, uses_task_data: z.boolean().default(true) })).max(4),
    response_target: ResponseTargetSchema,
    note: z.string().trim().min(1).max(160),
  })
  .partial()
  .strict();
export type DecisionEdits = z.infer<typeof DecisionEditsSchema>;

export const PlanReviewEntrySchema = z
  .object({
    decision_id: DecisionIdSchema,
    action: z.enum(REVIEW_ACTIONS),
    reason: z.string().trim().min(1).max(160),
    /** Short instructions for the generator: what it must not do inside this decision. */
    restrictions: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
    edits: DecisionEditsSchema.optional(),
    /**
     * What the reviewer REQUIRES of a support, in elements: "at least this many". The execution preflight compares it with what the
     * support block can hold, so an impossible request is found before any model call. Free-text restrictions are never parsed.
     */
    support_requests: z.array(z.object({ kind: SupportKindSchema, min_items: z.number().int().min(1).max(20) })).max(4).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.action === "edited" && (!entry.edits || Object.keys(entry.edits).length === 0)) ctx.addIssue({ code: "custom", path: ["edits"], message: "Una decisión editada necesita al menos una edición" });
    if (entry.action !== "edited" && entry.edits) ctx.addIssue({ code: "custom", path: ["edits"], message: "Solo una decisión editada lleva ediciones" });
    if (entry.action === "rejected" && entry.support_requests) ctx.addIssue({ code: "custom", path: ["support_requests"], message: "Una decisión rechazada no tiene peticiones de apoyo" });
    if (entry.action === "rejected" && entry.restrictions) ctx.addIssue({ code: "custom", path: ["restrictions"], message: "Una decisión rechazada no tiene restricciones" });
  });
export type PlanReviewEntry = z.infer<typeof PlanReviewEntrySchema>;

export const PlanReviewSchema = z
  .object({
    schema_version: z.literal(PLAN_REVIEW_SCHEMA_VERSION),
    /** Fingerprint of the RAW plan this review was made for. A review never applies to a different plan. */
    plan_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reviewer: z.object({ kind: z.enum(["teacher", "eval", "auto"]), label: z.string().max(40).optional() }),
    reviewed_at: z.string().max(40),
    entries: z.array(PlanReviewEntrySchema).max(60),
  })
  .superRefine((review, ctx) => {
    const seen = new Set<string>();
    review.entries.forEach((e, i) => {
      if (seen.has(e.decision_id)) ctx.addIssue({ code: "custom", path: ["entries", i, "decision_id"], message: `Revisión duplicada: ${e.decision_id}` });
      seen.add(e.decision_id);
    });
  });
export type PlanReview = z.infer<typeof PlanReviewSchema>;
