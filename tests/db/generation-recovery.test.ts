import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { recoverFailedGeneration } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";
import { mathAnalysis, realDecisions, realDraft } from "../support/math-generation-case";

/**
 * Recovering the real failed adaptation after the fix (operator procedure, `pnpm jobs:recover`). The state it is in is rebuilt
 * exactly: the same plan and generator answer, failed under the PREVIOUS audit (simulated here: that audit rejected the discarded
 * rewrite). Then the recovery: a dry run that writes nothing, and `apply`, which queues the same input. 0 real model calls.
 */

const previousAudit = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/adaptation/generation-checks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adaptation/generation-checks")>();
  return {
    ...actual,
    auditGeneration: (input: Parameters<typeof actual.auditGeneration>[0]) => {
      const audit = actual.auditGeneration(input);
      if (!previousAudit.on) return audit;
      // The audit before this fix: a discarded rewrite counted as an unauthorised proposal, pinned on no decision it could drop.
      const failing = { name: "el generador no propuso nada fuera de lo autorizado", ok: false, detail: "rewrite_not_needed(dec_2)", decisions: [] };
      return { ...audit, ok: false, checks: [...audit.checks, failing] };
    },
  };
});

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const entitlement = async (id: string) => (await q<{ state: string; consumed_at: string | null }>("select state, consumed_at from public.adaptation_entitlements where adaptation_id = $1", [id]))[0];

const planner = async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const ref = (dim: string) => `need_${input.context.needs.findIndex((n) => n.dimension === dim) + 1}`;
  return { draft: { decisions: realDecisions().map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map(ref) })), summary: ["Plan"] }, runs: [] } as never;
};

describe("recovering the failed adaptation after the fix: same adaptation, same unit, no generator call", () => {
  it("dry run reads only; apply queues the same input; the next visit delivers it and consumes the unit reserved at creation", async () => {
    const u = await createUser(db, "recover-1@example.com");
    const material = await seedMaterial(db, u, mathAnalysis());
    const learner = await seedLearner(db, u);
    const spy = newSpy();
    const orchestrator = makeDeps(db, scriptedServices(spy, { planner, generator: async () => ({ draft: realDraft, runs: [] }) as never }));
    orchestrator.entitlements = dbEntitlements(orchestrator.store);
    const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
    const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
    const status = async (id: string) => {
      const r = await getAdaptationStatus(deps, actor, id);
      if (!r.ok) throw new Error(r.code);
      return r.data;
    };
    const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: "recover-key", creationMode: "automatic" });
    const id = created.ok ? created.data.adaptationId : "";

    // The production state: planning completed, generation failed with generator_validation, nothing delivered.
    previousAudit.on = true;
    for (let i = 0; i < 4 && (await processAdaptationStage(orchestrator, id)); i++);
    previousAudit.on = false;
    expect(await status(id)).toMatchObject({ status: "failed", delivered: false, error: { code: "generator_validation" } });
    expect([spy.planner, spy.generator, spy.reviewer]).toEqual([1, 1, 0]);
    expect(await entitlement(id)).toMatchObject({ state: "reserved", consumed_at: null });

    // Dry run: recoverable, and nothing changed.
    const dry = await recoverFailedGeneration(orchestrator, id);
    expect(dry).toMatchObject({ recoverable: true, generationReused: true, auditFailing: [], deterministicFailing: [], entitlement: { state: "reserved", consumedAt: null }, generationsUsed: 1 });
    expect(dry.queued).toBeUndefined();
    expect((await status(id)).status).toBe("failed");

    // Apply: the same input is queued (not a new generation cycle); nothing is run.
    expect(await recoverFailedGeneration(orchestrator, id, { apply: true })).toMatchObject({ recoverable: true, queued: true });
    expect(await status(id)).toMatchObject({ status: "generation_queued", generationsUsed: 1 });
    expect([spy.generator, spy.reviewer]).toEqual([1, 0]);

    // The teacher's next visit runs it: no generator call (the generation is reused), one reviewer call, delivered.
    for (let i = 0; i < 4 && (await processAdaptationStage(orchestrator, id)); i++);
    expect(await status(id)).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect([spy.planner, spy.generator, spy.reviewer]).toEqual([1, 1, 1]);
    expect(await entitlement(id)).toMatchObject({ state: "consumed" });
    expect(Number((await q<{ c: string }>("select count(*)::text c from public.adaptation_entitlements where workspace_id = $1", [u.workspaceId]))[0]!.c)).toBe(1);

    // Idempotent and bounded: a second recovery is refused (it is not failed any more).
    expect(await recoverFailedGeneration(orchestrator, id, { apply: true })).toMatchObject({ recoverable: false, reason: expect.stringMatching(/no está en failed/) });
  });
});
