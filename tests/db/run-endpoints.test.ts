import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAdaptationCommand, getAdaptationStatus, startPlanning, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import type { OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import type { AdaptationReader } from "@/lib/adaptation/orchestration/service";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Spy } from "./orchestration-harness";

/**
 * `POST /api/adaptations/[id]/run` end to end against the real database: the real Route Handler, the real services, a scripted
 * provider (no model). Only the session is simulated. Running a pending stage takes the capability that starting it takes.
 */

type Role = "owner" | "admin" | "teacher" | "viewer";
const session: { role: Role; userId: string; workspaceId: string; orchestrator: OrchestratorDeps; deps: ServiceDeps } = { role: "owner", userId: "", workspaceId: "", orchestrator: null as never, deps: null as never };

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return { ...actual, getApiContext: async () => ({ ctx: { user: { id: session.userId }, workspace: { id: session.workspaceId }, role: session.role } }) };
});
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({}) }));
vi.mock("@/lib/adaptation/orchestration/server", () => ({ orchestratorDeps: () => session.orchestrator, serviceDeps: () => session.deps }));

const { POST } = await import("@/app/api/adaptations/[id]/run/route");
const status = await import("@/app/api/adaptations/[id]/status/route");

let db: PGlite;
const analysis = fractionsAnalysis();
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

let n = 0;
async function started() {
  const user = await createUser(db, `run-${++n}@example.com`);
  const material = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const spy: Spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const created = await createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `run-${n}-${Math.random().toString(36).slice(2)}` });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  Object.assign(session, { userId: user.id, workspaceId: user.workspaceId, orchestrator, deps });
  return { id, spy, deps, actor, start: () => startPlanning(deps, actor, id) };
}
/**
 * Reader for the CONCURRENT test: PGlite has one connection, and the RLS reader switches database role around each query, which two
 * simultaneous requests would trample (a test artefact). Authorization by role does not depend on it; isolation between workspaces
 * is covered by the RLS tests and by "another workspace" below.
 */
const plainReader = (): AdaptationReader => {
  const q = <T>(sql: string, params: unknown[]) => db.query<T>(sql, params).then((r) => r.rows);
  return {
    getMaterial: async (id) => (await q<never>("select id, workspace_id, title, status, analysis, stage_slug, grade_slug, subject_slug from public.materials where id = $1", [id]))[0] ?? null,
    getLearnerProfile: async (id) => (await q<never>("select id, workspace_id, stage_slug, grade_slug, functional_profile from public.learner_profiles where id = $1", [id]))[0] ?? null,
    getAdaptation: async (id) => (await q<never>("select id, workspace_id, material_id, status, current_version, delivered_at from public.adaptations where id = $1", [id]))[0] ?? null,
    getVersion: async () => null,
    getArtifacts: async (id, kinds) => q<never>("select id, kind, input_fingerprint, fingerprint, payload, created_at::text from public.adaptation_artifacts where adaptation_id = $1 and kind = any($2::text[]) order by created_at", [id, kinds as unknown as string[]]),
  };
};
const run = (id: string) => POST(new Request(`http://localhost/api/adaptations/${id}/run`, { method: "POST" }), { params: Promise.resolve({ id }) } as never);
const jobsOf = async (id: string) => Number((await db.query<{ c: string }>("select count(*)::text c from public.adaptation_jobs where adaptation_id = $1", [id])).rows[0]!.c);

describe("POST /api/adaptations/[id]/run · authorization", () => {
  it("owner, admin and teacher can run the pending stage: the planner runs now, inside the request", async () => {
    for (const role of ["owner", "admin", "teacher"] as const) {
      const t = await started();
      session.role = role;
      await t.start();
      expect(t.spy.planner).toBe(0);
      const res = await run(t.id);
      expect(res.status, role).toBe(200);
      expect(await res.json()).toMatchObject({ status: "awaiting_plan_review" });
      expect(t.spy.planner, role).toBe(1);
    }
  });

  it("a read-only member is rejected BEFORE anything is processed: same not-found as every adaptation command, zero provider calls, state untouched", async () => {
    const t = await started();
    await t.start();
    session.role = "viewer";
    const res = await run(t.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden", message: "No hemos encontrado esa adaptación." } });
    expect(t.spy.planner + t.spy.generator + t.spy.reviewer).toBe(0);
    const job = (await t.deps.orchestrator.store.getPipeline(t.id))!.jobs[0]!;
    expect(job).toMatchObject({ status: "queued", attempts: 0 }); // not even claimed
    // …and the same job is run normally by a writer afterwards.
    session.role = "teacher";
    expect((await run(t.id)).status).toBe(200);
    expect(t.spy.planner).toBe(1);
  });

  it("reading the status stays open to a read-only member (service and route)", async () => {
    const t = await started();
    await t.start();
    session.role = "viewer";
    expect(await getAdaptationStatus(t.deps, { ...t.actor, canWrite: false }, t.id)).toMatchObject({ ok: true, data: { id: t.id } });
    const res = await status.GET(new Request(`http://localhost/api/adaptations/${t.id}/status`), { params: Promise.resolve({ id: t.id }) } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: t.id, status: "queued" });
    expect(t.spy.planner).toBe(0); // reading never runs anything
  });

  it("an adaptation of another workspace is not found for a writer too", async () => {
    const t = await started();
    session.role = "owner";
    const other = await started(); // switches the session to the other workspace
    session.role = "owner";
    expect((await run(t.id)).status).toBe(404);
    expect(other.spy.planner + t.spy.planner).toBe(0);
  });
});

describe("POST /api/adaptations/[id]/run · idempotency", () => {
  it("two authorised /run at once (double click, two tabs) → one logical execution, one call, one set of ai_runs", async () => {
    const t = await started();
    session.role = "teacher";
    await t.start();
    session.deps = { ...session.deps, reader: plainReader() };
    const [a, b] = await Promise.all([run(t.id), run(t.id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(t.spy.planner).toBe(1);
    expect(Number((await db.query<{ c: string }>("select count(*)::text c from public.ai_runs where adaptation_id = $1 and purpose = 'plan'", [t.id])).rows[0]!.c)).toBe(1);
    expect(await jobsOf(t.id)).toBe(1);
    expect((await (await run(t.id)).json()) as { status: string }).toMatchObject({ status: "awaiting_plan_review" });
    expect(t.spy.planner).toBe(1);
  });

  it("an adaptation that was never started has nothing to run: /run does not start it", async () => {
    const t = await started();
    session.role = "teacher";
    const res = await run(t.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "queued", nextAction: "start_planning" });
    expect(t.spy.planner).toBe(0);
    expect(await jobsOf(t.id)).toBe(0);
  });
});
