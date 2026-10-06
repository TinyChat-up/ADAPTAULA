import { z } from "zod";
import { FunctionalProfileSchema } from "./functional-profile";

export const DISPLAY_NAME_MAX = 60;

/** What the browser may send when creating or editing a profile. Everything else is decided on the server. */
export const LearnerProfileInputSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Escribe un alias o unas iniciales.")
    .max(DISPLAY_NAME_MAX, `Máximo ${DISPLAY_NAME_MAX} caracteres.`),
  stage_slug: z.string().regex(/^[a-z0-9-]+$/, "Elige una etapa."),
  grade_slug: z.string().regex(/^[a-z0-9-]+$/, "Elige un curso."),
  functional_profile: FunctionalProfileSchema,
});

export type LearnerProfileInput = z.infer<typeof LearnerProfileInputSchema>;

export const ProfileIdSchema = z.uuid();
