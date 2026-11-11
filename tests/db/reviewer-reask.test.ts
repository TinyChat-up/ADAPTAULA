import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { RejectedStageOutput, rejectedRun, type PedagogicalReviewer } from "@/lib/adaptation/services";
import { AIError } from "@/lib/ai/errors";
import { SpendRefused } from "@/lib/ai/spend";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";

/**
 * Production case (adaptation 8b7f5c69…, «Un estanque en equilibrio», 2026-11-11): the visual was reconstructed, the deterministic
 * review passed with warnings, and the AI review answered 842 tokens that did NOT match its strict JSON contract: `reviewer_schema`,
 * non-retryable, nothing delivered, and no record of WHY. The review now gets ONE new ask after a malformed answer, and the reason
 * (paths and rules, no content) is kept. A second malformed answer fails as before: two calls at most. 0 real model calls.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(async () => {
  await db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'");
  await db.query("delete from public.app_settings where key = 'ai.failure_budget'");
});

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const issue = { path: "findings.0.reason", code: "too_big", rule: "string ≤ 160" };
/** The model answered (and was paid) but the answer broke the contract, as the real reviewer reports it. */
const stageRecord = { purpose: "review", attempt: 1, alias: "STANDARD", provider: "mock", model: "m", effort: "medium", promptKey: "pedagogical_reviewer", promptVersion: 1, inputTokens: 4809, outputTokens: 842, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0.024, latencyMs: 5460, status: "success", errorCode: null, schemaKey: "pedagogical_review_findings", schemaVersion: 1, callKind: "initial", reasoningTokens: null } as never;
const malformed = (inner: PedagogicalReviewer, kind: "schema" | "not_json" = "schema") => async (input: Parameters<PedagogicalReviewer["review"]>[0]) => {
  const run = (await inner.review(input)).runs[0] ?? stageRecord;
  throw new RejectedStageOutput("invalid_output", `reviewer output rejected: ${kind}`, rejectedRun(run, "invalid_output"), { kind, issues: kind === "schema" ? [issue] : [], outputTokens: 842, maxOutputTokens: 2000 });
};

let n = 0;
async function teacher(reviewer: (inner: PedagogicalReviewer, call: number, input: Parameters<PedagogicalReviewer["review"]>[0]) => ReturnType<PedagogicalReviewer["review"]>) {
  const u = await createUser(db, `reask-${++n}@example.com`);
  const material = await seedMaterial(db, u, fractionsAnalysis());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { reviewer }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `reask-${n}-${Math.random()}`, creationMode: "automatic" });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  for (let i = 0; i < 12; i++) if (!(await processAdaptationStage(orchestrator, id))) break;
  const status = await getAdaptationStatus(deps, actor, id);
  if (!status.ok) throw new Error(status.code);
  return { id, spy, status: status.data, orchestrator, deps, actor };
}
const reviewRuns = (id: string) => q<{ status: string; error_code: string | null; call_kind: string; input_tokens: number; output_tokens: number; estimated_cost_usd: string | null }>("select status, error_code, call_kind, input_tokens, output_tokens, estimated_cost_usd from public.ai_runs where adaptation_id = $1 and purpose = 'review' order by created_at", [id]);
const rejections = (id: string) => q<{ payload: { reviewer_rejected: { ask: number; kind: string; issues: unknown[] } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' and payload ? 'reviewer_rejected' order by created_at", [id]);

describe("una revisión con el JSON mal formado se vuelve a pedir UNA vez, y el motivo queda registrado", () => {
  it("la primera respuesta rechazada y la segunda válida: la ficha se entrega; dos llamadas registradas y el motivo guardado", async () => {
    const t = await teacher(async (inner, call, input) => (call === 1 ? malformed(inner)(input) : inner.review(input)));
    expect(t.spy.reviewer).toBe(2);
    expect(t.status).toMatchObject({ status: "ready", delivered: true });
    expect((await reviewRuns(t.id)).map((r) => r.status)).toEqual(["invalid_output", "success"]);
    expect((await q<{ call_kind: string }>("select call_kind from public.ai_runs where adaptation_id = $1 and purpose = 'review' order by created_at", [t.id])).map((r) => r.call_kind)).toEqual(["initial", "repair"]);
    expect(await rejections(t.id)).toMatchObject([{ payload: { reviewer_rejected: { ask: 1, kind: "schema", issues: [issue] } } }]);
  });

  it("las dos llamadas quedan en ai_runs con sus tokens y su coste: lo pagado por la rechazada no se pierde", async () => {
    const t = await teacher(async (inner, call, input) => (call === 1 ? malformed(inner)(input) : inner.review(input)));
    const runs = await reviewRuns(t.id);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: "invalid_output", error_code: "reviewer_schema", call_kind: "initial", input_tokens: 4809, output_tokens: 842 });
    expect(Number(runs[0]!.estimated_cost_usd)).toBeCloseTo(0.024, 6);
    expect(runs[1]).toMatchObject({ status: "success", call_kind: "repair" });
    expect(Number(runs[1]!.estimated_cost_usd)).toBeGreaterThan(0);
    expect(runs[1]!.input_tokens + runs[1]!.output_tokens).toBeGreaterThan(0);
  });

  it("dos respuestas mal formadas seguidas: falla como antes con reviewer_schema, sin una tercera llamada y sin entregar", async () => {
    const t = await teacher(async (inner, _call, input) => malformed(inner)(input));
    expect(t.spy.reviewer).toBe(2);
    expect(t.status).toMatchObject({ status: "failed", delivered: false });
    expect((await q<{ failure_code: string }>("select failure_code from public.adaptations where id = $1", [t.id]))[0]!.failure_code).toBe("reviewer_schema");
    expect((await reviewRuns(t.id)).map((r) => r.status)).toEqual(["invalid_output", "invalid_output"]);
    expect((await rejections(t.id)).map((r) => r.payload.reviewer_rejected.ask)).toEqual([1, 2]);
    // Nothing is delivered: no delivery date, no current version, the sheet is not marked as valid.
    expect(await q("select delivered_at, current_version from public.adaptations where id = $1 and delivered_at is null and current_version = 0", [t.id])).toHaveLength(1);
    // The unit is given back: a generation that delivered nothing consumes nothing.
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [t.id]))[0]!.state).not.toBe("consumed");
  });

  it("una respuesta que no es JSON también se vuelve a pedir una vez", async () => {
    const t = await teacher(async (inner, call, input) => (call === 1 ? malformed(inner, "not_json")(input) : inner.review(input)));
    expect(t.spy.reviewer).toBe(2);
    expect(t.status).toMatchObject({ status: "ready", delivered: true });
  });

  it("el límite de fallos del espacio se respeta: con el presupuesto agotado tras el primer fallo no hay segunda llamada", async () => {
    await db.query("insert into public.app_settings (key, value) values ('ai.failure_budget', '{\"max_failed_paid_calls\": 1, \"window_hours\": 24}'::jsonb) on conflict (key) do update set value = excluded.value");
    const t = await teacher(async (inner, _call, input) => malformed(inner)(input));
    expect(t.spy.reviewer).toBe(1);
    expect(t.status).toMatchObject({ delivered: false });
    expect((await reviewRuns(t.id)).map((r) => r.status)).toEqual(["invalid_output"]);
  });

  it("el límite de gasto del piloto se respeta: si el libro rechaza la segunda petición, no se envía y no hay una tercera", async () => {
    // The re-ask goes through the same metered provider as any request: the ledger decides before it is sent.
    const t = await teacher(async (inner, call, input) => {
      if (call === 1) return malformed(inner)(input);
      throw new SpendRefused("budget_exhausted");
    });
    expect(t.spy.reviewer).toBe(2);
    expect(t.status).toMatchObject({ delivered: false });
    // The refused request sent nothing: its row carries no tokens and no cost (unknown is null, never a made-up figure).
    const runs = await reviewRuns(t.id);
    expect(runs[0]).toMatchObject({ status: "invalid_output", input_tokens: 4809 });
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ input_tokens: 0, output_tokens: 0, estimated_cost_usd: null });
  });

  it("una reanudación no repite el intento ya rechazado: rechazo, fallo transitorio y reanudación suman 3 llamadas como máximo, no 4", async () => {
    // Attempt 1: malformed (ask 1) → the second ask fails with a transient provider error → the stage is retried (attempt 2) and
    // must continue from the rejection already on record (ask 2), not start again from the first ask.
    const t = await teacher(async (inner, call, input) => {
      if (call === 1) return malformed(inner)(input);
      if (call === 2) throw new AIError("provider_unavailable", "temporalmente no disponible");
      if (call === 3) return malformed(inner)(input);
      return inner.review(input);
    });
    expect(t.spy.reviewer).toBe(3);
    expect(t.status).toMatchObject({ delivered: false });
    expect((await q<{ failure_code: string }>("select failure_code from public.adaptations where id = $1", [t.id]))[0]!.failure_code).toBe("reviewer_schema");
  });

  it("cada petición queda marcada como «en curso» antes de salir: si el proceso muriera a mitad de la segunda, sería un intento ambiguo (no se repite solo)", async () => {
    // The marker is what makes a crashed call ambiguous. The second ask must arm it again (the first one cleared it when it answered).
    const marked: boolean[] = [];
    const t = await teacher(async (inner, call, input) => {
      const [job] = await q<{ provider_call_started_at: string | null }>("select provider_call_started_at from public.adaptation_jobs where stage = 'generation' and status = 'processing' order by created_at desc limit 1");
      marked.push(job?.provider_call_started_at != null);
      return call === 1 ? malformed(inner)(input) : inner.review(input);
    });
    expect(marked).toEqual([true, true]);
    expect(t.status).toMatchObject({ status: "ready", delivered: true });
    // And once the stage completed, no marker is left behind.
    expect(await q("select 1 from public.adaptation_jobs where adaptation_id = $1 and provider_call_started_at is not null", [t.id])).toEqual([]);
  });

  it("una respuesta cortada por límite de tokens no se vuelve a pedir", async () => {
    const t = await teacher(async (inner, _call, input) => {
      const run = (await inner.review(input)).runs[0] ?? stageRecord;
      throw new RejectedStageOutput("truncated", "reviewer output rejected: truncated", rejectedRun(run, "truncated"), { kind: "truncated", issues: [], outputTokens: 2000, maxOutputTokens: 2000 });
    });
    expect(t.spy.reviewer).toBe(1);
    expect(t.status).toMatchObject({ delivered: false });
  });

  it("dos procesos a la vez no duplican la llamada: la reserva del trabajo deja pasar a uno solo", async () => {
    // Run the stages by hand: planning first, then several workers at once on the generation stage.
    const u = await createUser(db, `reask-conc-${++n}@example.com`);
    const material = await seedMaterial(db, u, fractionsAnalysis());
    const learner = await seedLearner(db, u);
    const spy = newSpy();
    const orchestrator = makeDeps(db, scriptedServices(spy, { reviewer: async (inner, call, input) => (call === 1 ? malformed(inner)(input) : inner.review(input)) }));
    orchestrator.entitlements = dbEntitlements(orchestrator.store);
    const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
    const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
    const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `reask-conc-${Math.random()}`, creationMode: "automatic" });
    if (!created.ok) throw new Error(created.code);
    for (let i = 0; i < 6; i++) await Promise.all([processAdaptationStage(orchestrator, created.data.adaptationId), processAdaptationStage(orchestrator, created.data.adaptationId), processAdaptationStage(orchestrator, created.data.adaptationId)]);
    // One malformed answer and one valid: exactly two review calls, never a third from a second worker.
    expect(spy.reviewer).toBe(2);
    expect((await reviewRuns(created.data.adaptationId)).map((r) => r.status)).toEqual(["invalid_output", "success"]);
  });

  it("un rechazo del proveedor (rechazo expreso) NO se vuelve a pedir", async () => {
    const t = await teacher(async (inner, _call, input) => {
      const run = (await inner.review(input)).runs[0] ?? stageRecord;
      throw new RejectedStageOutput("refusal", "reviewer output rejected: refused", rejectedRun(run, "refusal"), { kind: "refused", issues: [], outputTokens: 0, maxOutputTokens: 2000 });
    });
    expect(t.spy.reviewer).toBe(1);
    expect(t.status).toMatchObject({ delivered: false });
  });
});
