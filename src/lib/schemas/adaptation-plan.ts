import { z } from "zod";
import { AdaptationTypeSchema } from "./adaptation-type";
import { DimensionKeySchema } from "./functional-profile";

/**
 * AdaptationPlan v1: the pedagogical decisions taken BEFORE any adapted material is written (docs/ADAPTATION.md).
 * It describes the transformation, never the final sheet: what changes, what does not, for which functional need, on
 * which target of the analysis, with which strategy and intensity, which protected elements constrain it and what needs
 * review. Compact, structured decisions instead of model reasoning, so every one can be validated without AI.
 *
 * Two schemas (ADR-008): `DraftAdaptationPlanSchema` is what the planner produces (no ids); `AdaptationPlanSchema` is
 * what we store, with server ids (`dec_N`) and the fingerprints of the analysis and context it was built from.
 */

export const ADAPTATION_PLAN_SCHEMA_VERSION = 1;

/** Small, composable and functional. No strategy is named after a diagnosis (tests forbid it). */
export const STRATEGY_KEYS = [
  "language_simplification",
  "text_segmentation",
  "visual_load_reduction",
  "spatial_organization",
  "instruction_clarification",
  "task_sequencing",
  "comprehension_support",
  "worked_example",
  "prior_knowledge_activation",
  "attention_focus",
  "working_memory_support",
  "planning_support",
  "response_choice",
  "response_format",
  "writing_load_reduction",
  "visual_support",
  "vocabulary_support",
  "pacing",
  "self_regulation",
  "extension",
] as const;
export const StrategyKeySchema = z.enum(STRATEGY_KEYS);
export type StrategyKey = z.infer<typeof StrategyKeySchema>;

/**
 * What happens to the target. `keep` is the default for anything the plan does not mention, so a plan only lists changes
 * (and explicit keeps when they matter for the teacher).
 */
export const ADAPTATION_ACTIONS = [
  "keep",
  "rephrase",
  "segment",
  "reorganize",
  "add_support",
  "change_response_format",
  "reduce",
  "remove",
  "extend",
] as const;
export const AdaptationActionSchema = z.enum(ADAPTATION_ACTIONS);
export type AdaptationAction = z.infer<typeof AdaptationActionSchema>;

/** Actions that change the target itself (as opposed to adding something next to it or moving it). */
export const MODIFYING_ACTIONS = ["rephrase", "segment", "change_response_format", "reduce", "remove"] as const satisfies readonly AdaptationAction[];

/** How much a decision changes its target. It qualifies the CHANGE, never the learner. */
export const INTENSITIES = ["light", "moderate", "substantial"] as const;
export const IntensitySchema = z.enum(INTENSITIES);
export type Intensity = z.infer<typeof IntensitySchema>;

export const SUPPORT_KINDS = [
  "glossary",
  "key_idea",
  "reminder",
  "checklist",
  "planner",
  "sentence_starters",
  "worked_example",
  "guiding_questions",
  "step_list",
  "self_check",
  "visual_cue",
  "extension_task",
] as const;
export const SupportKindSchema = z.enum(SUPPORT_KINDS);
export type SupportKind = z.infer<typeof SupportKindSchema>;

/** How the student answers after the change. The closed ones turn production into recognition. */
export const RESPONSE_TARGETS = [
  "write_text",
  "write_text_short",
  "write_number",
  "table_completion",
  "keyboard",
  "oral_or_alternative",
  "select_option",
  "mark",
  "fill_blanks",
  "match",
  "order",
] as const;
export const CLOSED_RESPONSES = ["select_option", "mark", "fill_blanks", "match", "order"] as const satisfies readonly (typeof RESPONSE_TARGETS)[number][];
export const ResponseTargetSchema = z.enum(RESPONSE_TARGETS);
export type ResponseTarget = z.infer<typeof ResponseTargetSchema>;

/** A future visual aid (images are not implemented). More images is not a better adaptation: each one needs a function. */
export const VISUAL_REQUEST_MODES = ["reuse_original", "transform_original", "new_representation", "optional_support"] as const;

export const REVIEW_FLAGS = [
  "objective_changed",
  "activity_removed",
  "protected_element_modified",
  "required_data_removed",
  "essential_visual_replaced",
  "source_text_altered",
  "answer_revealed",
  "target_operation_replaced",
  "written_expression_replaced",
  "open_task_closed",
  "cognitive_demand_reduced",
  "extension_changed",
  "inferred_used_as_fact",
  "ambiguous_source",
  "needs_conflict",
  "infantilization_risk",
  "unknown_reference",
  "unjustified_change",
] as const;
export const ReviewFlagSchema = z.enum(REVIEW_FLAGS);
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>;

/** `block`: the decision cannot be applied. `review`: it can, but the teacher must see it. `info`: recorded only. */
export const FLAG_SEVERITIES = ["block", "review", "info"] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

/** Targets are ids of the stored MaterialAnalysis (never text) or the whole document. */
export const TargetRefSchema = z.string().regex(/^(act|ctt|vis|sec)_[0-9]{1,4}$|^document$/, "Destino no válido");
export const ProtectedRefSchema = z.string().regex(/^prt_[0-9]{1,4}$/, "Elemento protegido no válido");
export const DecisionIdSchema = z.string().regex(/^dec_[0-9]{1,4}$/, "Decisión no válida");
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const Note = z.string().trim().min(1).max(160);

const SupportRequestSchema = z.object({
  kind: SupportKindSchema,
  /**
   * Whether the support is built on the task's own data. A worked example on the task's data IS the answer, so it is
   * blocked; guiding questions on the task's data need review. Examples must be analogous.
   */
  uses_task_data: z.boolean(),
});

const VisualRequestSchema = z
  .object({
    mode: z.enum(VISUAL_REQUEST_MODES),
    source_visual: z.string().regex(/^vis_[0-9]{1,4}$/).nullable(),
    purpose: z.string().trim().min(1).max(120),
    essential: z.boolean(),
  })
  .refine((v) => (v.mode === "reuse_original" || v.mode === "transform_original" ? v.source_visual !== null : true), {
    message: "Reutilizar o transformar un visual exige indicar cuál",
  });

const decisionShape = {
  target: TargetRefSchema,
  action: AdaptationActionSchema,
  strategies: z.array(StrategyKeySchema).max(3),
  /** The functional needs behind the change. A change without a need of the context is not allowed. */
  dimensions: z.array(DimensionKeySchema).max(4),
  intensity: IntensitySchema,
  /** Protected elements this decision must carry intact (validated against the analysis). */
  preserves: z.array(ProtectedRefSchema).max(12),
  supports: z.array(SupportRequestSchema).max(4),
  response_target: ResponseTargetSchema.optional(),
  visual: VisualRequestSchema.optional(),
  /** Risks the planner itself sees. The validator adds its own; these are never trusted to clear anything. */
  flags: z.array(ReviewFlagSchema).max(4),
  note: Note.optional(),
};

export const DraftDecisionSchema = z.object(decisionShape);
export const DecisionSchema = z.object({ id: DecisionIdSchema, ...decisionShape });
export type DraftDecision = z.infer<typeof DraftDecisionSchema>;
export type Decision = z.infer<typeof DecisionSchema>;

export const DraftAdaptationPlanSchema = z.object({
  decisions: z.array(DraftDecisionSchema).max(60),
  /** 3-6 short points for the teacher ("¿Qué vamos a adaptar?"). Never shown to the student. */
  summary: z.array(Note).max(6),
});
export type DraftAdaptationPlan = z.infer<typeof DraftAdaptationPlanSchema>;

export const AdaptationPlanSchema = z
  .object({
    schema_version: z.literal(ADAPTATION_PLAN_SCHEMA_VERSION),
    analysis: z.object({ schema_version: z.literal(3), fingerprint: Fingerprint }),
    context_fingerprint: Fingerprint,
    adaptation_type: AdaptationTypeSchema,
    decisions: z.array(DecisionSchema).max(60),
    summary: z.array(Note).max(6),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.decisions.forEach((d, i) => {
      if (seen.has(d.id)) ctx.addIssue({ code: "custom", path: ["decisions", i, "id"], message: `Decisión duplicada: ${d.id}` });
      seen.add(d.id);
    });
  });
export type AdaptationPlan = z.infer<typeof AdaptationPlanSchema>;

export const PlanIssueSchema = z.object({
  flag: ReviewFlagSchema,
  severity: z.enum(FLAG_SEVERITIES),
  decision_id: DecisionIdSchema.nullable(),
  target: z.string().max(20).nullable(),
  message: z.string().max(240),
});
export type PlanIssue = z.infer<typeof PlanIssueSchema>;

/** Output of the deterministic plan validator. `valid` is false as soon as one issue blocks. */
export const PlanValidationSchema = z.object({ valid: z.boolean(), issues: z.array(PlanIssueSchema) });
export type PlanValidation = z.infer<typeof PlanValidationSchema>;
