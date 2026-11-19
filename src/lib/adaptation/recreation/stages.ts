import "server-only";
import { randomUUID } from "node:crypto";
import { AIError } from "@/lib/ai/errors";
import type { AIRunRecord } from "@/lib/ai/types";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { RECREATION_CONTRACT } from "@/lib/recreation/contract";
import { finishRecreation, planRecreation, type PlannedRecreation } from "@/lib/recreation/pilot";
import { RECREATION_PLANNER_LIMITS } from "@/lib/recreation/planner";
import { RecreationPlanSchema } from "@/lib/recreation/contract";
import { versionOf } from "@/lib/recreation/record";
import { RECREATION_VERIFIER_VERSION, type Verification } from "@/lib/recreation/verify";
import { RECREATION_VISUALS_VERSION } from "@/lib/recreation/visuals";
import type { PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { stageKit, type OrchestratorDeps, type StageOutcome, type StageRun } from "../orchestration/orchestrator";
import { AdaptationError } from "../orchestration/errors";
import { FailureBudgetError, InvalidStateError, LeaseLostError, NotFoundError, type AdaptationStore, type PipelineSnapshot } from "../orchestration/store";
import type { AdaptationStatus } from "../orchestration/state-machine";
import { NO_ENTITLEMENTS } from "../orchestration/entitlements";
import type { PipelineVersions } from "../orchestration/versions";
import type { RecreationServices } from "./services";
import type { VisualPolicy } from "@/lib/recreation/visuals";
import { DESIGNED_FROM, DIAGRAMS_FROM, NEW_IMAGES_FROM, usesRecreation } from "./engine";

/**
 * The two stages of «Hacer magia» when the adaptation was created with the recreation engine (ADR-053). They reuse the adaptation's
 * own machinery — durable jobs with leases, the ordered state machine, the reserved unit (consumed once, atomically with the first
 * delivery), `ai_runs`, versions — and replace only what happens inside:
 *
 *   planning     Claude designs the new sheet (`recreation_plan@v1`), the server verifies it (one repair), and the verified plan, with
 *                its solutions, is kept SERVER-ONLY (`recreation_plans`). Then the adaptation moves on by itself (no plan review: this
 *                is «Hacer magia») and the generation job is queued.
 *   generation   the pictures (original · code · OpenAI through the product's own gates), the sheet and the materials, the version
 *                persisted WITHOUT answers (`answer_key` empty; the solutions go to `recreation_internals`), the review, the delivery.
 *
 * Opening, printing or downloading what exists never reaches this file: those read the stored version (`reader.ts`).
 */

const SCOPE = "methodological" as const;

/**
 * ADR-054: from planner v5 on, «Hacer magia» designs NEW pictures (no reuse of the original's, no vision call to locate them) and
 * never words away a missing one. Read from the frozen prompt version: an adaptation created before keeps what it was created with.
 */
export const visualPolicyOf = (versions: PipelineVersions): VisualPolicy => {
  const v = versions.recreation?.planner.prompt_version ?? 1;
  return v >= DESIGNED_FROM ? "designed" : v >= NEW_IMAGES_FROM ? "new_images" : "reuse_originals";
};

/** ADR-059: whether this adaptation's planner may design new schemes (read from the frozen prompt version, like the visual policy). */
export const diagramsOf = (versions: PipelineVersions): boolean => (versions.recreation?.planner.prompt_version ?? 1) >= DIAGRAMS_FROM;

const statusOf = async (store: AdaptationStore, id: string) => ((await store.getPipeline(id))?.adaptation.status ?? "failed") as AdaptationStatus;
const runIds = (job: NonNullable<Awaited<ReturnType<AdaptationStore["claimStage"]>>>): StageRun["ids"] => ({ workspaceId: job.workspace_id, adaptationId: job.adaptation_id, materialId: job.material_id, jobId: job.id, jobAttempt: job.attempts });

function recorder(store: AdaptationStore, ids: StageRun["ids"]) {
  return async (run: AIRunRecord) => {
    await store.recordAiRun({
      workspace_id: ids.workspaceId, job_id: ids.jobId, adaptation_id: ids.adaptationId, material_id: ids.materialId,
      purpose: run.purpose, model_alias: run.alias, provider: run.provider, model: run.model, prompt_key: run.promptKey, prompt_version: run.promptVersion, effort: run.effort,
      input_tokens: run.inputTokens, output_tokens: run.outputTokens, cached_input_tokens: run.cachedInputTokens, cache_creation_input_tokens: run.cacheCreationInputTokens,
      estimated_cost_usd: run.estimatedCostUsd, latency_ms: run.latencyMs, status: run.status, error_code: run.errorCode, attempt: run.attempt,
      schema_version: null, call_kind: run.attempt > 1 ? "repair" : "initial", reasoning_tokens: null, input_fingerprint: null, output_fingerprint: null, job_attempt: ids.jobAttempt,
    });
  };
}

/** What the plan calls of this adaptation already cost (a retried stage never starts again with a fresh budget). */
async function plannerSpent(store: AdaptationStore, adaptationId: string): Promise<number> {
  const rows = await store.listAiRuns({ adaptationId });
  return rows.filter((r) => r.purpose === "plan").reduce((sum, r) => sum + (r.estimated_cost_usd === null || r.estimated_cost_usd === undefined ? RECREATION_PLANNER_LIMITS.unpricedCallUsd : Number(r.estimated_cost_usd)), 0);
}

const generationFingerprint = (row: PipelineSnapshot["adaptation"], planFp: string, versions: PipelineVersions) =>
  fingerprint({ stage: "recreation_generation", context: row.context_fingerprint, analysis: row.analysis_fingerprint, plan: planFp, recreation: versions.recreation, contract: RECREATION_CONTRACT });

/** After a successful planning job: the ordered hop through the plan gate (automatic: nobody approves a plan) and the generation job. */
async function handoff(deps: OrchestratorDeps, adaptationId: string): Promise<AdaptationStatus> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  let status = snapshot.adaptation.status as AdaptationStatus;
  if (status === "planning") {
    await store.transition(adaptationId, "planning", "awaiting_plan_review");
    status = "awaiting_plan_review";
  }
  if (status === "awaiting_plan_review") {
    await store.transition(adaptationId, "awaiting_plan_review", "generation_queued");
    status = "generation_queued";
  }
  if (status !== "generation_queued") return status;
  const stored = await store.getRecreationPlan(adaptationId);
  if (!stored || !snapshot.adaptation.pipeline_versions) return status;
  try {
    await store.enqueueStage(adaptationId, "generation", generationFingerprint(snapshot.adaptation, stored.plan_fingerprint, snapshot.adaptation.pipeline_versions), stageKit.settings(deps).maxAttempts);
  } catch (error) {
    // The workspace's budget of failed paid calls is spent: the adaptation stops here, honestly, without another paid call.
    if (error instanceof FailureBudgetError) {
      await store.transition(adaptationId, "generation_queued", "failed", "provider_transient");
      return "failed";
    }
    throw error;
  }
  return "generation_queued";
}

function planFailure(planned: Exclude<PlannedRecreation, { status: "planned" }>): AdaptationError | AIError {
  switch (planned.status) {
    case "budget_exhausted":
      return new AdaptationError("provider_transient", "El presupuesto de la planificación no cubre otra llamada");
    case "invalid_contract":
      return new AdaptationError("planner_schema", `el plan no cumple el contrato tras una reparación (${planned.issues.length} problemas)`);
    default:
      return new AdaptationError("planner_schema", `el plan no supera las comprobaciones esenciales (${planned.issues.filter((i) => i.severity === "error").map((i) => i.code).slice(0, 6).join(", ")})`);
  }
}

/** A failure the system will not retry by itself gives the unit back: a failed «Hacer magia» never costs one. */
async function releaseOnFinalFailure(deps: OrchestratorDeps, adaptationId: string, workspaceId: string, outcome: StageOutcome): Promise<StageOutcome> {
  if (outcome.outcome === "failed" || outcome.outcome === "human_action_required") await stageKit.release(deps, { id: adaptationId, workspaceId }, `recreation_${outcome.code ?? "failed"}`);
  return outcome;
}

export async function runRecreationPlanning(deps: OrchestratorDeps, adaptationId: string): Promise<StageOutcome> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status === "cancelled") return { outcome: "rejected", status, code: "cancelled" };
  let loaded;
  try {
    loaded = stageKit.load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return { outcome: error.kind === "human_action_required" ? "human_action_required" : "rejected", status, code: error.code, detail: error.message };
    throw error;
  }
  const inputFp = stageKit.planningFingerprint(snapshot.adaptation, loaded.versions);
  // Already planned for this input (a resumed adaptation): only the hop is missing, no job and no model call.
  if (await store.getRecreationPlan(adaptationId)) return { outcome: "reused", status: await handoff(deps, adaptationId) };
  if (deps.entitlements?.assertReserved && !(await deps.entitlements.assertReserved({ id: adaptationId, workspaceId: snapshot.adaptation.workspace_id }))) return { outcome: "rejected", status, code: "entitlement_not_reserved" };
  let enqueued;
  try {
    enqueued = await store.enqueueStage(adaptationId, "planning", inputFp, stageKit.settings(deps).maxAttempts);
  } catch (error) {
    if (error instanceof InvalidStateError) return { outcome: "rejected", status, code: "plan_review_required", detail: error.detail };
    throw error;
  }
  const job = await stageKit.claim(deps, enqueued.jobId, false);
  if (!job) return { outcome: "skipped", status, jobId: enqueued.jobId };
  const ids = runIds(job);
  const run: StageRun = { job, lease: { jobId: job.id, attempt: job.attempts }, ids };
  try {
    const ambiguous = await stageKit.stopOnAmbiguity(deps, run, loaded, "planning");
    if (ambiguous) return ambiguous;
    if ((await statusOf(store, adaptationId)) === "queued") await store.transition(adaptationId, "queued", "planning");
    if (!deps.recreation) throw new AIError("not_configured", "the recreation engine is not configured");
    await store.setStep(job.id, job.attempts, "planning", 30);
    const planner = (deps.recreation as RecreationServices).planner({ versions: loaded.versions, ids, spentUsd: () => plannerSpent(store, adaptationId), record: recorder(store, ids) });
    // A call whose outcome is unknown (the process dies in the middle) is never repeated by itself: the next attempt stops as ambiguous.
    await store.markProviderCall(job.id, job.attempts);
    const planned = await planRecreation(planner, { analysis: loaded.analysis, context: loaded.context, scope: SCOPE, approach: loaded.versions.recreation?.approach ?? "auto", visualPolicy: visualPolicyOf(loaded.versions), diagrams: diagramsOf(loaded.versions) });
    await store.clearProviderCall(job.id, job.attempts);
    if (planned.status !== "planned") {
      // Content-free diagnostics: codes and schema paths only, never plans, quotes, answers or student data.
      const codes = planned.status === "rejected" ? [...new Set(planned.issues.filter((i) => i.severity === "error").map((i) => i.code))] : [planned.status];
      const paths = planned.status === "rejected" ? [...new Set(planned.issues.filter((i) => i.severity === "error").map((i) => i.path))] : [];
      deps.log?.warn("recreation_plan_rejected", { adaptationId, status: planned.status, calls: planned.calls, codes: codes.slice(0, 20).join(","), paths: paths.slice(0, 20).join(",") });
      throw planFailure(planned);
    }
    await store.setStep(job.id, job.attempts, "validating", 80);
    await store.putRecreationPlan(adaptationId, run.lease, planned.plan, planned.verification, fingerprint(planned.plan));
    if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
    return { outcome: "completed", status: await handoff(deps, adaptationId), jobId: job.id };
  } catch (error) {
    if (error instanceof LeaseLostError) return { outcome: "skipped", status: await statusOf(store, adaptationId), jobId: job.id };
    return releaseOnFinalFailure(deps, adaptationId, ids.workspaceId, await stageKit.failStage(deps, run, "planning", error));
  }
}

/** The honest, short review the delivery is recorded with: only what the engine really verified, in the original review's own format. */
export function reviewOf(input: { documentFingerprint: string; planFingerprint: string; state: "ready" | "review" | "incomplete"; reviewActivities: readonly string[]; visualsMissing: number }): PedagogicalReview {
  const checks: PedagogicalReview["checks"] = [
    { check: "objectives_preserved", method: "deterministic", status: "PASS", targets: [], detail: "El verificador comprobó que se conservan todos los objetivos y sus operaciones." },
    { check: "answers_not_leaked", method: "deterministic", status: "PASS", targets: [], detail: "Ninguna pista ni apoyo revela una respuesta; las respuestas no están en el documento visible." },
    input.reviewActivities.length > 0
      ? { check: "traceability_complete", method: "deterministic", status: "WARN", targets: [], detail: `Respuesta apoyada en el texto pero no demostrada: actividades ${input.reviewActivities.join(", ")}. Revisión docente.` }
      : { check: "traceability_complete", method: "deterministic", status: "PASS", targets: [], detail: "Cada respuesta cerrada está demostrada o es una respuesta abierta con criterios." },
    input.visualsMissing > 0
      ? { check: "visual_references_resolved", method: "deterministic", status: "WARN", targets: [], detail: `Falta ${input.visualsMissing === 1 ? "una imagen necesaria" : `${input.visualsMissing} imágenes necesarias`}.` }
      : { check: "visual_references_resolved", method: "deterministic", status: "PASS", targets: [], detail: "Las imágenes que necesitan las actividades están en la ficha." },
  ];
  return { schema_version: 1, document_fingerprint: input.documentFingerprint, plan_fingerprint: input.planFingerprint, checks, verdict: input.state === "ready" ? "approved" : "approved_with_warnings", blocks_to_revise: [] };
}

export async function runRecreationGeneration(deps: OrchestratorDeps, adaptationId: string): Promise<StageOutcome & { delivered?: boolean; version?: number }> {
  const store = deps.store;
  const snapshot = await store.getPipeline(adaptationId);
  if (!snapshot) throw new NotFoundError();
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status === "cancelled") return { outcome: "rejected", status, code: "cancelled" };
  if (status === "ready") return { outcome: "reused", status };
  let loaded;
  try {
    loaded = stageKit.load(snapshot);
  } catch (error) {
    if (error instanceof AdaptationError) return { outcome: error.kind === "human_action_required" ? "human_action_required" : "rejected", status, code: error.code, detail: error.message };
    throw error;
  }
  const recreation = loaded.versions.recreation;
  const stored = await store.getRecreationPlan(adaptationId);
  if (!recreation || !stored) return { outcome: "rejected", status, code: "plan_review_required" };
  if (deps.entitlements?.assertReserved && !(await deps.entitlements.assertReserved({ id: adaptationId, workspaceId: snapshot.adaptation.workspace_id }))) return { outcome: "rejected", status, code: "entitlement_not_reserved" };
  const genFp = generationFingerprint(snapshot.adaptation, stored.plan_fingerprint, loaded.versions);
  let enqueued;
  try {
    enqueued = await store.enqueueStage(adaptationId, "generation", genFp, stageKit.settings(deps).maxAttempts);
  } catch (error) {
    if (error instanceof InvalidStateError) return { outcome: "rejected", status, code: "plan_review_required", detail: error.detail };
    throw error;
  }
  const job = await stageKit.claim(deps, enqueued.jobId, false);
  if (!job) return { outcome: "skipped", status, jobId: enqueued.jobId };
  const ids = runIds(job);
  const run: StageRun = { job, lease: { jobId: job.id, attempt: job.attempts }, ids };
  try {
    const ambiguous = await stageKit.stopOnAmbiguity(deps, run, loaded, "generation");
    if (ambiguous) return ambiguous;
    if (!deps.recreation) throw new AIError("not_configured", "the recreation engine is not configured");
    const plan = RecreationPlanSchema.parse(stored.plan);
    const verification = stored.verification as Verification;
    let current = await statusOf(store, adaptationId);
    current = await stageKit.advance(store, adaptationId, current, "generating");
    await store.setStep(job.id, job.attempts, "generating", 30);
    const gate = await (deps.recreation as RecreationServices).illustrations({ versions: loaded.versions, ids });
    const plannerLabel = `recreation_planner v${recreation.planner.prompt_version} · ${recreation.planner.selection.model}`;
    // The pictures are the paid part: a call whose outcome is unknown is never repeated by itself, and approved pictures are
    // reused (the same need, brief and style) if this stage is run again.
    await store.markProviderCall(job.id, job.attempts);
    // Option A first: the original's own pictures that the plan points at, when located and trusted (never blocks the sheet).
    const services = deps.recreation as RecreationServices;
    const originals = [...new Set(plan.visual_requests.flatMap((r) => (r.original_ref ? [r.original_ref] : [])))];
    const visualPolicy = visualPolicyOf(loaded.versions);
    const locatedOriginals = visualPolicy === "reuse_originals" && originals.length > 0 && services.locatedOriginals ? await services.locatedOriginals({ ids, analysis: loaded.analysis, analysisFingerprint: snapshot.adaptation.analysis_fingerprint ?? "", visualIds: originals }).catch(() => new Set<string>()) : new Set<string>();
    const outcome = await finishRecreation({ status: "planned", plan, verification, runs: [], calls: 0 }, { analysis: loaded.analysis, context: loaded.context, scope: SCOPE, plannerLabel, illustrations: gate, locatedOriginals, visualPolicy });
    await store.clearProviderCall(job.id, job.attempts);

    current = await stageKit.advance(store, adaptationId, current, "reviewing_deterministic");
    await store.setStep(job.id, job.attempts, "reviewing", 60);
    await stageKit.advance(store, adaptationId, current, "reviewing_ai");
    const made = versionOf(outcome, { id: randomUUID(), lineId: adaptationId, version: 1, workspaceId: ids.workspaceId, now: new Date().toISOString() }, [], { contract: RECREATION_CONTRACT, verifier: RECREATION_VERIFIER_VERSION, visuals: RECREATION_VISUALS_VERSION, planner: plannerLabel });
    if (!made) throw new AdaptationError("generator_validation", "la recreación no produjo una versión");
    // A sheet that lacks something essential (a picture an activity needs) is never delivered as final.
    if (made.version.state === "incomplete") {
      // The precise technical cause, by request: route and reason codes only (never the material, the plan or a model's words).
      const causes = outcome.visuals.filter((v) => v.route === "none" && v.essential).map((v) => `${v.request_id}:${(v.attempts.at(-1) ?? "").split(/[ (:]/).filter(Boolean).slice(0, 3).join("_")}`);
      deps.log?.warn("recreation_incomplete", { adaptationId, missing: causes.join(","), unresolved: outcome.compiled.unresolved.join(",") });
      const lost = (outcome.compiled.lost ?? []).slice(0, 3).join("; ");
      throw new AdaptationError("generator_validation", `falta un recurso imprescindible (${causes.join(", ") || `actividades ${outcome.compiled.unresolved.join(", ")}`}${lost ? `; ${lost}` : ""})`.slice(0, 240));
    }
    // The sheet that is stored in the adaptation's version carries NO answers (`versionOf` emptied the key and kept it in `internal`).
    const version = await store.persistVersion(adaptationId, run.lease, made.version.student, { plan: stored.plan_fingerprint, review: stored.plan_fingerprint, generation: genFp });
    await store.putRecreationVersion(
      adaptationId,
      run.lease,
      version.id,
      { state: made.version.state, state_message: made.version.state_message, review_activities: made.version.review_activities, materials_document: made.version.materials, explanation: made.version.explanation, assets: made.version.assets },
      { ...made.internal, version_id: version.id },
    );
    const review = reviewOf({ documentFingerprint: fingerprint(made.version.student), planFingerprint: stored.plan_fingerprint, state: made.version.state, reviewActivities: made.version.review_activities, visualsMissing: outcome.visuals.filter((v) => v.route === "none" && v.essential).length });
    await store.finalize(adaptationId, run.lease, version.id, review, "ready");
    if (!(await store.completeStage(job.id, job.attempts))) throw new LeaseLostError();
    await (deps.entitlements ?? NO_ENTITLEMENTS).consume({ id: adaptationId, workspaceId: ids.workspaceId }).catch(() => deps.log?.warn("entitlement_consume_failed", { adaptationId }));
    return { outcome: "completed", status: "ready", jobId: job.id, delivered: true, version: version.version };
  } catch (error) {
    if (error instanceof LeaseLostError) return { outcome: "skipped", status: await statusOf(store, adaptationId), jobId: job.id };
    return releaseOnFinalFailure(deps, adaptationId, ids.workspaceId, await stageKit.failStage(deps, run, "generation", error));
  }
}

/**
 * An adaptation of this engine interrupted between its two stages (the process died, the page was closed): the plan was saved but the
 * hop or the generation job never happened. Picks it up again without a model call. Null when there is nothing to resume.
 */
export async function resumeRecreation(deps: OrchestratorDeps, adaptationId: string): Promise<AdaptationStatus | null> {
  const snapshot = await deps.store.getPipeline(adaptationId);
  if (!snapshot || !usesRecreation(snapshot.adaptation.pipeline_versions)) return null;
  const status = snapshot.adaptation.status as AdaptationStatus;
  if (status !== "planning" && status !== "awaiting_plan_review" && status !== "generation_queued") return null;
  if (!(await deps.store.getRecreationPlan(adaptationId))) return null;
  return handoff(deps, adaptationId);
}
