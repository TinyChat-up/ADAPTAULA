import type { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdaptationView, type AdaptationActions } from "@/components/adaptation/adaptation-view";
import { PlanReviewForm } from "@/components/adaptation/plan-review-form";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { PRIVATE_HEADERS } from "@/lib/adaptation/orchestration/http";
import { processAdaptationJobs } from "@/lib/adaptation/orchestration/worker";
import { cancelAdaptationCommand, createAdaptationCommand, getAdaptationPlan, getAdaptationStatus, startGeneration, startPlanning, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { buildContextView } from "@/lib/adaptation/presentation/context";
import { buildReview, editsFor, formReducer, initialFormState, problemsOf, type FormState } from "@/lib/adaptation/presentation/review-form";
import { screenFor } from "@/lib/adaptation/presentation/view-model";
import { INFERRED_ANSWER, analysisWithInferredAnswer } from "../support/adaptation-ui-fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type Spy, type User } from "./orchestration-harness";

/**
 * The adaptation UI against the real application layer on PGlite, with the provider mocks (0 real calls): what the browser
 * would show at each step is built from the same DTOs the pages receive, and what it sends is what the Server Actions accept.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

let db: PGlite;
const analysis = analysisWithInferredAnswer();
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

let n = 0;
async function session(existing?: User) {
  const user = existing ?? (await createUser(db, `ui-${++n}@example.com`));
  const material = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const spy: Spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, {}), {});
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date("2026-10-05T12:00:00Z") };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const ids: string[] = [];
  const context = buildContextView({ materialId: material, title: "Comprensión y argumentación", stage: "Bachillerato", grade: "1.º Bachillerato", subject: "Lengua", analysis });
  const worker = () => processAdaptationJobs(orchestrator, { limit: 5, adaptationIds: ids });
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const plan = async (id: string) => {
    const r = await getAdaptationPlan(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  /** What the Server Actions do for the page, bound to this adaptation. */
  const actionsFor = (id: string): AdaptationActions => ({
    start: async () => ({ ok: true, data: (await startPlanning(deps, actor, id)) as never }) as never,
    submit: async (review) => {
      const r = await submitPlanReviewCommand(deps, actor, id, { ...review, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00Z" });
      return (r.ok ? r : { ok: false, code: r.code, message: "" }) as never;
    },
    generate: async () => (await startGeneration(deps, actor, id)) as never,
    reopen: async () => ({ ok: true, data: { status: "x" } }),
    retry: async () => ({ ok: true, data: { status: "queued" as const, alreadyQueued: false } }),
    cancel: async () => (await cancelAdaptationCommand(deps, actor, id)) as never,
  });
  const create = async (key = `ui-key-${++n}-${Math.random().toString(36).slice(2)}`) => {
    const r = await createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: key });
    if (!r.ok) throw new Error(`create: ${r.code}`);
    ids.push(r.data.adaptationId);
    return r.data.adaptationId;
  };
  return { user, material, spy, deps, actor, ids, context, worker, status, plan, actionsFor, create };
}
type Session = Awaited<ReturnType<typeof session>>;

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const visible = (markup: string) => markup.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (s: Session, id: string, dto: Awaited<ReturnType<Session["status"]>>, plan: Awaited<ReturnType<Session["plan"]>> | null = null) =>
  renderToStaticMarkup(createElement(AdaptationView, { initial: dto, plan, context: s.context, readyInfo: null, actions: s.actionsFor(id), canWrite: true }));

/** The teacher's choices over the real plan: one rejected, one adjusted, the rest approved (blocked ones discarded). */
function teacherChoices(plan: Awaited<ReturnType<Session["plan"]>>): FormState {
  let state = initialFormState(plan);
  let rejected = false;
  let adjusted = false;
  for (const d of plan.decisions) {
    if (d.status === "blocked") continue;
    if (!rejected && d.status === "valid") {
      state = formReducer(state, { type: "choose", id: d.id, choice: "reject" });
      rejected = true;
    } else if (!adjusted && d.status === "valid") {
      state = formReducer(state, { type: "edit", id: d.id, patch: { intensity: d.intensity === "light" ? "moderate" : "light" } });
      adjusted = true;
    } else state = formReducer(state, { type: "choose", id: d.id, choice: "approve" });
  }
  return state;
}

describe("flujo integrado de la UI (mocks de proveedor, 0 llamadas reales)", () => {
  it("material → crear → CTA → planificar → worker → revisión → aprobar/rechazar/ajustar → guardar → generar → worker → ready con observaciones", async () => {
    const s = await session();
    const id = await s.create();

    // 1 · queued: the page offers exactly one CTA and nothing has been sent to a provider.
    let dto = await s.status(id);
    expect(screenFor(dto)).toBe("start");
    expect(render(s, id, dto)).toContain("Preparar propuesta de adaptación");
    expect(s.spy).toMatchObject({ planner: 0, generator: 0, reviewer: 0 });

    // 2 · the CTA twice (double click) → one job; the page now shows the working state and the DB has one planning job.
    const actions = s.actionsFor(id);
    await Promise.all([actions.start(), actions.start()]);
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_jobs where adaptation_id = $1 and stage = 'planning'", [id]))[0]!.c).toBe("1");
    dto = await s.status(id);
    expect(screenFor(dto)).toBe("working");
    expect(visible(render(s, id, dto))).toContain("Estamos preparando una propuesta de adaptación.");

    // 3 · the worker plans; polling would now see the review.
    await s.worker();
    dto = await s.status(id);
    expect(screenFor(dto)).toBe("review");
    const plan = await s.plan(id);
    const reviewHtml = render(s, id, dto, plan);
    expect(reviewHtml.match(/<fieldset/g)).toHaveLength(plan.decisions.length);
    expect(visible(reviewHtml)).not.toMatch(/need_\d|\bdec_\d|\bact_\d|diagn|dislex/i);
    expect(s.spy.generator).toBe(0);

    // 4 · the form never submits by itself, blocks until every decision is resolved, then builds a valid review.
    let state = initialFormState(plan);
    expect(Object.keys(problemsOf(plan, state)).length).toBe(plan.decisions.filter((d) => d.status !== "blocked").length);
    state = teacherChoices(plan);
    expect(problemsOf(plan, state)).toEqual({});
    const review = buildReview(plan, state);
    expect(review.entries.map((e) => e.action)).toContain("rejected");
    expect(review.entries.map((e) => e.action)).toContain("edited");
    expect(review.entries.map((e) => e.action)).toContain("approved");

    // 5 · saving: the server accepts the review, says it is executable and moves on; the page offers the generation CTA.
    const saved = await actions.submit(review);
    expect(saved).toMatchObject({ ok: true, data: { executable: true } });
    dto = await s.status(id);
    expect(screenFor(dto)).toBe("generate");
    const generateHtml = render(s, id, dto);
    expect(generateHtml).toContain("Crear material adaptado");
    expect(s.spy.generator).toBe(0);

    // 6 · generation only enqueues; the worker runs generator and (mock) reviewer; polling ends on a delivered state.
    expect(await actions.generate()).toMatchObject({ ok: true });
    expect(await actions.generate()).toMatchObject({ ok: true, data: { alreadyQueued: true } });
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [id]))[0]!.c).toBe("1");
    await s.worker();
    dto = await s.status(id);
    expect(screenFor(dto)).toBe("ready");
    expect(dto).toMatchObject({ status: "ready", delivered: true, currentVersion: 1 });
    const readyHtml = render(s, id, dto);
    expect(visible(readyHtml)).toMatch(/Material preparado con observaciones|La adaptación está preparada/);
    expect(readyHtml).not.toMatch(/"blocks"|schema_version|<table|<img/);
    expect(visible(readyHtml)).not.toMatch(/need_\d|\bblk_|\bR1\b|traceability_complete|functional_supports_applied/);

    // 7 · DB: one unit consumed, one version, entitlement consumed, every stage ran once, no real call is possible here.
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("consumed");
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_versions where adaptation_id = $1", [id]))[0]!.c).toBe("1");
    expect(s.spy).toMatchObject({ planner: 1, generator: 1, reviewer: 1 });
  });

  it("recargar reconstruye la pantalla desde el servidor en cada estado, sin reenviar nada ni duplicar jobs", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    const plan = await s.plan(id);
    // Reload while reviewing: same plan, same screen, no extra job or provider call.
    for (let i = 0; i < 3; i++) expect(screenFor(await s.status(id))).toBe("review");
    expect(render(s, id, await s.status(id), plan)).toContain("Guardar revisión");
    expect(s.spy.planner).toBe(1);
    // Reload after saving → generate; after generating → ready.
    await s.actionsFor(id).submit(buildReview(plan, teacherChoices(plan)));
    expect(screenFor(await s.status(id))).toBe("generate");
    await s.actionsFor(id).generate();
    await s.worker();
    expect(screenFor(await s.status(id))).toBe("ready");
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_jobs where adaptation_id = $1", [id]))[0]!.c).toBe("2");
  });

  it("una propuesta obsoleta no sobrescribe: la segunda pestaña recibe un error que la pantalla traduce, y la revisión guardada no cambia", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    const plan = await s.plan(id);
    const review = buildReview(plan, teacherChoices(plan));
    expect(await s.actionsFor(id).submit(review)).toMatchObject({ ok: true });
    const stale = await s.actionsFor(id).submit({ ...review, plan_fingerprint: "b".repeat(64) });
    expect(stale.ok).toBe(false);
    const before = (await q<{ c: string }>("select count(*)::text c from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id]))[0]!.c;
    await s.actionsFor(id).submit({ ...review, plan_fingerprint: "c".repeat(64) });
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id]))[0]!.c).toBe(before);
  });

  it("cancelar actualiza el estado, devuelve la unidad y la pantalla no ofrece ninguna acción de generación", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    expect(await s.actionsFor(id).cancel()).toMatchObject({ ok: true, data: { cancelled: true } });
    const dto = await s.status(id);
    expect(screenFor(dto)).toBe("cancelled");
    expect(visible(render(s, id, dto))).not.toMatch(/Crear material adaptado|Preparar propuesta|Guardar revisión/);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("released");
  });

  it("otro workspace no ve ni la adaptación ni su plan (la página sería un 404)", async () => {
    const owner = await session();
    const id = await owner.create();
    await owner.actionsFor(id).start();
    await owner.worker();
    const other = await session();
    const asOther: ServiceDeps = { ...owner.deps, reader: other.deps.reader };
    expect(await getAdaptationStatus(asOther, other.actor, id)).toEqual({ ok: false, code: "not_found" });
    expect(await getAdaptationPlan(asOther, other.actor, id)).toEqual({ ok: false, code: "not_found" });
  });

  it("los endpoints de sondeo son privados y no cacheables", () => {
    expect(PRIVATE_HEADERS["Cache-Control"]).toBe("no-store, private");
    expect(PRIVATE_HEADERS.Vary).toBe("Cookie");
  });

  it("PlanReviewForm se renderiza con el plan real sin acciones ejecutadas y sin filtrar la respuesta inferida", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    const plan = await s.plan(id);
    const out = renderToStaticMarkup(createElement(PlanReviewForm, { plan, context: s.context, deferredIds: [], submit: async () => { throw new Error("no"); }, onSaved: () => {}, onRefresh: () => {} }));
    expect(visible(out)).not.toContain("Debe ser");
    expect(editsFor(plan.decisions[0]!, {})).toEqual({});
  });
});

describe("endurecimiento: autoridad del servidor sobre las ediciones y proyección de lo que se conserva", () => {
  it("el DTO del plan lleva las preservaciones de cada decisión (tipo + texto) y nunca la respuesta inferida", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    const plan = await s.plan(id);
    expect(plan.decisions.some((d) => d.preserves.length > 0)).toBe(true);
    for (const d of plan.decisions) for (const p of d.preserves) expect(Object.keys(p).sort()).toEqual(["type", "value"]);
    expect(JSON.stringify(plan)).not.toContain(INFERRED_ANSWER);
    const html = render(s, id, await s.status(id), plan);
    expect(html).not.toContain(INFERRED_ANSWER);
    expect(visible(html)).toMatch(/Se mantendrá|Se mantiene/);
  });

  it("una edición con el flag falsificado a false no llega así al almacén: el servidor lo deriva o la edición se rechaza", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    const plan = await s.plan(id);
    const target = plan.decisions.find((d) => d.status !== "blocked")!;
    const review = {
      schema_version: 1 as const,
      plan_fingerprint: plan.planFingerprint,
      entries: plan.decisions.map((d) =>
        d.id === target.id
          ? { decision_id: d.id, action: "edited" as const, reason: "x", edits: { supports: [{ kind: "sentence_starters", uses_task_data: false }, { kind: "worked_example", uses_task_data: false }] } }
          : { decision_id: d.id, action: "rejected" as const, reason: "x" },
      ),
    };
    const outcome = await s.actionsFor(id).submit(review as never);
    const stored = await q<{ payload: { entries: Array<{ edits?: { supports?: Array<{ kind: string; uses_task_data: boolean }> } }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id]);
    // Accepted (applied with its server-derived flag) or refused (nothing stored): never stored as a browser-declared false.
    expect(outcome.ok === false || stored.length > 0).toBe(true);
    for (const row of stored) for (const e of row.payload.entries) for (const sup of e.edits?.supports ?? []) expect(sup.uses_task_data, sup.kind).toBe(true);
  });

  it("las restricciones de una revisión de este mismo plan aparecen en el DTO de esa decisión", async () => {
    const s = await session();
    const id = await s.create();
    await s.actionsFor(id).start();
    await s.worker();
    const plan = await s.plan(id);
    const state = teacherChoices(plan);
    const review = buildReview(plan, state);
    const first = review.entries.find((e) => e.action !== "rejected")!;
    (first as { restrictions?: string[] }).restrictions = ["No sugerir la tesis ni los argumentos."];
    expect(await s.actionsFor(id).submit(review)).toMatchObject({ ok: true });
    const after = await s.plan(id);
    expect(after.decisions.find((d) => d.id === first.decision_id)!.restrictions).toEqual(["No sugerir la tesis ni los argumentos."]);
    expect(after.decisions.filter((d) => d.id !== first.decision_id).every((d) => d.restrictions.length === 0)).toBe(true);
  });
});

