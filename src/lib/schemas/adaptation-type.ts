import { z } from "zod";

/** Mirrors the `adaptations.adaptation_type` check constraint (migration 004). */
export const ADAPTATION_TYPES = [
  "accessibility",
  "methodological",
  "linguistic",
  "reinforcement",
  "enrichment",
  "curricular",
] as const;
export const AdaptationTypeSchema = z.enum(ADAPTATION_TYPES);
export type AdaptationType = z.infer<typeof AdaptationTypeSchema>;

/** Only `curricular` may change learning objectives, and only after the teacher confirms the warning. */
export const OBJECTIVES_MAY_CHANGE: Record<AdaptationType, boolean> = {
  accessibility: false,
  methodological: false,
  linguistic: false,
  reinforcement: false,
  enrichment: false,
  curricular: true,
};
