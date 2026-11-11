import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { RejectedStageOutput, rejectedRun, type PedagogicalReviewer } from "@/lib/adaptation/services";
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
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

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
  return { id, spy, status: status.data };
}
const reviewRuns = (id: string) => q<{ status: string; error_code: string | null }>("select status, error_code from public.ai_runs where adaptation_id = $1 and purpose = 'review' order by created_at", [id]);
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

  it("dos respuestas mal formadas seguidas: falla como antes con reviewer_schema, sin una tercera llamada y sin entregar", async () => {
    const t = await teacher(async (inner, _call, input) => malformed(inner)(input));
    expect(t.spy.reviewer).toBe(2);
    expect(t.status).toMatchObject({ status: "failed", delivered: false });
    expect((await q<{ failure_code: string }>("select failure_code from public.adaptations where id = $1", [t.id]))[0]!.failure_code).toBe("reviewer_schema");
    expect((await reviewRuns(t.id)).map((r) => r.status)).toEqual(["invalid_output", "invalid_output"]);
    expect((await rejections(t.id)).map((r) => r.payload.reviewer_rejected.ask)).toEqual([1, 2]);
    // The unit is given back: a generation that delivered nothing consumes nothing.
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [t.id]))[0]!.state).not.toBe("consumed");
  });

  it("una respuesta que no es JSON también se vuelve a pedir una vez", async () => {
    const t = await teacher(async (inner, call, input) => (call === 1 ? malformed(inner, "not_json")(input) : inner.review(input)));
    expect(t.spy.reviewer).toBe(2);
    expect(t.status).toMatchObject({ status: "ready", delivered: true });
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
