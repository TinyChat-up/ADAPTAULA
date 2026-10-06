import type { AnalysisActivity } from "@/lib/schemas/material-analysis";
import { wordCount } from "./text";

/**
 * Proportionality (generator v2, docs/ADAPTATION.md). The functional intensity of a need does not imply textual volume: a
 * short, clear instruction is kept as it is and only the executive support it lacks is added. These are parameters of generator
 * v2, not product rules; they live here so they are versioned with it and can be changed in a v3 without touching the contract.
 */
export const PROPORTION_POLICY = {
  /** An instruction up to this many words (or the profile's own limit) is kept: no rewrite, no segmenting for its own sake. */
  keepInstructionMaxWords: 30,
  /** Words a decision's supports may add: at least this many, or `perWord` times the original instruction. */
  supportBudgetMinWords: 24,
  supportBudgetPerWord: 2,
} as const;

export const instructionWords = (activity: Pick<AnalysisActivity, "instruction" | "context">) => wordCount(`${activity.instruction} ${activity.context ?? ""}`);

/** Whether an instruction is long enough (or longer than the profile's limit) for a rewrite to be allowed. */
export function instructionNeedsRewrite(activity: Pick<AnalysisActivity, "instruction" | "context">, maxInstructionWords: number | null): boolean {
  return instructionWords(activity) > (maxInstructionWords ?? PROPORTION_POLICY.keepInstructionMaxWords);
}

export function supportBudgetWords(activity: Pick<AnalysisActivity, "instruction" | "context"> | undefined): number {
  const words = activity ? instructionWords(activity) : 0;
  return Math.max(PROPORTION_POLICY.supportBudgetMinWords, PROPORTION_POLICY.supportBudgetPerWord * words);
}
