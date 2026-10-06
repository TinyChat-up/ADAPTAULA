import { z } from "zod";

const Slug = z.string().regex(/^[a-z0-9-]*$/, "Opción no válida.").max(60);

/** What the teacher may correct about a material. Everything else about it is decided by the server. */
export const MaterialContextInputSchema = z.object({
  title: z.string().trim().min(1, "Escribe un título.").max(200, "Máximo 200 caracteres."),
  stage_slug: Slug,
  grade_slug: Slug,
  subject_slug: Slug,
  topic: z.string().trim().max(200, "Máximo 200 caracteres."),
});
export type MaterialContextInput = z.infer<typeof MaterialContextInputSchema>;
