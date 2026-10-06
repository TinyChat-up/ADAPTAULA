import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_ADAPTATION_PROMPT_VERSIONS } from "@/lib/ai/prompts";
import { AIError } from "@/lib/ai/errors";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { createAdaptation, reopenPlanReview, runGenerationStage, runPlanningStage, submitPlanReview, cancelAdaptation, type OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import { buildStatusDto } from "@/lib/adaptation/orchestration/status";
import { getAdaptationCost } from "@/lib/adaptation/orchestration/cost";
import { AdaptationStore } from "@/lib/adaptation/orchestration/store";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { allPreserved } from "../unit/adaptation-helpers";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, expireLeases, newSpy, recordingEntitlements, scriptedServices, seedMaterial, versions, type Scripted, type Spy, type User } from "./orchestration-harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

let n = 0;
const frac = fractionsAnalysis();

interface World {
  user: User;
  id: string;
  d: ReturnType<typeof makeDeps>;
  spy: Spy;
  analysis: MaterialAnalysis;
  entitlements: ReturnType<typeof recordingEntitlements>;
}

async function world(script: Scripted = {}, analysis: MaterialAnalysis = frac, extra: Partial<OrchestratorDeps> = {}): Promise<World> {
  const user = await createUser(db, `orq-${++n}@example.com`);
  const material = await seedMaterial(db, user, analysis);
  const spy = newSpy();
  const entitlements = recordingEntitlements();
  const d = makeDeps(db, scriptedServices(spy, script), { entitlements, ...extra });
  const { adaptationId } = await createAdaptation(d, { workspaceId: user.workspaceId, userId: user.id, materialId: material, storedAnalysis: analysis, learnerProfileId: null, profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, adaptationType: "accessibility", title: "Prueba", requestKey: `orq-key-${n}-${Math.random().toString(36).slice(2)}`, versions: versions() });
  return { user, id: adaptationId, d, spy, analysis, entitlements };
}

const status = (id: string) => db.query<{ status: string }>("select status from public.adaptations where id = $1", [id]).then((r) => r.rows[0]!.status);
const count = (sql: string, params: unknown[]) => db.query<{ c: string }>(`select count(*)::text as c from ${sql}`, params).then((r) => Number(r.rows[0]!.c));

type Decision = Record<string, unknown>;
const planOf = (decisions: Decision[]) => ({ decisions, summary: [] });
const planner = (draft: unknown): Scripted["planner"] => async () => ({ draft, runs: [] });

/** A review that approves/rejects by decision id, bound to the CURRENT raw plan. */
async function reviewOf(w: World, verdicts: Record<string, "approved" | "rejected">, extra: Record<string, unknown> = {}) {
  const plans = await w.d.store.listArtifacts(w.id, "plan");
  const plan = plans.at(-1)!;
  const decisions = (plan.payload as { decisions: Array<{ id: string }> }).decisions;
  return {
    schema_version: 1,
    plan_fingerprint: plan.fingerprint,
    reviewer: { kind: "teacher" },
    reviewed_at: "2026-10-05T10:00:00Z",
    entries: decisions.map((x) => ({ decision_id: x.id, action: verdicts[x.id] ?? "rejected", reason: "prueba" })),
    ...extra,
  };
}
const approveAll = async (w: World) => reviewOf(w, Object.fromEntries(((await w.d.store.listArtifacts(w.id, "plan")).at(-1)!.payload as { decisions: Array<{ id: string }> }).decisions.map((x) => [x.id, "approved" as const])));

const passAll = (input: { reviewContext?: { review_scope: { required_targets: { answers_not_leaked?: string[] } } } }): AiReviewDraft => ({
  checks: [
    ...((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0 ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "Sin fuga" }] : []),
    { check: "age_appropriate", status: "PASS", targets: [], detail: "Adecuado" },
    { check: "no_infantilization", status: "PASS", targets: [], detail: "Sobrio" },
    { check: "functional_supports_applied", status: "PASS", targets: [], detail: "Útil" },
  ],
});
const reviewerPass: Scripted["reviewer"] = async (_inner, _call, input) => ({ draft: passAll(input), runs: [] });

async function toGeneration(w: World, verdicts?: Record<string, "approved" | "rejected">) {
  expect((await runPlanningStage(w.d, w.id)).outcome).toBe("completed");
  const review = verdicts ? await reviewOf(w, verdicts) : await approveAll(w);
  const submitted = await submitPlanReview(w.d, w.id, review);
  if (!submitted.ok) throw new Error(`review rejected: ${submitted.code}`);
  return submitted;
}

describe("la pausa humana: nunca hay generación antes de la revisión del docente", () => {
  it("el planificador termina en awaiting_plan_review y no se continúa solo; generar antes de revisar se rechaza sin llamar al proveedor", async () => {
    const w = await world();
    const planned = await runPlanningStage(w.d, w.id);
    expect(planned).toMatchObject({ outcome: "completed", status: "awaiting_plan_review" });
    expect(await status(w.id)).toBe("awaiting_plan_review");
    expect(w.spy).toMatchObject({ planner: 1, generator: 0, reviewer: 0 });
    const early = await runGenerationStage(w.d, w.id, "a".repeat(64));
    expect(early).toMatchObject({ outcome: "rejected", code: "plan_review_required" });
    expect(w.spy.generator).toBe(0);
    await expect(w.d.store.enqueueStage(w.id, "generation", "b".repeat(64), 3)).rejects.toThrow();
    expect(await count("public.adaptation_versions where adaptation_id = $1", [w.id])).toBe(0);
  });

  it("camino feliz: planificar → revisar → generar → revisión determinista → revisor → ready, con todo persistido", async () => {
    const w = await world({ reviewer: reviewerPass });
    const submitted = await toGeneration(w);
    expect(submitted).toMatchObject({ ok: true, executable: true });
    expect(await status(w.id)).toBe("generation_queued");
    const done = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(done).toMatchObject({ outcome: "completed", status: "ready", delivered: true, version: 1 });
    const row = (await db.query<{ status: string; current_version: number; delivered_at: string | null }>("select status, current_version, delivered_at from public.adaptations where id = $1", [w.id])).rows[0]!;
    expect(row).toMatchObject({ status: "ready", current_version: 1 });
    expect(row.delivered_at).not.toBeNull();
    const kinds = (await w.d.store.listArtifacts(w.id, null)).map((a) => a.kind);
    expect(new Set(kinds)).toEqual(new Set(["planner_draft", "plan", "plan_validation", "plan_review", "execution_report", "generation", "deterministic_review", "reviewer_findings", "pedagogical_review"]));
    const version = (await db.query<{ review: { verdict: string }; plan_fingerprint: string; plan_review_fingerprint: string; generation_fingerprint: string }>("select review, plan_fingerprint, plan_review_fingerprint, generation_fingerprint from public.adaptation_versions where adaptation_id = $1", [w.id])).rows[0]!;
    expect(["approved", "approved_with_warnings"]).toContain(version.review.verdict);
    expect(version.plan_review_fingerprint).toBe(submitted.reviewFingerprint);
    expect(w.entitlements.events).toEqual([`reserve:${w.id}`, `consume:${w.id}`]);
  });

  it("approved_with_warnings es utilizable y sus avisos se persisten sin filtrar para la interfaz", async () => {
    const w = await world();
    const submitted = await toGeneration(w);
    const done = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(done).toMatchObject({ status: "ready", delivered: true, verdict: "approved_with_warnings" });
    const snapshot = (await w.d.store.getPipeline(w.id))!;
    const dto = buildStatusDto(snapshot, { review: (await w.d.store.listArtifacts(w.id, "pedagogical_review")).at(-1)!.payload.review as never });
    expect(dto).toMatchObject({ phase: "ready", delivered: true, currentVersion: 1 });
    expect(dto.review?.warnings.length).toBeGreaterThan(0);
    expect(dto.review?.warnings.some((x) => x.check === "answers_not_leaked")).toBe(true);
  });
});

describe("PlanReview como puerta", () => {
  const blockedPlan = (analysis: MaterialAnalysis) =>
    planOf([{ target: "act_3", action: "add_support", strategies: ["worked_example"], need_refs: ["need_1"], intensity: "light", preserves: allPreserved(analysis, "act_3"), supports: [{ kind: "worked_example", uses_task_data: true }] }]);

  it("una decisión bloqueada no se puede aprobar (no se persiste la revisión); rechazada, el plan avanza sin llamar al generador", async () => {
    const w = await world({ planner: planner(blockedPlan(frac)), reviewer: reviewerPass });
    await runPlanningStage(w.d, w.id);
    const validation = (await w.d.store.listArtifacts(w.id, "plan_validation")).at(-1)!.payload as { classification: { counts: { blocked: number } } };
    expect(validation.classification.counts.blocked).toBe(1);
    const approving = await submitPlanReview(w.d, w.id, await reviewOf(w, { dec_1: "approved" }));
    expect(approving).toMatchObject({ ok: false, code: "invalid_review" });
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [w.id])).toBe(0);
    expect(await status(w.id)).toBe("awaiting_plan_review");
    const rejecting = await submitPlanReview(w.d, w.id, await reviewOf(w, { dec_1: "rejected" }));
    expect(rejecting).toMatchObject({ ok: true, executable: true });
    const done = await runGenerationStage(w.d, w.id, (rejecting as { reviewFingerprint: string }).reviewFingerprint);
    expect(done.status).toBe("ready");
    expect(w.spy.generator).toBe(0);
  });

  it("una edición que sigue bloqueada se rechaza, y una revisión de otro plan se rechaza como obsoleta", async () => {
    const w = await world({ planner: planner(blockedPlan(frac)) });
    await runPlanningStage(w.d, w.id);
    const base = await reviewOf(w, { dec_1: "approved" });
    const edited = { ...base, entries: [{ decision_id: "dec_1", action: "edited", reason: "x", edits: { intensity: "moderate" } }] };
    expect(await submitPlanReview(w.d, w.id, edited)).toMatchObject({ ok: false, code: "invalid_review" });
    const stale = { ...(await reviewOf(w, { dec_1: "rejected" })), plan_fingerprint: "f".repeat(64) };
    expect(await submitPlanReview(w.d, w.id, stale)).toMatchObject({ ok: false, code: "stale_review" });
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [w.id])).toBe(0);
  });

  it("una decisión sin ejecutor (unsupported) impide cualquier llamada: nada se encola y se exige otra revisión", async () => {
    const unsupported = planOf([{ target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], need_refs: ["need_1"], intensity: "light", preserves: allPreserved(frac, "act_1") }]);
    const w = await world({ planner: planner(unsupported) });
    await runPlanningStage(w.d, w.id);
    const submitted = await submitPlanReview(w.d, w.id, await reviewOf(w, { dec_1: "approved" }));
    expect(submitted).toMatchObject({ ok: true, executable: false });
    expect(await status(w.id)).toBe("awaiting_plan_review");
    const blocked = await runGenerationStage(w.d, w.id, (submitted as { reviewFingerprint: string }).reviewFingerprint);
    expect(blocked.outcome).toBe("rejected");
    expect(w.spy).toMatchObject({ generator: 0, reviewer: 0 });
    expect(await count("public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [w.id])).toBe(0);
  });

  it("al generador solo llegan las decisiones ai_generation: ni las rechazadas ni las diferidas", async () => {
    const plan = planOf([
      { target: "document", action: "add_support", strategies: ["planning_support"], need_refs: ["need_4"], intensity: "moderate", supports: [{ kind: "checklist", uses_task_data: false }] },
      { target: "act_2", action: "segment", strategies: ["task_sequencing"], need_refs: ["need_1"], intensity: "light", preserves: allPreserved(frac, "act_2") },
      { target: "act_5", action: "add_support", strategies: ["planning_support"], need_refs: ["need_2"], intensity: "light", preserves: allPreserved(frac, "act_5"), supports: [{ kind: "checklist", uses_task_data: false }] },
    ]);
    const w = await world({ planner: planner(plan), reviewer: reviewerPass });
    const submitted = await toGeneration(w, { dec_1: "approved", dec_2: "approved", dec_3: "rejected" });
    expect((submitted.execution.deferred).map((x) => x.id)).toEqual(["dec_2"]);
    const done = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(done.status).toBe("ready");
    expect(w.spy.generatorInputs).toEqual([{ decisions: ["dec_1"] }]);
    const traces = (await db.query<{ document: { pages: Array<{ blocks: Array<{ trace: { decision_ids: string[] } }> }> } }>("select document from public.adaptation_versions where adaptation_id = $1", [w.id])).rows[0]!.document.pages.flatMap((p) => p.blocks.flatMap((b) => b.trace.decision_ids));
    expect(traces).not.toContain("dec_2");
    expect(traces).not.toContain("dec_3");
    const dto = buildStatusDto((await w.d.store.getPipeline(w.id))!, { execution: (await w.d.store.listArtifacts(w.id, "execution_report")).at(-1)!.payload.execution as never });
    expect(dto.execution?.deferredDecisions).toEqual(["dec_2"]);
  });

  it("una revisión ligada a otro plan no puede continuar a generación, y vuelve a la revisión", async () => {
    const w = await world();
    const submitted = await toGeneration(w);
    // Somebody stores a review that belongs to a different plan under this adaptation.
    const foreign = { ...(await reviewOf(w, {})), plan_fingerprint: "e".repeat(64) };
    const foreignFp = fingerprint(foreign);
    await w.d.store.putArtifact(w.id, null, "plan_review", "e".repeat(64), foreignFp, foreign);
    const out = await runGenerationStage(w.d, w.id, foreignFp);
    expect(out).toMatchObject({ outcome: "human_action_required", code: "stale_review", status: "awaiting_plan_review" });
    expect(w.spy.generator).toBe(0);
    expect(submitted.ok).toBe(true);
  });
});

describe("idempotencia y concurrencia", () => {
  it("repetir planificación o generación reutiliza lo persistido: ni otro plan, ni otra versión, ni otra llamada", async () => {
    const w = await world({ reviewer: reviewerPass });
    const submitted = await toGeneration(w);
    expect((await runPlanningStage(w.d, w.id)).outcome).toBe("reused");
    expect(w.spy.planner).toBe(1);
    const first = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    const calls = { ...w.spy };
    const again = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(again.outcome).toBe("reused");
    expect({ planner: w.spy.planner, generator: w.spy.generator, reviewer: w.spy.reviewer }).toEqual({ planner: calls.planner, generator: calls.generator, reviewer: calls.reviewer });
    expect(first.version).toBe(1);
    expect(await count("public.adaptation_versions where adaptation_id = $1", [w.id])).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [w.id])).toBe(2);
    expect(await count("public.ai_runs where adaptation_id = $1 and status = 'success'", [w.id])).toBe(3);
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan'", [w.id])).toBe(1);
  });

  it("dos procesadores sobre la misma etapa: solo uno llama al proveedor", async () => {
    const w2 = await world();
    const [a, b] = await Promise.all([runPlanningStage(w2.d, w2.id), runPlanningStage(w2.d, w2.id)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["completed", "skipped"].sort());
    expect(w2.spy.planner).toBe(1);
    expect(await count("public.adaptation_jobs where adaptation_id = $1", [w2.id])).toBe(1);
  });

  it("un lease caducado se recupera: el job lo toma otro procesador y termina", async () => {
    const w = await world();
    const q = await w.d.store.enqueueStage(w.id, "planning", fingerprint({}), 3);
    expect(await w.d.store.claimStage(q.jobId, 300, false)).not.toBeNull();
    expect((await runPlanningStage(w.d, w.id)).outcome).toBe("skipped");
    await expireLeases(db);
    expect((await runPlanningStage(w.d, w.id)).outcome).toBe("completed");
    expect(w.spy.planner).toBe(1);
  });

  it("si el proceso muere tras la respuesta del proveedor, el intento es ambiguo: no se repite a ciegas, y reconocerlo lo permite", async () => {
    const w = await world();
    let dead = false;
    const guarded = new Proxy(w.d.store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (dead) throw new Error("process died");
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as AdaptationStore;
    const inner = scriptedServices(w.spy, {
      planner: async (p) => {
        const out = await p.plan({ context: (await w.d.store.getPipeline(w.id))!.adaptation.context_snapshot as never, material: undefined as never });
        dead = true; // the provider answered; the process dies before persisting anything
        return out;
      },
    });
    await expect(runPlanningStage({ ...w.d, store: guarded, services: inner }, w.id)).rejects.toThrow("process died");
    expect(w.spy.planner).toBe(1);
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'planner_draft'", [w.id])).toBe(0);
    dead = false;
    await expireLeases(db);
    const blind = await runPlanningStage(w.d, w.id);
    expect(blind).toMatchObject({ outcome: "human_action_required", code: "ambiguous_attempt", status: "failed" });
    expect(w.spy.planner).toBe(1);
    const run = (await db.query<{ error_code: string; estimated_cost_usd: string | null }>("select error_code, estimated_cost_usd from public.ai_runs where adaptation_id = $1", [w.id])).rows;
    expect(run).toEqual([{ error_code: "ambiguous_attempt", estimated_cost_usd: null }]);
    const dto = buildStatusDto((await w.d.store.getPipeline(w.id))!);
    expect(dto).toMatchObject({ phase: "action_required", error: { code: "ambiguous_attempt", category: "human_action_required" }, canRetry: true, nextAction: "retry", ambiguousAttempt: true });
    const acknowledged = await runPlanningStage(w.d, w.id, { acknowledgeAmbiguous: true });
    expect(acknowledged.outcome).toBe("completed");
    expect(w.spy.planner).toBe(2);
  });
});

describe("fallos, reintentos y entrega", () => {
  it("un generador inválido no entrega ninguna versión, la cuota se libera y el fallo es no reintentable", async () => {
    const w = await world({ generator: async () => { throw new AIError("invalid_output", "schema"); } });
    const submitted = await toGeneration(w);
    const out = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(out).toMatchObject({ outcome: "failed", code: "generator_schema", status: "failed" });
    expect(await count("public.adaptation_versions where adaptation_id = $1", [w.id])).toBe(0);
    expect(await count("public.adaptations where id = $1 and delivered_at is not null", [w.id])).toBe(0);
    expect(w.spy.reviewer).toBe(0);
    expect(w.entitlements.events.filter((e) => e.startsWith("release"))).toEqual([]); // a failure keeps the reservation
    expect(buildStatusDto((await w.d.store.getPipeline(w.id))!)).toMatchObject({ phase: "action_required", delivered: false });
  });

  it("un error transitorio del proveedor se reintenta dentro del presupuesto de intentos y entonces completa", async () => {
    const flaky = await world({ reviewer: reviewerPass, generator: async (inner, call, input) => { if (call === 1) throw new AIError("provider_unavailable", "503"); return inner.generate(input); } });
    const submitted = await toGeneration(flaky);
    const first = await runGenerationStage(flaky.d, flaky.id, submitted.reviewFingerprint);
    expect(first).toMatchObject({ outcome: "retry", code: "provider_transient" });
    expect(await status(flaky.id)).toBe("generating");
    expect(await count("public.ai_runs where adaptation_id = $1 and status = 'error'", [flaky.id])).toBe(1);
    const second = await runGenerationStage(flaky.d, flaky.id, submitted.reviewFingerprint);
    expect(second.outcome).toBe("completed");
    expect(flaky.spy.generator).toBe(2);
  });

  it("un rechazo del proveedor no se reintenta", async () => {
    const w = await world({ generator: async () => { throw new AIError("refusal", "no"); } });
    const submitted = await toGeneration(w);
    const out = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(out).toMatchObject({ outcome: "failed", code: "provider_refusal" });
    expect(w.spy.generator).toBe(1);
  });

  it("el revisor con un FAIL deja la adaptación en blocked: la versión se conserva pero no hay entrega", async () => {
    const w = await world({
      reviewer: async (_i, _c, input) => {
        const draft = passAll(input);
        const required = input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? [];
        return { draft: { checks: [{ check: "answers_not_leaked", status: "FAIL", targets: required.length > 0 ? required : [], detail: "Revela la respuesta" }, ...draft.checks.filter((c) => c.check !== "answers_not_leaked")] }, runs: [] };
      },
    });
    const submitted = await toGeneration(w);
    const out = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(out).toMatchObject({ status: "blocked", delivered: false, verdict: "blocked" });
    const row = (await db.query<{ status: string; current_version: number; delivered_at: string | null }>("select status, current_version, delivered_at from public.adaptations where id = $1", [w.id])).rows[0]!;
    expect(row).toMatchObject({ status: "blocked", current_version: 0, delivered_at: null });
    expect(await count("public.adaptation_versions where adaptation_id = $1", [w.id])).toBe(1);
    expect(w.entitlements.events.filter((e) => e.startsWith("release") || e.startsWith("consume"))).toEqual([]); // a block keeps the reservation and consumes nothing
    expect(buildStatusDto((await w.d.store.getPipeline(w.id))!)).toMatchObject({ phase: "blocked", delivered: false });
  });

  it("un FAIL determinista no se suaviza: bloquea sin llamar al revisor", async () => {
    const geo = geographyAnalysis();
    const plan = planOf([{ target: "act_1", action: "add_support", strategies: ["planning_support"], need_refs: ["need_1"], intensity: "light", preserves: allPreserved(geo, "act_1"), supports: [{ kind: "reminder", uses_task_data: false }] }]);
    const w = await world(
      { planner: planner(plan), reviewer: reviewerPass, generator: async () => ({ draft: { segments: [{ decision_id: "dec_1", target: "act_1", supports: [{ kind: "reminder", text: "Recuerda que son 7.100 habitantes." }] }], skipped: [], blocked: [], change_summary: ["x"] }, runs: [] }) },
      geo,
    );
    const submitted = await toGeneration(w);
    const out = await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    expect(out).toMatchObject({ status: "blocked", code: "deterministic_review_failed", delivered: false });
    expect(w.spy.reviewer).toBe(0);
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'pedagogical_review'", [w.id])).toBe(0);
    const stored = (await db.query<{ review: { verdict: string; checks: Array<{ check: string; status: string }> } }>("select review from public.adaptation_versions where adaptation_id = $1", [w.id])).rows[0]!.review;
    expect(stored.verdict).toBe("blocked");
    expect(stored.checks.find((c) => c.check === "answers_not_leaked")?.status).toBe("FAIL");
  });

  it("una nueva versión no destruye la anterior: bloqueada → reabrir → nueva revisión → ready con la versión 1 intacta", async () => {
    let call = 0;
    const w = await world({
      reviewer: async (_i, _c, input) => {
        call += 1;
        const draft = passAll(input);
        if (call > 1) return { draft, runs: [] };
        return { draft: { checks: [{ check: "age_appropriate", status: "FAIL", targets: [], detail: "Tono inadecuado" }, ...draft.checks.filter((c) => c.check !== "age_appropriate")] }, runs: [] };
      },
    });
    const first = await toGeneration(w);
    expect((await runGenerationStage(w.d, w.id, first.reviewFingerprint)).status).toBe("blocked");
    expect(await reopenPlanReview(w.d, w.id)).toBe("awaiting_plan_review");
    expect((await runPlanningStage(w.d, w.id)).outcome).toBe("reused");
    const second = await submitPlanReview(w.d, w.id, await reviewOf(w, {}));
    expect(second).toMatchObject({ ok: true, executable: true });
    const done = await runGenerationStage(w.d, w.id, (second as { reviewFingerprint: string }).reviewFingerprint);
    expect(done).toMatchObject({ status: "ready", version: 2, delivered: true });
    const rows = (await db.query<{ version: number; review: { verdict: string } }>("select version, review from public.adaptation_versions where adaptation_id = $1 order by version", [w.id])).rows;
    expect(rows.map((r) => [r.version, r.review.verdict])).toEqual([[1, "needs_revision"], [2, rows[1]!.review.verdict]]);
    expect(await count("public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [w.id])).toBe(2);
  });
});

describe("versiones fijadas, ai_runs y coste", () => {
  it("las etapas usan las versiones PERSISTIDAS, no los valores por defecto actuales", async () => {
    expect(ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner).toBe(1);
    expect(ACTIVE_ADAPTATION_PROMPT_VERSIONS.material_generator).toBe(1);
    const w = await world({ reviewer: reviewerPass });
    const submitted = await toGeneration(w);
    await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    const persisted = (await db.query<{ pipeline_versions: unknown }>("select pipeline_versions from public.adaptations where id = $1", [w.id])).rows[0]!.pipeline_versions;
    expect(w.spy.seenVersions.length).toBeGreaterThanOrEqual(2);
    for (const seen of w.spy.seenVersions) expect(seen).toEqual(persisted);
    expect(w.spy.seenVersions[0]).toMatchObject({ planner: { prompt_version: 2 }, generator: { prompt_version: 2 }, reviewer: { prompt_version: 1 }, context_policy: 2 });
  });

  it("cada llamada queda en ai_runs con su etapa, versiones, huellas e intento; el coste se agrega por etapa y el análisis va aparte", async () => {
    const w = await world({ reviewer: reviewerPass });
    const submitted = await toGeneration(w);
    await runGenerationStage(w.d, w.id, submitted.reviewFingerprint);
    const material = (await db.query<{ material_id: string }>("select material_id from public.adaptations where id = $1", [w.id])).rows[0]!.material_id;
    await db.query("insert into public.ai_runs (workspace_id, material_id, purpose, model_alias, provider, model, status, estimated_cost_usd) values ($1, $2, 'analyze', 'STANDARD', 'anthropic', 'm', 'success', 0.05)", [w.user.workspaceId, material]);
    const runs = (await db.query<{ purpose: string; prompt_version: number; schema_version: number; call_kind: string; job_attempt: number; input_fingerprint: string; output_fingerprint: string; adaptation_id: string; material_id: string; job_id: string }>("select purpose, prompt_version, schema_version, call_kind, job_attempt, input_fingerprint, output_fingerprint, adaptation_id, material_id, job_id from public.ai_runs where adaptation_id = $1 order by created_at", [w.id])).rows;
    expect(runs.map((r) => [r.purpose, r.prompt_version, r.call_kind])).toEqual([["plan", 2, "initial"], ["generate", 2, "initial"], ["review", 1, "initial"]]);
    for (const r of runs) expect(r).toMatchObject({ adaptation_id: w.id, material_id: material, job_attempt: 1 });
    expect(runs.every((r) => /^[a-f0-9]{64}$/.test(r.input_fingerprint) && /^[a-f0-9]{64}$/.test(r.output_fingerprint) && r.job_id)).toBe(true);
    const cost = await getAdaptationCost(w.d.store, w.id, material);
    expect(cost.adaptationTotalUsd).toBeCloseTo(0.06, 6);
    expect([cost.planning.calls, cost.generation.calls, cost.review.calls]).toEqual([1, 1, 1]);
    expect(cost.sharedAnalysisUsd).toBeCloseTo(0.05, 6);
    expect(cost.incomplete).toBe(false);
  });

  it("cancelar libera la reserva, y una adaptación entregada no se cancela", async () => {
    const w = await world({ reviewer: reviewerPass });
    expect((await cancelAdaptation(w.d, w.id)).cancelled).toBe(true);
    expect(w.entitlements.events).toContain("release:cancelled");
    const done = await world({ reviewer: reviewerPass });
    const submitted = await toGeneration(done);
    await runGenerationStage(done.d, done.id, submitted.reviewFingerprint);
    expect(await cancelAdaptation(done.d, done.id)).toMatchObject({ cancelled: false, status: "ready" });
  });
});
