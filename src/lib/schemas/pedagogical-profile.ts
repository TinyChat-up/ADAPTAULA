import { z } from "zod";

export const RESPONSE_PREFERENCES = ["write", "oral", "match", "fill_blanks", "order", "select", "classify"] as const;
export const ADAPTATION_PREFERENCES = ["accessibility", "methodological", "linguistic", "reinforcement", "enrichment", "curricular"] as const;
const slug = z.string().regex(/^[a-z0-9-]+$/).max(80);
const statement = z.string().trim().min(1).max(180);

/** Teacher-declared reference only. These values do not authorise a curricular change or enter the planner. */
export const PedagogicalProfileSchema = z.object({
  areas: z.array(z.object({
    subject: slug,
    reference_grade: slug.nullable(),
    knows: statement.array().max(5),
    needs: statement.array().max(5),
  }).strict()).max(30).refine((a) => new Set(a.map((x) => x.subject)).size === a.length, "No repitas un área."),
  response_preferences: z.array(z.enum(RESPONSE_PREFERENCES)).max(RESPONSE_PREFERENCES.length).refine((a) => new Set(a).size === a.length),
  adaptation_preferences: z.array(z.enum(ADAPTATION_PREFERENCES)).max(ADAPTATION_PREFERENCES.length).refine((a) => new Set(a).size === a.length),
}).strict();
export type PedagogicalProfile = z.infer<typeof PedagogicalProfileSchema>;
export const emptyPedagogicalProfile = (): PedagogicalProfile => ({ areas: [], response_preferences: [], adaptation_preferences: [] });
