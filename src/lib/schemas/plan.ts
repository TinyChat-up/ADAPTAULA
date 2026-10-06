import { z } from "zod";

/** Known keys of `plans.features`; unknown keys are kept so new plan options never break parsing. */
export const PlanFeaturesSchema = z.looseObject({
  multi_profile: z.boolean().optional(),
  max_profiles_per_job: z.number().int().positive().optional(),
  monthly_analyses: z.number().int().nonnegative().optional(),
  monthly_block_revisions: z.number().int().nonnegative().optional(),
  premium_escalations_per_month: z.number().int().nonnegative().optional(),
  max_pages_per_material: z.number().int().positive().optional(),
  max_file_mb: z.number().positive().optional(),
  history_days: z.number().int().positive().nullable().optional(),
  templates: z.string().optional(),
  advanced_editor: z.boolean().optional(),
  comparison: z.string().optional(),
  ai_base_tier: z.string().optional(),
  image_generation: z.boolean().optional(),
  priority_processing: z.boolean().optional(),
});
export type PlanFeatures = z.infer<typeof PlanFeaturesSchema>;

export const PublicPlanSchema = z.object({
  slug: z.string(),
  name: z.string(),
  monthly_price_cents: z.number().int().nonnegative(),
  annual_price_cents: z.number().int().nonnegative(),
  monthly_adaptations: z.number().int().nonnegative(),
  monthly_images: z.number().int().nonnegative(),
  max_profiles: z.number().int().nonnegative(),
  max_classes: z.number().int().nonnegative(),
  features: PlanFeaturesSchema,
  sort_order: z.number().int(),
});
export type PublicPlan = z.infer<typeof PublicPlanSchema>;

const Meter = z.object({ used: z.number().int(), limit: z.number().int() });

/** Shape returned by the SQL function `workspace_usage(ws)`. */
export const WorkspaceUsageSchema = z.object({
  plan: z.object({ slug: z.string(), name: z.string() }),
  period_start: z.string(),
  period_end: z.string(),
  adaptations: Meter,
  images: Meter,
  block_revisions: Meter,
  analyses: Meter,
  max_profiles: z.number().int(),
  max_classes: z.number().int(),
  features: PlanFeaturesSchema,
});
export type WorkspaceUsage = z.infer<typeof WorkspaceUsageSchema>;
