import { z } from "zod";
import { InvalidTransitionError, type AdaptationStatus } from "./state-machine";
import { PipelineVersionsSchema } from "./versions";

/**
 * Persistence port of the orchestrator, implemented over the database's RPC functions (all the state logic —
 * transitions, leases, fencing, uniqueness — lives in SQL, supabase/migrations/…013). The only thing the application
 * needs from a client is `rpc`: production passes the service-role client, tests pass PGlite behind the same shape.
 */

export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export class LeaseLostError extends Error {
  constructor() {
    super("El procesador ya no es el titular del lease");
    this.name = "LeaseLostError";
  }
}
export class InvalidStateError extends Error {
  constructor(readonly detail: string) {
    super(`La adaptación no está en un estado válido para esto (${detail})`);
    this.name = "InvalidStateError";
  }
}
/** The workspace has no adaptation left (`exhausted`) or its limit is not configured (`unavailable`). */
export class EntitlementError extends Error {
  constructor(readonly reason: "exhausted" | "unavailable") {
    super(`Sin cuota de adaptaciones (${reason})`);
    this.name = "EntitlementError";
  }
}
/** The adaptation already used every product generation it may have (MAX_GENERATION_CYCLES): no new one is started. */
export class GenerationLimitError extends Error {
  constructor() {
    super("Sin generaciones nuevas para esta adaptación");
    this.name = "GenerationLimitError";
  }
}
/** Too many paid AI calls failed in this workspace recently (ai_failure_budget): no NEW job is admitted for a while. */
export class FailureBudgetError extends Error {
  constructor() {
    super("Presupuesto de fallos de IA agotado");
    this.name = "FailureBudgetError";
  }
}
export class NotFoundError extends Error {
  constructor() {
    super("No encontrado");
    this.name = "NotFoundError";
  }
}

export const ARTIFACT_KINDS = ["planner_draft", "plan", "plan_validation", "plan_review", "execution_report", "generation", "deterministic_review", "reviewer_findings", "pedagogical_review"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type StageName = "planning" | "generation";

const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

const AdaptationRowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  material_id: z.uuid(),
  learner_profile_id: z.uuid().nullable(),
  title: z.string(),
  adaptation_type: z.string(),
  status: z.string(),
  current_version: z.number().int(),
  pipeline_versions: PipelineVersionsSchema.nullable(),
  context_snapshot: z.record(z.string(), z.unknown()).nullable(),
  context_fingerprint: Fingerprint.nullable(),
  analysis_fingerprint: Fingerprint.nullable(),
  failure_code: z.string().nullable(),
  delivered_at: z.string().nullable(),
  created_at: z.string(),
});
export type AdaptationRow = z.infer<typeof AdaptationRowSchema> & { status: AdaptationStatus };

const JobSummarySchema = z.object({
  id: z.uuid(),
  stage: z.enum(["planning", "generation"]),
  status: z.string(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  step: z.string().nullable(),
  progress: z.number(),
  locked_until: z.string().nullable(),
  input_fingerprint: z.string().nullable(),
  error: z.object({ code: z.string() }).passthrough().nullable(),
  ambiguous: z.boolean(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

const PipelineSchema = z.object({
  adaptation: AdaptationRowSchema,
  analysis: z.object({ analysis: z.unknown(), prompt_version: z.string().nullable(), status: z.string() }),
  jobs: z.array(JobSummarySchema),
});
export type PipelineSnapshot = Omit<z.infer<typeof PipelineSchema>, "adaptation"> & { adaptation: AdaptationRow };

const ArtifactSchema = z.object({ id: z.uuid(), kind: z.enum(ARTIFACT_KINDS), input_fingerprint: Fingerprint, fingerprint: Fingerprint, payload: z.record(z.string(), z.unknown()), created_at: z.string() });
export type ArtifactRow = z.infer<typeof ArtifactSchema>;

const ClaimSchema = z.object({ id: z.uuid(), adaptation_id: z.uuid(), workspace_id: z.uuid(), material_id: z.uuid(), stage: z.enum(["planning", "generation"]), attempts: z.number().int(), input_fingerprint: Fingerprint, ambiguous_previous: z.boolean() });
export type ClaimedStage = z.infer<typeof ClaimSchema>;

const EntitlementRecordSchema = z.object({
  adaptation_id: z.uuid(),
  workspace_id: z.uuid(),
  state: z.enum(["reserved", "consumed", "released"]),
  reserve_key: z.string(),
  release_key: z.string().nullable(),
  availability_at_reserve: z.enum(["finite", "unlimited"]),
  limit_at_reserve: z.number().int().nullable(),
  reserved_at: z.string(),
  consumed_at: z.string().nullable(),
  released_at: z.string().nullable(),
  release_reason: z.string().nullable(),
});
export type EntitlementRecord = z.infer<typeof EntitlementRecordSchema>;

/**
 * `finite`: a numeric limit. `unlimited`: no limit (explicit, never a magic number). `unavailable`: no plan or a misconfigured
 * limit: there is NO balance, and nothing may be reserved.
 */
const EntitlementUsageSchema = z.object({
  availability: z.enum(["finite", "unlimited", "unavailable"]),
  limit: z.number().int().nullable(),
  reserved: z.number().int(),
  consumed: z.number().int(),
  available: z.number().int().nullable(),
  ledger_used: z.number().int(),
  period_start: z.string(),
  period_end: z.string(),
});
export type EntitlementUsage = z.infer<typeof EntitlementUsageSchema>;

export interface AiRunRow {
  workspace_id: string;
  job_id: string | null;
  adaptation_id: string;
  material_id: string;
  purpose: string;
  model_alias: string;
  provider: string;
  model: string;
  prompt_key: string | null;
  prompt_version: number | null;
  effort: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  status: string;
  error_code: string | null;
  attempt: number;
  schema_version: number | null;
  call_kind: string | null;
  reasoning_tokens: number | null;
  input_fingerprint: string | null;
  output_fingerprint: string | null;
  job_attempt: number | null;
}

export interface CreateAdaptationArgs {
  workspaceId: string;
  materialId: string;
  userId: string;
  learnerProfileId: string | null;
  adaptationType: string;
  title: string;
  requestKey: string | null;
  versions: unknown;
  context: unknown;
  contextFingerprint: string;
  analysisFingerprint: string;
  /** Reserve the entitlement in the SAME transaction as the row: an unreserved adaptation never exists. */
  reserve?: boolean;
}

function fail(error: { message: string }): never {
  const m = error.message;
  if (m.includes("lease_lost")) throw new LeaseLostError();
  if (m.includes("generation_cycles_exhausted")) throw new GenerationLimitError();
  if (m.includes("ai_failure_budget_exhausted")) throw new FailureBudgetError();
  if (m.includes("entitlement_exhausted")) throw new EntitlementError("exhausted");
  if (m.includes("entitlement_unavailable")) throw new EntitlementError("unavailable");
  if (m.includes("invalid_transition")) {
    const detail = /(\w+) -> (\w+)/.exec(m);
    throw new InvalidTransitionError(detail?.[1] ?? "?", detail?.[2] ?? "?");
  }
  if (m.includes("invalid_state")) throw new InvalidStateError(m);
  if (m.includes("not_found") || m.includes("material_not_found") || m.includes("adaptation_not_found")) throw new NotFoundError();
  throw new Error(`database: ${m.slice(0, 160)}`);
}

export class AdaptationStore {
  constructor(private readonly client: RpcClient) {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) fail(error);
    return data;
  }

  async createAdaptation(a: CreateAdaptationArgs): Promise<string> {
    const id = await this.call("create_adaptation", {
      p_workspace: a.workspaceId, p_material: a.materialId, p_user: a.userId, p_learner: a.learnerProfileId, p_type: a.adaptationType,
      p_title: a.title, p_request_key: a.requestKey, p_versions: a.versions, p_context: a.context, p_context_fp: a.contextFingerprint, p_analysis_fp: a.analysisFingerprint, p_reserve: a.reserve === true,
    });
    return z.uuid().parse(id);
  }

  /** Compare-and-set. False = the adaptation was not in `from` (someone else moved it). Invalid transitions throw. */
  async transition(adaptationId: string, from: AdaptationStatus, to: AdaptationStatus, failureCode: string | null = null): Promise<boolean> {
    return (await this.call("transition_adaptation", { p_adaptation: adaptationId, p_from: from, p_to: to, p_failure_code: failureCode })) === true;
  }

  async getPipeline(adaptationId: string): Promise<PipelineSnapshot | null> {
    const data = await this.call("get_adaptation_pipeline", { p_adaptation: adaptationId });
    return data === null ? null : (PipelineSchema.parse(data) as PipelineSnapshot);
  }

  async enqueueStage(adaptationId: string, stage: StageName, inputFingerprint: string, maxAttempts: number): Promise<{ jobId: string; reused: boolean; status: string }> {
    const data = z.object({ job_id: z.uuid(), reused: z.boolean(), status: z.string() }).parse(await this.call("enqueue_adaptation_stage", { p_adaptation: adaptationId, p_stage: stage, p_input_fp: inputFingerprint, p_max_attempts: maxAttempts }));
    return { jobId: data.job_id, reused: data.reused, status: data.status };
  }

  async claimStage(jobId: string, leaseSeconds: number, acknowledgeAmbiguous: boolean): Promise<ClaimedStage | null> {
    const data = await this.call("claim_adaptation_stage", { p_job: jobId, p_lease_seconds: leaseSeconds, p_ack_ambiguous: acknowledgeAmbiguous });
    return data === null ? null : ClaimSchema.parse(data);
  }

  async markProviderCall(jobId: string, attempt: number): Promise<boolean> {
    return (await this.call("mark_provider_call", { p_job: jobId, p_attempt: attempt })) === true;
  }
  async clearProviderCall(jobId: string, attempt: number): Promise<boolean> {
    return (await this.call("clear_provider_call", { p_job: jobId, p_attempt: attempt })) === true;
  }
  async setStep(jobId: string, attempt: number, step: string, progress: number): Promise<void> {
    await this.call("set_adaptation_job_step", { p_job: jobId, p_attempt: attempt, p_step: step, p_progress: progress });
  }
  async completeStage(jobId: string, attempt: number): Promise<boolean> {
    return (await this.call("complete_adaptation_stage", { p_job: jobId, p_attempt: attempt })) === true;
  }
  async failStage(jobId: string, attempt: number, code: string, retryable: boolean, backoffSeconds: number, adaptationStatus: AdaptationStatus = "failed"): Promise<"retry" | "failed" | "ignored"> {
    return z.enum(["retry", "failed", "ignored"]).parse(await this.call("fail_adaptation_stage", { p_job: jobId, p_attempt: attempt, p_code: code, p_retryable: retryable, p_backoff_seconds: backoffSeconds, p_adaptation_status: adaptationStatus }));
  }

  async putArtifact(adaptationId: string, lease: { jobId: string; attempt: number } | null, kind: ArtifactKind, inputFingerprint: string, fingerprint: string, payload: unknown): Promise<{ id: string; created: boolean }> {
    return z.object({ id: z.uuid(), created: z.boolean() }).parse(await this.call("put_adaptation_artifact", {
      p_adaptation: adaptationId, p_job: lease?.jobId ?? null, p_attempt: lease?.attempt ?? null, p_kind: kind, p_input_fp: inputFingerprint, p_fp: fingerprint, p_payload: payload,
    }));
  }
  async findArtifact(adaptationId: string, kind: ArtifactKind, match: { inputFingerprint?: string; fingerprint?: string }): Promise<ArtifactRow | null> {
    const data = await this.call("find_adaptation_artifact", { p_adaptation: adaptationId, p_kind: kind, p_input_fp: match.inputFingerprint ?? null, p_fp: match.fingerprint ?? null });
    return data === null ? null : ArtifactSchema.parse(data);
  }
  async listArtifacts(adaptationId: string, kind: ArtifactKind | null): Promise<ArtifactRow[]> {
    return z.array(ArtifactSchema).parse(await this.call("list_adaptation_artifacts", { p_adaptation: adaptationId, p_kind: kind }));
  }

  async persistVersion(adaptationId: string, lease: { jobId: string; attempt: number } | null, document: unknown, fps: { plan: string; review: string; generation: string }): Promise<{ id: string; version: number; created: boolean }> {
    return z.object({ id: z.uuid(), version: z.number().int(), created: z.boolean() }).parse(await this.call("persist_adaptation_version", {
      p_adaptation: adaptationId, p_job: lease?.jobId ?? null, p_attempt: lease?.attempt ?? null, p_document: document, p_plan_fp: fps.plan, p_review_fp: fps.review, p_generation_fp: fps.generation,
    }));
  }
  async finalize(adaptationId: string, lease: { jobId: string; attempt: number } | null, versionId: string, review: unknown, outcome: "ready" | "blocked"): Promise<{ duplicate: boolean; status: string }> {
    const data = z.object({ finalized: z.boolean(), duplicate: z.boolean(), status: z.string() }).parse(await this.call("finalize_adaptation", {
      p_adaptation: adaptationId, p_job: lease?.jobId ?? null, p_attempt: lease?.attempt ?? null, p_version: versionId, p_review: review, p_outcome: outcome,
    }));
    return { duplicate: data.duplicate, status: data.status };
  }

  // --- entitlements (docs/BILLING.md § Adaptaciones) --------------------------------------------------------------------
  async reserveEntitlement(adaptationId: string, userId: string | null): Promise<{ allowed: boolean; reason?: string; state?: string; duplicate?: boolean }> {
    return z.object({ allowed: z.boolean(), reason: z.string().optional(), state: z.string().optional(), duplicate: z.boolean().optional() }).parse(await this.call("reserve_adaptation_entitlement", { p_adaptation: adaptationId, p_user: userId }));
  }
  async consumeEntitlement(adaptationId: string): Promise<{ consumed: boolean; reason?: string; duplicate?: boolean }> {
    return z.object({ consumed: z.boolean(), reason: z.string().optional(), duplicate: z.boolean().optional() }).parse(await this.call("consume_adaptation_entitlement", { p_adaptation: adaptationId }));
  }
  async releaseEntitlement(adaptationId: string, reason: string): Promise<{ released: boolean; reason?: string; duplicate?: boolean }> {
    return z.object({ released: z.boolean(), reason: z.string().optional(), duplicate: z.boolean().optional() }).parse(await this.call("release_adaptation_entitlement", { p_adaptation: adaptationId, p_reason: reason }));
  }
  async getEntitlement(adaptationId: string): Promise<EntitlementRecord | null> {
    const data = await this.call("get_adaptation_entitlement", { p_adaptation: adaptationId });
    return data === null ? null : EntitlementRecordSchema.parse(data);
  }
  async entitlementUsage(workspaceId: string): Promise<EntitlementUsage> {
    return EntitlementUsageSchema.parse(await this.call("adaptation_entitlement_usage", { p_workspace: workspaceId }));
  }

  // --- runtime: what a worker can claim ----------------------------------------------------------------------------------
  async listClaimableJobs(limit: number): Promise<Array<{ jobId: string; adaptationId: string; stage: StageName }>> {
    const rows = z.array(z.object({ job_id: z.uuid(), adaptation_id: z.uuid(), stage: z.enum(["planning", "generation"]) })).parse(await this.call("list_claimable_adaptation_jobs", { p_limit: limit }));
    return rows.map((r) => ({ jobId: r.job_id, adaptationId: r.adaptation_id, stage: r.stage }));
  }

  async recordAiRun(row: AiRunRow): Promise<boolean> {
    return (await this.call("record_ai_run", { p_row: row })) === true;
  }
  async listAiRuns(scope: { adaptationId?: string; materialId?: string }): Promise<Array<Record<string, unknown>>> {
    const data = await this.call("list_ai_runs", { p_adaptation: scope.adaptationId ?? null, p_material: scope.materialId ?? null, p_purpose: scope.materialId && !scope.adaptationId ? "analyze" : null });
    return z.array(z.record(z.string(), z.unknown())).parse(data);
  }
}
