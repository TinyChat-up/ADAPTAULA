import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { ADAPTATION_ERROR_CODES, FAILURE_KIND, AdaptationError, classifyAIFailure } from "@/lib/adaptation/orchestration/errors";
import { AIError } from "@/lib/ai/errors";
import { processAdaptationJobs } from "@/lib/adaptation/orchestration/worker";
import { cancelAdaptationCommand, createAdaptationCommand, getAdaptationStatus, getAdaptationVersion, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type AdaptationReader, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, scriptedServices, seedLearner, seedMaterial, versions, type User } from "./orchestration-harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

/** The reader is the USER's view of the database: every query runs as `authenticated` under RLS. */
function readerFor(user: User): AdaptationReader {
  const q = <T>(sql: string, params: unknown[]) => as(db, "authenticated", user.id, () => db.query<T>(sql, params)).then((r) => r.rows);
  return {
    getMaterial: async (id) => (await q<never>("select id, workspace_id, title, status, analysis, stage_slug, grade_slug, subject_slug from public.materials where id = $1", [id]))[0] ?? null,
    getLearnerProfile: async (id) => (await q<never>("select id, workspace_id, stage_slug, grade_slug, functional_profile from public.learner_profiles where id = $1", [id]))[0] ?? null,
    getAdaptation: async (id) => (await q<never>("select id, workspace_id, material_id, status, current_version, delivered_at from public.adaptations where id = $1", [id]))[0] ?? null,
    getVersion: async (id, version) => (await q<never>(`select id, version, document, review, source, created_at::text from public.adaptation_versions where adaptation_id = $1 ${version === null ? "order by version desc" : "and version = $2"} limit 1`, version === null ? [id] : [id, version]))[0] ?? null,
    getArtifacts: async (id, kinds) => q<never>("select id, kind, input_fingerprint, fingerprint, payload, created_at::text from public.adaptation_artifacts where adaptation_id = $1 and kind = any($2::text[]) order by created_at", [id, kinds as unknown as string[]]),
  };
}

const actorOf = (u: User, canWrite = true): Actor => ({ userId: u.id, workspaceId: u.workspaceId, canWrite });
function serviceDeps(user: User): ServiceDeps {
  const spy = newSpy();
  return { orchestrator: makeDeps(db, scriptedServices(spy)), reader: readerFor(user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
}

async function teacherWithMaterial(email: string) {
  const user = await createUser(db, email);
  const material = await seedMaterial(db, user, fractionsAnalysis());
  const learner = await seedLearner(db, user, "Lucía Docente-Test");
  return { user, material, learner, deps: serviceDeps(user) };
}

describe("capa de aplicación: autorización y 404", () => {
  it("crear y planificar: el docente crea desde su material; el perfil se minimiza y nunca va al contexto con nombre", async () => {
    const t = await teacherWithMaterial("svc-1@example.com");
    const created = await createAdaptationCommand(t.deps, actorOf(t.user), { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: "svc-key-0001" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = (await db.query<{ context_snapshot: unknown; profile_snapshot: unknown }>("select context_snapshot, profile_snapshot from public.adaptations where id = $1", [created.data.adaptationId])).rows[0]!;
    expect(JSON.stringify(row)).not.toMatch(/Lucía|display_name|contextual_tags|notes/i);
    const again = await createAdaptationCommand(t.deps, actorOf(t.user), { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: "svc-key-0001" });
    expect(again).toEqual(created);
    const planned = await startPlanning(t.deps, actorOf(t.user), created.data.adaptationId);
    expect(planned).toMatchObject({ ok: true, data: { status: "queued", alreadyQueued: false } });
    await processAdaptationJobs(t.deps.orchestrator, { limit: 5 });
    expect(await getAdaptationStatus(t.deps, actorOf(t.user), created.data.adaptationId)).toMatchObject({ ok: true, data: { status: "awaiting_plan_review" } });
  });

  it("otro workspace: material, perfil, adaptación y versión son 404 (no existen para él)", async () => {
    const a = await teacherWithMaterial("svc-a@example.com");
    const b = await teacherWithMaterial("svc-b@example.com");
    const created = await createAdaptationCommand(a.deps, actorOf(a.user), { materialId: a.material, learnerProfileId: null, adaptationType: "accessibility" });
    if (!created.ok) throw new Error("setup");
    const id = created.data.adaptationId;
    expect(await createAdaptationCommand(b.deps, actorOf(b.user), { materialId: a.material, learnerProfileId: null, adaptationType: "accessibility" })).toEqual({ ok: false, code: "not_found" });
    expect(await createAdaptationCommand(b.deps, actorOf(b.user), { materialId: b.material, learnerProfileId: a.learner, adaptationType: "accessibility" })).toEqual({ ok: false, code: "not_found" });
    for (const call of [
      () => startPlanning(b.deps, actorOf(b.user), id),
      () => submitPlanReviewCommand(b.deps, actorOf(b.user), id, {}),
      () => startGeneration(b.deps, actorOf(b.user), id),
      () => getAdaptationStatus(b.deps, actorOf(b.user), id),
      () => getAdaptationVersion(b.deps, actorOf(b.user), id),
      () => cancelAdaptationCommand(b.deps, actorOf(b.user), id),
    ]) {
      expect(await call()).toEqual({ ok: false, code: "not_found" });
    }
    // An id from another workspace is not special even with a forged actor workspace: the reader (RLS) hides it first.
    expect(await getAdaptationStatus(b.deps, { ...actorOf(b.user), workspaceId: a.user.workspaceId }, id)).toEqual({ ok: false, code: "not_found" });
  });

  it("un viewer no puede escribir; leer el estado sí", async () => {
    const t = await teacherWithMaterial("svc-viewer@example.com");
    const created = await createAdaptationCommand(t.deps, actorOf(t.user), { materialId: t.material, learnerProfileId: null, adaptationType: "accessibility" });
    if (!created.ok) throw new Error("setup");
    const viewer = actorOf(t.user, false);
    expect(await createAdaptationCommand(t.deps, viewer, { materialId: t.material, learnerProfileId: null, adaptationType: "accessibility" })).toEqual({ ok: false, code: "forbidden" });
    expect(await startPlanning(t.deps, viewer, created.data.adaptationId)).toEqual({ ok: false, code: "forbidden" });
    expect(await submitPlanReviewCommand(t.deps, viewer, created.data.adaptationId, {})).toEqual({ ok: false, code: "forbidden" });
    expect(await getAdaptationStatus(t.deps, viewer, created.data.adaptationId)).toMatchObject({ ok: true, data: { status: "queued", phase: "working" } });
  });

  it("el cliente no puede saltarse la revisión ni suplantar al revisor: la identidad la pone el servidor", async () => {
    const t = await teacherWithMaterial("svc-gate@example.com");
    const created = await createAdaptationCommand(t.deps, actorOf(t.user), { materialId: t.material, learnerProfileId: null, adaptationType: "accessibility" });
    if (!created.ok) throw new Error("setup");
    const id = created.data.adaptationId;
    // Generation before planning/review is refused: the state machine says so.
    expect(await startGeneration(t.deps, actorOf(t.user), id)).toEqual({ ok: false, code: "review_required" });
    await startPlanning(t.deps, actorOf(t.user), id);
    await processAdaptationJobs(t.deps.orchestrator, { limit: 5 });
    const status = await getAdaptationStatus(t.deps, actorOf(t.user), id);
    expect(status).toMatchObject({ ok: true, data: { phase: "awaiting_review", status: "awaiting_plan_review", delivered: false } });
    const plan = (await db.query<{ fingerprint: string; payload: { decisions: Array<{ id: string }> } }>("select fingerprint, payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan'", [id])).rows[0]!;
    const forged = { schema_version: 1, plan_fingerprint: plan.fingerprint, reviewer: { kind: "auto", label: "sistema" }, reviewed_at: "1999-01-01T00:00:00Z", entries: plan.payload.decisions.map((d) => ({ decision_id: d.id, action: "approved", reason: "ok" })) };
    const submitted = await submitPlanReviewCommand(t.deps, actorOf(t.user), id, forged);
    expect(submitted).toMatchObject({ ok: true, data: { executable: true, blockers: [] } });
    const stored = (await db.query<{ payload: { reviewer: { kind: string }; reviewed_at: string } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id])).rows[0]!.payload;
    expect(stored.reviewer).toEqual({ kind: "teacher" });
    expect(stored.reviewed_at).toBe("2026-10-05T12:00:00.000Z");
  });

  it("el estado de una versión no entregada no se presenta como ficha final", async () => {
    const t = await teacherWithMaterial("svc-version@example.com");
    const created = await createAdaptationCommand(t.deps, actorOf(t.user), { materialId: t.material, learnerProfileId: null, adaptationType: "accessibility" });
    if (!created.ok) throw new Error("setup");
    expect(await getAdaptationVersion(t.deps, actorOf(t.user), created.data.adaptationId)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("taxonomía de fallos", () => {
  it("cada código tiene exactamente una clase de manejo y las clases cubren lo pedido", () => {
    for (const code of ADAPTATION_ERROR_CODES) expect(["retryable", "non_retryable", "human_action_required"]).toContain(FAILURE_KIND[code]);
    for (const required of ["invalid_input", "stale_analysis", "planner_schema", "planner_validation", "plan_review_required", "execution_unsupported", "generator_schema", "generator_validation", "deterministic_review_failed", "reviewer_schema", "reviewer_blocked", "provider_transient", "provider_refusal", "provider_credentials", "cancelled", "internal"]) {
      expect(ADAPTATION_ERROR_CODES).toContain(required);
    }
    expect(new AdaptationError("stale_review", "x").kind).toBe("human_action_required");
  });

  it("la política de reintento central se respeta: solo lo transitorio y lo inesperado se reintentan", () => {
    const of = (code: ConstructorParameters<typeof AIError>[0], stage: Parameters<typeof classifyAIFailure>[1] = "generation") => classifyAIFailure(new AIError(code, "x"), stage);
    expect(of("provider_unavailable")).toEqual({ code: "provider_transient", retryable: true });
    expect(of("rate_limited")).toEqual({ code: "provider_transient", retryable: true });
    expect(of("timeout")).toEqual({ code: "provider_transient", retryable: true });
    expect(of("refusal")).toEqual({ code: "provider_refusal", retryable: false });
    expect(of("auth")).toEqual({ code: "provider_credentials", retryable: false });
    expect(of("invalid_output", "planning")).toEqual({ code: "planner_schema", retryable: false });
    expect(of("invalid_output", "review")).toEqual({ code: "reviewer_schema", retryable: false });
    expect(of("truncated", "generation")).toEqual({ code: "generator_schema", retryable: false });
    expect(classifyAIFailure(new Error("boom"), "planning")).toEqual({ code: "internal", retryable: true });
  });
});
