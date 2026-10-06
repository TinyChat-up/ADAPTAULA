import type { AnalysisActivity } from "@/lib/schemas/material-analysis";

/**
 * Rules for expected answers (docs/AI_PIPELINE.md):
 * - `source`: the sheet states it. It is original content.
 * - `inferred`: the model deduced it. NEVER original content, NEVER rendered to the student automatically, NEVER a protected
 *   element just because it exists. Its only use is internal: checking that an adaptation is still solvable.
 * - `not_inferable`: open, subjective or doubtful. No value.
 * Everything that wants an answer goes through these two functions so the distinction cannot be lost by accident.
 */
export function statedAnswer(activity: Pick<AnalysisActivity, "expected_answer">): string | null {
  return activity.expected_answer.basis === "source" ? activity.expected_answer.value : null;
}

/** An answer the model deduced, to be used only to verify solvability. Never display it as the material's own. */
export function solvabilityHint(activity: Pick<AnalysisActivity, "expected_answer">): string | null {
  return activity.expected_answer.basis === "inferred" ? activity.expected_answer.value : null;
}

export const normalizeForComparison = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
