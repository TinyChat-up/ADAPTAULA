import { z } from "zod";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fingerprint } from "./fingerprint";

/** A proposed per-sheet decision. This contract is not yet connected to the generation pipeline. */
const ObjectiveId = z.string().regex(/^obj_[0-9]{1,4}$/);
export const SheetPedagogicalChoiceSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("accessibility") }).strict(),
  z.object({ version: z.literal(1), type: z.literal("methodological") }).strict(),
  z.object({ version: z.literal(1), type: z.literal("curricular"), analysis_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), objective_ids: z.array(ObjectiveId).min(1).max(8).refine((ids) => new Set(ids).size === ids.length) }).strict(),
]);
export type SheetPedagogicalChoice = z.infer<typeof SheetPedagogicalChoiceSchema>;

/** Only a server-verified subject slug selects an area: model-produced text is not an authoritative match. */
export function pedagogicalAreaFor(profile: FunctionalProfile, materialSubjectSlug: string | null) {
  if (profile.schema_version !== 3 || !materialSubjectSlug) return null;
  const matches = profile.pedagogy?.areas.filter((area) => area.subject === materialSubjectSlug) ?? [];
  return matches.length === 1 ? structuredClone(matches[0]!) : null;
}

export type ScopeResult =
  | { ok: true; choice: SheetPedagogicalChoice; affected_activities: string[] }
  | { ok: false; reason: "invalid_choice" | "stale_analysis" | "unknown_objective" | "unlinked_objective" };

/** No inference from the learner's preferences. A mixed-objective activity is not wholly within a partial authorisation. */
export function checkPedagogicalScope(input: unknown, analysis: MaterialAnalysis): ScopeResult {
  const parsed = SheetPedagogicalChoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_choice" };
  const choice = parsed.data;
  if (choice.type !== "curricular") return { ok: true, choice, affected_activities: [] };
  if (choice.analysis_fingerprint !== fingerprint(analysis)) return { ok: false, reason: "stale_analysis" };
  const known = new Set(analysis.pedagogical_intent.objectives.map((o) => o.id));
  if (choice.objective_ids.some((id) => !known.has(id))) return { ok: false, reason: "unknown_objective" };
  const selected = new Set(choice.objective_ids);
  if (choice.objective_ids.some((id) => !analysis.activities.some((activity) => activity.objective_ids.includes(id)))) return { ok: false, reason: "unlinked_objective" };
  return { ok: true, choice, affected_activities: analysis.activities.filter((a) => a.objective_ids.length > 0 && a.objective_ids.every((id) => selected.has(id))).map((a) => a.id) };
}
