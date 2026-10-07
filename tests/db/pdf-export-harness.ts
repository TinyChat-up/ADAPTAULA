import type { PGlite } from "@electric-sql/pglite";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAdaptationCommand, getAdaptationPlan, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationJobs } from "@/lib/adaptation/orchestration/worker";
import { locateVisual } from "@/lib/materials/visuals/service";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { visualFixturePdf } from "../support/visual-fixture";
import { createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Spy, type User } from "./orchestration-harness";
import { attachSource, visualHarness, type VisualHarness } from "./visual-harness";

/**
 * A delivered adaptation over the real migrations (PGlite), produced by the real pipeline with scripted providers (0 model
 * calls), whose original visuals were located by a person (real crops in the private bucket). What `GET /api/adaptations/[id]/pdf`
 * exports, in `tests/db` (fake engine) and in `tests/pdf` (real Chromium).
 */

export interface World {
  user: User;
  materialId: string;
  id: string;
  deps: ServiceDeps;
  actor: Actor;
  visuals: VisualHarness;
  spy: Spy;
}

let n = 0;
let sourcePdf: Uint8Array | null = null;

export async function deliveredWithVisuals(db: PGlite, options: { locate?: boolean; deliver?: boolean } = {}): Promise<World> {
  sourcePdf ??= await visualFixturePdf();
  const user = await createUser(db, `pdf-export-${++n}-${Math.random().toString(36).slice(2, 8)}@example.com`);
  const materialId = await seedMaterial(db, user, fractionsAnalysis());
  const visuals = visualHarness(db, user);
  await attachSource(db, visuals, materialId, "application/pdf", sourcePdf);

  const learner = await seedLearner(db, user);
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, {}), {});
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const created = await createAdaptationCommand(deps, actor, { materialId, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `pdf-${n}-${Math.random()}` });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  if (options.deliver === false) return { user, materialId, id, deps, actor, visuals, spy };
  const tick = () => processAdaptationJobs(orchestrator, { limit: 5, adaptationIds: [id] });
  await startPlanning(deps, actor, id);
  await tick();
  const plan = await getAdaptationPlan(deps, actor, id);
  if (!plan.ok) throw new Error(plan.code);
  await submitPlanReviewCommand(deps, actor, id, { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00Z", entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" })) });
  await startGeneration(deps, actor, id);
  await tick();

  if (options.locate !== false) {
    for (const [visualId, bounds] of [["vis_1", { x: 0.15, y: 0.22, w: 0.42, h: 0.14 }], ["vis_2", { x: 0.15, y: 0.45, w: 0.72, h: 0.06 }]] as const) {
      const located = await locateVisual(visuals.deps, actor, { materialId, visualId, page: 2, bounds });
      if (!("status" in located) || located.status !== "ready") throw new Error(`no se pudo localizar ${visualId}`);
    }
  }
  return { user, materialId, id, deps, actor, visuals, spy };
}

/**
 * Puts another stored document in the delivered version (as a superuser; the app can never do this) so one delivered adaptation
 * can carry each fixture: tables, charts, ten pages… The document must still be a valid `MaterialDocument`.
 */
export async function replaceDocument(db: PGlite, adaptationId: string, document: MaterialDocument): Promise<void> {
  await db.query("update public.adaptation_versions set document = $2 where adaptation_id = $1 and version = (select current_version from public.adaptations where id = $1)", [adaptationId, JSON.stringify(document)]);
}

export const count = async (db: PGlite, sql: string, params: unknown[] = []) => Number((await db.query<{ c: string }>(sql, params)).rows[0]!.c);

/** Everything an export must leave untouched: no model call, no quota, no new version or job, the same stored document. */
export async function footprint(db: PGlite, w: Pick<World, "id" | "user">) {
  return {
    aiRuns: await count(db, "select count(*)::text c from public.ai_runs where workspace_id = $1", [w.user.workspaceId]),
    usage: await count(db, "select count(*)::text c from public.usage_events where workspace_id = $1", [w.user.workspaceId]),
    entitlements: (await db.query("select state from public.adaptation_entitlements where adaptation_id = $1 order by 1", [w.id])).rows,
    versions: await count(db, "select count(*)::text c from public.adaptation_versions where adaptation_id = $1", [w.id]),
    jobs: await count(db, "select count(*)::text c from public.adaptation_jobs where adaptation_id = $1", [w.id]),
    adaptation: (await db.query("select status, current_version, delivered_at::text, updated_at::text from public.adaptations where id = $1", [w.id])).rows[0],
    document: (await db.query("select document from public.adaptation_versions where adaptation_id = $1", [w.id])).rows,
    assets: await count(db, "select count(*)::text c from public.material_visual_assets where workspace_id = $1", [w.user.workspaceId]),
  };
}
