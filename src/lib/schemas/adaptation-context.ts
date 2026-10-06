import { z } from "zod";
import { StrategyKeySchema, IntensitySchema } from "./adaptation-plan";
import { AdaptationTypeSchema } from "./adaptation-type";
import { DimensionKeySchema } from "./functional-profile";

/**
 * AdaptationContext v1: the compact, deterministic input of the planner, derived in TypeScript from the functional
 * profile, the education context and the analysis (`src/lib/adaptation/context.ts`). It carries only what changes this
 * adaptation: active and applicable needs with their intensity, presentation settings, limits, stage constraints and a few
 * facts of this material. Never a name, alias, profile id, diagnosis or medical data; the profile schema cannot hold them.
 */

export const ADAPTATION_CONTEXT_VERSION = 1;

/**
 * Policy of the BUILDER (not of the schema): the same schema can be filled by different, versioned rules. Policy 1 is the
 * historical one and the default: it keeps every applicable need, and a context built under it carries no `policy_version`, so
 * its bytes and fingerprint are exactly what they were before policies existed (the frozen evidence depends on that). Policy 2
 * additionally drops the needs that the deterministic presentation layer already resolves completely (docs/ADAPTATION.md).
 */
export const CONTEXT_POLICIES = [1, 2] as const;
export type ContextPolicy = (typeof CONTEXT_POLICIES)[number];
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = 1;

export const AGE_BANDS = ["6-9", "9-12", "12-16", "16-18", "unknown"] as const;
/** Chronological age register: independent of the cognitive accessibility the profile asks for. */
export const REGISTERS = ["child", "adolescent", "young_adult"] as const;

export const CONFLICT_RULES = ["pedagogical_integrity", "content_fidelity", "functional_need", "presentation"] as const;
export const CONFLICT_KEYS = [
  "reading_load_vs_literal_text",
  "added_visuals_vs_visual_load",
  "examples_vs_answer",
  "writing_reduction_vs_evaluated_writing",
  "segmentation_vs_integrated_product",
  "selection_vs_open_reasoning",
  "inference_support_vs_evaluated_inference",
] as const;

export const ConflictResolutionSchema = z.object({
  key: z.enum(CONFLICT_KEYS),
  dimensions: z.array(DimensionKeySchema).min(1).max(6),
  targets: z.array(z.string().regex(/^(act|ctt|vis)_[0-9]{1,4}$/)).max(40),
  /** The level of the priority hierarchy that decides (docs/ADAPTATION.md § Conflictos). */
  rule: z.enum(CONFLICT_RULES),
  /** What the planner must do instead. Short and in Spanish: it is also shown to the teacher. */
  guidance: z.string().max(240),
});
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

export const PresentationSchema = z.object({
  font_scale: z.union([z.literal(1), z.literal(1.15), z.literal(1.3), z.literal(1.5)]),
  line_spacing: z.enum(["normal", "relaxed", "loose"]),
  spacing: z.enum(["normal", "wide"]),
  contrast: z.enum(["normal", "high"]),
  decoration: z.enum(["standard", "reduced", "none"]),
  max_tasks_per_page: z.number().int().min(1).max(20).nullable(),
  color_independent: z.boolean(),
  /** Charts carry a data table and images a description: nothing is understood only by looking. */
  text_alternatives_for_visuals: z.boolean(),
});
export type Presentation = z.infer<typeof PresentationSchema>;

export const ContextNeedSchema = z.object({
  dimension: DimensionKeySchema,
  level: z.enum(["low", "medium", "high"]),
  intensity: IntensitySchema,
  strategies: z.array(StrategyKeySchema).min(1).max(3),
});
export type ContextNeed = z.infer<typeof ContextNeedSchema>;

const Ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9]{1,4}$`));

export const AdaptationContextSchema = z.object({
  context_version: z.literal(ADAPTATION_CONTEXT_VERSION),
  /** Absent = policy 1 (historical). Present only for later policies, so old contexts never change. */
  policy_version: z.literal(2).optional(),
  adaptation_type: AdaptationTypeSchema,
  education: z.object({
    stage: z.enum(["primaria", "eso", "bachillerato", "unknown"]),
    grade: z.string().regex(/^[a-z0-9-]+$/).nullable(),
    subject: z.string().max(80).nullable(),
    language: z.string().regex(/^[a-z]{2}$/),
  }),
  audience: z.object({
    age_band: z.enum(AGE_BANDS),
    register: z.enum(REGISTERS),
    /** ESO and Bachillerato: no childish look or language, whatever the support level. */
    infantilization_guard: z.boolean(),
  }),
  /** Active, applicable, pedagogical needs, strongest first. Presentation-only dimensions live in `presentation`. */
  needs: z.array(ContextNeedSchema).max(69),
  presentation: PresentationSchema,
  limits: z.object({
    max_instruction_words: z.number().int().nullable(),
    max_visible_tasks: z.number().int().nullable(),
    max_task_minutes: z.number().int().nullable(),
  }),
  allowances: z.object({
    calculator: z.boolean(),
    keyboard: z.boolean(),
    bilingual_support_language: z.string().regex(/^[a-z]{2}$/).nullable(),
  }),
  /** Facts of this material that constrain the plan, all computed deterministically from the analysis. */
  material: z.object({
    activity_count: z.number().int().min(0),
    has_math: z.boolean(),
    literal_source_texts: z.array(Ref("ctt")).max(100),
    writing_evaluated_activities: z.array(Ref("act")).max(150),
    required_visuals: z.array(Ref("vis")).max(60),
    decorative_visuals: z.array(Ref("vis")).max(60),
    ambiguous_targets: z.array(z.string().regex(/^(act|ctt|vis)_[0-9]{1,4}$/)).max(40),
  }),
  conflicts: z.array(ConflictResolutionSchema).max(20),
  teacher_request: z.string().max(500).nullable(),
});
export type AdaptationContext = z.infer<typeof AdaptationContextSchema>;
