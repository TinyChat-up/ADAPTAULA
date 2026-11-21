import { z } from "zod";

export const RESPONSE_PREFERENCES = ["write", "oral", "match", "fill_blanks", "order", "select", "classify"] as const;
export const ADAPTATION_PREFERENCES = ["accessibility", "methodological", "linguistic", "reinforcement", "enrichment", "curricular"] as const;
const slug = z.string().regex(/^[a-z0-9-]+$/).max(80);
export const LEARNING_STATEMENT_LIMIT = 180;
export const LEARNINGS_PER_AREA = 5;
const statement = z.string().trim().min(1).max(LEARNING_STATEMENT_LIMIT);

export const ABILITY_AUTONOMY = ["independent", "with_help", "not_yet", "unassessed"] as const;
const ObservedAbilitySchema = z.object({
  statement,
  autonomy: z.enum(ABILITY_AUTONOMY),
}).strict();
export type ObservedAbility = z.infer<typeof ObservedAbilitySchema>;

/**
 * Teacher-declared reference. It never authorises a curricular change. What reaches an adaptation is resolved per sheet on the server
 * (`pedagogical-scope.ts`): the executable response options and the activities the declared learnings point at; never the free text or the level.
 */
export const PedagogicalProfileSchema = z.object({
  areas: z.array(z.object({
    subject: slug,
    reference_grade: slug.nullable(),
    // Historical statements record an ability but provide no evidence about its autonomy.
    knows: statement.array().max(LEARNINGS_PER_AREA),
    abilities: ObservedAbilitySchema.array().max(LEARNINGS_PER_AREA).optional(),
    needs: statement.array().max(LEARNINGS_PER_AREA),
  }).strict()).max(30).refine((a) => new Set(a.map((x) => x.subject)).size === a.length, "No repitas un área."),
  response_preferences: z.array(z.enum(RESPONSE_PREFERENCES)).max(RESPONSE_PREFERENCES.length).refine((a) => new Set(a).size === a.length),
  short_responses_with_support: z.literal(true).optional(),
  adaptation_preferences: z.array(z.enum(ADAPTATION_PREFERENCES)).max(ADAPTATION_PREFERENCES.length).refine((a) => new Set(a).size === a.length),
}).strict();
export type PedagogicalProfile = z.infer<typeof PedagogicalProfileSchema>;
export const emptyPedagogicalProfile = (): PedagogicalProfile => ({ areas: [], response_preferences: [], adaptation_preferences: [] });
