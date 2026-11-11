import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, PlanValidation } from "@/lib/schemas/adaptation-plan";
import { ACTIVE_ADAPTATION_PROMPT_VERSIONS } from "@/lib/ai/prompts";
import type { PlanReview } from "@/lib/schemas/plan-review";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { AiReviewDraftSchema, type PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { solvabilityHint } from "@/lib/analysis/answers";
import { buildAdaptationContext, type ContextInput } from "./context";
import { buildDocument } from "./document";
import { modelFacingAnalysis } from "./model-input";
import { normalizeGeneration } from "./generator";
import type { NormalizedGeneration } from "./generated";
import { ExecutionBlockedError, planExecutability, type ExecutabilityReport } from "./execution";
import { autoReview, reviewPlan, type ReviewedPlan } from "./plan-review";
import { applicablePlan } from "./plan";
import { normalizePlanFor } from "./plan-v2";
import { resolveWithheldAutonomously } from "./autonomous-resolution";
import { normalizePlanV3, type PlannerDeclarations } from "./plan-v3";
import { buildReview } from "./review";
import { buildPedagogicalReviewContext } from "./review-context";
import { buildReviewScoped } from "./reviewer";
import type { AdaptationPlanner, MaterialGenerator, PedagogicalReviewer, StageRunRecord } from "./services";

/**
 * The logical sequence (docs/ADAPTATION.md § Arquitectura): A context (deterministic) → B planner (AI) → C plan validator
 * (deterministic, one repair) → D generator (AI, only changed targets) → E document assembly + integrity checks
 * (deterministic) → F reviewer (AI, judgment-only checks) → G renderer (later). Never one call that analyses, adapts,
 * reviews and prints. Works today with the mocks; real services plug in through the same interfaces.
 */

export interface PipelineDeps {
  planner: AdaptationPlanner;
  generator: MaterialGenerator;
  reviewer: PedagogicalReviewer | null;
  newBlockId?: () => string;
  /** Planner contract the draft is read with (v1 until v2 is validated). Canonical output is `AdaptationPlan v1` either way. */
  plannerVersion?: number;
  /** Generator contract the draft is read with (v1 until v2 is validated). The draft is never read with another version's rules. */
  generatorVersion?: number;
  /**
   * The teacher's (or an eval's) review of the planner's plan. Without one, everything the validator did not block is applied
   * (`autoReview`), which is the offline behaviour; blocked decisions are never applied either way.
   */
  humanReview?: (raw: AdaptationPlan) => PlanReview;
  /** Stop before the generator when an effective decision has no executor or a request the contract cannot hold (see `execution.ts`). */
  requireExecutable?: boolean;
}

export interface PipelineResult {
  context: AdaptationContext;
  /** The plan that was applied (effective decisions only). */
  plan: AdaptationPlan;
  /** Validator verdict on the RAW plan. */
  validation: PlanValidation;
  /** Raw plan → validator → review → effective plan, each decision with its history. */
  reviewed: ReviewedPlan;
  /** Planner v3 only: what the planner declared under the V2.2 method, screened (ADR-045). Null for v1 and v2. */
  declarations: PlannerDeclarations | null;
  /** Who executes each effective decision (generator v2 capabilities). Metadata: the plan itself is unchanged. */
  execution: ExecutabilityReport;
  /** What the generator produced, after the effective plan's rules were enforced on it. */
  generation: NormalizedGeneration;
  document: MaterialDocument;
  review: PedagogicalReview;
  runs: StageRunRecord[];
}

export async function runAdaptation(input: ContextInput, deps: PipelineDeps): Promise<PipelineResult> {
  const { analysis } = input;
  const runs: StageRunRecord[] = [];
  const { context } = buildAdaptationContext(input);
  const material = modelFacingAnalysis(analysis);

  const first = await deps.planner.plan({ context, material });
  runs.push(...first.runs);
  const plannerVersion = deps.plannerVersion ?? ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner;
  // v3 keeps what the planner declared beside the canonical plan; v1 and v2 have nothing to declare.
  const normalize = (stage: { draft: unknown; rules?: import("./plan-v3").RulesUse }) =>
    plannerVersion === 3 ? normalizePlanV3(stage.draft, analysis, context, stage.rules ?? null) : { plan: normalizePlanFor(plannerVersion, stage.draft, analysis, context), declarations: null };
  let normalized = normalize(first);
  let raw = normalized.plan;
  let checked = applicablePlan(raw, analysis, context);
  if (!checked.validation.valid) {
    // One repair with the blocking issues; whatever still blocks is never applied.
    const repaired = await deps.planner.plan({ context, material, repairOf: checked.validation.issues.filter((i) => i.severity === "block") });
    runs.push(...repaired.runs);
    normalized = normalize(repaired);
    raw = normalized.plan;
    checked = applicablePlan(raw, analysis, context);
  }
  const { declarations } = normalized;
  // Without a teacher, what the v3 planner declared conditional (or a hint) is resolved safely and internally: a safe variant, an
  // alternative, or the original kept. It is never applied as the planner wrote it, and never handed to a teacher.
  const automatic = () => {
    const review = autoReview(raw, analysis, context);
    return declarations ? resolveWithheldAutonomously(review, raw, declarations, analysis, context).review : review;
  };
  const review = deps.humanReview ? deps.humanReview(raw) : automatic();
  const reviewed = reviewPlan(raw, review, analysis, context);
  const plan = reviewed.effective;
  const execution = planExecutability(reviewed, analysis, context);
  if (deps.requireExecutable && execution.blockers.length > 0) throw new ExecutionBlockedError(execution.blockers);

  const generated = await deps.generator.generate({ context, analysis, reviewed });
  runs.push(...generated.runs);
  const generation = normalizeGeneration(deps.generatorVersion ?? ACTIVE_ADAPTATION_PROMPT_VERSIONS.material_generator, generated.draft, reviewed, analysis, context);
  const document = buildDocument({ analysis, plan, context, generated: generation.segments, newBlockId: deps.newBlockId });

  let aiReview = null;
  if (deps.reviewer) {
    const solvability = solvabilityInputs(analysis);
    const reviewContext = buildPedagogicalReviewContext({ analysis, plan, context, document, validation: reviewed.effectiveValidation }, reviewed);
    const answered = await deps.reviewer.review({ context, document, plan, solvability, reviewContext });
    runs.push(...answered.runs);
    aiReview = AiReviewDraftSchema.parse(answered.draft);
  }
  const reviewInput = { analysis, plan, context, document, validation: reviewed.effectiveValidation };
  const pedagogicalReview = deps.reviewer ? buildReviewScoped(reviewInput, aiReview, reviewed.raw.decisions.map((d) => d.id)).review : buildReview(reviewInput, aiReview);
  return { context, plan, validation: reviewed.validation, reviewed, declarations, execution, generation, document, review: pedagogicalReview, runs };
}

/** The only place inferred answers leave the analysis: towards the reviewer, to check solvability. */
export function solvabilityInputs(analysis: MaterialAnalysis): Array<{ activity: string; answer: string }> {
  return analysis.activities.flatMap((a) => {
    const hint = solvabilityHint(a);
    return hint ? [{ activity: a.id, answer: hint }] : [];
  });
}
