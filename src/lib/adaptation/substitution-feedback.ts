/** Only server validation codes travel to a second attempt, never a rejected answer, tokens, or learner data. */
export const SUBSTITUTION_REJECTION_CODES = [
  "invalid_candidate", "not_feasible", "figure_invalid", "representation_lost", "representation_not_drawable",
  "operation_changed", "response_type_changed", "no_answer_space", "action_lost", "action_added", "constraint_lost",
  "new_data", "demand_lowered", "reading_load_increased", "objective_unrelated", "not_rewritten", "mentions_image",
  "answer_leaked", "shared_figure_conflict",
] as const;

export type SubstitutionRejectionCode = (typeof SUBSTITUTION_REJECTION_CODES)[number];

export function substitutionFeedback(violations: readonly string[]): SubstitutionRejectionCode[] {
  const known = new Set<string>(SUBSTITUTION_REJECTION_CODES);
  return [...new Set(violations.map((v) => v.split("(")[0]!).filter((v): v is SubstitutionRejectionCode => known.has(v)))].slice(0, 12);
}
