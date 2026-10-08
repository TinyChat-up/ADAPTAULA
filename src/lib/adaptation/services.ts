import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, PlanIssue } from "@/lib/schemas/adaptation-plan";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { AIError } from "@/lib/ai/errors";
import type { AIRunRecord } from "@/lib/ai/types";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { ModelFacingAnalysis } from "./model-input";
import type { ReviewedPlan } from "./plan-review";
import type { PedagogicalReviewContext } from "./review-context";

/**
 * Service boundaries of the adaptation pipeline (docs/ADAPTATION.md § Arquitectura). Each AI step is an interface that
 * returns an UNTRUSTED draft plus the accounting of its calls; parsing, validation and normalisation stay in the pipeline.
 * Real implementations (prompts `adaptation_planner`, `material_generator`, `pedagogical_reviewer` behind `src/lib/ai`)
 * come later; today only deterministic mocks exist.
 */

export const AI_STAGES = ["plan", "generate", "review", "revise_block", "image_brief", "image"] as const;
export type AiStage = (typeof AI_STAGES)[number];

/** One model call of one stage. Extends the analysis record with what a per-stage cost benchmark needs. */
export interface StageRunRecord extends AIRunRecord {
  schemaKey: string;
  schemaVersion: number;
  /** initial · repair (invalid output, one at most) · regeneration (truncated output, one at most). */
  callKind: "initial" | "repair" | "regeneration";
  /** Reported separately only by providers that do; otherwise already inside `outputTokens`. */
  reasoningTokens: number | null;
}

export interface PlannerInput {
  context: AdaptationContext;
  material: ModelFacingAnalysis;
  /** Issues of the previous attempt, for the single repair. Paths and rules only, never learner data. */
  repairOf?: PlanIssue[];
}

export interface GeneratorInput {
  context: AdaptationContext;
  analysis: MaterialAnalysis;
  /** The raw plan, the validator's verdict, the review and the effective plan. The generator only executes the effective one. */
  reviewed: ReviewedPlan;
}

export interface ReviewerInput {
  context: AdaptationContext;
  document: MaterialDocument;
  plan: AdaptationPlan;
  /** Inferred answers are allowed HERE only: to check that the adapted task is still solvable. */
  solvability: Array<{ activity: string; answer: string }>;
  /** What a model-backed reviewer reads (narrowed and deterministic). The mock ignores it. */
  reviewContext?: PedagogicalReviewContext;
}

export interface StageResult {
  draft: unknown;
  runs: StageRunRecord[];
}

export interface AdaptationPlanner {
  plan(input: PlannerInput): Promise<StageResult>;
}
export interface MaterialGenerator {
  generate(input: GeneratorInput): Promise<StageResult>;
}
export interface PedagogicalReviewer {
  review(input: ReviewerInput): Promise<StageResult>;
}

/**
 * The model answered (and was paid) but its answer was rejected (refused, cut off or not matching the contract). Carries the
 * real record of that call so the cost is kept in `ai_runs` even though the stage fails: quota may be given back, spend never.
 */
export class RejectedStageOutput extends AIError {
  constructor(
    code: "refusal" | "truncated" | "invalid_output",
    message: string,
    readonly run: StageRunRecord,
  ) {
    super(code, message);
    this.name = "RejectedStageOutput";
  }
}

/** The rejected call's own record, with the status and error of the rejection. */
export function rejectedRun(run: StageRunRecord, code: "refusal" | "truncated" | "invalid_output"): StageRunRecord {
  return { ...run, status: code === "refusal" ? "refused" : "invalid_output", errorCode: code };
}

export interface StageCost {
  calls: number;
  repairs: number;
  regenerations: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
}

export interface AdaptationCost {
  stages: Partial<Record<AiStage, StageCost>>;
  /** The analysis is paid once per material and shared by every adaptation of it: reported apart, never summed in silently. */
  analysisUsd: number | null;
  adaptationUsd: number | null;
  /** True when some call had no known price: the total is then a lower bound, never a made-up 0. */
  incomplete: boolean;
}

/** Per-stage and total cost of one adaptation, from its runs. `null` costs stay unknown instead of becoming 0. */
export function summarizeCost(runs: readonly StageRunRecord[], analysisUsd: number | null): AdaptationCost {
  const stages: Partial<Record<AiStage, StageCost>> = {};
  let incomplete = analysisUsd === null;
  for (const run of runs) {
    const stage = run.purpose === "analyze" ? null : (run.purpose as AiStage);
    if (!stage) continue;
    const s = (stages[stage] ??= { calls: 0, repairs: 0, regenerations: 0, inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningTokens: null, costUsd: 0, latencyMs: 0 });
    s.calls += 1;
    if (run.callKind === "repair") s.repairs += 1;
    if (run.callKind === "regeneration") s.regenerations += 1;
    s.inputTokens += run.inputTokens;
    s.cachedInputTokens += run.cachedInputTokens;
    s.cacheCreationInputTokens += run.cacheCreationInputTokens;
    s.outputTokens += run.outputTokens;
    if (run.reasoningTokens !== null) s.reasoningTokens = (s.reasoningTokens ?? 0) + run.reasoningTokens;
    s.latencyMs += run.latencyMs;
    if (run.estimatedCostUsd === null) incomplete = true;
    else s.costUsd = (s.costUsd ?? 0) + run.estimatedCostUsd;
  }
  const known = Object.values(stages).map((s) => s?.costUsd ?? 0);
  return { stages, analysisUsd, adaptationUsd: runs.length === 0 ? 0 : known.reduce((a, b) => a + b, 0), incomplete };
}
