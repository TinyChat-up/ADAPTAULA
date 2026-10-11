import { z } from "zod";
import { VisualSpecSchema } from "./spec";

/**
 * Contracts the next phases build on (8.2B.2 generated images, 8.2B.3 pictogram catalogues), fixed now so this phase's data does
 * not have to change for them. NOTHING here is wired: no code path produces `generated` or `catalog` yet, and a test keeps it so.
 *
 * Order of preference for any visual a sheet needs, from safest to least safe (docs/VISUAL_RESOURCES.md § Más adelante):
 *   the original (a person's crop, or the automatic one) → a verified reconstruction (VisualSpec) → the teacher's own image →
 *   an authorised catalogue → a generated image. A figure a VisualSpec can express is ALWAYS drawn, never generated.
 */

export const VISUAL_PROVENANCES = ["original_crop", "reconstruction", "teacher_upload", "catalog", "generated"] as const;
export type VisualProvenance = (typeof VISUAL_PROVENANCES)[number];
/** What this phase produces. `catalog` (8.2B.3) and `generated` (8.2B.2) are reserved. */
export const ACTIVE_PROVENANCES = ["original_crop", "reconstruction", "teacher_upload"] as const satisfies readonly VisualProvenance[];

const Short = (max: number) => z.string().trim().min(1).max(max);

/**
 * 8.2B.2 — what a decision may ask an image generator for, once it exists. Built by the server from the plan decision (never
 * from the student or free text about them), validated, and refused when a VisualSpec can draw it (`spec` present → no
 * generation). `must_not_include` carries the safety limits (no answer, no text in the image, no real people).
 */
export const GeneratedImageRequestSchema = z
  .object({
    request_version: z.literal(1),
    decision_id: z.string().regex(/^dec_[0-9]{1,4}$/),
    purpose: Short(300),
    style: z.enum(["diagram", "icon", "illustration"]),
    essential: z.boolean(),
    stage: z.enum(["primaria", "eso", "bachillerato"]),
    must_include: z.array(Short(120)).max(6),
    must_not_include: z.array(Short(120)).max(10),
    spec: VisualSpecSchema.optional(),
  })
  .refine((r) => r.spec === undefined, { message: "Una figura que se puede dibujar con un VisualSpec no se genera", path: ["spec"] });
export type GeneratedImageRequest = z.infer<typeof GeneratedImageRequestSchema>;
