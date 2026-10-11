import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { AdaptationContextSchema, type AdaptationContext } from "@/lib/schemas/adaptation-context";
import { AdaptationPlanSchema, type AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { PlanReviewSchema, type PlanReview } from "@/lib/schemas/plan-review";
import type { AiReviewDraft, PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { allBlocks } from "@/lib/schemas/material-document";
import { AIError } from "@/lib/ai/errors";
import { resolveAutomatically } from "../automatic-resolution";
import { buildAdaptationContext, isResolvedByPresentation } from "../context";
import { buildDocument, sequentialIds } from "../document";
import { planExecutability, type ExecutabilityReport } from "../execution";
import { fingerprint } from "../fingerprint";
import { auditGeneration } from "../generation-checks";
import { decisionSupportBudget, designatedRewriter } from "../generated-v2";
import { OUT_OF_BUDGET_CHECK } from "../generation-checks";
import { buildGeneratorInputV2, normalizeGeneration } from "../generator";
import { classifyPlan } from "../invariants";
import { modelFacingAnalysis } from "../model-input";
import type { NormalizedGeneration } from "../generated";
import { applicablePlan } from "../plan";
import { normalizeTeacherEdits, reviewPlan, type ReviewedPlan } from "../plan-review";
import { normalizePlanFor } from "../plan-v2";
import { solvabilityInputs } from "../pipeline";
import { assembleReview, deterministicChecks } from "../review";
import { buildPedagogicalReviewContext } from "../review-context";
import { buildReviewScoped } from "../reviewer";
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
  services: (versions: PipelineVersions, analysis: MaterialAnalysis) => PipelineServices;
  entitlements?: AdaptationEntitlements;
  leaseSeconds?: number;
  retryBackoffSeconds?: number;
  maxAttempts?: number;
  /** Failed jobs of one stage after which a manual retry is refused (a person must cancel or escalate). */
  maxManualRetries?: number;
  log?: { warn: (event: string, data: Record<string, unknown>) => void };
}

const DEFAULTS = { leaseSeconds: 300, retryBackoffSeconds: 30, maxAttempts: 3 } as const;

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

interface Loaded {
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
async function plannerDraft(deps: OrchestratorDeps, run: StageRun, loaded: Loaded, services: PipelineServices, callFp: string, repairOf?: Parameters<AdaptationPlanner["plan"]>[0]["repairOf"]): Promise<unknown> {
  const existing = await deps.store.findArtifact(run.job.adaptation_id, "planner_draft", { inputFingerprint: callFp });
  if (existing) return existing.payload.draft;
  if (!(await deps.store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
  let answered;
  try {
    answered = await services.planner.plan({ context: loaded.context, material: modelFacingAnalysis(loaded.analysis), ...(repairOf ? { repairOf } : {}) });
  } catch (error) {
    const { code } = classifyAIFailure(error, "planning");
    await deps.store.recordAiRun(failedRow(error, loaded.versions.planner, "plan", "adaptation_planner", code, run.ids, callFp, repairOf ? "repair" : "initial"));
    throw error;
  }
  const outputFp = fingerprint(answered.draft);
  // The call happened and may have cost money: it is recorded BEFORE anything that can be refused (a cancelled job loses its
  // lease, so a late answer is audited but can never persist an artifact).
  for (const r of answered.runs) await deps.store.recordAiRun(runRow(r, run.ids, callFp, outputFp));
  await deps.store.putArtifact(run.job.adaptation_id, run.lease, "planner_draft", callFp, outputFp, { draft: answered.draft, version: loaded.versions.planner.prompt_version, repair: repairOf !== undefined });
  await deps.store.clearProviderCall(run.lease.jobId, run.lease.attempt);
  return answered.draft;
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

    const services = deps.services(loaded.versions, loaded.analysis);
    const version = loaded.versions.planner.prompt_version;
    await store.setStep(job.id, job.attempts, "planning", 30);

    const draft = await plannerDraft(deps, run, loaded, services, inputFp);
    const normalize = (d: unknown) => {
      try {
        return normalizePlanFor(version, d, loaded.analysis, loaded.context);
      } catch (error) {
        throw new AIError("invalid_output", `planner draft rejected: ${error instanceof Error ? error.name : "unknown"}`, { cause: error });
      }
    };
    let plan = normalize(draft);
    let checked = applicablePlan(plan, loaded.analysis, loaded.context);
    if (!checked.validation.valid) {
      // One repair with the blocking issues (the existing policy); whatever still blocks is never applied.
      const issues = checked.validation.issues.filter((i) => i.severity === "block");
      const repairFp = fingerprint({ input: inputFp, repair: issues });
      plan = normalize(await plannerDraft(deps, run, loaded, services, repairFp, issues));
      checked = applicablePlan(plan, loaded.analysis, loaded.context);
    }
    const validation = checked.validation;
    const classification = classifyPlan(plan, validation);
    const planFp = fingerprint(plan);
    await store.setStep(job.id, job.attempts, "validating", 80);
    await store.putArtifact(adaptationId, run.lease, "plan", inputFp, planFp, plan);
    await store.putArtifact(adaptationId, run.lease, "plan_validation", inputFp, fingerprint({ validation, classification }), { plan_fingerprint: planFp, validation, classification });
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
export type AutomaticStopCode = "generation_refused" | "quality";

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
  // Saved in every case (audit, and what the status reads); held when a high need is left without any executable decision.
  const submitted = await submitPlanReview(deps, adaptationId, resolution.review, { automatic: { outcomes: resolution.outcomes, unresolved: resolution.unresolved.map((u) => u.decision_id) } }, { hold: resolution.unresolved.length > 0 });
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
const AUDIT_RESTRICTIONS: Readonly<Record<string, string>> = {
  "el generador no propuso nada fuera de lo autorizado": SCOPE,
  "cada bloque generado es de un tipo que su decisión autoriza": SCOPE,
  "ninguna frase se repite literalmente dentro de una actividad": NO_REPEAT,
  "todas las decisiones aprobadas se ejecutaron o se rechazaron de forma estructurada": EXECUTE,
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
function losesCoverage(effective: readonly AdaptationPlan["decisions"][number][], drop: ReadonlySet<string>, context: AdaptationContext): boolean {
  const kept = effective.filter((d) => !drop.has(d.id));
  return effective.some((d) => drop.has(d.id) && d.dimensions.some((dim) => !isResolvedByPresentation(dim, context.presentation) && !kept.some((k) => k.dimensions.includes(dim))));
}

/**
 * The repair of a failed generation or review, decision by decision, CONTENT FIRST:
 *   1. a decision that has not been asked this yet keeps its place and gets the restriction that names what to fix: it is generated
 *      again with it (the useful adaptation is repaired, not removed);
 *   2. one that already carried that restriction and failed again (or for which no restriction can say what to fix) is left out,
 *      its part keeping the original, ONLY if every need it attends stays covered (`losesCoverage`);
 *   3. otherwise null: no safe repair, the honest stop.
 * The result must still be executable.
 */
function planRepair(raw: AdaptationPlan, previous: PlanReview, loaded: Loaded, asks: ReadonlyMap<string, ReadonlyArray<string | null>>, dropReason: string): { review: PlanReview; restricted: string[]; dropped: string[] } | null {
  const effective = reviewPlan(raw, previous, loaded.analysis, loaded.context).effective.decisions;
  const restricted: string[] = [];
  const drop = new Set<string>();
  const entries = previous.entries.map((e) => {
    const wanted = asks.get(e.decision_id);
    if (!wanted) return e;
    const current = e.restrictions ?? [];
    const missing = [...new Set(wanted)].filter((r): r is string => r !== null && !current.includes(r));
    if (wanted.includes(null) || missing.length === 0 || current.length + missing.length > 6) {
      drop.add(e.decision_id);
      return e;
    }
    restricted.push(e.decision_id);
    return { ...e, restrictions: [...current, ...missing] };
  });
  if (drop.size > 0 && losesCoverage(effective, drop, loaded.context)) return null;
  const review: PlanReview = { ...previous, entries: entries.map((e) => (drop.has(e.decision_id) ? { decision_id: e.decision_id, action: "rejected" as const, reason: dropReason.slice(0, 160) } : e)) };
  const check = reviewPlan(raw, review, loaded.analysis, loaded.context);
  if (planExecutability(check, loaded.analysis, loaded.context).blockers.length > 0 || !check.effectiveValidation.valid) return null;
  return { review, restricted, dropped: [...drop] };
}

const addAsk = (asks: Map<string, Array<string | null>>, id: string, restriction: string | null) => asks.set(id, [...(asks.get(id) ?? []), restriction]);

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
  const reviewed = reviewPlan(raw.plan, previous, loaded.analysis, loaded.context);

  // The blocked version, rebuilt exactly (same generation, same deterministic ids, same restoration) to read what each failing
  // block traces to.
  const generationArtifact = await store.findArtifact(adaptationId, "generation", { inputFingerprint: generationFingerprint(raw.fingerprint, last.fingerprint, loaded.versions) });
  if (!generationArtifact) return status === "awaiting_plan_review" ? requeueSavedReview(deps, adaptationId, last.fingerprint, previous) : null;
  const generation = (generationArtifact.payload as { generation: NormalizedGeneration }).generation;
  let document;
  try {
    document = assembleAndCheck(loaded, reviewed, generation, true).document;
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
  if (perCheck.some((c) => c.ids.size === 0)) {
    deps.log?.warn("automatic_correction_unattributed", { adaptationId, checks: perCheck.filter((c) => c.ids.size === 0).map((c) => c.check).join(",") });
    return null;
  }
  const asks = new Map<string, Array<string | null>>();
  for (const { check, ids } of perCheck) for (const id of ids) addAsk(asks, id, REVIEW_RESTRICTIONS[check] ?? null);
  const repair = planRepair(raw.plan, previous, loaded, asks, CORRECTION_REASON);
  if (!repair) return null;

  if (status === "blocked") {
    try {
      await reopenPlanReview(deps, adaptationId);
    } catch (error) {
      if (error instanceof GenerationLimitError) return null;
      throw error;
    }
  }
  const submitted = await submitPlanReview(deps, adaptationId, repair.review, { automatic: { correction_of: last.fingerprint, restricted: repair.restricted, dropped: repair.dropped, failing: failing.map((c) => c.check) } });
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
function assembleAndCheck(loaded: Loaded, reviewed: ReviewedPlan, generation: NormalizedGeneration, restore: boolean) {
  const check = (g: NormalizedGeneration) => {
    const document = buildDocument({ analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, generated: g.segments, newBlockId: sequentialIds() });
    const input = { analysis: loaded.analysis, plan: reviewed.effective, context: loaded.context, document, validation: reviewed.effectiveValidation };
    const deterministic = assembleReview(input, deterministicChecks(input));
    const audit = auditGeneration({ analysis: loaded.analysis, context: loaded.context, reviewed, generation: g, document, review: deterministic });
    return { generation: g, document, input, deterministic, audit, restored: [] as string[] };
  };
  let first;
  try {
    first = check(generation);
  } catch (error) {
    throw new AdaptationError("generator_validation", "El documento no se pudo ensamblar", { cause: error });
  }
  if (!restore) return first;
  const refs = preservationRefs(first.deterministic, loaded.analysis, first.document);
  const restoration = refs.size > 0 ? withOriginals(generation, refs) : null;
  if (!restoration) return first;
  let second;
  try {
    second = check(restoration.generation);
  } catch {
    return first;
  }
  const fails = (r: PedagogicalReview) => new Set(r.checks.filter((c) => c.status === "FAIL").map((c) => c.check));
  const before = fails(first.deterministic);
  const after = fails(second.deterministic);
  const auditBefore = new Set(first.audit.checks.filter((c) => !c.ok).map((c) => c.name));
  const better = after.size < before.size && [...after].every((c) => before.has(c)) && second.audit.checks.every((c) => c.ok || auditBefore.has(c.name));
  return better ? { ...second, restored: restoration.restored } : first;
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
  const run: StageRun = { job, lease: { jobId: job.id, attempt: job.attempts }, ids: { workspaceId: job.workspace_id, adaptationId: job.adaptation_id, materialId: job.material_id, jobId: job.id, jobAttempt: job.attempts } };

  let failing: Stage = "generation";
  try {
    const ambiguous = await stopOnAmbiguity(deps, run, loaded, "generation");
    if (ambiguous) return ambiguous;
    let current = (await store.getPipeline(adaptationId))!.adaptation.status as AdaptationStatus;
    if (current === "generation_queued") current = await advance(store, adaptationId, current, "generating");

    const services = deps.services(loaded.versions, loaded.analysis);
    const generatorVersion = loaded.versions.generator.prompt_version;
    await store.setStep(job.id, job.attempts, "generating", 30);

    // 3-5. Generate (or reuse), normalise. Only `ai_generation` decisions can be in the request; with none, there is no call.
    const generationArtifact = await store.findArtifact(adaptationId, "generation", { inputFingerprint: inputFp });
    let generation: NormalizedGeneration;
    if (generationArtifact) {
      generation = (generationArtifact.payload as { generation: ReturnType<typeof normalizeGeneration> }).generation;
    } else {
      let draft: unknown = { segments: [], skipped: [], blocked: [], change_summary: [] };
      if (execution.ai.length > 0) {
        const sent = buildGeneratorInputV2(reviewed, loaded.analysis, loaded.context).approved.decisions.map((d) => d.id);
        if (JSON.stringify([...sent].sort()) !== JSON.stringify([...execution.ai].sort())) throw new AdaptationError("internal", "La petición no contiene exactamente las decisiones ai_generation");
        if (!(await store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
        let answered;
        try {
          answered = await services.generator.generate({ context: loaded.context, analysis: loaded.analysis, reviewed });
        } catch (error) {
          const { code } = classifyAIFailure(error, "generation");
          await store.recordAiRun(failedRow(error, loaded.versions.generator, "generate", "material_generator", code, run.ids, inputFp));
          throw error;
        }
        draft = answered.draft;
        const outputFp = fingerprint(draft);
        try {
          generation = normalizeGeneration(generatorVersion, draft, reviewed, loaded.analysis, loaded.context);
        } catch (error) {
          for (const r of answered.runs) await store.recordAiRun(runRow(r, run.ids, inputFp, outputFp));
          await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
          throw new AdaptationError("generator_validation", `generator draft rejected: ${error instanceof Error ? error.name : "unknown"}`, { cause: error });
        }
        for (const r of answered.runs) await store.recordAiRun(runRow(r, run.ids, inputFp, outputFp));
        await store.putArtifact(adaptationId, run.lease, "generation", inputFp, fingerprint({ input: inputFp, draft, generation }), { draft, generation });
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
    const assembled = assembleAndCheck(loaded, reviewed, generation, serverDriven(row, reviewArtifact.payload));
    const { document, input, deterministic, audit, restored } = assembled;
    generation = assembled.generation;
    const documentFp = fingerprint(document);
    if (restored.length > 0) deps.log?.warn("automatic_original_restored", { adaptationId, refs: restored.join(",") });
    const hardFail = deterministic.checks.some((c) => c.status === "FAIL");
    if (!audit.ok && !hardFail) {
      const failing = audit.checks.filter((c) => !c.ok);
      // Names and decision ids only: what an operator needs to know why, never content.
      deps.log?.warn("generation_audit_failed", { adaptationId, checks: failing.map((c) => c.name).join("; "), decisions: [...new Set(failing.flatMap((c) => c.decisions ?? []))].join(",") });
      const repaired = await repairGenerationAutomatically(deps, run, { snapshot, loaded, raw, reviewArtifact, failing });
      if (repaired) return repaired;
      throw new AdaptationError("generator_validation", `La generación no supera la auditoría: ${failing.map((c) => c.name).join("; ").slice(0, 200)}`);
    }
    current = await advance(store, adaptationId, current, "reviewing_deterministic");
    await store.putArtifact(adaptationId, run.lease, "deterministic_review", inputFp, fingerprint({ input: inputFp, deterministic, audit }), { review: deterministic, audit, document_fingerprint: documentFp, ...(restored.length > 0 ? { restored_originals: restored } : {}) });

    // 8. The version exists from here on (history), whatever the review says.
    const version = await store.persistVersion(adaptationId, run.lease, document, { plan: raw.fingerprint, review: reviewFp, generation: inputFp });

    if (hardFail) {
      // A deterministic FAIL is final: no AI call can soften it, so none is made.
      await store.finalize(adaptationId, run.lease, version.id, deterministic, "blocked");
      if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
      return { outcome: "completed", status: "blocked", code: "deterministic_review_failed", jobId: job.id, delivered: false, verdict: deterministic.verdict, version: version.version };
    }

    // 9-12. AI review: reuse a persisted merged review, else ask, persist the findings, merge with the precedences, persist.
    current = await advance(store, adaptationId, current, "reviewing_ai");
    failing = "review";
    const reviewInputFp = reviewFingerprint(documentFp, reviewFp, loaded.versions);
    const merged = await store.findArtifact(adaptationId, "pedagogical_review", { inputFingerprint: reviewInputFp });
    let finalReview;
    if (merged) {
      finalReview = (merged.payload as { review: ReturnType<typeof assembleReview> }).review;
    } else {
      const findings = await store.findArtifact(adaptationId, "reviewer_findings", { inputFingerprint: reviewInputFp });
      let draft: AiReviewDraft;
      if (findings) draft = (findings.payload as { draft: AiReviewDraft }).draft;
      else {
        const reviewContext = buildPedagogicalReviewContext(input, reviewed);
        if (!(await store.markProviderCall(run.lease.jobId, run.lease.attempt))) throw new LeaseLostError();
        let answered;
        try {
          answered = await services.reviewer.review({ context: loaded.context, document, plan: reviewed.effective, solvability: solvabilityInputs(loaded.analysis), reviewContext });
        } catch (error) {
          const { code } = classifyAIFailure(error, "review");
          await store.recordAiRun(failedRow(error, loaded.versions.reviewer, "review", "pedagogical_reviewer", code, run.ids, reviewInputFp));
          throw error;
        }
        draft = answered.draft as AiReviewDraft;
        const outputFp = fingerprint(draft);
        for (const r of answered.runs) await store.recordAiRun(runRow(r, run.ids, reviewInputFp, outputFp));
        await store.putArtifact(adaptationId, run.lease, "reviewer_findings", reviewInputFp, fingerprint({ input: reviewInputFp, output: outputFp }), { draft });
        await store.clearProviderCall(run.lease.jobId, run.lease.attempt);
      }
      const outcome = buildReviewScoped(input, draft, reviewed.raw.decisions.map((d) => d.id));
      finalReview = outcome.review;
      await store.putArtifact(adaptationId, run.lease, "pedagogical_review", reviewInputFp, fingerprint({ input: reviewInputFp, review: finalReview, rejected: outcome.rejected, pending: outcome.pending }), { review: finalReview, rejected: outcome.rejected, pending: outcome.pending });
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
  at: { snapshot: PipelineSnapshot; loaded: Loaded; raw: { plan: AdaptationPlan; fingerprint: string }; reviewArtifact: { fingerprint: string; payload: Record<string, unknown> }; failing: ReadonlyArray<{ name: string; decisions?: string[] }> },
): Promise<GenerationResult | null> {
  const { snapshot, loaded, raw, reviewArtifact, failing } = at;
  const adaptationId = snapshot.adaptation.id;
  if (snapshot.adaptation.creation_mode !== "automatic") return null;
  const previous = PlanReviewSchema.parse(reviewArtifact.payload);
  if (previous.reviewer.kind !== "auto" || previous.plan_fingerprint !== raw.fingerprint) return null;
  // This generation is one cycle; another one must still fit.
  const cycles = new Set([...snapshot.jobs.filter((j) => j.stage === "generation" && j.input_fingerprint).map((j) => j.input_fingerprint), run.job.input_fingerprint]).size;
  if (cycles >= MAX_GENERATION_CYCLES) return null;
  if (failing.some((c) => (c.decisions ?? []).length === 0)) return null;
  const effective = reviewPlan(raw.plan, previous, loaded.analysis, loaded.context).effective.decisions;
  const asks = new Map<string, Array<string | null>>();
  for (const c of failing) {
    for (const id of c.decisions ?? []) {
      const decision = effective.find((d) => d.id === id);
      const budget = c.name === OUT_OF_BUDGET_CHECK && decision ? budgetRestriction(decisionSupportBudget(decision, loaded.analysis.activities.find((a) => a.id === decision.target))) : null;
      addAsk(asks, id, budget ?? AUDIT_RESTRICTIONS[c.name] ?? null);
    }
  }
  const repair = planRepair(raw.plan, previous, loaded, asks, REPAIR_REASON);
  if (!repair) return null;

  // This generation ends here (its output stays as an artifact, no version); the adaptation goes back through the gate it came from.
  if (!(await deps.store.completeStage(run.job.id, run.job.attempts))) throw new LeaseLostError();
  await deps.store.transition(adaptationId, "generating", "awaiting_plan_review");
  const submitted = await submitPlanReview(deps, adaptationId, repair.review, { automatic: { repair_of: reviewArtifact.fingerprint, restricted: repair.restricted, dropped: repair.dropped, failing: failing.map((c) => c.name) } });
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
