import { auditSupports } from "../support-audit";
import { assessSupports } from "../assessment-safety";
import { DEFAULT_SUBSTITUTION_MODE, STRUCTURAL_RESTRICTIONS, SUBSTITUTION_REASON, applySupportGuard, coverageOf, servesAll, isActionable, kindsOfBlock, planSubstitution, recordOf, revealDeclines, type SubstitutionMode, type SupportFlag, type SupportResolutionRecord } from "../support-substitution";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { AdaptationContextSchema, type AdaptationContext } from "@/lib/schemas/adaptation-context";
import { AdaptationPlanSchema, type AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { DraftGeneratedSegmentsV2Schema, type DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { PlanReviewSchema, type PlanReview } from "@/lib/schemas/plan-review";
import type { AiReviewDraft, PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import type { SanitationCounts, SupportJudgment } from "@/lib/schemas/reviewer-findings";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import { reaches, resolveAutomatically } from "../automatic-resolution";
import { VISUAL_STOP_CODES, applyVisualResolution, unresolvedEssential, visualStopCode, type VisualResolutionPlan, type VisualStopCode } from "../visual-policy";
import { buildAdaptationContext, isResolvedByPresentation } from "../context";
import { addVisualSupports } from "../visual-supports";
import { buildDocument, sequentialIds } from "../document";
import { planExecutability, type ExecutabilityReport } from "../execution";
import { fingerprint } from "../fingerprint";
import { SUPPORT_SOLVES_CHECK, auditGeneration } from "../generation-checks";
import { decisionSupportBudget, designatedRewriter } from "../generated-v2";
import { CONCEPT_LEAK_CHECK, INVALID_BLOCK_CHECK, LITERAL_COPY_CHECK, MISSING_ACTIVITY_CHECK, OUT_OF_BUDGET_CHECK, RESPONSE_AREA_CHECK } from "../generation-checks";
import { budgetRepairProgress, diagnoseGeneration, diagnoseReview, failureSignature, missingRepairedGlossaries, repairLocally, screenGeneration, type GenerationFailure } from "../generation-recovery";
import { buildGeneratorInputV2, normalizeGeneration } from "../generator";
import { classifyPlan } from "../invariants";
import { modelFacingAnalysis } from "../model-input";
import type { NormalizedGeneration } from "../generated";
import { applicablePlan } from "../plan";
import { normalizeTeacherEdits, reviewPlan, type ReviewedPlan } from "../plan-review";
import { checkPlanDraft, repairNotes, type PlanDraftDiagnosis } from "../planner-draft";
import { resolveWithheldAutonomously } from "../autonomous-resolution";
import { justifyDecisions } from "@/lib/profiles/strength-leverage";
import { withheldWithoutConfirmation, type PlannerDeclarations, type RulesUse } from "../plan-v3";
import { solvabilityInputs } from "../pipeline";
import { assembleReview, deterministicChecks } from "../review";
import { buildPedagogicalReviewContext } from "../review-context";
import { buildReviewScoped, withSemanticChecks } from "../reviewer";
import { SEMANTIC_POLICY_VERSION, buildSemanticScope, effectiveReviewerMode, judgeSupports, restrictionFor, semanticChecks, semanticFlags, summarize, type ReviewerV2Mode, type SemanticRecord, type SemanticRecordSet } from "../support-semantic";
import { preservationRefs, withOriginals } from "../restoration";
import { RejectedStageOutput, type AdaptationPlanner, type MaterialGenerator, type PedagogicalReviewer, type StageRunRecord } from "../services";
import { NO_ENTITLEMENTS, type AdaptationEntitlements } from "./entitlements";
import { AdaptationError, FAILURE_KIND, classifyAIFailure, type AdaptationErrorCode, type Stage } from "./errors";
import { EntitlementError, FailureBudgetError, GenerationLimitError, InvalidStateError, LeaseLostError, NotFoundError, type AdaptationStore, type AiRunRow, type ClaimedStage, type CreationMode, type PipelineSnapshot } from "./store";
import type { AdaptationStatus } from "./state-machine";
import { MAX_GENERATION_CYCLES, generationCyclesOf } from "./status";
import type { PipelineVersions } from "./versions";

/**
 * The pipeline orchestrator (docs/ADAPTATION.md § Orquestación). Two stages with a mandatory human gate between them:
 *
 *   createAdaptation → [queued] → runPlanningStage → [awaiting_plan_review] ⟶ teacher ⟶ submitPlanReview → [generation_queued]
 *   → runGenerationStage → [generating → reviewing_deterministic → reviewing_ai] → [ready | blocked]
 *
 * An adaptation created in `automatic` mode («Hacer magia») crosses the gate with `continueAutomatically`: the server submits its
 * capability-aware resolution (`resolveAutomatically`, the same policy as the offline pipeline) once per plan, through the same
 * `submitPlanReview`, and queues the same generation job. A quality review that fails is corrected by `correctAutomatically` when a
 * safe correction exists (within the same generation limit). Nothing else differs: same jobs, fencing, limits, entitlement and
 * mandatory reviewer. Nobody is asked to approve the plan; when the sheet cannot be finished automatically the adaptation stops
 * honestly (the status says why) and the teacher MAY choose to edit it.
 *
 * Guarantees, and their limits:
 *  - IDEMPOTENT APPLICATION STATE: every stage output is persisted under "stage + input fingerprint + versions" and checked
 *    BEFORE any provider call, so repeating a command reuses what exists and never duplicates a plan, a version, a review,
 *    a job or a successful ai_run.
 *  - AT-LEAST-ONCE EXTERNAL ATTEMPTS, NOT EXACTLY-ONCE: if a provider answered and the process died before persisting, the
 *    attempt is AMBIGUOUS (the call may have been billed). It is detected (`provider_call_started_at` still set when the lease
 *    expires) and NOT retried blindly: the stage fails with `ambiguous_attempt` (human action) until someone acknowledges it.
 *  - Two workers never run the same stage (lease), and a worker that lost its lease cannot persist (attempt fencing in SQL).
 *  - Versions, models, limits and the minimized context come from the persisted adaptation, never from the environment.
 */

export interface PipelineServices {
  planner: AdaptationPlanner;
  generator: MaterialGenerator;
  reviewer: PedagogicalReviewer;
}

export interface OrchestratorDeps {
  store: AdaptationStore;
  /** Builds the AI services from the PERSISTED versions (alias, model, limits). It must not read the environment. */
  services: (versions: PipelineVersions, analysis: MaterialAnalysis, workspaceId?: string) => PipelineServices;
  entitlements?: AdaptationEntitlements;
  leaseSeconds?: number;
  retryBackoffSeconds?: number;
  maxAttempts?: number;
  /** Failed jobs of one stage after which a manual retry is refused (a person must cancel or escalate). */
  maxManualRetries?: number;
  log?: { warn: (event: string, data: Record<string, unknown>) => void };
  /**
   * The visual policy of «Hacer magia» (docs/VISUAL_RESOURCES.md § Política visual): every visual need of the assembled sheet is
   * resolved by the server (located, rebuilt, generated, rewritten around or left out when optional) before it is reviewed; what
   * nothing resolves stops the adaptation honestly. Never in «Revisar antes de crear». No adaptation unit is consumed by it.
   */
  /**
   * Etapa 2.2: what a LITERAL, reliable answer in a support (or a support the generator declined for revealing it) does. `dry_run`
   * (the default, also when this is missing): only recorded, nothing changes, no restriction is added; `on` (explicit): the decision is
   * repaired, then its support substituted once, and the first generation is told what not to define; `off`: nothing at all.
   */
  supportSubstitution?: SubstitutionMode;
  /**
   * Etapa 2.3: what the semantic review of the supports does (`REVIEWER_V2_MODE`). `off` (the default, also when this is missing): the v1
   * reviewer exactly as before. `shadow`: pedagogical_reviewer@v2 judges and the semantic judgments are only recorded (its general findings still count: not transparent). `on`: its CONFIRMED findings fail
   * the review and are repaired (a substitution only if `supportSubstitution` is `on` too). It only applies to an adaptation created with the v2
   * reviewer; one created with v1 always runs v1.
   */
  reviewerV2?: ReviewerV2Mode;
  visuals?: { resolve(input: { workspaceId: string; materialId: string; adaptationId: string; analysis: MaterialAnalysis; analysisFingerprint: string; document: MaterialDocument; requiredVisuals: readonly string[]; stage: string | null; grade: string | null; subject: string | null; functionalNeeds: readonly string[]; visualSupports?: boolean; deadline?: number | null }): Promise<VisualResolutionPlan> };
}

const DEFAULTS = { leaseSeconds: 300, retryBackoffSeconds: 30, maxAttempts: 3 } as const;
/** Kept, at the end of a generation stage's lease, for what follows the visual policy (the review, persisting the sheet). */
const AFTER_VISUALS_MS = 60_000;

export type StageOutcomeKind = "completed" | "enqueued" | "reused" | "skipped" | "retry" | "failed" | "human_action_required" | "rejected";
export interface StageOutcome {
  outcome: StageOutcomeKind;
  status: AdaptationStatus;
  code?: AdaptationErrorCode;
  jobId?: string;
  detail?: string;
  /** `enqueued`: the job already existed (a repeated command), nothing new was created. */
  reusedJob?: boolean;
}

const settings = (deps: OrchestratorDeps) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries({ leaseSeconds: deps.leaseSeconds, retryBackoffSeconds: deps.retryBackoffSeconds, maxAttempts: deps.maxAttempts }).filter(([, v]) => v !== undefined)) }) as typeof DEFAULTS;

// ---------------------------------------------------------------------------------------------------------------------
// Loading and integrity
// ---------------------------------------------------------------------------------------------------------------------

export interface Loaded {
  snapshot: PipelineSnapshot;
  versions: PipelineVersions;
  analysis: MaterialAnalysis;
  context: AdaptationContext;
}

/** Everything a stage needs, from the persisted adaptation. A stale or corrupt input is a categorized error, never a guess. */
function load(snapshot: PipelineSnapshot | null): Loaded {
  if (!snapshot) throw new NotFoundError();
  const row = snapshot.adaptation;
  if (!row.pipeline_versions || !row.context_snapshot || !row.context_fingerprint || !row.analysis_fingerprint) throw new AdaptationError("invalid_input", "La adaptación no tiene versiones o contexto fijados");
  const context = AdaptationContextSchema.safeParse(row.context_snapshot);
  if (!context.success || fingerprint(context.data) !== row.context_fingerprint) throw new AdaptationError("invalid_input", "El contexto guardado no coincide con su huella");
  const parsed = parseStoredAnalysis(snapshot.analysis.analysis);
  if (!parsed.analysis || parsed.outdated || fingerprint(parsed.analysis) !== row.analysis_fingerprint) throw new AdaptationError("stale_analysis", "El análisis del material cambió o no es compatible");
  return { snapshot, versions: row.pipeline_versions, analysis: parsed.analysis, context: context.data };
}

const planningFingerprint = (row: PipelineSnapshot["adaptation"], v: PipelineVersions) =>
  fingerprint({ stage: "planning", context: row.context_fingerprint, analysis: row.analysis_fingerprint, planner: v.planner, plan_schema: v.plan_schema, context_policy: v.context_policy, analysis_schema: v.analysis_schema });
const generationFingerprint = (planFp: string, reviewFp: string, v: PipelineVersions) => fingerprint({ stage: "generation", plan: planFp, review: reviewFp, generator: v.generator, document_schema: v.document_schema });
const reviewFingerprint = (documentFp: string, reviewFp: string, v: PipelineVersions) => fingerprint({ stage: "review", document: documentFp, plan_review: reviewFp, reviewer: v.reviewer, review_schema: v.review_schema });

function runRow(run: StageRunRecord, ids: { workspaceId: string; adaptationId: string; materialId: string; jobId: string; jobAttempt: number }, inputFp: string, outputFp: string | null): AiRunRow {
  return {
    workspace_id: ids.workspaceId,
    job_id: ids.jobId,
    adaptation_id: ids.adaptationId,
    material_id: ids.materialId,
    purpose: run.purpose,
    model_alias: run.alias,
    provider: run.provider,
    model: run.model,
    prompt_key: run.promptKey,
    prompt_version: run.promptVersion,
    effort: run.effort,
    input_tokens: run.inputTokens,
    output_tokens: run.outputTokens,
    cached_input_tokens: run.cachedInputTokens,
    cache_creation_input_tokens: run.cacheCreationInputTokens,
    estimated_cost_usd: run.estimatedCostUsd,
    latency_ms: run.latencyMs,
    status: run.status,
    error_code: run.errorCode,
    attempt: run.attempt,
    schema_version: run.schemaVersion,
    call_kind: run.callKind,
    reasoning_tokens: run.reasoningTokens,
    input_fingerprint: inputFp,
    output_fingerprint: outputFp,
    job_attempt: ids.jobAttempt,
    ...(run.rulesSha256 ? { rules_sha256: run.rulesSha256 } : {}),
  };
}

/**
 * The row of a failed call. A rejected answer (`RejectedStageOutput`) was paid: its real record (tokens, cost) is kept. Any
 * other failure returned no record: what is known, never a made-up cost (unknown is null).
 */
function failedRow(error: unknown, component: PipelineVersions["planner"], purpose: "plan" | "generate" | "review", promptKey: string, code: string, ids: Parameters<typeof runRow>[1], inputFp: string, callKind: "initial" | "repair" = "initial"): AiRunRow {
  if (error instanceof RejectedStageOutput) return { ...runRow({ ...error.run, callKind }, ids, inputFp, null), error_code: code };
  return failedRunRow(component, purpose, promptKey, code, ids, inputFp, callKind);
}

/** A call that failed before returning a record: what is known (never a made-up cost: unknown is null). */
function failedRunRow(component: PipelineVersions["planner"], purpose: "plan" | "generate" | "review", promptKey: string, code: string, ids: Parameters<typeof runRow>[1], inputFp: string, callKind: "initial" | "repair" = "initial"): AiRunRow {
  const refused = code === "provider_refusal";
  const invalid = code.endsWith("_schema");
  return {
    workspace_id: ids.workspaceId, job_id: ids.jobId, adaptation_id: ids.adaptationId, material_id: ids.materialId, purpose,
    model_alias: component.selection.alias, provider: component.selection.provider, model: component.selection.model, prompt_key: promptKey,
    prompt_version: component.prompt_version, effort: component.selection.effort, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
    cache_creation_input_tokens: 0, estimated_cost_usd: null, latency_ms: null, status: refused ? "refused" : invalid ? "invalid_output" : "error",
    error_code: code, attempt: 1, schema_version: component.schema_version, call_kind: callKind, reasoning_tokens: null, input_fingerprint: inputFp,
    output_fingerprint: null, job_attempt: ids.jobAttempt,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------------------------------

export interface CreateAdaptationInput {
  workspaceId: string;
  userId: string;
  materialId: string;
  /** `materials.analysis` as stored. Must be a current MaterialAnalysis v3. */
  storedAnalysis: unknown;
  learnerProfileId: string | null;
  /** Used ONLY to build the minimized context; it is never persisted. */
  profile: FunctionalProfile;
  education: { stage: string | null; grade: string | null; subject: string | null };
  adaptationType: AdaptationContext["adaptation_type"];
  teacherRequest?: string | null;
  visualSupports?: boolean;
  title: string;
  /** Same key, same adaptation: a double submit never creates two. */
  requestKey: string;
  versions: PipelineVersions;
  /** `automatic` = «Hacer magia» (no human plan approval; the reviewer still decides). Default: `review`. */
  creationMode?: CreationMode;
}

export async function createAdaptation(deps: OrchestratorDeps, input: CreateAdaptationInput): Promise<{ adaptationId: string; contextFingerprint: string }> {
  const parsed = parseStoredAnalysis(input.storedAnalysis);
  if (!parsed.analysis || parsed.outdated) throw new AdaptationError("stale_analysis", "El material no tiene un análisis v3 actual");
  const { context } = buildAdaptationContext({
    profile: input.profile,
    education: input.education,
    analysis: parsed.analysis,
    adaptationType: input.adaptationType,
    ...(input.teacherRequest !== undefined ? { teacherRequest: input.teacherRequest } : {}),
    visualSupports: input.visualSupports === true,
    policy: input.versions.context_policy,
  });
  const contextFingerprint = fingerprint(context);
  const entitlements = deps.entitlements ?? NO_ENTITLEMENTS;
  let adaptationId: string;
  try {
    adaptationId = await deps.store.createAdaptation({
    workspaceId: input.workspaceId,
    materialId: input.materialId,
    userId: input.userId,
    learnerProfileId: input.learnerProfileId,
    adaptationType: input.adaptationType,
    title: input.title,
    requestKey: input.requestKey,
    versions: input.versions,
    context,
    contextFingerprint,
    analysisFingerprint: fingerprint(parsed.analysis),
    reserve: entitlements.atomicWithCreation === true,
    creationMode: input.creationMode ?? "review",
    });
  } catch (error) {
    if (error instanceof EntitlementError) throw new AdaptationError(error.reason === "exhausted" ? "entitlement_exhausted" : "entitlement_unavailable", error.message);
    throw error;
  }
  // Non-atomic implementations reserve right after the row exists, and before any planning can start.
  if (entitlements.atomicWithCreation !== true) await entitlements.reserve({ id: adaptationId, workspaceId: input.workspaceId });
  return { adaptationId, contextFingerprint };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared stage machinery
// ---------------------------------------------------------------------------------------------------------------------

interface StageRun {
  job: ClaimedStage;
  ids: Parameters<typeof runRow>[1];
  lease: { jobId: string; attempt: number };
}

const SETTLED: readonly AdaptationStatus[] = ["awaiting_plan_review", "generation_queued", "generating", "reviewing_deterministic", "reviewing_ai", "ready", "blocked"];

/**
 * ENTITLEMENT POLICY (the unit is the adaptation_id; see entitlements-db.ts and migration 014). It is reserved when the
 * adaptation is created and KEPT through every state that can still end in a delivery: planning, review, generation,
 * `blocked` (recoverable: reopen → review → generate), `failed` (retryable, awaiting a person, or ambiguous) and new
 * versions. It is consumed exactly once, atomically with the first delivery (`ready`). It goes back ONLY by an explicit
 * cancellation of an adaptation that was never delivered. Provider cost plays no role in any of this.
 */
async function release(deps: OrchestratorDeps, adaptation: { id: string; workspaceId: string }, reason: string) {
  try {
    await (deps.entitlements ?? NO_ENTITLEMENTS).release(adaptation, reason);
  } catch {
    deps.log?.warn("entitlement_release_failed", { adaptationId: adaptation.id });
  }
}

const FORWARD: readonly AdaptationStatus[] = ["generation_queued", "generating", "reviewing_deterministic", "reviewing_ai"];

/** Moves the adaptation forward only if it is not already there or beyond: a resumed stage is idempotent. */
async function advance(store: AdaptationStore, id: string, current: AdaptationStatus, to: AdaptationStatus): Promise<AdaptationStatus> {
  const from = FORWARD.indexOf(current);
  const target = FORWARD.indexOf(to);
  if (from >= target && from !== -1) return current;
  await store.transition(id, current, to);
  return to;
}

async function failStage(deps: OrchestratorDeps, run: StageRun, stage: Stage, error: unknown, backToReview = false): Promise<StageOutcome> {
  const s = settings(deps);
  const { code, retryable } = classifyAIFailure(error, stage);
  // The outcome of the call is known now (it failed): the attempt is not ambiguous.
  await deps.store.clearProviderCall(run.job.id, run.job.attempts);
  const adaptationStatus: AdaptationStatus = backToReview ? "awaiting_plan_review" : "failed";
  const result = await deps.store.failStage(run.job.id, run.job.attempts, code, retryable, s.retryBackoffSeconds, adaptationStatus);
  const snapshot = await deps.store.getPipeline(run.job.adaptation_id);
  const status = (snapshot?.adaptation.status ?? "failed") as AdaptationStatus;
  if (result === "retry") return { outcome: "retry", status, code, jobId: run.job.id };
  return { outcome: FAILURE_KIND[code] === "human_action_required" ? "human_action_required" : "failed", status, code, jobId: run.job.id };
}

/** Claims the stage's job. Null means: someone else holds it, it is waiting out a backoff, or it has no attempts left. */
async function claim(deps: OrchestratorDeps, jobId: string, acknowledgeAmbiguous: boolean): Promise<ClaimedStage | null> {
  return deps.store.claimStage(jobId, settings(deps).leaseSeconds, acknowledgeAmbiguous);
}

/** The previous attempt called the provider and never persisted: record it and stop, unless a person acknowledged it. */
async function stopOnAmbiguity(deps: OrchestratorDeps, run: StageRun, loaded: Loaded, stage: Stage): Promise<StageOutcome | null> {
  if (!run.job.ambiguous_previous) return null;
  const component = stage === "planning" ? loaded.versions.planner : stage === "generation" ? loaded.versions.generator : loaded.versions.reviewer;
  const purpose = stage === "planning" ? "plan" : stage === "generation" ? "generate" : "review";
  const key = stage === "planning" ? "adaptation_planner" : stage === "generation" ? "material_generator" : "pedagogical_reviewer";
  await deps.store.recordAiRun(failedRunRow(component, purpose, key, "ambiguous_attempt", run.ids, run.job.input_fingerprint));
  const result = await deps.store.failStage(run.job.id, run.job.attempts, "ambiguous_attempt", false, 0, "failed");
  const snapshot = await deps.store.getPipeline(run.job.adaptation_id);
  return { outcome: result === "ignored" ? "skipped" : "human_action_required", status: (snapshot?.adaptation.status ?? "failed") as AdaptationStatus, code: "ambiguous_attempt", jobId: run.job.id };
}

// ---------------------------------------------------------------------------------------------------------------------
// Planning stage
// ---------------------------------------------------------------------------------------------------------------------

/** A planner call, persisted under its own input fingerprint BEFORE anything is derived from it (and reused on resume). */
async function plannerDraft(deps: OrchestratorDeps, run: StageRun, loaded: Loaded, services: PipelineServices, callFp: string, repairOf?: Parameters<AdaptationPlanner["plan"]>[0]["repairOf"], maxOutputTokens?: number): Promise<{ draft: unknown; rules: RulesUse | null }> {
  const existing = await deps.store.findArtifact(run.job.adaptation_id, "planner_draft", { inputFingerprint: callFp });
  if (existing) return { draft: existing.payload.draft, rules: (existing.payload.rules as RulesUse | undefined) ?? null };
  if (!(await deps.store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
  let answered;
  try {
    answered = await services.planner.plan({ context: loaded.context, material: modelFacingAnalysis(loaded.analysis), ...(repairOf ? { repairOf } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) });
  } catch (error) {
    const { code } = classifyAIFailure(error, "planning");
    await deps.store.recordAiRun(failedRow(error, loaded.versions.planner, "plan", "adaptation_planner", code, run.ids, callFp, repairOf ? "repair" : "initial"));
    throw error;
  }
  const outputFp = fingerprint(answered.draft);
  // The call happened and may have cost money: it is recorded BEFORE anything that can be refused (a cancelled job loses its
  // lease, so a late answer is audited but can never persist an artifact).
  for (const r of answered.runs) await deps.store.recordAiRun(runRow(r, run.ids, callFp, outputFp));
  // v3: which verified rules and precedents travelled (hashes and ids, never text), so a resume screens the same declarations.
  const rules = answered.rules ?? null;
  await deps.store.putArtifact(run.job.adaptation_id, run.lease, "planner_draft", callFp, outputFp, { draft: answered.draft, version: loaded.versions.planner.prompt_version, repair: repairOf !== undefined, ...(rules ? { rules } : {}) });
  await deps.store.clearProviderCall(run.lease.jobId, run.lease.attempt);
  return { draft: answered.draft, rules };
}

/** More room for an answer that was cut off: double the version's budget, within a fixed ceiling (bounded cost). */
export const PLANNER_REPAIR_OUTPUT_CEILING = 16_000;
const truncationBudget = (versionBudget: number) => Math.min(versionBudget * 2, PLANNER_REPAIR_OUTPUT_CEILING);

type DraftAttempt = { ok: true; plan: AdaptationPlan; declarations: PlannerDeclarations | null } | { ok: false; diagnosis: PlanDraftDiagnosis };

/**
 * One planner answer judged: the model's draft (or the parsed value of a rejected one) gets its unequivocal fixes, the contract and
 * the need references; the result is a plan or a content-free diagnosis. A refusal or a provider error is not a draft: it goes up.
 * A rejected answer that the fixes make valid is stored as this call's draft (so a resume reuses it, no new call).
 */
async function draftAttempt(deps: OrchestratorDeps, run: StageRun, loaded: Loaded, services: PipelineServices, callFp: string, repairOf?: Parameters<AdaptationPlanner["plan"]>[0]["repairOf"], maxOutputTokens?: number): Promise<DraftAttempt> {
  const version = loaded.versions.planner.prompt_version;
  const budget = maxOutputTokens ?? loaded.versions.planner.max_output_tokens;
  const base = { stage: "planning" as const, schema: `DraftAdaptationPlan v${version}`, prompt_version: version, max_output_tokens: budget, repair_attempted: repairOf !== undefined };
  let draft: unknown;
  let rules: RulesUse | null = null;
  let outputTokens: number | null = null;
  try {
    ({ draft, rules } = await plannerDraft(deps, run, loaded, services, callFp, repairOf, maxOutputTokens));
  } catch (error) {
    if (!(error instanceof RejectedStageOutput) || !error.detail || error.detail.kind === "refused") throw error;
    // The call's outcome is known (an answer, rejected): this attempt is not ambiguous any more.
    await deps.store.clearProviderCall(run.lease.jobId, run.lease.attempt);
    const detail = error.detail;
    if (detail.kind !== "schema" || detail.json === undefined) {
      return { ok: false, diagnosis: { ...base, kind: detail.kind, issues: detail.issues, truncated: detail.kind === "truncated", output_tokens: detail.outputTokens, deterministic_fixes: [] } };
    }
    draft = detail.json;
    outputTokens = detail.outputTokens;
    // A rejected answer carries no rules record of its own: the rules of this call are the ones the error reports, if any.
    rules = detail.rules ?? null;
    const fixed = checkPlanDraft(version, draft, loaded.analysis, loaded.context, rules);
    if (fixed.ok) {
      await deps.store.putArtifact(run.job.adaptation_id, run.lease, "planner_draft", callFp, fingerprint({ input: callFp, draft: fixed.draft }), { draft: fixed.draft, version, repair: repairOf !== undefined, deterministic_fixes: fixed.fixes, ...(rules ? { rules } : {}) });
      deps.log?.warn("planner_draft_fixed", { adaptationId: run.job.adaptation_id, fixes: fixed.fixes.join("; ").slice(0, 400) });
      return { ok: true, plan: fixed.plan, declarations: fixed.declarations };
    }
    return { ok: false, diagnosis: { ...base, kind: fixed.kind, issues: fixed.issues, truncated: false, output_tokens: outputTokens, deterministic_fixes: fixed.fixes } };
  }
  const checked = checkPlanDraft(version, draft, loaded.analysis, loaded.context, rules);
  if (checked.ok) {
    if (checked.fixes.length > 0) deps.log?.warn("planner_draft_fixed", { adaptationId: run.job.adaptation_id, fixes: checked.fixes.join("; ").slice(0, 400) });
    return { ok: true, plan: checked.plan, declarations: checked.declarations };
  }
  return { ok: false, diagnosis: { ...base, kind: checked.kind, issues: checked.issues, truncated: false, output_tokens: outputTokens, deterministic_fixes: checked.fixes } };
}

/**
 * The content-free record of a rejected planner answer (a `planner_draft` artifact that carries no draft, under its own input) and
 * its log line: stage, contract and prompt version, kind, invalid paths and rules, cut-off or not, tokens, repair, final reason.
 * Never the model's text, the material or anything about the learner.
 */
async function recordDraftRejection(deps: OrchestratorDeps, run: StageRun, callFp: string, diagnosis: PlanDraftDiagnosis) {
  await deps.store.putArtifact(run.job.adaptation_id, run.lease, "planner_draft", fingerprint({ rejected: callFp }), fingerprint({ rejected: callFp, diagnosis }), { rejected: true, diagnosis });
  deps.log?.warn("planner_output_rejected", {
    adaptationId: run.job.adaptation_id,
    jobId: run.job.id,
    schema: diagnosis.schema,
    kind: diagnosis.kind,
    truncated: diagnosis.truncated,
    outputTokens: diagnosis.output_tokens,
    maxOutputTokens: diagnosis.max_output_tokens,
    paths: diagnosis.issues.map((i) => i.path).join(",").slice(0, 400),
    codes: [...new Set(diagnosis.issues.map((i) => i.code))].join(","),
    repairAttempted: diagnosis.repair_attempted,
    finalReason: diagnosis.final_reason ?? null,
  });
}

export async function runPlanningStage(deps: OrchestratorDeps, adaptationId: string, options: { acknowledgeAmbiguous?: boolean; enqueueOnly?: boolean } = {}): Promise<StageOutcome> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status === "cancelled") return { outcome: "rejected", status, code: "cancelled" };
  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return { outcome: error.kind === "human_action_required" ? "human_action_required" : "rejected", status, code: error.code, detail: error.message };
    throw error;
  }
  const inputFp = planningFingerprint(snapshot.adaptation, loaded.versions);

  // Already planned for exactly this input: reuse, no job, no provider call.
  if (SETTLED.includes(status) && (await store.findArtifact(adaptationId, "plan_validation", { inputFingerprint: inputFp }))) return { outcome: "reused", status };

  // No unit, no work: an adaptation that does not hold its entitlement never reaches a provider.
  if (deps.entitlements?.assertReserved && !(await deps.entitlements.assertReserved({ id: adaptationId, workspaceId: snapshot.adaptation.workspace_id }))) {
    return { outcome: "rejected", status, code: "entitlement_not_reserved" };
  }
  let enqueued;
  try {
    enqueued = await store.enqueueStage(adaptationId, "planning", inputFp, settings(deps).maxAttempts);
  } catch (error) {
    if (error instanceof InvalidStateError) return { outcome: "rejected", status, code: "plan_review_required", detail: error.detail };
    throw error;
  }
  if (enqueued.status === "completed") {
    // The job finished but the process died before moving the adaptation on: finish that, nothing else.
    if (status === "planning") await store.transition(adaptationId, "planning", "awaiting_plan_review");
    return { outcome: "reused", status: status === "planning" ? "awaiting_plan_review" : status, jobId: enqueued.jobId };
  }
  if (options.enqueueOnly) return { outcome: "enqueued", status: ((await store.getPipeline(adaptationId))?.adaptation.status as AdaptationStatus | undefined) ?? status, jobId: enqueued.jobId, reusedJob: enqueued.reused };

  const job = await claim(deps, enqueued.jobId, options.acknowledgeAmbiguous === true);
  if (!job) return { outcome: "skipped", status, jobId: enqueued.jobId };
  const run: StageRun = { job, lease: { jobId: job.id, attempt: job.attempts }, ids: { workspaceId: job.workspace_id, adaptationId: job.adaptation_id, materialId: job.material_id, jobId: job.id, jobAttempt: job.attempts } };

  try {
    const ambiguous = await stopOnAmbiguity(deps, run, loaded, "planning");
    if (ambiguous) return ambiguous;
    const current = (await store.getPipeline(adaptationId))!.adaptation.status as AdaptationStatus;
    if (current === "queued") await advance(store, adaptationId, current, "planning");

    const services = deps.services(loaded.versions, loaded.analysis, loaded.snapshot.adaptation.workspace_id);
    await store.setStep(job.id, job.attempts, "planning", 30);

    let first = await draftAttempt(deps, run, loaded, services, inputFp);
    // ONE repair call per attempt of the planning job, whatever needed it: an answer that breaks the contract (with its exact fields, and more room
    // if it was cut off), or a valid plan with blocking issues (the existing policy). Never the same request again without news.
    let repairUsed = false;
    if (!first.ok) {
      repairUsed = true;
      await recordDraftRejection(deps, run, inputFp, first.diagnosis);
      const notes = repairNotes(first.diagnosis.kind, first.diagnosis.issues);
      const budget = first.diagnosis.truncated ? truncationBudget(loaded.versions.planner.max_output_tokens) : undefined;
      const repairFp = fingerprint({ input: inputFp, schema_repair: notes, budget: budget ?? null });
      const second = await draftAttempt(deps, run, loaded, services, repairFp, notes, budget);
      if (!second.ok) {
        const final = { ...second.diagnosis, repair_attempted: true, final_reason: `el borrador no cumple el contrato tras una reparación (${second.diagnosis.kind})` };
        await recordDraftRejection(deps, run, repairFp, final);
        deps.log?.warn("planning_failed", { adaptationId, reason: final.final_reason, kind: final.kind, paths: final.issues.map((i) => i.path).join(","), truncated: final.truncated });
        throw new AdaptationError("planner_schema", final.final_reason);
      }
      first = second;
    }
    let plan = first.plan;
    let declarations = first.declarations;
    let checked = applicablePlan(plan, loaded.analysis, loaded.context);
    if (!checked.validation.valid && !repairUsed) {
      // Whatever still blocks is never applied; a repair that breaks the contract keeps the first plan (its blocked decisions out).
      const issues = checked.validation.issues.filter((i) => i.severity === "block");
      const repairFp = fingerprint({ input: inputFp, repair: issues });
      const repaired = await draftAttempt(deps, run, loaded, services, repairFp, issues);
      if (repaired.ok) {
        plan = repaired.plan;
        declarations = repaired.declarations;
        checked = applicablePlan(plan, loaded.analysis, loaded.context);
      } else {
        await recordDraftRejection(deps, run, repairFp, { ...repaired.diagnosis, repair_attempted: true, final_reason: "la reparación de los bloqueos no cumple el contrato: se conserva el primer plan" });
      }
    }
    const validation = checked.validation;
    const classification = classifyPlan(plan, validation);
    const planFp = fingerprint(plan);
    await store.setStep(job.id, job.attempts, "validating", 80);
    await store.putArtifact(adaptationId, run.lease, "plan", inputFp, planFp, plan);
    // v3: the method's declarations travel with the validation of the plan they belong to (ADR-046). They are the model's own
    // statements (screened), not derivable later; the decision ledger is recomputed on demand from them.
    await store.putArtifact(adaptationId, run.lease, "plan_validation", inputFp, fingerprint({ validation, classification, declarations }), { plan_fingerprint: planFp, validation, classification, ...(declarations ? { declarations } : {}) });
    if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
    await store.transition(adaptationId, "planning", "awaiting_plan_review");
    return { outcome: "completed", status: "awaiting_plan_review", jobId: job.id };
  } catch (error) {
    if (error instanceof LeaseLostError) return { outcome: "skipped", status: (await store.getPipeline(adaptationId))?.adaptation.status as AdaptationStatus ?? status, jobId: job.id };
    return failStage(deps, run, "planning", error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The human gate
// ---------------------------------------------------------------------------------------------------------------------

export type SubmitReviewResult =
  | { ok: true; executable: true; reviewFingerprint: string; execution: ExecutabilityReport }
  | { ok: true; executable: false; reviewFingerprint: string; execution: ExecutabilityReport }
  | { ok: false; code: "plan_review_required" | "stale_review" | "invalid_review" | "invalid_input" | "stale_analysis"; detail: string[] };

/** The current plan of an adaptation: the one planned for its current input. */
async function currentPlan(store: AdaptationStore, snapshot: PipelineSnapshot, loaded: Loaded): Promise<{ plan: AdaptationPlan; fingerprint: string } | null> {
  const artifact = await store.findArtifact(snapshot.adaptation.id, "plan", { inputFingerprint: planningFingerprint(snapshot.adaptation, loaded.versions) });
  if (!artifact) return null;
  const plan = AdaptationPlanSchema.parse(artifact.payload);
  return { plan, fingerprint: artifact.fingerprint };
}

/**
 * The v3 declarations of the current plan (ADR-046), stored with its validation; null for every other planner. Read with a schema:
 * an artifact is data, and a malformed one counts as «no declarations» only for plans that are not v3.
 */
async function currentDeclarations(store: AdaptationStore, snapshot: PipelineSnapshot, loaded: Loaded): Promise<PlannerDeclarations | null> {
  if (loaded.versions.planner.prompt_version !== 3) return null;
  const artifact = await store.findArtifact(snapshot.adaptation.id, "plan_validation", { inputFingerprint: planningFingerprint(snapshot.adaptation, loaded.versions) });
  const declarations = (artifact?.payload as { declarations?: PlannerDeclarations } | undefined)?.declarations;
  // A v3 plan without its declarations cannot tell what to withhold: nothing is applied automatically.
  if (!declarations || typeof declarations.decisions !== "object") throw new AdaptationError("invalid_input", "el plan v3 no conserva sus declaraciones");
  return declarations;
}

/**
 * Registers a teacher's review. Never overwrites an earlier one (each is a new, immutable artifact tied to the raw plan's
 * fingerprint). A review that approves a blocked decision, leaves an edit still blocked, or belongs to another plan is refused
 * and not persisted. A valid one builds the effective plan and runs the execution preflight: with an `unsupported` decision
 * nothing is queued and the adaptation stays in `awaiting_plan_review`.
 */
export async function submitPlanReview(deps: OrchestratorDeps, adaptationId: string, reviewInput: unknown, audit: Record<string, unknown> = {}, options: { hold?: boolean } = {}): Promise<SubmitReviewResult> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  if (snapshot.adaptation.status !== "awaiting_plan_review") return { ok: false, code: "plan_review_required", detail: [`estado ${snapshot.adaptation.status}`] };
  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return { ok: false, code: error.code === "stale_analysis" ? "stale_analysis" : "invalid_input", detail: [error.message] };
    throw error;
  }
  const raw = await currentPlan(store, snapshot, loaded);
  if (!raw) return { ok: false, code: "plan_review_required", detail: ["no hay plan que revisar"] };
  const parsed = PlanReviewSchema.safeParse(reviewInput);
  if (!parsed.success) return { ok: false, code: "invalid_review", detail: parsed.error.issues.slice(0, 5).map((i) => i.message) };
  // Planner V2.2 (ADR-047): a decision the method withheld is applied only with the teacher's explicit «yes». Checked here, never
  // trusted to the screen: a review that approves or edits one without it is refused and not persisted.
  if (parsed.data.reviewer.kind !== "auto") {
    let declarations: PlannerDeclarations | null;
    try {
      declarations = await currentDeclarations(store, snapshot, loaded);
    } catch (error) {
      if (error instanceof AdaptationError) return { ok: false, code: "invalid_input", detail: [error.message] };
      throw error;
    }
    const unconfirmed = withheldWithoutConfirmation(parsed.data, declarations);
    if (unconfirmed.length > 0) return { ok: false, code: "invalid_review", detail: unconfirmed.map((id) => `${id}: decisión retenida sin confirmación del docente`) };
  }
  const review: PlanReview = normalizeTeacherEdits(raw.plan, parsed.data);

  let reviewed: ReviewedPlan;
  try {
    reviewed = reviewPlan(raw.plan, review, loaded.analysis, loaded.context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "revisión no válida";
    return { ok: false, code: message.includes("otro plan") ? "stale_review" : "invalid_review", detail: [message] };
  }
  const refused = reviewed.decisions.filter((d) => d.outcome === "approval_refused_blocked" || d.outcome === "edit_still_blocked");
  if (refused.length > 0) return { ok: false, code: "invalid_review", detail: refused.map((d) => `${d.id}: ${d.outcome}`) };

  const reviewFp = fingerprint(review);
  await store.putArtifact(adaptationId, null, "plan_review", raw.fingerprint, reviewFp, review);
  const execution = planExecutability(reviewed, loaded.analysis, loaded.context);
  await store.putArtifact(adaptationId, null, "execution_report", reviewFp, fingerprint({ review: reviewFp, execution }), { ...audit, review_fingerprint: reviewFp, plan_fingerprint: raw.fingerprint, effective: reviewed.effective.decisions.map((d) => d.id), execution, effective_valid: reviewed.effectiveValidation.valid });

  if (execution.blockers.length > 0 || !reviewed.effectiveValidation.valid || options.hold) return { ok: true, executable: false, reviewFingerprint: reviewFp, execution };
  await store.transition(adaptationId, "awaiting_plan_review", "generation_queued");
  return { ok: true, executable: true, reviewFingerprint: reviewFp, execution };
}

/**
 * Why «Hacer magia» stopped without a sheet, recorded next to the review it concerns (an `execution_report` that carries no
 * execution): the cost guards refused the generation (`generation_refused`), or a sheet that failed its quality review has no safe
 * automatic correction left (`quality`). The stop before any generation (a need nothing covers) is read from the state itself.
 */
export type AutomaticStopCode = "generation_refused" | "quality" | VisualStopCode;

async function recordAutomaticStop(store: AdaptationStore, adaptationId: string, reviewFp: string, code: AutomaticStopCode, detail: string) {
  await store.putArtifact(adaptationId, null, "execution_report", reviewFp, fingerprint({ review: reviewFp, automatic_stop: code, detail }), { review_fingerprint: reviewFp, automatic_stop: code, detail });
}

/** Queues the generation of the review just saved; the cost guards may refuse it, which is recorded (not a crash, not a loop). */
async function enqueueAutomatically(deps: OrchestratorDeps, adaptationId: string, reviewFp: string): Promise<GenerationResult | null> {
  try {
    return await enqueueGeneration(deps, adaptationId);
  } catch (error) {
    if (error instanceof GenerationLimitError || error instanceof FailureBudgetError) {
      const detail = error instanceof FailureBudgetError ? "failure_budget" : "generation_limit";
      deps.log?.warn("automatic_generation_refused", { adaptationId, code: detail });
      await recordAutomaticStop(deps.store, adaptationId, reviewFp, "generation_refused", detail);
      return null;
    }
    throw error;
  }
}

/**
 * «Hacer magia»: crosses the human gate for an adaptation created in `automatic` mode. The server submits its capability-aware
 * resolution (`resolveAutomatically`: what can be executed is applied, what cannot gets an equivalent alternative or is left out
 * only when nothing important is lost) through the SAME `submitPlanReview`, and queues the SAME generation job; the deterministic
 * and pedagogical reviews still decide whether anything is delivered. The resolution of every decision is kept in the execution
 * report (audit). A decision that answers a high need and that nothing can execute stays approved, so the preflight stops: the
 * adaptation waits, honestly, for the teacher to CHOOSE to edit it (never sent there by itself).
 * Idempotent and bounded: it acts only in `automatic` mode, only while awaiting the plan review, and only if the current plan has
 * no review yet. The review is deterministic (same plan, same fingerprint), so two racing calls store one review and one job.
 */
export async function continueAutomatically(deps: OrchestratorDeps, adaptationId: string): Promise<GenerationResult | null> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot || snapshot.adaptation.creation_mode !== "automatic" || snapshot.adaptation.status !== "awaiting_plan_review") return null;
  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return null;
    throw error;
  }
  const raw = await currentPlan(store, snapshot, loaded);
  if (!raw) return null;
  if ((await store.listArtifacts(adaptationId, "plan_review")).some((a) => a.input_fingerprint === raw.fingerprint)) return null;
  const resolution = resolveAutomatically(raw.plan, loaded.analysis, loaded.context);
  // v3 (ADR-046/047): a decision the method withheld (conditional, a hint that could give the answer, a strategy foreign to its
  // needs) is resolved here without asking anyone: a safe variant, an alternative, or the original kept (`autonomous-resolution`).
  // «Hacer magia» never waits for a teacher's «yes»; every resolution and its cause stay in the report for the teacher to read later.
  let declarations: PlannerDeclarations | null;
  try {
    declarations = await currentDeclarations(store, snapshot, loaded);
  } catch (error) {
    if (error instanceof AdaptationError) return null;
    throw error;
  }
  const autonomous = declarations ? resolveWithheldAutonomously(resolution.review, raw.plan, declarations, loaded.analysis, loaded.context) : { review: resolution.review, resolutions: [], uncovered: [] };
  // Keeping the original is not solving a barrier: a HIGH need that no other applied decision (or the presentation) covers is an
  // honest stop, named, never a sheet declared valid with an essential need left open.
  const lost = new Map(autonomous.uncovered.map((u) => [u.decision_id, u.dimensions]));
  const outcomes = resolution.outcomes.map((o) => (lost.has(o.decision_id) ? { ...o, kind: "unresolved" as const, reason: "Conservar el original deja sin atender una necesidad importante del perfil que ninguna otra decisión cubre", uncovered: lost.get(o.decision_id)! } : o));
  const unresolved = outcomes.filter((o) => o.kind === "unresolved").map((o) => o.decision_id);
  // Etapa 2.2 (evidence C), after every resolution and mode-aware: `on` adds the restriction, `dry_run` only records what it would add.
  const guardMode = deps.supportSubstitution ?? DEFAULT_SUBSTITUTION_MODE;
  const guard = applySupportGuard(autonomous.review, raw.plan, loaded.analysis, guardMode);
  const review = guard.review;
  // Why each applied decision exists: the need, the declared barrier it reduces, the declared strength it takes advantage of and what
  // it keeps. From the profile's own declarations (no model, no student data), kept for the teacher to consult afterwards.
  const applied = new Set(review.entries.filter((e) => e.action !== "rejected").map((e) => e.decision_id));
  const justifications = justifyDecisions(raw.plan.decisions.filter((d) => applied.has(d.id)), loaded.context.learning_observations);
  // Saved in every case (audit, and what the status reads); held only when a high need has no executable decision at all.
  const submitted = await submitPlanReview(deps, adaptationId, review, { automatic: { outcomes, unresolved, ...(autonomous.resolutions.length > 0 ? { withheld_resolved: autonomous.resolutions } : {}), ...(guard.guarded.length > 0 ? { support_guard: { mode: guardMode, decisions: guard.guarded } } : {}), justifications } }, { hold: unresolved.length > 0 });
  if (!submitted.ok || !submitted.executable) {
    deps.log?.warn("automatic_review_incomplete", { adaptationId, code: submitted.ok ? "execution_unsupported" : submitted.code, unresolved: resolution.unresolved.length });
    return null;
  }
  return enqueueAutomatically(deps, adaptationId, submitted.reviewFingerprint);
}

/**
 * The automatic path picked up again after an interruption (the process died between two steps, a refresh): continue the gate,
 * correct a blocked sheet, or queue a generation whose review was saved but never queued. Never after a teacher took over, never
 * again after the cost guards refused (that stop is recorded), and never more than the limits allow.
 */
export async function resumeAutomatically(deps: OrchestratorDeps, adaptationId: string): Promise<GenerationResult | null> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  if (!snapshot || snapshot.adaptation.creation_mode !== "automatic") return null;
  if (snapshot.jobs.some((j) => j.status === "queued" || j.status === "processing")) return null;
  const status = snapshot.adaptation.status as AdaptationStatus;
  // At the gate: the first resolution if the plan has none yet; after a generation, an interrupted correction (or the honest stop).
  if (status === "awaiting_plan_review") return (await continueAutomatically(deps, adaptationId)) ?? correctAutomatically(deps, adaptationId);
  if (status === "blocked") return correctAutomatically(deps, adaptationId);
  if (status !== "generation_queued") return null;
  const last = (await deps.store.listArtifacts(adaptationId, "plan_review")).at(-1);
  if (!last || (last.payload as { reviewer?: { kind?: string } }).reviewer?.kind !== "auto") return null;
  const stopped = (await deps.store.listArtifacts(adaptationId, "execution_report")).some((a) => (a.payload as { review_fingerprint?: string; automatic_stop?: string }).review_fingerprint === last.fingerprint && a.payload.automatic_stop !== undefined);
  return stopped ? null : enqueueAutomatically(deps, adaptationId, last.fingerprint);
}

const CORRECTION_REASON = "La revisión de calidad volvió a encontrar el problema tras corregirlo: se mantiene el original (sus necesidades siguen cubiertas)";
const REPAIR_REASON = "Lo generado para esta decisión volvió a fallar tras corregirlo: se mantiene el original (sus necesidades siguen cubiertas)";

/**
 * What the generator is asked, as a restriction of the decision, to repair a failed check (fixed server wording: never the
 * reviewer's text, never content). Restrictions already travel to the generator in contract v2 (`restrictions`).
 */
const SCOPE = "Escribe solo los apoyos que autoriza esta decisión y no reescribas la consigna si no se te pide.";
const NO_REPEAT = "No repitas frases de la consigna ni de otros apoyos de esta actividad: cada elemento debe aportar algo nuevo.";
const EXECUTE = "Genera los apoyos de esta decisión o, si no aportan nada, decláralo como omitido con su motivo.";
const ANSWER_NOT_GIVEN = "Ningún apoyo puede contener, calcular ni insinuar la respuesta de la actividad: un ejemplo usa otro ámbito y otros datos; guía el proceso sin dar el resultado.";
const AUDIT_RESTRICTIONS: Readonly<Record<string, string>> = {
  [SUPPORT_SOLVES_CHECK]: ANSWER_NOT_GIVEN,
  "el generador no propuso nada fuera de lo autorizado": SCOPE,
  "cada bloque generado es de un tipo que su decisión autoriza": SCOPE,
  "ninguna frase se repite literalmente dentro de una actividad": NO_REPEAT,
  "todas las decisiones aprobadas se ejecutaron o se rechazaron de forma estructurada": EXECUTE,
  [INVALID_BLOCK_CHECK]: "Cada bloque debe respetar el contrato: textos dentro de su longitud máxima, tablas con todas sus celdas y solo los campos de su tipo.",
  [CONCEPT_LEAK_CHECK]: "No definas en un apoyo las categorías o conceptos que la actividad pide clasificar o identificar: el apoyo puede recordar cómo trabajar, nunca dar la clave.",
  [MISSING_ACTIVITY_CHECK]: "Conserva la actividad completa: si reescribes su consigna, el segmento debe incluir la actividad, nunca solo apoyos.",
  [RESPONSE_AREA_CHECK]: "No cambies la zona de respuesta de la actividad: conserva sus campos, sus líneas y su espacio.",
  [LITERAL_COPY_CHECK]: SCOPE,
};
const REVIEW_RESTRICTIONS: Partial<Record<PedagogicalReview["checks"][number]["check"], string>> = {
  answers_not_leaked: "Ningún apoyo puede contener, calcular ni insinuar la respuesta de la actividad: un ejemplo usa otros datos; si no, guía el proceso sin dar el resultado.",
  protected_elements_preserved: "Conserva intactos los datos, las condiciones y los elementos esenciales de la consigna.",
  required_data_preserved: "Conserva intactos los datos, las condiciones y los elementos esenciales de la consigna.",
  constraints_preserved: "Conserva intactos los datos, las condiciones y los elementos esenciales de la consigna.",
  instructions_complete: "Conserva intactos los datos, las condiciones y los elementos esenciales de la consigna.",
  objectives_preserved: "Conserva intactos los datos, las condiciones y los elementos esenciales de la consigna.",
  response_format_appropriate: "No cambies la forma de responder que pide la actividad.",
  no_infantilization: "Usa un tono y un vocabulario propios de la edad del alumnado, sin infantilizar.",
  age_appropriate: "Usa un tono y un vocabulario propios de la edad del alumnado, sin infantilizar.",
  reading_load_reasonable: "Haz el apoyo más breve y directo: menos texto, la misma función.",
  visual_load_reasonable: "Haz el apoyo más breve y directo: menos texto, la misma función.",
  functional_supports_applied: "El apoyo debe responder de forma concreta a la necesidad funcional de esta decisión.",
  traceability_complete: EXECUTE,
};
const budgetRestriction = (words: number) => `Los apoyos de esta decisión deben sumar como máximo ${words} palabras visibles; un ejemplo resuelto conserva todos sus pasos necesarios.`;

/**
 * Leaving out `drop` would leave ANY need it attends (high, medium or low) with nothing that attends it: neither another decision
 * that stays nor the presentation. A sheet that passes every check but silently lost one of the profile's adaptations is not
 * finished, so this is the condition for ever leaving a decision out automatically.
 */
function losesCoverage(effective: readonly AdaptationPlan["decisions"][number][], drop: ReadonlySet<string>, context: AdaptationContext, analysis: MaterialAnalysis): boolean {
  const kept = effective.filter((d) => !drop.has(d.id));
  // For an ESSENTIAL (high) need, «covered» means by a decision that REACHES the dropped one's target: the same dimension on another
  // activity does not help this one. Medium and low needs keep their earlier reading (any remaining decision of that dimension).
  const high = new Set(context.needs.filter((n) => n.level === "high").map((n) => n.dimension));
  return effective.some((d) => drop.has(d.id) && d.dimensions.some((dim) => !isResolvedByPresentation(dim, context.presentation) && !kept.some((k) => k.dimensions.includes(dim) && (!high.has(dim) || reaches(k, d, analysis)))));
}

/** What the repair knows about supports that hand over the answer (etapa 2.2). */
export interface SupportRepair {
  mode: SubstitutionMode;
  flags: ReadonlyMap<string, SupportFlag>;
  /** Evidence B: decisions with a structural signal. They are asked their restriction only when a repair is happening anyway; never dropped, never a call of their own. */
  structural: ReadonlyMap<string, SupportFlag>;
  /** Decisions already substituted in an earlier cycle: a second substitution is never attempted. */
  alreadySubstituted: ReadonlySet<string>;
  /** Filled by `planRepair`, also when it ends in a stop: the trace of every decision it touched (codes and ids only). */
  trace: SupportResolutionRecord[];
}

/**
 * The repair of a failed generation or review, decision by decision, CONTENT FIRST:
 *   1. a decision that has not been asked this yet keeps its place and gets the restriction that names what to fix: it is generated
 *      again with it (the useful adaptation is repaired, not removed);
 *   2. one that already carried that restriction and failed again (or for which no restriction can say what to fix) is left out,
 *      its part keeping the original, ONLY if every need it attends stays covered (`losesCoverage`);
 *   3. otherwise null: no safe repair, the honest stop.
 * Etapa 2.2: between 1 and 2, a support that hands over the answer is SUBSTITUTED once by one that serves the same needs
 * (`planSubstitution`). If none exists the decision is left out and its needs are recorded as covered elsewhere or uncovered, never
 * as applied; an ESSENTIAL need left uncovered is the honest stop. The result must still be executable.
 */
export function planRepair(raw: AdaptationPlan, previous: PlanReview, loaded: Loaded, asks: ReadonlyMap<string, ReadonlyArray<string | null>>, dropReason: string, support?: SupportRepair): { review: PlanReview; restricted: string[]; dropped: string[] } | null {
  const effective = reviewPlan(raw, previous, loaded.analysis, loaded.context).effective.decisions;
  const restricted: string[] = [];
  const drop = new Set<string>();
  const entries = previous.entries.map((e) => {
    const wanted = asks.get(e.decision_id);
    if (!wanted) return e;
    const current = e.restrictions ?? [];
    const missing = [...new Set(wanted)].filter((r): r is string => r !== null && !current.includes(r));
    const flag = support?.flags.get(e.decision_id);
    const soft = flag ? undefined : support?.structural.get(e.decision_id);
    const decision = effective.find((d) => d.id === e.decision_id);
    // A decision asked only for a structural signal that already carries that restriction is left as it is: it is never left out for it.
    if (soft && (missing.length === 0 || current.length + missing.length > 6)) return e;
    if (wanted.includes(null) || missing.length === 0 || current.length + missing.length > 6) {
      if (flag && decision && support!.mode === "on" && e.action !== "rejected" && !support!.alreadySubstituted.has(e.decision_id)) {
        const activity = loaded.analysis.activities.find((a) => a.id === flag.activityId);
        const plan = activity ? planSubstitution({ raw, decision, flagged: flag.kinds, analysis: loaded.analysis, context: loaded.context, activity }) : null;
        // The substitution changes ONLY the supports (and adds its restrictions to the ones already there): an earlier edit of this decision
        // (its action, its response format, the V2.2 resolution's safe variant) and every restriction already asked stay as they were.
        const restrictions = plan ? [...new Set([...current, ...plan.restrictions])] : [];
        if (plan && restrictions.length <= 6) {
          support!.trace.push(recordOf(flag, decision, support!.mode, "substituted", { to: plan.to, option: plan.option, coverage: "same_activity" }));
          // The substitute is WRITTEN by the generator, like any restricted decision: without this the saved draft would be reused as it is.
          restricted.push(e.decision_id);
          return { ...e, action: "edited" as const, reason: e.action === "edited" ? e.reason : SUBSTITUTION_REASON, restrictions, edits: { ...(e.action === "edited" ? e.edits : {}), supports: plan.edits.supports } };
        }
      }
      drop.add(e.decision_id);
      return e;
    }
    restricted.push(e.decision_id);
    const traced = flag ?? soft;
    if (traced && decision && support) support.trace.push(recordOf(traced, decision, support.mode, "restricted", { coverage: "same_activity" }));
    return { ...e, restrictions: [...current, ...missing] };
  });
  if (drop.size > 0) {
    // Only a decision dropped for a support that reveals the answer follows the honest-coverage reading below; any other keeps the strict one.
    const flagged = [...drop].filter((id) => support?.flags.has(id));
    const strictDrop = new Set([...drop].filter((id) => !flagged.includes(id)));
    if (strictDrop.size > 0 && losesCoverage(effective, strictDrop, loaded.context, loaded.analysis)) return null;
    let stop = false;
    for (const id of flagged) {
      const decision = effective.find((d) => d.id === id)!;
      const lost = coverageOf(decision, effective.filter((d) => !drop.has(d.id)), loaded.context, loaded.analysis);
      support!.trace.push(recordOf(support!.flags.get(id)!, decision, support!.mode, lost.essential ? "stopped" : "omitted", { coverage: lost.coverage, uncovered: lost.uncovered }));
      if (lost.essential) stop = true;
    }
    if (stop) return null;
  }
  const review: PlanReview = { ...previous, entries: entries.map((e) => (drop.has(e.decision_id) ? { decision_id: e.decision_id, action: "rejected" as const, reason: dropReason.slice(0, 160) } : e)) };
  const check = reviewPlan(raw, review, loaded.analysis, loaded.context);
  if (planExecutability(check, loaded.analysis, loaded.context).blockers.length > 0 || !check.effectiveValidation.valid) return null;
  return { review, restricted, dropped: [...drop] };
}

/**
 * The decisions whose support hands over the answer, from the audit's own evidence: a LITERAL finding (an answer part the sheet does
 * not show, stated or grounded in the material), or a support the generator declined for revealing it. Nothing less.
 */
function supportFlagsOf(loaded: Loaded, effective: readonly AdaptationPlan["decisions"][number][], document: MaterialDocument, generation: NormalizedGeneration): Map<string, SupportFlag> {
  const flags = new Map<string, SupportFlag>();
  const blocks = allBlocks(document);
  for (const finding of assessSupports(loaded.analysis, document).findings.filter(isActionable)) {
    const block = blocks.find((b) => b.id === finding.block_id);
    for (const id of finding.decision_ids) {
      const decision = effective.find((d) => d.id === id);
      if (!decision || !block) continue;
      const before = flags.get(id);
      flags.set(id, {
        decisionId: id,
        activityId: finding.activity_id,
        blockIds: [...new Set([...(before?.blockIds ?? []), finding.block_id])],
        kinds: [...new Set([...(before?.kinds ?? []), ...kindsOfBlock(block, decision)])],
        trigger: "literal_answer",
        codes: [...new Set([...(before?.codes ?? []), finding.code])],
      });
    }
  }
  for (const id of revealDeclines(generation)) {
    const decision = effective.find((d) => d.id === id);
    if (!decision || flags.has(id) || !loaded.analysis.activities.some((a) => a.id === decision.target)) continue;
    flags.set(id, { decisionId: id, activityId: decision.target, blockIds: [], kinds: decision.supports.map((s) => s.kind), trigger: "declined_reveal", codes: [] });
  }
  return flags;
}

function supportRepairOf(loaded: Loaded, effective: readonly AdaptationPlan["decisions"][number][], document: MaterialDocument, generation: NormalizedGeneration, mode: SubstitutionMode, alreadySubstituted: ReadonlySet<string>): SupportRepair {
  const flags = supportFlagsOf(loaded, effective, document, generation);
  return { mode, flags, structural: mode === "on" ? structuralSignalsOf(loaded, effective, document, flags) : new Map(), alreadySubstituted, trace: [] };
}

/** Decisions whose support shows a STRUCTURAL signal (the task's own data, the same relation, an item assigned to its category) and no literal one. */
function structuralSignalsOf(loaded: Loaded, effective: readonly AdaptationPlan["decisions"][number][], document: MaterialDocument, literal: ReadonlyMap<string, SupportFlag>): Map<string, SupportFlag> {
  const signals = new Map<string, SupportFlag>();
  const blocks = allBlocks(document);
  for (const finding of assessSupports(loaded.analysis, document).findings.filter((f) => f.evidence === "structural" && f.action === "warn")) {
    const block = blocks.find((b) => b.id === finding.block_id);
    for (const id of finding.decision_ids) {
      const decision = effective.find((d) => d.id === id);
      if (!decision || !block || literal.has(id)) continue;
      const before = signals.get(id);
      signals.set(id, { decisionId: id, activityId: finding.activity_id, blockIds: [...new Set([...(before?.blockIds ?? []), finding.block_id])], kinds: [...new Set([...(before?.kinds ?? []), ...kindsOfBlock(block, decision)])], trigger: "structural_signal", codes: [...new Set([...(before?.codes ?? []), finding.code])] });
    }
  }
  return signals;
}

/** Every substitution record an earlier cycle of this adaptation kept (in a submitted repair review, or next to a stop), oldest first. */
async function earlierResolutions(store: AdaptationStore, adaptationId: string): Promise<SupportResolutionRecord[]> {
  return (await store.listArtifacts(adaptationId, "execution_report")).flatMap((a) => {
    const p = a.payload as { support_resolution?: SupportResolutionRecord[]; automatic?: { support_resolution?: SupportResolutionRecord[] } };
    return [...(p.support_resolution ?? []), ...(p.automatic?.support_resolution ?? [])];
  });
}

/**
 * What became of each decision a substitution touched, read from the FINAL sheet, never from the plan:
 *   · applied        its support (the substitute or the restricted one) is in the document and serves every need of the decision;
 *   · partial        only some of its needs are served by what is there;
 *   · not_generated  nothing of it reached the document (the generator wrote nothing, or declined again);
 *   · flagged        it is there and still hands over the answer;
 *   · omitted        it was left out and another decision that really reaches the activity serves every need (its support is present);
 *   · uncovered      it was left out and some need is served by nothing present.
 * Only `applied` may be read as «the need is applied».
 */
function resolutionOutcome(records: readonly SupportResolutionRecord[], loaded: Loaded, effective: readonly AdaptationPlan["decisions"][number][], document: MaterialDocument, flagged: ReadonlySet<string>) {
  const blocks = allBlocks(document).filter((b) => b.trace.origin === "support" || b.trace.origin === "extension");
  const presentKinds = (decision: AdaptationPlan["decisions"][number]) => new Set(blocks.filter((b) => b.trace.decision_ids.includes(decision.id)).flatMap((b) => kindsOfBlock(b, decision)));
  const last = new Map(records.map((r) => [r.decision_id, r] as const));
  return [...last.values()].map((r) => {
    const decision = effective.find((d) => d.id === r.decision_id);
    let result: "applied" | "partial" | "not_generated" | "flagged" | "omitted" | "uncovered";
    if (r.action === "omitted" || r.action === "stopped") {
      const covered = r.dimensions.every((dim) => isResolvedByPresentation(dim, loaded.context.presentation) || effective.some((k) => k.id !== r.decision_id && k.dimensions.includes(dim) && (k.target === r.activity_id || reaches(k, { target: r.activity_id }, loaded.analysis)) && (k.supports.length === 0 || presentKinds(k).size > 0)));
      result = covered ? "omitted" : "uncovered";
    } else if (!decision) {
      result = "omitted";
    } else {
      const here = [...presentKinds(decision)];
      result = here.length === 0 ? "not_generated" : !servesAll(here, r.dimensions, loaded.context) ? "partial" : flagged.has(r.decision_id) ? "flagged" : "applied";
    }
    return { decision_id: r.decision_id, action: r.action, coverage: r.coverage, uncovered: r.uncovered, result, semantic_review: r.semantic_review };
  });
}

/** The semantic judgments (etapa 2.3) the review of THIS document stored next to itself; none when the document was not judged. */
async function semanticRecordsOf(store: AdaptationStore, adaptationId: string, documentFp: string): Promise<SemanticRecord[]> {
  const found = (await store.listArtifacts(adaptationId, "pedagogical_review")).filter((a) => (a.payload as { review?: PedagogicalReview }).review?.document_fingerprint === documentFp).at(-1);
  return (found?.payload as { semantic?: { records?: SemanticRecord[] } } | undefined)?.semantic?.records ?? [];
}

/** The trace of a support substitution, next to the review it concerns (an `execution_report` with no other content). */
async function recordSupportResolution(store: AdaptationStore, adaptationId: string, reviewFp: string, support: SupportRepair) {
  await store.putArtifact(adaptationId, null, "execution_report", reviewFp, fingerprint({ review: reviewFp, support_resolution: support.trace }), { review_fingerprint: reviewFp, support_resolution: support.trace });
}

const addAsk = (asks: Map<string, Array<string | null>>, id: string, restriction: string | null) => asks.set(id, [...(asks.get(id) ?? []), restriction]);

/** Whether an earlier automatic repair of this adaptation was made for exactly these failures (no progress since). */
async function seenSignature(store: AdaptationStore, adaptationId: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  return (await store.listArtifacts(adaptationId, "execution_report")).some((a) => (a.payload as { automatic?: { signature?: string } }).automatic?.signature === signature);
}

/**
 * «Hacer magia» after a quality review that blocks, inside the same limit of generations (`MAX_GENERATION_CYCLES`, enforced by the
 * database too). The decisions whose own output the review found wrong are REPAIRED first: regenerated with a restriction that
 * names what to fix (`planRepair`). Only one that fails again after that is left out, and only if every need it attends stays
 * covered. What each failing check points at is read precisely:
 *   · a block → the decisions in its trace; a decision → itself; an activity or text → the decisions applied to it;
 *   · a protected element → the decisions applied to its activities and resources (the one that rewrites them, when there is one);
 *   · a revealed answer → ONLY the support that reveals it when the check names it (the rest of the activity is left alone).
 * Attempted only when:
 *   · the adaptation is automatic, blocked (or a correction of it was interrupted), and its last review is still the server's;
 *   · EVERY failing check points at applied decisions (a finding about the whole sheet has no safe repair);
 *   · the repaired review is executable.
 * Otherwise nothing changes but one thing: the honest stop is RECORDED (`quality`), so the screen says so and no visit retries it.
 * The sheet stays undelivered and its reserved unit untouched.
 */
export async function correctAutomatically(deps: OrchestratorDeps, adaptationId: string): Promise<GenerationResult | null> {
  let corrected: GenerationResult | null;
  try {
    corrected = await attemptCorrection(deps, adaptationId);
  } catch (error) {
    // Recorded before the error goes up: the screen must not stay «working» and send the run request again and again.
    await recordQualityStop(deps, adaptationId);
    throw error;
  }
  if (!corrected) await recordQualityStop(deps, adaptationId);
  return corrected;
}

/**
 * The honest stop of «Hacer magia» (nothing safe left to try), recorded once for the latest review. Only while it is really stopped:
 * automatic, server-driven, no job running, blocked or back at the plan gate after a generation (the gate before any generation is
 * the `needs_decision` stop, read from the state itself).
 */
async function recordQualityStop(deps: OrchestratorDeps, adaptationId: string): Promise<void> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  if (!snapshot || snapshot.adaptation.creation_mode !== "automatic") return;
  if (snapshot.jobs.some((j) => j.status === "queued" || j.status === "processing")) return;
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status !== "blocked" && !(status === "awaiting_plan_review" && generationCyclesOf(snapshot.jobs) > 0)) return;
  const last = (await deps.store.listArtifacts(adaptationId, "plan_review")).at(-1);
  if (!last || (last.payload as { reviewer?: { kind?: string } }).reviewer?.kind !== "auto") return;
  // Already stopped for this review (e.g. a visual nothing resolves): one stop, one reason.
  if ((await deps.store.listArtifacts(adaptationId, "execution_report")).some((a) => (a.payload as { review_fingerprint?: string; automatic_stop?: string }).review_fingerprint === last.fingerprint && (a.payload as { automatic_stop?: string }).automatic_stop)) return;
  deps.log?.warn("automatic_stop_recorded", { adaptationId, status, cycles: generationCyclesOf(snapshot.jobs) });
  await recordAutomaticStop(deps.store, adaptationId, last.fingerprint, "quality", status);
}

/** Checks whose targets name the units to keep intact: the decision that rewrites a unit is the one to repair. */
const PRESERVING: ReadonlySet<string> = new Set(["protected_elements_preserved", "constraints_preserved", "required_data_preserved", "instructions_complete", "objectives_preserved"]);

async function attemptCorrection(deps: OrchestratorDeps, adaptationId: string): Promise<GenerationResult | null> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot || snapshot.adaptation.creation_mode !== "automatic") return null;
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status !== "blocked" && status !== "awaiting_plan_review") return null;
  if (snapshot.jobs.some((j) => j.status === "queued" || j.status === "processing")) return null;
  const cycles = generationCyclesOf(snapshot.jobs);
  if (cycles === 0 || cycles >= MAX_GENERATION_CYCLES) return null;
  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return null;
    throw error;
  }
  const raw = await currentPlan(store, snapshot, loaded);
  const last = (await store.listArtifacts(adaptationId, "plan_review")).at(-1);
  if (!raw || !last) return null;
  const previous = PlanReviewSchema.parse(last.payload);
  if (previous.reviewer.kind !== "auto" || previous.plan_fingerprint !== raw.fingerprint) return null;
  // A visual nothing could resolve is not fixed by generating the same sheet again.
  if ((await store.listArtifacts(adaptationId, "execution_report")).some((a) => (a.payload as { review_fingerprint?: string; automatic_stop?: string }).review_fingerprint === last.fingerprint && VISUAL_STOP_CODES.has((a.payload as { automatic_stop?: string }).automatic_stop ?? ""))) return null;
  const reviewed = reviewPlan(raw.plan, previous, loaded.analysis, loaded.context);

  // The blocked version, rebuilt exactly (same generation, same deterministic ids, same restoration) to read what each failing
  // block traces to.
  const inputFp = generationFingerprint(raw.fingerprint, last.fingerprint, loaded.versions);
  const generationArtifact = await store.findArtifact(adaptationId, "generation", { inputFingerprint: inputFp });
  if (!generationArtifact) return status === "awaiting_plan_review" ? requeueSavedReview(deps, adaptationId, last.fingerprint, previous) : null;
  const generation = (generationArtifact.payload as { generation: NormalizedGeneration }).generation;
  // The reviews judged the sheet AFTER the visual policy (a figure drawn, an activity rewritten or substituted): the same plan,
  // reused from its artifact, rebuilds that sheet; without it no review matches and nothing could ever be repaired.
  const visualArtifact = await store.findArtifact(adaptationId, "visual_resolution", { inputFingerprint: inputFp });
  const visualPlan = visualArtifact ? (visualArtifact.payload as { plan: VisualResolutionPlan }).plan : null;
  let document;
  try {
    document = assembleAndCheck(loaded, reviewed, generation, true, visualPlan).document;
  } catch (error) {
    if (error instanceof AdaptationError) return null;
    throw error;
  }
  const documentFp = fingerprint(document);
  const reviewsOf = async (kind: "pedagogical_review" | "deterministic_review") =>
    (await store.listArtifacts(adaptationId, kind)).map((a) => (a.payload as { review?: PedagogicalReview }).review).filter((r): r is PedagogicalReview => r?.document_fingerprint === documentFp);
  const review = (await reviewsOf("pedagogical_review")).at(-1) ?? (await reviewsOf("deterministic_review")).at(-1);
  if (!review) return null;
  const failing = review.checks.filter((c) => c.status === "FAIL" && !c.teacher_override);
  if (failing.length === 0) return null;

  const effective = reviewed.effective.decisions;
  const applied = effective.filter((d) => d.action !== "keep");
  const appliedIds = new Set(applied.map((d) => d.id));
  const blocks = allBlocks(document);
  const onUnit = (ref: string, preserving: boolean) => {
    const on = applied.filter((d) => d.target === ref);
    const rewriter = preserving ? designatedRewriter(effective, loaded.analysis, loaded.context, ref) : null;
    return rewriter && appliedIds.has(rewriter) ? [rewriter] : on.map((d) => d.id);
  };
  const implicated = (check: string, targets: readonly string[]) => {
    const preserving = PRESERVING.has(check);
    const revealing = check === "answers_not_leaked" ? targets.filter((t) => t.startsWith("blk_")) : [];
    const ids = new Set<string>();
    for (const t of revealing.length > 0 ? revealing : targets) {
      if (t.startsWith("blk_")) for (const id of blocks.find((b) => b.id === t)?.trace.decision_ids ?? []) if (appliedIds.has(id)) ids.add(id);
      if (t.startsWith("dec_") && appliedIds.has(t)) ids.add(t);
      if (/^(act|ctt|vis|sec)_/.test(t)) for (const id of onUnit(t, preserving)) ids.add(id);
      if (t.startsWith("prt_")) {
        const element = loaded.analysis.protected_elements.find((p) => p.id === t);
        for (const ref of [...(element?.activity_ids ?? []), ...(element?.resource_ids ?? [])]) for (const id of onUnit(ref, preserving)) ids.add(id);
      }
      if (t.startsWith("obj_")) for (const a of loaded.analysis.activities.filter((x) => x.objective_ids.includes(t))) for (const id of onUnit(a.id, preserving)) ids.add(id);
    }
    return ids;
  };
  const perCheck = failing.map((c) => ({ check: c.check, ids: implicated(c.check, c.targets) }));
  const diagnosis = perCheck.map((c) => ({ ...diagnoseReview({ checks: failing.filter((f) => f.check === c.check) })[0]!, decisions: [...c.ids] }));
  if (perCheck.some((c) => c.ids.size === 0)) {
    deps.log?.warn("automatic_correction_unattributed", { adaptationId, checks: perCheck.filter((c) => c.ids.size === 0).map((c) => c.check).join(",") });
    await recordDiagnosis(store, adaptationId, last.fingerprint, "review", diagnosis.map((d) => (d.decisions.length === 0 ? { ...d, repair: "none" as const } : d)));
    return null;
  }
  const signature = failureSignature(diagnosis);
  const repeated = await seenSignature(store, adaptationId, signature);
  // The same deterministic preservation failure on the same decisions after a targeted repair (and after the original was put
  // back): the generator is not what fails, so another generation would only spend a cycle. The honest stop, with its diagnosis.
  if (repeated && failing.every((c) => c.method === "deterministic" && PRESERVING.has(c.check))) {
    deps.log?.warn("automatic_correction_not_repeated", { adaptationId, checks: failing.map((c) => c.check).join(",") });
    await recordDiagnosis(store, adaptationId, last.fingerprint, "review", diagnosis.map((d) => ({ ...d, repair: "none" as const })));
    return null;
  }
  const asks = new Map<string, Array<string | null>>();
  for (const { check, ids } of perCheck) for (const id of ids) addAsk(asks, id, repeated ? null : (REVIEW_RESTRICTIONS[check] ?? null));
  // Etapa 2.3 (`REVIEWER_V2_MODE=on` only): what the semantic review CONFIRMED. Each support that did the student's work is asked, in fixed
  // wording, for what it must not do; a repeat leaves that rung. Only with `SUPPORT_SUBSTITUTION_MODE=on` may it then be substituted: in
  // `dry_run` or `off` the repair is exactly the one every other review failure gets, never a silent substitution.
  let support: SupportRepair | undefined;
  if (effectiveReviewerMode(deps.reviewerV2, loaded.versions.reviewer.prompt_version) === "on") {
    const confirmed = (await semanticRecordsOf(store, adaptationId, documentFp)).filter((r) => r.status === "confirmed");
    for (const r of confirmed) for (const id of r.decision_ids) if (appliedIds.has(id)) addAsk(asks, id, repeated ? null : restrictionFor(r));
    const substitution = deps.supportSubstitution ?? DEFAULT_SUBSTITUTION_MODE;
    const flags = semanticFlags(confirmed, effective);
    if (substitution === "on" && flags.size > 0) {
      support = { mode: substitution, flags, structural: new Map(), alreadySubstituted: new Set((await earlierResolutions(store, adaptationId)).filter((r) => r.action === "substituted").map((r) => r.decision_id)), trace: [] };
    }
  }
  const repair = planRepair(raw.plan, previous, loaded, asks, CORRECTION_REASON, support);
  if (!repair) {
    if (support && support.trace.length > 0) await recordSupportResolution(store, adaptationId, last.fingerprint, support);
    await recordDiagnosis(store, adaptationId, last.fingerprint, "review", diagnosis.map((d) => ({ ...d, repair: "none" as const })));
    return null;
  }

  if (status === "blocked") {
    try {
      await reopenPlanReview(deps, adaptationId);
    } catch (error) {
      if (error instanceof GenerationLimitError) return null;
      throw error;
    }
  }
  const submitted = await submitPlanReview(deps, adaptationId, repair.review, { automatic: { correction_of: last.fingerprint, restricted: repair.restricted, dropped: repair.dropped, failing: failing.map((c) => c.check), signature, ...(support && support.trace.length > 0 ? { support_resolution: support.trace } : {}) } });
  if (!submitted.ok || !submitted.executable) return null;
  deps.log?.warn("automatic_correction_queued", { adaptationId, restricted: repair.restricted.join(","), dropped: repair.dropped.join(","), checks: failing.map((c) => c.check).join(",") });
  return enqueueAutomatically(deps, adaptationId, submitted.reviewFingerprint);
}

/**
 * A server review saved after a generation but never queued (the process died between saving it and queuing it): the SAME review is
 * queued, nothing new is decided. Submitting it again is idempotent (same review, same fingerprint, same report).
 */
async function requeueSavedReview(deps: OrchestratorDeps, adaptationId: string, reviewFp: string, review: PlanReview): Promise<GenerationResult | null> {
  const reports = (await deps.store.listArtifacts(adaptationId, "execution_report")).map((a) => a.payload as { review_fingerprint?: string; automatic_stop?: string; automatic?: { unresolved?: string[] } });
  const own = reports.filter((r) => r.review_fingerprint === reviewFp);
  if (own.length === 0 || own.some((r) => r.automatic_stop !== undefined || (r.automatic?.unresolved?.length ?? 0) > 0)) return null;
  const submitted = await submitPlanReview(deps, adaptationId, review);
  if (!submitted.ok || !submitted.executable || submitted.reviewFingerprint !== reviewFp) return null;
  return enqueueAutomatically(deps, adaptationId, reviewFp);
}

// ---------------------------------------------------------------------------------------------------------------------
// Generation stage (+ deterministic and AI review)
// ---------------------------------------------------------------------------------------------------------------------

/** «Hacer magia» still decided by the server: automatic mode and a plan review the server made (not a teacher who took over). */
const serverDriven = (row: PipelineSnapshot["adaptation"], review: Record<string, unknown>) => row.creation_mode === "automatic" && (review as { reviewer?: { kind?: string } }).reviewer?.kind === "auto";

/**
 * The document of a generation and its deterministic checks. With `restore` («Hacer magia»), a rewrite that lost original content
 * (a preservation FAIL) is replaced by the original, its supports kept (`withOriginals`), and the restored sheet is checked again
 * from scratch: it is kept only if it removes failures without adding any (deterministic or of the audit). Deterministic, so the
 * automatic correction rebuilds exactly the same document to read its review.
 */
/**
 * `visualPlan` («Hacer magia»): the visual policy's decisions applied to the assembled sheet. The generation audit judges what the
 * generator produced (the sheet before them); the deterministic review judges the sheet that will be delivered (after them).
 */
function assembleAndCheck(loaded: Loaded, reviewed: ReviewedPlan, rawGeneration: NormalizedGeneration, restore: boolean, visualPlan: VisualResolutionPlan | null = null, substitution: SubstitutionMode = "on") {
  // A generated block that breaks the document contract is dropped and recorded against its decision, never a sheet that cannot be built.
  const generation = screenGeneration(rawGeneration);
  const check = (g: NormalizedGeneration) => {
    const assembled = buildDocument({ analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, generated: g.segments, newBlockId: sequentialIds() });
    const resolved = visualPlan && visualPlan.needs.length > 0 ? applyVisualResolution(assembled, visualPlan) : assembled;
    const document = addVisualSupports(resolved, loaded.analysis, loaded.context);
    const input = { analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, document, validation: reviewed.effectiveValidation };
    const deterministic = assembleReview(input, deterministicChecks(input));
    const audit = auditGeneration({ substitution, analysis: loaded.analysis, context: loaded.context, reviewed, generation: g, document: assembled, review: visualPlan ? assembleReview({ ...input, document: assembled }, deterministicChecks({ ...input, document: assembled })) : deterministic });
    return { generation: g, document, input, deterministic, audit, restored: [] as string[], repaired: [] as string[] };
  };
  let first;
  try {
    first = check(generation);
  } catch (error) {
    // A cross-block problem (a resource that does not exist, an inconsistent table): the decision whose output makes the sheet
    // unbuildable is found by leaving out ONE decision at a time; its blocks are dropped and recorded, so a repair regenerates only it.
    const isolated = isolateUnbuildable(generation, check);
    if (!isolated) throw new AdaptationError("generator_validation", "El documento no se pudo ensamblar", { cause: error });
    first = isolated;
  }
  if (!restore) return first;
  const fails = (r: PedagogicalReview) => new Set(r.checks.filter((c) => c.status === "FAIL").map((c) => c.check));
  const auditFails = (a: typeof first.audit) => new Set(a.checks.filter((c) => !c.ok).map((c) => c.name));
  let best = first;
  const refs = preservationRefs(first.deterministic, loaded.analysis, first.document);
  const restoration = refs.size > 0 ? withOriginals(generation, refs) : null;
  if (restoration) {
    try {
      const second = check(restoration.generation);
      const before = fails(first.deterministic);
      const after = fails(second.deterministic);
      const auditBefore = auditFails(first.audit);
      const better = after.size < before.size && [...after].every((c) => before.has(c)) && second.audit.checks.every((c) => c.ok || auditBefore.has(c.name));
      if (better) best = { ...second, restored: restoration.restored };
    } catch {
      // The restored sheet could not be built: the first one stands.
    }
  }
  // «Hacer magia» 2.0: what the audit found that needs no model (an answer area changed by a rewrite, a link to a decision that is
  // not applied, a segment for a unit no decision changes) is fixed here, kept only if strictly better and nothing new fails.
  if (!best.audit.ok) {
    const local = repairLocally(best.generation, best.audit, loaded.analysis, new Set(reviewed.effective.decisions.map((d) => d.id)));
    if (local) {
      try {
        const third = check(local.generation);
        const auditBefore = auditFails(best.audit);
        const auditAfter = auditFails(third.audit);
        const detBefore = fails(best.deterministic);
        const better = auditAfter.size < auditBefore.size && [...auditAfter].every((c) => auditBefore.has(c)) && [...fails(third.deterministic)].every((c) => detBefore.has(c));
        if (better) best = { ...third, restored: best.restored, repaired: local.fixes };
      } catch {
        // Never worse than what was there.
      }
    }
  }
  return best;
}

/** The first single decision whose blocks, once left out, let the sheet be built (null: none does). Bounded by the decisions written. */
function isolateUnbuildable<T>(generation: NormalizedGeneration, check: (g: NormalizedGeneration) => T): T | null {
  for (const id of generation.generated) {
    const segments = generation.segments.segments.filter((s) => !s.decision_ids.includes(id));
    const candidate: NormalizedGeneration = {
      ...generation,
      segments: { ...generation.segments, segments },
      generated: generation.generated.filter((g) => g !== id),
      ignored: [...new Set([...generation.ignored, id])],
      issues: [...generation.issues, { code: "invalid_block_dropped", decision_id: id, detail: "sus bloques impedían montar el documento" }],
    };
    try {
      return check(candidate);
    } catch {
      // Not this one.
    }
  }
  return null;
}

/**
 * The localized repair a server review asks for: the decisions it restricts (to regenerate) and the previous generation's draft (to
 * keep everything else). Only for a review the server made as a repair or correction of an earlier generation of the same plan,
 * and only when that generation is still stored. Null otherwise (a full generation, as before).
 */
async function localizedRepair(store: AdaptationStore, adaptationId: string, reviewFp: string, planFp: string, loaded: Loaded, ai: readonly string[]): Promise<{ only: Set<string>; previous: DraftGeneratedSegmentsV2; previousInputFp: string; budgetDecisions: Set<string> } | null> {
  const report = (await store.listArtifacts(adaptationId, "execution_report"))
    .map((a) => a.payload as { review_fingerprint?: string; automatic?: { repair_of?: string; correction_of?: string; restricted?: string[] } })
    .find((r) => r.review_fingerprint === reviewFp && (r.automatic?.repair_of || r.automatic?.correction_of));
  const previousReview = report?.automatic?.repair_of ?? report?.automatic?.correction_of;
  if (!report || !previousReview) return null;
  const previousInputFp = generationFingerprint(planFp, previousReview, loaded.versions);
  const previous = await store.findArtifact(adaptationId, "generation", { inputFingerprint: previousInputFp });
  const parsed = previous ? DraftGeneratedSegmentsV2Schema.safeParse((previous.payload as { draft?: unknown }).draft) : null;
  if (!parsed?.success) return null;
  const generation = previous?.payload.generation as Partial<NormalizedGeneration> | undefined;
  const budgetDecisions = new Set((Array.isArray(generation?.issues) ? generation.issues : []).filter((i) => i.code === "support_out_of_budget" && typeof i.decision_id === "string").map((i) => i.decision_id!));
  return { only: new Set((report.automatic?.restricted ?? []).filter((id) => ai.includes(id))), previous: parsed.data, previousInputFp, budgetDecisions };
}

/** The previous draft for the decisions not regenerated, the fresh one for those regenerated; decisions no longer applied vanish. */
function mergeDrafts(previous: DraftGeneratedSegmentsV2, fresh: DraftGeneratedSegmentsV2 | null, only: ReadonlySet<string>, effective: ReadonlySet<string>): DraftGeneratedSegmentsV2 {
  const kept = (id: string) => effective.has(id) && !only.has(id);
  const renewed = (id: string) => effective.has(id) && only.has(id);
  return {
    segments: [...previous.segments.filter((x) => kept(x.decision_id)), ...(fresh?.segments ?? []).filter((x) => renewed(x.decision_id))],
    skipped: [...previous.skipped.filter((x) => kept(x.decision_id)), ...(fresh?.skipped ?? []).filter((x) => renewed(x.decision_id))],
    blocked: [...previous.blocked.filter((x) => kept(x.decision_id)), ...(fresh?.blocked ?? []).filter((x) => renewed(x.decision_id))],
    change_summary: fresh && fresh.change_summary.length > 0 ? fresh.change_summary : previous.change_summary,
  };
}

/** The diagnosis of a stop, next to the review it concerns (rules, decisions and units only: never content). */
async function recordDiagnosis(store: AdaptationStore, adaptationId: string, reviewFp: string, stage: "generation" | "review", failures: readonly GenerationFailure[]) {
  if (failures.length === 0) return;
  await store.putArtifact(adaptationId, null, "execution_report", reviewFp, fingerprint({ review: reviewFp, diagnosis: failures, stage }), { review_fingerprint: reviewFp, diagnosis: { stage, failures, signature: failureSignature(failures) } });
}

export interface GenerationResult extends StageOutcome {
  delivered?: boolean;
  verdict?: string;
  version?: number;
}

/*
 * Artifact fingerprints of a generation include its INPUT: two generations of different inputs (a repair that asked for a fix the
 * model ignored) may produce identical content, and each must stay findable by its own input (`unique (adaptation, kind,
 * fingerprint)` would otherwise keep only the first). The same input still gives the same fingerprint: idempotent on resume.
 */
export async function runGenerationStage(deps: OrchestratorDeps, adaptationId: string, reviewFp: string, options: { acknowledgeAmbiguous?: boolean; enqueueOnly?: boolean } = {}): Promise<GenerationResult> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const row = snapshot.adaptation;
  const status = row.status as AdaptationStatus;
  const entitlementTarget = { id: row.id, workspaceId: row.workspace_id };
  if (status === "cancelled") return { outcome: "rejected", status, code: "cancelled" };
  if (status === "awaiting_plan_review" || status === "queued" || status === "planning") return { outcome: "rejected", status, code: "plan_review_required" };

  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return { outcome: "rejected", status, code: error.code, detail: error.message };
    throw error;
  }
  const raw = await currentPlan(store, snapshot, loaded);
  const reviewArtifact = await store.findArtifact(adaptationId, "plan_review", { fingerprint: reviewFp });
  if (!raw || !reviewArtifact) return { outcome: "rejected", status, code: "plan_review_required" };

  // 1-2. The review must still belong to the current plan, and the preflight must still pass: before any job, any cost.
  let reviewed: ReviewedPlan;
  try {
    reviewed = reviewPlan(raw.plan, PlanReviewSchema.parse(reviewArtifact.payload), loaded.analysis, loaded.context);
  } catch {
    if (status === "generation_queued") await store.transition(adaptationId, "generation_queued", "awaiting_plan_review");
    return { outcome: "human_action_required", status: status === "generation_queued" ? "awaiting_plan_review" : status, code: "stale_review" };
  }
  const execution = planExecutability(reviewed, loaded.analysis, loaded.context);
  if (execution.blockers.length > 0 || !reviewed.effectiveValidation.valid) {
    if (status === "generation_queued") await store.transition(adaptationId, "generation_queued", "awaiting_plan_review");
    return { outcome: "human_action_required", status: status === "generation_queued" ? "awaiting_plan_review" : status, code: "execution_unsupported", detail: execution.blockers.join("; ") };
  }

  const inputFp = generationFingerprint(raw.fingerprint, reviewFp, loaded.versions);
  // Delivered or blocked for exactly this input: reuse, no job, no provider call.
  if ((status === "ready" || status === "blocked") && (await store.findArtifact(adaptationId, "generation", { inputFingerprint: inputFp }))) {
    return { outcome: "reused", status, delivered: status === "ready" };
  }

  if (deps.entitlements?.assertReserved && !(await deps.entitlements.assertReserved(entitlementTarget))) return { outcome: "rejected", status, code: "entitlement_not_reserved" };
  let enqueued;
  try {
    enqueued = await store.enqueueStage(adaptationId, "generation", inputFp, settings(deps).maxAttempts);
  } catch (error) {
    if (error instanceof InvalidStateError) return { outcome: "rejected", status, code: "plan_review_required", detail: error.detail };
    throw error;
  }
  if (enqueued.status === "completed") return { outcome: "reused", status, jobId: enqueued.jobId, delivered: status === "ready" };
  if (options.enqueueOnly) return { outcome: "enqueued", status: ((await store.getPipeline(adaptationId))?.adaptation.status as AdaptationStatus | undefined) ?? status, jobId: enqueued.jobId, reusedJob: enqueued.reused };
  const job = await claim(deps, enqueued.jobId, options.acknowledgeAmbiguous === true);
  if (!job) return { outcome: "skipped", status, jobId: enqueued.jobId };
  // The visual policy never starts what it could not finish within this lease (a paid image cut off by the platform is lost).
  const visualsDeadline = Date.now() + settings(deps).leaseSeconds * 1000 - AFTER_VISUALS_MS;
  const run: StageRun = { job, lease: { jobId: job.id, attempt: job.attempts }, ids: { workspaceId: job.workspace_id, adaptationId: job.adaptation_id, materialId: job.material_id, jobId: job.id, jobAttempt: job.attempts } };

  let failing: Stage = "generation";
  try {
    const ambiguous = await stopOnAmbiguity(deps, run, loaded, "generation");
    if (ambiguous) return ambiguous;
    let current = (await store.getPipeline(adaptationId))!.adaptation.status as AdaptationStatus;
    if (current === "generation_queued") current = await advance(store, adaptationId, current, "generating");

    const services = deps.services(loaded.versions, loaded.analysis, loaded.snapshot.adaptation.workspace_id);
    const generatorVersion = loaded.versions.generator.prompt_version;
    await store.setStep(job.id, job.attempts, "generating", 30);

    // 3-5. Generate (or reuse), normalise. Only `ai_generation` decisions can be in the request; with none, there is no call.
    const generationArtifact = await store.findArtifact(adaptationId, "generation", { inputFingerprint: inputFp });
    let generation: NormalizedGeneration;
    if (generationArtifact) {
      generation = (generationArtifact.payload as { generation: ReturnType<typeof normalizeGeneration> }).generation;
    } else {
      let draft: unknown = { segments: [], skipped: [], blocked: [], change_summary: [] };
      // «Hacer magia» 2.0: a repair of an earlier generation asks the model ONLY for the decisions it repairs; every other decision
      // keeps what it already wrote (paid, valid), and the server merges both before normalising the whole sheet again.
      const localized = generatorVersion === 2 ? await localizedRepair(store, adaptationId, reviewFp, raw.fingerprint, loaded, execution.ai) : null;
      const asked = localized ? execution.ai.filter((id) => localized.only.has(id)) : execution.ai;
      if (localized && asked.length === 0) {
        // Only decisions left out: nothing to ask the model, the valid output is reused as it is.
        draft = mergeDrafts(localized.previous, null, localized.only, new Set(reviewed.effective.decisions.map((d) => d.id)));
        deps.log?.warn("automatic_repair_reused", { adaptationId, reused: localized.previous.segments.length, regenerated: 0 });
        generation = normalizeGeneration(generatorVersion, draft, reviewed, loaded.analysis, loaded.context);
        await store.putArtifact(adaptationId, run.lease, "generation", inputFp, fingerprint({ input: inputFp, draft, generation }), { draft, generation, reused_from: localized.previousInputFp });
      } else if (asked.length > 0) {
        const sent = buildGeneratorInputV2(reviewed, loaded.analysis, loaded.context, localized ? asked : undefined).approved.decisions.map((d) => d.id);
        if (JSON.stringify([...sent].sort()) !== JSON.stringify([...asked].sort())) throw new AdaptationError("internal", "La petición no contiene exactamente las decisiones ai_generation");
        if (!(await store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
        let answered;
        const repairFrom = localized?.previous.segments.filter((s) => asked.includes(s.decision_id) && localized.budgetDecisions.has(s.decision_id)).map(({ decision_id, target, supports }) => ({ decision_id, target, supports }));
        try {
          answered = await services.generator.generate({ context: loaded.context, analysis: loaded.analysis, reviewed, ...(localized ? { only: asked, ...(repairFrom?.length ? { repairFrom } : {}) } : {}) });
        } catch (error) {
          const { code } = classifyAIFailure(error, "generation");
          await store.recordAiRun(failedRow(error, loaded.versions.generator, "generate", "material_generator", code, run.ids, inputFp, localized ? "repair" : "initial"));
          throw error;
        }
        draft = localized ? mergeDrafts(localized.previous, answered.draft as DraftGeneratedSegmentsV2, localized.only, new Set(reviewed.effective.decisions.map((d) => d.id))) : answered.draft;
        if (localized) deps.log?.warn("automatic_repair_localized", { adaptationId, regenerated: asked.join(","), reused: localized.previous.segments.filter((x) => !localized.only.has(x.decision_id)).length });
        if (localized) answered = { ...answered, runs: answered.runs.map((r) => ({ ...r, callKind: "repair" as const })) };
        const outputFp = fingerprint(draft);
        try {
          generation = normalizeGeneration(generatorVersion, draft, reviewed, loaded.analysis, loaded.context);
        } catch (error) {
          for (const r of answered.runs) await store.recordAiRun(runRow(r, run.ids, inputFp, outputFp));
          await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
          throw new AdaptationError("generator_validation", `generator draft rejected: ${error instanceof Error ? error.name : "unknown"}`, { cause: error });
        }
        const missingGlossaries = repairFrom ? missingRepairedGlossaries(repairFrom, generation.segments) : [];
        if (missingGlossaries.length) {
          for (const r of answered.runs) await store.recordAiRun(runRow(r, run.ids, inputFp, outputFp));
          await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
          await recordDiagnosis(store, adaptationId, reviewFp, "generation", missingGlossaries.map((id) => ({ category: "data_loss", rule: "glossary_terms_preserved", decisions: [id], refs: [], repair: "none" })));
          throw new AdaptationError("generator_validation", "glossary_terms_lost");
        }
        for (const r of answered.runs) await store.recordAiRun(runRow(r, run.ids, inputFp, outputFp));
        await store.putArtifact(adaptationId, run.lease, "generation", inputFp, fingerprint({ input: inputFp, draft, generation }), { draft, generation, ...(localized ? { reused_from: localized.previousInputFp, regenerated: asked } : {}) });
        await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
      } else {
        generation = normalizeGeneration(generatorVersion, draft, reviewed, loaded.analysis, loaded.context);
        await store.putArtifact(adaptationId, run.lease, "generation", inputFp, fingerprint({ input: inputFp, draft, generation }), { draft, generation });
      }
    }

    // 6-7. Assemble the document deterministically and review it (in «Hacer magia», a rewrite that lost original content is
    // replaced by the original before anything else). A document that fails the generation audit without a deterministic FAIL is an
    // invalid generation.
    await store.setStep(job.id, job.attempts, "reviewing", 60);
    const substitutionMode = deps.supportSubstitution ?? DEFAULT_SUBSTITUTION_MODE;
    let assembled = assembleAndCheck(loaded, reviewed, generation, serverDriven(row, reviewArtifact.payload), null, substitutionMode);
    // «Hacer magia»: the visual policy decides, once per generation input (a resumed job reuses its decisions and their cost).
    let visualPlan: VisualResolutionPlan | null = null;
    if (row.creation_mode === "automatic" && deps.visuals) {
      const cached = await store.findArtifact(adaptationId, "visual_resolution", { inputFingerprint: inputFp });
      if (cached) visualPlan = (cached.payload as { plan: VisualResolutionPlan }).plan;
      else {
        visualPlan = await deps.visuals.resolve({ workspaceId: row.workspace_id, materialId: row.material_id, adaptationId, analysis: loaded.analysis, analysisFingerprint: row.analysis_fingerprint!, document: assembled.document, requiredVisuals: loaded.context.material.required_visuals, stage: loaded.context.education.stage, grade: loaded.context.education.grade, subject: loaded.context.education.subject, functionalNeeds: loaded.context.needs.map((n) => n.dimension), visualSupports: loaded.context.visual_supports?.requested === true, deadline: visualsDeadline });
        await store.putArtifact(adaptationId, run.lease, "visual_resolution", inputFp, fingerprint({ input: inputFp, plan: visualPlan }), { plan: visualPlan });
      }
      if (visualPlan.needs.length > 0) assembled = assembleAndCheck(loaded, reviewed, generation, serverDriven(row, reviewArtifact.payload), visualPlan, substitutionMode);
    }
    const { document, input, deterministic, audit, restored } = assembled;
    generation = assembled.generation;
    const documentFp = fingerprint(document);
    if (restored.length > 0) deps.log?.warn("automatic_original_restored", { adaptationId, refs: restored.join(",") });
    const hardFail = deterministic.checks.some((c) => c.status === "FAIL");
    if (!audit.ok && !hardFail) {
      const failing = audit.checks.filter((c) => !c.ok);
      // Names and decision ids only: what an operator needs to know why, never content.
      deps.log?.warn("generation_audit_failed", { adaptationId, checks: failing.map((c) => c.name).join("; "), decisions: [...new Set(failing.flatMap((c) => c.decisions ?? []))].join(",") });
      const repaired = await repairGenerationAutomatically(deps, run, { snapshot, loaded, raw, reviewArtifact, failing, generation, inputFp, support: supportRepairOf(loaded, reviewed.effective.decisions, assembled.document, assembled.generation, substitutionMode, new Set((await earlierResolutions(store, adaptationId)).filter((r) => r.action === "substituted").map((r) => r.decision_id))) });
      if (repaired) return repaired;
      // No safe repair left: the precise diagnosis (rule, decision, unit) is kept next to the review, never only a generic code.
      const diagnosis = diagnoseGeneration({ audit });
      await recordDiagnosis(store, adaptationId, reviewFp, "generation", diagnosis);
      deps.log?.warn("generation_stop_diagnosed", { adaptationId, failures: diagnosis.map((d) => `${d.category}:${d.repair}`).join(",") });
      throw new AdaptationError("generator_validation", `La generación no supera la auditoría: ${diagnosis.map((d) => `${d.category}[${d.decisions.join("+") || d.refs.join("+") || "documento"}]`).join("; ").slice(0, 200)}`);
    }
    current = await advance(store, adaptationId, current, "reviewing_deterministic");
    // Shadow mode (bloque 1): supports that perform what the activity evaluates. Codes and ids only; it never blocks, never reaches the
    // teacher and can never stop the generation. Outside the artifact's fingerprint: it is a measurement, not an input.
    const supportAudit = (() => {
      try {
        return auditSupports({ analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, document });
      } catch {
        return undefined;
      }
    })();
    // Etapa 2.2: the trace of what happened to each support that handed over the answer, and in dry-run what WOULD happen. Codes and ids only.
    const flagsNow = supportFlagsOf(loaded, reviewed.effective.decisions, document, generation);
    const outcome = resolutionOutcome(await earlierResolutions(store, adaptationId), loaded, reviewed.effective.decisions, document, new Set([...flagsNow.keys()]));
    const dryRun = substitutionMode === "dry_run" ? [...flagsNow.values()].flatMap((flag) => {
      const decision = reviewed.effective.decisions.find((d) => d.id === flag.decisionId);
      const activity = loaded.analysis.activities.find((a) => a.id === flag.activityId);
      if (!decision || !activity) return [];
      const plan = planSubstitution({ raw: raw.plan, decision, flagged: flag.kinds, analysis: loaded.analysis, context: loaded.context, activity });
      return [recordOf(flag, decision, "dry_run", plan ? "would_substitute" : "would_restrict", { to: plan?.to ?? null, option: plan?.option ?? null, coverage: "same_activity" })];
    }) : [];
    if (supportAudit && supportAudit.warnings.length > 0) deps.log?.warn("support_audit_warnings", { adaptationId, codes: [...new Set(supportAudit.warnings.map((w) => w.code))].join(","), activities: [...new Set(supportAudit.warnings.map((w) => w.activity_id))].join(",") });
    await store.putArtifact(adaptationId, run.lease, "deterministic_review", inputFp, fingerprint({ input: inputFp, deterministic, audit }), { review: deterministic, audit, document_fingerprint: documentFp, ...(restored.length > 0 ? { restored_originals: restored } : {}), ...(supportAudit ? { support_audit: supportAudit } : {}), ...(outcome.length > 0 ? { support_resolution_outcome: outcome } : {}), ...(dryRun.length > 0 ? { support_resolution_dry_run: dryRun } : {}) });

    // 8. The version exists from here on (history), whatever the review says.
    const version = await store.persistVersion(adaptationId, run.lease, document, { plan: raw.fingerprint, review: reviewFp, generation: inputFp });

    // A visual nothing could resolve: never a «ready» sheet with a gap, never a request to the teacher. An honest stop, no AI review.
    const unresolvedVisuals = unresolvedEssential(visualPlan);
    if (unresolvedVisuals.length > 0 && !hardFail) {
      await store.finalize(adaptationId, run.lease, version.id, deterministic, "blocked");
      if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
      await recordAutomaticStop(store, adaptationId, reviewFp, visualStopCode(unresolvedVisuals), unresolvedVisuals.map((n) => n.key).join(","));
      deps.log?.warn("automatic_visual_stop", { adaptationId, visuals: unresolvedVisuals.map((n) => `${n.key}:${n.resolution.action === "unresolved" ? n.resolution.reason : ""}`).join(",") });
      return { outcome: "completed", status: "blocked", jobId: job.id, delivered: false, version: version.version, detail: "visual_unresolved" };
    }

    if (hardFail) {
      // A deterministic FAIL is final: no AI call can soften it, so none is made.
      await store.finalize(adaptationId, run.lease, version.id, deterministic, "blocked");
      if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
      return { outcome: "completed", status: "blocked", code: "deterministic_review_failed", jobId: job.id, delivered: false, verdict: deterministic.verdict, version: version.version };
    }

    // 9-12. AI review: reuse a persisted merged review, else ask, persist the findings, merge with the precedences, persist.
    current = await advance(store, adaptationId, current, "reviewing_ai");
    failing = "review";
    const reviewerMode = effectiveReviewerMode(deps.reviewerV2, loaded.versions.reviewer.prompt_version);
    const semantic = reviewerMode !== "off";
    // `off` keeps EVERY key it always had. The v2 judgments are asked under their own key (a v1 answer is not reused as if it carried them) and
    // only `on` has its own merged review, so moving from `shadow` to `on` merges what was already asked: never a second ask.
    const baseInputFp = reviewFingerprint(documentFp, reviewFp, loaded.versions);
    const reviewInputFp = semantic ? fingerprint({ review: baseInputFp, judged: SEMANTIC_POLICY_VERSION }) : baseInputFp;
    const mergedFp = reviewerMode === "on" ? fingerprint({ review: reviewInputFp, applied: SEMANTIC_POLICY_VERSION }) : reviewInputFp;
    const merged = await store.findArtifact(adaptationId, "pedagogical_review", { inputFingerprint: mergedFp });
    let finalReview;
    if (merged) {
      finalReview = (merged.payload as { review: ReturnType<typeof assembleReview> }).review;
    } else {
      const findings = await store.findArtifact(adaptationId, "reviewer_findings", { inputFingerprint: reviewInputFp });
      let draft: AiReviewDraft;
      let judgments: SupportJudgment[] = [];
      let sanitation: SanitationCounts | undefined;
      if (findings) {
        const saved = findings.payload as { draft: AiReviewDraft; support_judgments?: SupportJudgment[]; sanitation?: SanitationCounts };
        draft = saved.draft;
        judgments = saved.support_judgments ?? [];
        sanitation = saved.sanitation;
      } else {
        const reviewContext = buildPedagogicalReviewContext(input, reviewed, { semantic });
        if (!(await store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
        // A malformed answer (the review is asked as free JSON against a strict contract) gets ONE new ask of the same review, then the
        // stage fails as before: bounded by construction (two calls at most, both kept in `ai_runs`), never a loop. Anything else
        // (a refusal, a cut-off answer, a provider error) is not asked again here.
        // A resumed stage (lease lost, process restarted) continues from the rejections already on record for THIS review input, so the
        // bound of two calls holds across resumptions too: it never starts again from the first ask.
        const earlier = (await store.listArtifacts(adaptationId, "execution_report")).filter((a) => {
          const payload = a.payload as { reviewer_rejected?: unknown; review_input_fingerprint?: string };
          return payload.reviewer_rejected !== undefined && payload.review_input_fingerprint === reviewInputFp;
        }).length;
        if (earlier >= 2) throw new AdaptationError("reviewer_schema", "la revisión ya fue rechazada dos veces");
        let answered;
        let ask = earlier + 1;
        for (; ; ask++) {
          try {
            answered = await services.reviewer.review({ context: loaded.context, document, plan: reviewed.effective, solvability: solvabilityInputs(loaded.analysis), reviewContext });
            break;
          } catch (error) {
            const { code } = classifyAIFailure(error, "review");
            await store.recordAiRun(failedRow(error, loaded.versions.reviewer, "review", "pedagogical_reviewer", code, run.ids, reviewInputFp, ask > 1 ? "repair" : "initial"));
            const rejected = error instanceof RejectedStageOutput && (error.detail?.kind === "schema" || error.detail?.kind === "not_json") ? error.detail : null;
            if (rejected) {
              // Why it was rejected, in paths and rules (no content): the diagnosis that was missing.
              deps.log?.warn("reviewer_output_rejected", { adaptationId, ask, kind: rejected.kind, outputTokens: rejected.outputTokens, issues: rejected.issues.map((i) => `${i.path}:${i.code}`).join(",").slice(0, 400) });
              await store.putArtifact(adaptationId, run.lease, "execution_report", reviewFp, fingerprint({ input: reviewInputFp, reviewer_rejected: ask, issues: rejected.issues }), { review_fingerprint: reviewFp, review_input_fingerprint: reviewInputFp, reviewer_rejected: { ask, kind: rejected.kind, output_tokens: rejected.outputTokens, issues: rejected.issues.slice(0, 15) } });
            }
            if (!rejected || ask >= 2) throw error;
            // The same limit that admits a new job: a workspace whose paid calls keep failing gets no extra paid call.
            try {
              await store.assertFailureBudget(row.workspace_id);
            } catch (budget) {
              if (budget instanceof FailureBudgetError) throw error;
              throw budget;
            }
            await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
            if (!(await store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
          }
        }
        draft = answered.draft as AiReviewDraft;
        if (semantic) {
          judgments = answered.judgments ?? [];
          sanitation = answered.sanitation;
        }
        const outputFp = fingerprint(semantic ? { draft, judgments } : draft);
        // The second ask is a «repair» call: the index of `ai_runs` keys a call by (job, attempt, purpose, kind, attempt, input), so a repeat
        // recorded as «initial» would be dropped silently and its cost lost.
        for (const r of answered.runs) await store.recordAiRun(runRow({ ...r, callKind: ask > 1 ? "repair" : r.callKind }, run.ids, reviewInputFp, outputFp));
        await store.putArtifact(adaptationId, run.lease, "reviewer_findings", reviewInputFp, fingerprint({ input: reviewInputFp, output: outputFp }), { draft, ...(semantic ? { support_judgments: judgments, ...(sanitation ? { sanitation } : {}) } : {}) });
        await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
      }
      const outcome = buildReviewScoped(input, draft, reviewed.raw.decisions.map((d) => d.id));
      finalReview = outcome.review;
      // Etapa 2.3: what the reviewer judged about each support. `shadow` and `on` RECORD it (ids, codes and counts); only `on` lets it change the
      // review, by appending its checks (a confirmed finding fails `answers_not_leaked`, a suspicion or an unjudged support only warns).
      let semanticSet: SemanticRecordSet | undefined;
      let semanticDryRun: SupportResolutionRecord[] = [];
      if (semantic) {
        const judged = judgeSupports({ analysis: input.analysis, scope: buildSemanticScope(input.analysis, input.plan, document), document, judgments });
        semanticSet = summarize(reviewerMode, judged, input.plan.decisions);
        if (reviewerMode === "on") {
          finalReview = withSemanticChecks(input, outcome.review, semanticChecks(judged.records));
          // A substitution configured as `dry_run` never happens silently: it is only recorded what it WOULD do for each confirmed support.
          if (substitutionMode === "dry_run") {
            semanticDryRun = [...semanticFlags(judged.records, input.plan.decisions).values()].flatMap((flag) => {
              const decision = input.plan.decisions.find((d) => d.id === flag.decisionId);
              const activity = loaded.analysis.activities.find((a) => a.id === flag.activityId);
              if (!decision || !activity) return [];
              const plan = planSubstitution({ raw: raw.plan, decision, flagged: flag.kinds, analysis: loaded.analysis, context: loaded.context, activity });
              return [recordOf(flag, decision, "dry_run", plan ? "would_substitute" : "would_restrict", { to: plan?.to ?? null, option: plan?.option ?? null, coverage: "same_activity" })];
            });
          }
        }
        deps.log?.warn("support_semantic_review", { adaptationId, mode: reviewerMode, confirmed: semanticSet.counts.confirmed, suspected: semanticSet.counts.suspected, legitimate: semanticSet.counts.legitimate, unjudged: semanticSet.counts.unjudged });
      }
      await store.putArtifact(adaptationId, run.lease, "pedagogical_review", mergedFp, fingerprint({ input: mergedFp, review: finalReview, rejected: outcome.rejected, pending: outcome.pending, semantic: semanticSet ?? null }), { review: finalReview, rejected: outcome.rejected, pending: outcome.pending, ...(semanticSet ? { semantic: { ...semanticSet, ...(sanitation ? { sanitation } : {}), ...(semanticDryRun.length > 0 ? { dry_run: semanticDryRun } : {}) } } : {}) });
    }

    // 13. Delivered only if usable: approved / approved_with_warnings. Anything else keeps the version but is not a delivery.
    const usable = finalReview.verdict === "approved" || finalReview.verdict === "approved_with_warnings";
    await store.finalize(adaptationId, run.lease, version.id, finalReview, usable ? "ready" : "blocked");
    if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
    if (usable) await (deps.entitlements ?? NO_ENTITLEMENTS).consume(entitlementTarget).catch(() => deps.log?.warn("entitlement_consume_failed", { adaptationId }));
    return { outcome: "completed", status: usable ? "ready" : "blocked", jobId: job.id, delivered: usable, verdict: finalReview.verdict, version: version.version, ...(usable ? {} : { code: "reviewer_blocked" as const }) };
  } catch (error) {
    if (error instanceof LeaseLostError) return { outcome: "skipped", status: (await store.getPipeline(adaptationId))?.adaptation.status as AdaptationStatus ?? status, jobId: job.id };
    return failStage(deps, run, failing, error);
  }
}

/**
 * «Hacer magia» after a generation that fails its audit: the bounded, automatic repair, as a NEW generation of the SAME adaptation
 * (same context, same unit, counted in `MAX_GENERATION_CYCLES`, which the database enforces too). Content first (`planRepair`):
 * the decisions whose output fails are regenerated with a restriction that names what to fix (an explicit word limit for a support
 * out of budget); a decision is left out only after failing again, and only if every need it attends stays covered. Only when:
 *   · the adaptation is automatic and its review is still the server's (a teacher who took over decides alone);
 *   · there is a generation left;
 *   · EVERY failing check is pinned on applied decisions (a changed original, a lost activity… are never «repaired» silently);
 *   · the repaired review is executable.
 * Otherwise null: the stage fails with `generator_validation` and nothing is delivered (the honest stop in «Hacer magia»).
 */
async function repairGenerationAutomatically(
  deps: OrchestratorDeps,
  run: StageRun,
  at: { snapshot: PipelineSnapshot; loaded: Loaded; raw: { plan: AdaptationPlan; fingerprint: string }; reviewArtifact: { fingerprint: string; payload: Record<string, unknown> }; failing: ReadonlyArray<{ name: string; decisions?: string[] }>; generation: NormalizedGeneration; inputFp: string; support?: SupportRepair },
): Promise<GenerationResult | null> {
  const { snapshot, loaded, raw, reviewArtifact, failing, support } = at;
  const adaptationId = snapshot.adaptation.id;
  if (snapshot.adaptation.creation_mode !== "automatic") return null;
  const previous = PlanReviewSchema.parse(reviewArtifact.payload);
  if (previous.reviewer.kind !== "auto" || previous.plan_fingerprint !== raw.fingerprint) return null;
  // This generation is one cycle; another one must still fit.
  const cycles = new Set([...snapshot.jobs.filter((j) => j.stage === "generation" && j.input_fingerprint).map((j) => j.input_fingerprint), run.job.input_fingerprint]).size;
  if (cycles >= MAX_GENERATION_CYCLES) return null;
  if (failing.some((c) => (c.decisions ?? []).length === 0)) return null;
  const effective = reviewPlan(raw.plan, previous, loaded.analysis, loaded.context).effective.decisions;
  // The same signature normally means no progress. A budget failure can still have improved: only a shorter support with the
  // same budget, verified against the persisted previous generation, earns the remaining bounded attempt.
  const signature = failureSignature(diagnoseGeneration({ audit: { checks: failing.map((c) => ({ ok: false, detail: "", ...c })) } }));
  const repeated = await seenSignature(deps.store, adaptationId, signature);
  let budgetProgress = false;
  if (repeated && failing.length === 1 && failing[0]!.name === OUT_OF_BUDGET_CHECK) {
    const current = await deps.store.findArtifact(adaptationId, "generation", { inputFingerprint: at.inputFp });
    const reusedFrom = (current?.payload as { reused_from?: unknown } | undefined)?.reused_from;
    if (typeof reusedFrom === "string") {
      const prior = await deps.store.findArtifact(adaptationId, "generation", { inputFingerprint: reusedFrom });
      const issues = (prior?.payload as { generation?: { issues?: NormalizedGeneration["issues"] } } | undefined)?.generation?.issues;
      if (Array.isArray(issues)) budgetProgress = budgetRepairProgress(issues, at.generation.issues, failing[0]!.decisions ?? []);
    }
  }
  const asks = new Map<string, Array<string | null>>();
  for (const c of failing) {
    for (const id of c.decisions ?? []) {
      const decision = effective.find((d) => d.id === id);
      const budget = c.name === OUT_OF_BUDGET_CHECK && decision ? budgetRestriction(decisionSupportBudget(decision, loaded.analysis.activities.find((a) => a.id === decision.target))) : null;
      addAsk(asks, id, repeated ? (budgetProgress ? "La reparación anterior acortó el apoyo pero sigue excediendo el límite: acórtalo de nuevo conservando todas las necesidades, datos y términos esenciales." : null) : (budget ?? AUDIT_RESTRICTIONS[c.name] ?? null));
    }
  }
  // Evidence B rides along: a decision with a structural signal gets its restriction only because this repair already happens.
  if (support && support.mode === "on" && !repeated) {
    for (const [id, signal] of support.structural) {
      if (asks.has(id) || !effective.some((d) => d.id === id)) continue;
      for (const code of signal.codes) {
        const restriction = STRUCTURAL_RESTRICTIONS[code];
        if (restriction) addAsk(asks, id, restriction);
      }
    }
  }
  const repair = planRepair(raw.plan, previous, loaded, asks, REPAIR_REASON, support);
  // Without a safe repair there is no submitted review to carry the trace: what the substitution did (or why it stopped) is kept here.
  if (!repair) {
    if (support && support.trace.length > 0) await recordSupportResolution(deps.store, adaptationId, reviewArtifact.fingerprint, support);
    return null;
  }

  // This generation ends here (its output stays as an artifact, no version); the adaptation goes back through the gate it came from.
  if (!(await deps.store.completeStage(run.job.id, run.job.attempts))) throw new LeaseLostError();
  await deps.store.transition(adaptationId, "generating", "awaiting_plan_review");
  const submitted = await submitPlanReview(deps, adaptationId, repair.review, { automatic: { repair_of: reviewArtifact.fingerprint, restricted: repair.restricted, dropped: repair.dropped, failing: failing.map((c) => c.name), signature, ...(support && support.trace.length > 0 ? { support_resolution: support.trace } : {}) } });
  if (!submitted.ok || !submitted.executable) {
    // Already back at the gate: the honest stop, recorded (never a plan waiting for a teacher's approval).
    await recordQualityStop(deps, adaptationId);
    return { outcome: "completed", status: "awaiting_plan_review", jobId: run.job.id, delivered: false, code: "generator_validation", detail: "repair_not_queued" };
  }
  deps.log?.warn("automatic_generation_repair_queued", { adaptationId, restricted: repair.restricted.join(","), dropped: repair.dropped.join(",") });
  const queued = await enqueueAutomatically(deps, adaptationId, submitted.reviewFingerprint);
  const status = ((await deps.store.getPipeline(adaptationId))?.adaptation.status ?? "generation_queued") as AdaptationStatus;
  return { outcome: "completed", status, jobId: run.job.id, delivered: false, code: "generator_validation", ...(queued ? {} : { detail: "repair_not_queued" }) };
}

/** Reopens a blocked adaptation for a new teacher review (the previous version and review stay as history). */
export async function reopenPlanReview(deps: OrchestratorDeps, adaptationId: string): Promise<AdaptationStatus> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status !== "blocked") return status;
  // Reopening only leads to another generation: refused here so the teacher is not sent to a review that could not be used.
  if (generationCyclesOf(snapshot.jobs) >= MAX_GENERATION_CYCLES) throw new GenerationLimitError();
  await deps.store.transition(adaptationId, "blocked", "awaiting_plan_review");
  return "awaiting_plan_review";
}

/** Cancels an adaptation that is not delivered. A worker already running notices at its next fenced write. */
export async function cancelAdaptation(deps: OrchestratorDeps, adaptationId: string): Promise<{ cancelled: boolean; status: AdaptationStatus }> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status === "ready" || status === "cancelled") return { cancelled: false, status };
  const moved = await deps.store.transition(adaptationId, status, "cancelled");
  if (moved) await release(deps, { id: snapshot.adaptation.id, workspaceId: snapshot.adaptation.workspace_id }, "cancelled");
  return { cancelled: moved, status: moved ? "cancelled" : status };
}

// ---------------------------------------------------------------------------------------------------------------------
// Commands that only ENQUEUE (the web boundary) and the worker's view of a generation job
// ---------------------------------------------------------------------------------------------------------------------

/** The review that put the adaptation in `generation_queued`: the latest one (reviews can only be submitted while awaiting one). */
export async function latestReviewFingerprint(store: AdaptationStore, adaptationId: string): Promise<string | null> {
  return (await store.listArtifacts(adaptationId, "plan_review")).at(-1)?.fingerprint ?? null;
}

/** Persists the planning job and returns. Idempotent: a repeated call returns the same job. Never calls a provider. */
export const enqueuePlanning = (deps: OrchestratorDeps, adaptationId: string): Promise<StageOutcome> => runPlanningStage(deps, adaptationId, { enqueueOnly: true });

/** Persists the generation job (preflight and entitlement included) and returns. The review comes from the server, never the client. */
export async function enqueueGeneration(deps: OrchestratorDeps, adaptationId: string): Promise<GenerationResult> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const status = snapshot.adaptation.status as AdaptationStatus;
  const review = await latestReviewFingerprint(deps.store, adaptationId);
  if (!review) return { outcome: "rejected", status, code: "plan_review_required" };
  // A review was saved but its preflight said "cannot execute": say so, instead of a generic "review required".
  if (status === "awaiting_plan_review") {
    const report = (await deps.store.listArtifacts(adaptationId, "execution_report")).at(-1)?.payload as { review_fingerprint?: string; execution?: { blockers: string[] }; effective_valid?: boolean } | undefined;
    if (report?.review_fingerprint === review && ((report.execution?.blockers.length ?? 0) > 0 || report.effective_valid === false)) {
      return { outcome: "human_action_required", status, code: "execution_unsupported", detail: report.execution?.blockers.join("; ") };
    }
  }
  return runGenerationStage(deps, adaptationId, review, { enqueueOnly: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Operator recovery of a generation that failed under an earlier version of the audit (never automatic)
// ---------------------------------------------------------------------------------------------------------------------

export interface GenerationRecoveryReport {
  adaptationId: string;
  status: AdaptationStatus;
  creationMode: CreationMode;
  failureCode: string | null;
  entitlement: { state: string; consumedAt: string | null } | null;
  generationsUsed: number;
  /** The persisted generation the retry would reuse (no new generator call). */
  generationReused: boolean;
  /** The audit and the deterministic review of that same generation, re-run with the CURRENT code: check names only. */
  auditFailing: string[];
  deterministicFailing: string[];
  recoverable: boolean;
  reason: string;
  /** With `apply`: the generation job queued (same input: not a new generation cycle). */
  queued?: boolean;
}

/**
 * For an operator, after a fix: can an adaptation whose generation failed (`generator_validation`) be delivered from what it already
 * has, without a new adaptation or a new unit? Read-only unless `apply`. It reuses the persisted plan, review and generation (the
 * same input fingerprint, so no generator call and no new generation cycle), re-runs the audit and the deterministic review with
 * the current code, and checks that the unit is still reserved (never consumed, never released). With `apply` and only if all of
 * that holds, it queues the generation job; the teacher's next visit runs it (one reviewer call) and the delivery consumes the
 * SAME reserved unit. Nothing is run here, no provider is called, no unit is touched.
 */
export async function recoverFailedGeneration(deps: OrchestratorDeps, adaptationId: string, options: { apply?: boolean } = {}): Promise<GenerationRecoveryReport> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const row = snapshot.adaptation;
  const entitlementRecord = await store.getEntitlement(adaptationId);
  const report: GenerationRecoveryReport = {
    adaptationId,
    status: row.status as AdaptationStatus,
    creationMode: row.creation_mode,
    failureCode: row.failure_code ?? snapshot.jobs.at(-1)?.error?.code ?? null,
    entitlement: entitlementRecord ? { state: entitlementRecord.state, consumedAt: entitlementRecord.consumed_at } : null,
    generationsUsed: generationCyclesOf(snapshot.jobs),
    generationReused: false,
    auditFailing: [],
    deterministicFailing: [],
    recoverable: false,
    reason: "",
  };
  const stop = (reason: string) => ({ ...report, reason });
  if (row.status !== "failed") return stop(`la adaptación no está en failed (${row.status})`);
  if (report.failureCode !== "generator_validation") return stop(`el fallo no es generator_validation (${report.failureCode ?? "desconocido"})`);
  if (entitlementRecord?.state !== "reserved" || entitlementRecord.consumed_at !== null) return stop("la unidad no está reservada sin consumir: no se recupera por aquí");
  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return stop(`entrada no válida (${error.code})`);
    throw error;
  }
  const raw = await currentPlan(store, snapshot, loaded);
  const reviewFp = await latestReviewFingerprint(store, adaptationId);
  const reviewArtifact = reviewFp ? await store.findArtifact(adaptationId, "plan_review", { fingerprint: reviewFp }) : null;
  if (!raw || !reviewArtifact) return stop("no hay plan o revisión del plan actuales");
  const reviewed = reviewPlan(raw.plan, PlanReviewSchema.parse(reviewArtifact.payload), loaded.analysis, loaded.context);
  const execution = planExecutability(reviewed, loaded.analysis, loaded.context);
  if (execution.blockers.length > 0 || !reviewed.effectiveValidation.valid) return stop("la revisión guardada ya no es ejecutable");
  const inputFp = generationFingerprint(raw.fingerprint, reviewArtifact.fingerprint, loaded.versions);
  const generationArtifact = await store.findArtifact(adaptationId, "generation", { inputFingerprint: inputFp });
  if (!generationArtifact) return stop("no hay generación guardada para esta entrada: recuperarla exigiría otra llamada al generador");
  report.generationReused = true;
  const generation = (generationArtifact.payload as { generation: ReturnType<typeof normalizeGeneration> }).generation;
  const document = buildDocument({ analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, generated: generation.segments, newBlockId: sequentialIds() });
  const input = { analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, document, validation: reviewed.effectiveValidation };
  const deterministic = assembleReview(input, deterministicChecks(input));
  const audit = auditGeneration({ analysis: loaded.analysis, context: loaded.context, reviewed, generation, document, review: deterministic });
  report.auditFailing = audit.checks.filter((c) => !c.ok).map((c) => c.name);
  report.deterministicFailing = deterministic.checks.filter((c) => c.status === "FAIL").map((c) => c.check);
  if (report.auditFailing.length > 0) return stop("la generación guardada sigue sin superar la auditoría con el código actual");
  if (report.deterministicFailing.length > 0) return stop("la revisión determinista de esa generación tiene un FAIL: no se entregaría");
  report.recoverable = true;
  report.reason = "recuperable: misma entrada (sin generador, sin ciclo nuevo); falta la revisión pedagógica; consumirá la unidad ya reservada al entregarse";
  if (!options.apply) return report;
  const queued = await runGenerationStage(deps, adaptationId, reviewArtifact.fingerprint, { enqueueOnly: true });
  return { ...report, queued: queued.outcome === "enqueued" || queued.outcome === "reused" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Operator recovery of a planning that failed with `planner_schema` before the bounded repair existed (never automatic)
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanningRecoveryReport {
  adaptationId: string;
  status: AdaptationStatus;
  creationMode: CreationMode;
  failureCode: string | null;
  entitlement: { state: string; consumedAt: string | null } | null;
  /** Planning jobs of this adaptation, oldest first: status and error code only. */
  planningJobs: Array<{ status: string; code: string | null }>;
  /** A plan already exists for the adaptation's current input (then nothing needs planning again). */
  planExists: boolean;
  recoverable: boolean;
  reason: string;
  /** With `apply`: the planning job queued again (the same adaptation, the same reserved unit). */
  queued?: boolean;
}

/**
 * For an operator, after this fix: can an adaptation whose planning failed with `planner_schema` be planned again WITHOUT a new
 * adaptation or a new unit? Read-only unless `apply`. Requires: `failed`, failure `planner_schema` on a planning job, its unit
 * reserved and never consumed or released, and no plan for its current input. With `apply` it queues the planning job again
 * (`failed → queued`, the database's own transition, inside the workspace's failure budget). Nothing runs here and no provider is
 * called: the teacher's next visit runs it, now with the diagnosis and the single bounded repair (at most two planner calls).
 */
export async function recoverFailedPlanning(deps: OrchestratorDeps, adaptationId: string, options: { apply?: boolean } = {}): Promise<PlanningRecoveryReport> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const row = snapshot.adaptation;
  const entitlementRecord = await store.getEntitlement(adaptationId);
  const planning = snapshot.jobs.filter((j) => j.stage === "planning");
  const report: PlanningRecoveryReport = {
    adaptationId,
    status: row.status as AdaptationStatus,
    creationMode: row.creation_mode,
    failureCode: row.failure_code ?? snapshot.jobs.at(-1)?.error?.code ?? null,
    entitlement: entitlementRecord ? { state: entitlementRecord.state, consumedAt: entitlementRecord.consumed_at } : null,
    planningJobs: planning.map((j) => ({ status: j.status, code: j.error?.code ?? null })),
    planExists: false,
    recoverable: false,
    reason: "",
  };
  const stop = (reason: string) => ({ ...report, reason });
  if (row.status !== "failed") return stop(`la adaptación no está en failed (${row.status})`);
  if (report.failureCode !== "planner_schema") return stop(`el fallo no es planner_schema (${report.failureCode ?? "desconocido"})`);
  if (snapshot.jobs.at(-1)?.stage !== "planning") return stop("el último job no es de planificación");
  if (snapshot.jobs.some((j) => j.status === "queued" || j.status === "processing")) return stop("ya hay un job en curso");
  if (entitlementRecord?.state !== "reserved" || entitlementRecord.consumed_at !== null) return stop("la unidad no está reservada sin consumir: no se recupera por aquí");
  let loaded: Loaded;
  try {
    loaded = load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return stop(`entrada no válida (${error.code}): hay que crear la adaptación de nuevo`);
    throw error;
  }
  report.planExists = (await currentPlan(store, snapshot, loaded)) !== null;
  if (report.planExists) return stop("ya hay un plan para esta entrada: no hace falta planificar de nuevo");
  report.recoverable = true;
  report.reason = "recuperable: la misma adaptación vuelve a planificarse con la reserva que ya tiene; como máximo dos llamadas al planificador (una reparación acotada)";
  if (!options.apply) return report;
  try {
    const queued = await enqueuePlanning(deps, adaptationId);
    return { ...report, queued: queued.outcome === "enqueued" || queued.outcome === "reused", ...(queued.outcome === "enqueued" || queued.outcome === "reused" ? {} : { reason: `no se pudo encolar (${queued.code ?? queued.outcome})` }) };
  } catch (error) {
    if (error instanceof FailureBudgetError) return { ...report, recoverable: false, queued: false, reason: "el presupuesto de fallos del espacio de trabajo no admite otra llamada ahora: reintentar más tarde" };
    throw error;
  }
}
