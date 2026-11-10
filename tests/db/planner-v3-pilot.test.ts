import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mockPlanDraftV3 } from "@/lib/adaptation/mock-v3";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { runPlanningStage } from "@/lib/adaptation/orchestration/orchestrator";
import { createAdaptationCommand, createAndStartAdaptation, getAdaptationPlan, submitPlanReviewCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { resolvePipelineVersions, type PipelineVersions, type RulesFreeze } from "@/lib/adaptation/orchestration/versions";
import type { RulesUse } from "@/lib/adaptation/plan-v3";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import { initialFormState } from "@/lib/adaptation/presentation/review-form";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial } from "./orchestration-harness";

/**
 * The V3 pilot through the real migrations and orchestrator (ADR-046), with scripted planners: 0 model calls. What is proven:
 *  - V3 is chosen only where the server's pilot gate answers for THIS workspace; anything else is refused before any adaptation,
 *    reservation or job exists, and every other adaptation keeps the current planner;
 *  - the planner's declarations are stored with the plan's validation and reach the review screen;
 *  - a withheld decision is never applied without the teacher: «Hacer magia» stops at the plan review instead of generating, and
 *    the review form starts with it unchecked; the teacher may still approve it.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const RULES: RulesFreeze = { version: "v2.2", package_sha256: "b".repeat(64) };
const RULES_USE: RulesUse = { version: RULES.version, package_sha256: RULES.package_sha256, block_sha256: "c".repeat(64), included: ["D-001-A01"] };

/** A v3 planner whose first decision depends on the teacher's answer (conditional, with its question). */
const conditionalFirst = async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const draft = mockPlanDraftV3(fractionsAnalysis(), input.context, RULES_USE);
  draft.decisions[0] = { ...draft.decisions[0]!, status: "conditional", question: "q_9" };
  draft.teacher_questions = [...(draft.teacher_questions ?? []), { id: "q_9", text: "¿Esta actividad se usa para evaluar?" }];
  return { draft, runs: [], rules: RULES_USE };
};

let n = 0;
async function teacher(pilotFor: (workspaceId: string) => RulesFreeze | null) {
  const u = await createUser(db, `v3pilot-${++n}@example.com`);
  const material = await seedMaterial(db, u, fractionsAnalysis());
  const learner = await seedLearner(db, u, "Perfil A ficticio");
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner: conditionalFirst as never }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: (options) => resolvePipelineVersions({}, options), plannerV3Pilot: pilotFor };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const versionsOf = async (id: string) => (await q<{ pipeline_versions: PipelineVersions }>("select pipeline_versions from public.adaptations where id = $1", [id]))[0]!.pipeline_versions;
  return { u, material, learner, spy, orchestrator, deps, actor, versionsOf };
}

describe("elegir V3 lo decide la puerta del servidor", () => {
  it("sin piloto, pedir V3 se rechaza antes de crear nada: ni adaptación, ni reserva, ni trabajo", async () => {
    const t = await teacher(() => null);
    const refused = await createAndStartAdaptation(t.deps, t.actor, { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: `v3pilot-key-${n}-a`, creationMode: "review", planner: "v22" });
    expect(refused).toEqual({ ok: false, code: "forbidden" });
    expect(await q("select id from public.adaptations where workspace_id = $1", [t.u.workspaceId])).toEqual([]);
    expect(await q("select adaptation_id from public.adaptation_entitlements where workspace_id = $1", [t.u.workspaceId])).toEqual([]);
    expect(t.spy.planner).toBe(0);
  });

  it("solo el workspace autorizado congela v3 con la huella de sus reglas; sin pedirlo, sigue el planificador actual", async () => {
    const t = await teacher((ws) => (ws === t.u.workspaceId ? RULES : null));
    const v3 = await createAdaptationCommand(t.deps, t.actor, { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: `v3pilot-key-${n}-b`, planner: "v22" });
    const current = await createAdaptationCommand(t.deps, t.actor, { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: `v3pilot-key-${n}-c` });
    if (!v3.ok || !current.ok) throw new Error("no creada");
    expect(await t.versionsOf(v3.data.adaptationId)).toMatchObject({ planner: { prompt_version: 3, max_output_tokens: 12000 }, rules: RULES });
    const plain = await t.versionsOf(current.data.adaptationId);
    expect(plain.planner.prompt_version).toBe(2);
    expect(plain.rules).toBeUndefined();
    // Another workspace asking for V3 through the same deployment is refused.
    const other = await createUser(db, `v3pilot-otro-${n}@example.com`);
    const otherMaterial = await seedMaterial(db, other, fractionsAnalysis());
    const deps: ServiceDeps = { ...t.deps, reader: readerFor(db, other) };
    expect(await createAdaptationCommand(deps, { userId: other.id, workspaceId: other.workspaceId, canWrite: true }, { materialId: otherMaterial, learnerProfileId: null, adaptationType: "accessibility", requestKey: `v3pilot-key-${n}-d`, planner: "v22" })).toEqual({ ok: false, code: "forbidden" });
  });
});

describe("las decisiones condicionadas esperan al docente", () => {
  it("«Hacer magia» con v3 se detiene en la revisión del plan: la decisión retenida se rechaza con su motivo y no se genera nada", async () => {
    const t = await teacher(() => RULES);
    const created = await createAndStartAdaptation(t.deps, t.actor, { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: `v3pilot-key-${n}-e`, creationMode: "automatic", planner: "v22" });
    if (!created.ok) throw new Error(created.code);
    const id = created.data.adaptationId;
    for (let i = 0; i < 6 && (await processAdaptationStage(t.orchestrator, id)); i++);
    expect((await q<{ status: string }>("select status from public.adaptations where id = $1", [id]))[0]!.status).toBe("awaiting_plan_review");
    expect(t.spy.generator).toBe(0);
    const reviews = await q<{ payload: { reviewer: { kind: string }; entries: Array<{ decision_id: string; action: string; reason: string }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id]);
    expect(reviews.at(-1)!.payload.entries.find((e) => e.decision_id === "dec_1")).toMatchObject({ action: "rejected", reason: expect.stringMatching(/V2\.2/) });

    // The declarations travel with the plan's validation (ids and hashes of the rules, never their text) …
    const validation = (await q<{ payload: { declarations: { rules: RulesUse; decisions: Record<string, { withheld: boolean }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_validation'", [id]))[0]!.payload;
    expect(validation.declarations.rules).toEqual(RULES_USE);
    expect(validation.declarations.decisions.dec_1!.withheld).toBe(true);
    const draft = (await q<{ payload: { rules?: RulesUse } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'planner_draft'", [id]))[0]!.payload;
    expect(draft.rules).toEqual(RULES_USE);

    // … and reach the review screen: the decision starts unchecked, with its question.
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    expect(plan.data.decisions[0]!.method).toEqual({ withheld: true, conditional: true, question: "¿Esta actividad se usa para evaluar?", reasons: ["Depende de tu respuesta a una pregunta."] });
    expect(plan.data.method?.questions.map((x) => x.id)).toContain("q_9");
    expect(initialFormState(plan.data).dec_1!.choice).toBe("reject");
    expect(plan.data.decisions.slice(1).every((d) => initialFormState(plan.data)[d.id]!.choice !== "reject" || d.status === "blocked" || d.method?.withheld)).toBe(true);
  });

  it("el docente puede aprobar una decisión retenida: su revisión es suya y no se modifica", async () => {
    const t = await teacher(() => RULES);
    const created = await createAdaptationCommand(t.deps, t.actor, { materialId: t.material, learnerProfileId: t.learner, adaptationType: "accessibility", requestKey: `v3pilot-key-${n}-f`, planner: "v22", creationMode: "review" });
    if (!created.ok) throw new Error(created.code);
    const id = created.data.adaptationId;
    expect((await runPlanningStage(t.orchestrator, id)).outcome).toBe("completed");
    const plan = await getAdaptationPlan(t.deps, t.actor, id);
    if (!plan.ok) throw new Error(plan.code);
    const entries = plan.data.decisions.map((d) => ({ decision_id: d.id, action: d.status === "blocked" ? "rejected" : "approved", reason: "prueba" }));
    const body = { schema_version: 1, plan_fingerprint: plan.data.planFingerprint, entries };
    // Without the teacher's answer, the withheld decision cannot be approved (the server decides, not the screen); «no» and
    // «no lo sé» are not a yes either, and nothing is persisted.
    const before = (await q("select id from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id])).length;
    for (const answer of [undefined, "no", "unknown"] as const) {
      const refused = await submitPlanReviewCommand(t.deps, t.actor, id, answer ? { ...body, confirmations: [{ decision_id: "dec_1", answer }] } : body);
      expect(refused.ok).toBe(false);
    }
    expect((await q("select id from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review'", [id])).length).toBe(before);
    const submitted = await submitPlanReviewCommand(t.deps, t.actor, id, { ...body, confirmations: [{ decision_id: "dec_1", answer: "yes" }] });
    expect(submitted.ok).toBe(true);
    const review = (await q<{ payload: { entries: Array<{ decision_id: string; action: string }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan_review' order by created_at", [id])).at(-1)!.payload;
    expect(review.entries.find((e) => e.decision_id === "dec_1")!.action).toBe("approved");
  });
});
