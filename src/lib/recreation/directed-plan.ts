import { z } from "zod";
import { DirectorFingerprintSchema } from "@/lib/schemas/pedagogical-direction";
import { RecreationPlanSchema } from "./contract";

export const DirectedPlanSchema = z.object({
  version: z.literal(1),
  request_fingerprint: DirectorFingerprintSchema,
  links: z.array(z.object({
    original_id: z.string().regex(/^act_[0-9]{1,4}$/),
    result_id: z.string().regex(/^(act_[0-9]{1,4}|ra_[0-9]{1,3})$/),
    changes: z.array(z.enum(["segment_instruction", "blank_workspace", "visual_navigation", "change_presentation", "oral_response", "replacement"])).max(5),
    retains: z.array(z.string().regex(/^[a-z_]+_[0-9]{1,4}$/)).max(350),
  }).strict()).max(150),
  replacement: RecreationPlanSchema.nullable(),
}).strict();

export type DirectedPlan = z.infer<typeof DirectedPlanSchema>;
