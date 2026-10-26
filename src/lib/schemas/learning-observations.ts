import { z } from "zod";
import { BARRIER_IDS, STRENGTH_IDS } from "@/lib/profiles/learning-catalog";

const unique = (ids: string[]) => new Set(ids).size === ids.length;
export const LearningObservationsSchema = z.object({
  strengths: z.array(z.enum(STRENGTH_IDS)).max(STRENGTH_IDS.length).refine(unique),
  barriers: z.array(z.enum(BARRIER_IDS)).max(BARRIER_IDS.length).refine(unique),
}).strict();
export type LearningObservations = z.infer<typeof LearningObservationsSchema>;
