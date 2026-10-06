import type { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { processAdaptationJobs } from "@/lib/adaptation/orchestration/worker";
import { createAdaptationCommand, getAdaptationPlan, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { loadRenderInputWith } from "@/lib/render/load";
import { buildRenderModel } from "@/lib/render/model";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { argumentationAnalysis, fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Scripted, type User } from "./orchestration-harness";

/** The viewer's loader and renderer against the real pipeline output on PGlite (mock providers, 0 real calls). */
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

let n = 0;
async function session(analysis: MaterialAnalysis, script: Scripted = {}, existing?: User) {
  const user = existing ?? (await createUser(db, `render-${++n}@example.com`));
  const material = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const orchestrator = makeDeps(db, scriptedServices(newSpy(), script), {});
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const created = await createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `render-key-${n}-${Math.random()}` });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  const tick = () => processAdaptationJobs(orchestrator, { limit: 5, adaptationIds: [id] });
  return { user, deps, actor, id, tick, deliver: () => deliverFlow() };
  async function deliverFlow() {
    await startPlanning(deps, actor, id);
    await tick();
    const plan = await getAdaptationPlan(deps, actor, id);
    if (!plan.ok) throw new Error(plan.code);
    const review = { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00Z", entries: plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" })) };
    await submitPlanReviewCommand(deps, actor, id, review);
    await startGeneration(deps, actor, id);
    await tick();
  }
}

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const failReviewer: Scripted["reviewer"] = async (_i, _c, input) => ({
  draft: { checks: [{ check: "age_appropriate", status: "FAIL", targets: [], detail: "x" }, ...(((input.reviewContext?.review_scope.required_targets.answers_not_leaked ?? []).length > 0) ? [{ check: "answers_not_leaked" as const, status: "PASS" as const, targets: input.reviewContext!.review_scope.required_targets.answers_not_leaked!, detail: "ok" }] : []), { check: "no_infantilization", status: "PASS", targets: [], detail: "ok" }, { check: "functional_supports_applied", status: "PASS", targets: [], detail: "ok" }] } satisfies AiReviewDraft,
  runs: [],
});

describe("visor: carga autorizada y render sobre documentos reales del pipeline", () => {
  it("una adaptación entregada (aprobada con observaciones) se carga, se renderiza y el estado de render es independiente de la revisión pedagógica", async () => {
    const s = await session(argumentationAnalysis());
    await s.deliver();
    const loaded = await loadRenderInputWith(s.deps, s.actor, s.id);
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    expect(loaded.status.review?.verdict).toBe("approved_with_warnings");
    expect(loaded.version.version).toBe(1);
    const { model, validation } = buildRenderModel(loaded.document, { mode: "student", requiredVisuals: loaded.requiredVisuals, deferred: loaded.deferred });
    expect(["renderable", "renderable_with_warnings"]).toContain(validation.status);
    const out = renderToStaticMarkup(createElement(MaterialSheet, { model }));
    expect(out).toContain("ms-sheet");
    expect(out).not.toMatch(/blk_|dec_\d|source_refs/);
    for (const entry of loaded.document.answer_key) if (entry.value) expect(out).not.toContain(entry.value);
    // The deferred decisions of that very review were read (an empty list is still "known").
    expect(loaded.deferred).not.toBeNull();
  });

  it("un recurso original necesario sin asset deja la ficha no renderable aunque la revisión pedagógica la aprobara, y no altera esa revisión", async () => {
    const s = await session(fractionsAnalysis());
    await s.deliver();
    const reviewBefore = await q<{ review: unknown; current_version: number }>("select v.review, a.current_version from public.adaptation_versions v join public.adaptations a on a.id = v.adaptation_id where v.adaptation_id = $1", [s.id]);
    const loaded = await loadRenderInputWith(s.deps, s.actor, s.id);
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    expect(loaded.requiredVisuals.length).toBeGreaterThan(0);
    const { validation, model } = buildRenderModel(loaded.document, { mode: "student", requiredVisuals: loaded.requiredVisuals, deferred: loaded.deferred });
    expect(validation.status).toBe("not_renderable");
    expect(renderToStaticMarkup(createElement(MaterialSheet, { model }))).not.toContain("<img");
    const reviewAfter = await q<{ review: unknown; current_version: number }>("select v.review, a.current_version from public.adaptation_versions v join public.adaptations a on a.id = v.adaptation_id where v.adaptation_id = $1", [s.id]);
    expect(reviewAfter).toEqual(reviewBefore);
    expect(loaded.status.review?.verdict).toMatch(/approved/);
  });

  it("solo se muestra la versión actual entregada: cargar dos veces no cambia ni crea versiones", async () => {
    const s = await session(argumentationAnalysis());
    await s.deliver();
    const a = await loadRenderInputWith(s.deps, s.actor, s.id);
    const b = await loadRenderInputWith(s.deps, s.actor, s.id);
    expect(a.kind === "ok" && b.kind === "ok" && a.version.version === b.version.version && JSON.stringify(a.document) === JSON.stringify(b.document)).toBe(true);
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_versions where adaptation_id = $1", [s.id]))[0]!.c).toBe("1");
  });

  it("una adaptación bloqueada o sin entregar no se presenta como ficha final", async () => {
    const blocked = await session(argumentationAnalysis(), { reviewer: failReviewer });
    await blocked.deliver();
    expect((await loadRenderInputWith(blocked.deps, blocked.actor, blocked.id)).kind).toBe("not_ready");
    const fresh = await session(argumentationAnalysis());
    expect((await loadRenderInputWith(fresh.deps, fresh.actor, fresh.id)).kind).toBe("not_ready");
  });

  it("otro workspace recibe not_found (la ruta responde 404)", async () => {
    const owner = await session(argumentationAnalysis());
    await owner.deliver();
    const other = await session(argumentationAnalysis());
    const asOther: ServiceDeps = { ...owner.deps, reader: other.deps.reader };
    expect(await loadRenderInputWith(asOther, other.actor, owner.id)).toEqual({ kind: "not_found" });
  });
});
