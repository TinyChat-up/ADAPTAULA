import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { resolvePipelineVersions } from "@/lib/adaptation/orchestration/versions";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import type { RecreationServices } from "@/lib/adaptation/recreation/services";
import { POND_PILOT_PROFILE, POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { mockStack } from "../support/recreation-mocks";
import { pondAnalysis } from "../support/pond-case";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedMaterial } from "./orchestration-harness";

/**
 * «Hacer magia» con el motor de recreación (ADR-053) sobre las migraciones reales (PGlite), con Claude y OpenAI simulados: 0 llamadas
 * de pago. Prueba el recorrido completo (crear → planificar → generar → entregar), que las respuestas no estén en nada que un miembro
 * pueda leer, el aislamiento entre workspaces y roles, la cuota y que abrir lo guardado no llame a ningún modelo.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const SECRET = "30 − 18 = 12";

let n = 0;
async function teacher(options: { engine?: boolean; plans?: Parameters<typeof mockStack>[0] } = {}) {
  const u = await createUser(db, `recreation-${++n}@example.com`);
  const material = await seedMaterial(db, u, pondAnalysis());
  const learner = (await q<{ id: string }>("insert into public.learner_profiles (workspace_id, display_name, created_by, functional_profile) values ($1, 'Alumno', $2, $3) returning id", [u.workspaceId, u.id, JSON.stringify(POND_PILOT_PROFILE)]))[0]!.id;
  const stack = mockStack({ imagesAuthorized: true, ...(options.plans ?? {}) });
  const planned: string[] = [];
  const services: RecreationServices = {
    planner: ({ record }) => async (input, repairOf) => {
      const answer = await stack.planner(input, repairOf);
      planned.push(repairOf ? "repair" : "plan");
      if (answer.run) await record(answer.run);
      return answer;
    },
    illustrations: async () => stack.request.illustrations,
  };
  const orchestrator = makeDeps(db, scriptedServices(newSpy()), { recreation: services });
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: (o) => resolvePipelineVersions({}, o), recreationEngine: () => options.engine !== false };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const start = (key = `rec-${n}-${Math.random()}`, mode: "automatic" | "review" = "automatic") =>
    createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: key, creationMode: mode });
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const runAll = async (id: string) => {
    for (let i = 0; i < 6; i++) if (!(await processAdaptationStage(orchestrator, id))) return;
  };
  const totalCalls = () => Object.values(stack.calls).reduce((a, b) => a + b, 0);
  return { user: u, material, deps, actor, orchestrator, stack, planned, start, status, runAll, totalCalls };
}
type Teacher = Awaited<ReturnType<typeof teacher>>;

const created = async (t: Teacher, key?: string) => {
  const r = await t.start(key);
  if (!r.ok) throw new Error(r.code);
  return r.data.adaptationId;
};
const adaptation = async (id: string) => (await q<{ status: string; current_version: number; creation_mode: string; adaptation_type: string; pipeline_versions: { engine?: string } }>("select status, current_version, creation_mode, adaptation_type, pipeline_versions from public.adaptations where id = $1", [id]))[0]!;
const entitlement = async (id: string) => (await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]?.state;
const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied|forbidden/);

describe("el indicador decide el motor al CREAR, y solo en «Hacer magia»", () => {
  it("apagado: Hacer magia crea la adaptación de siempre, sin motor fijado", async () => {
    const t = await teacher({ engine: false });
    const id = await created(t);
    expect((await adaptation(id)).pipeline_versions.engine).toBeUndefined();
    expect((await adaptation(id)).adaptation_type).toBe("accessibility");
  });

  it("encendido: queda fijado, el alcance es metodológico (lo decide el servidor) y crear no llama a ningún modelo", async () => {
    const t = await teacher();
    const id = await created(t);
    const row = await adaptation(id);
    expect(row).toMatchObject({ creation_mode: "automatic", adaptation_type: "methodological" });
    expect(row.pipeline_versions.engine).toBe("recreation_v1");
    expect(t.totalCalls()).toBe(0);
    expect(await entitlement(id)).toBe("reserved");
  });

  it("«Revisar antes de crear» conserva el recorrido de siempre aunque el indicador esté encendido", async () => {
    const t = await teacher();
    const r = await t.start(undefined, "review");
    expect(r.ok).toBe(true);
    expect((await adaptation(r.ok ? r.data.adaptationId : "")).pipeline_versions.engine).toBeUndefined();
  });

  it("la misma petición dos veces (doble clic) no crea dos adaptaciones ni reserva dos unidades", async () => {
    const t = await teacher();
    const a = await created(t, "misma-peticion-1");
    const b = await created(t, "misma-peticion-1");
    expect(a).toBe(b);
    expect((await q<{ c: string }>("select count(*)::text c from public.adaptation_entitlements where workspace_id = $1", [t.user.workspaceId]))[0]!.c).toBe("1");
  });
});

describe("recorrido completo: planificar, generar y entregar", () => {
  it("los dos trabajos se ejecutan, la adaptación llega a ready, la cuota se consume una vez y no queda plan de relevo", async () => {
    const t = await teacher();
    const id = await created(t);
    await t.runAll(id);
    expect(await adaptation(id)).toMatchObject({ status: "ready", current_version: 1 });
    expect(await entitlement(id)).toBe("consumed");
    expect(await t.status(id)).toMatchObject({ phase: "ready", delivered: true });
    expect((await q<{ stage: string; status: string }>("select stage, status from public.adaptation_jobs where adaptation_id = $1 order by created_at", [id])).map((j) => `${j.stage}:${j.status}`)).toEqual(["planning:completed", "generation:completed"]);
    // The plan (with its solutions) was only a hand-over between the stages.
    expect(await q("select 1 from public.recreation_plans where adaptation_id = $1", [id])).toHaveLength(0);
    expect((await q<{ c: string }>("select count(*)::text c from public.ai_runs where adaptation_id = $1 and purpose = 'plan'", [id]))[0]!.c).toBe("1");
    expect(t.planned).toEqual(["plan"]);
  });

  it("la versión guardada es la ficha del alumno SIN respuestas; los materiales y la explicación van en la parte legible", async () => {
    const t = await teacher();
    const id = await created(t);
    await t.runAll(id);
    const version = (await q<{ id: string; document: { answer_key: unknown[] }; review: { verdict: string } }>("select id, document, review from public.adaptation_versions where adaptation_id = $1", [id]))[0]!;
    expect(version.document.answer_key).toEqual([]);
    expect(JSON.stringify(version.document)).not.toContain(SECRET);
    expect(version.review.verdict).toBe("approved_with_warnings");
    expect((await t.status(id)).review?.warnings.map((c) => c.check)).toEqual(expect.arrayContaining(["objectives_preserved", "answers_not_leaked"]));
    const visible = (await q<{ state: string; state_message: string; review_activities: string[]; materials_document: { answer_key: unknown[] }; explanation: { adapted: string[] }; assets: unknown[] }>("select * from public.recreation_versions where adaptation_version_id = $1", [version.id]))[0]!;
    expect(visible).toMatchObject({ state: "review", review_activities: ["1", "2", "3", "4", "5", "6", "7"] });
    expect(visible.state_message).toContain("Contrasta las respuestas propuestas con la fuente citada.");
    expect(visible.materials_document.answer_key).toEqual([]);
    expect(visible.explanation.adapted.length).toBeGreaterThan(0);
    expect(visible.assets.length).toBeGreaterThan(0);
    expect(JSON.stringify(visible)).not.toContain(SECRET);
    // The solutions exist, but only on the server side.
    const internal = (await q<{ answer_key: { student: unknown[] } }>("select answer_key from public.recreation_internals where adaptation_version_id = $1", [version.id]))[0]!;
    expect(internal.answer_key.student.length).toBe(7);
    expect(JSON.stringify(internal)).toContain(SECRET);
  });

  it("abrir, recargar o volver a pedir lo pendiente no llama a ningún modelo ni consume nada", async () => {
    const t = await teacher();
    const id = await created(t);
    await t.runAll(id);
    const calls = t.totalCalls();
    for (let i = 0; i < 20; i++) {
      expect(await processAdaptationStage(t.orchestrator, id)).toBeNull();
      await t.status(id);
      await readerFor(db, t.user).getVersion(id, null);
    }
    expect(t.totalCalls()).toBe(calls);
    expect(await entitlement(id)).toBe("consumed");
  });

  it("interrumpida entre las dos etapas: se retoma sin volver a planificar", async () => {
    const t = await teacher();
    const id = await created(t);
    await processAdaptationStage(t.orchestrator, id); // planning only
    expect((await adaptation(id)).status).toBe("generation_queued");
    await db.query("delete from public.adaptation_jobs where adaptation_id = $1 and stage = 'generation'", [id]);
    await t.runAll(id);
    expect((await adaptation(id)).status).toBe("ready");
    expect(t.planned).toEqual(["plan"]);
  });
});

describe("un plan que no supera las comprobaciones esenciales no se entrega ni se cobra", () => {
  it("falla la planificación: no hay versión ni plan guardado, ninguna imagen y la unidad se devuelve", async () => {
    const bad = structuredClone(POND_RECREATION_PLAN);
    bad.activities[4]!.steps = ["Debe darte 12."];
    const t = await teacher({ plans: { plans: [bad, bad] } });
    const id = await created(t);
    await t.runAll(id);
    expect((await adaptation(id)).status).toBe("failed");
    expect(t.planned).toEqual(["plan", "repair"]);
    expect(await q("select 1 from public.adaptation_versions where adaptation_id = $1", [id])).toHaveLength(0);
    expect(await q("select 1 from public.recreation_plans where adaptation_id = $1", [id])).toHaveLength(0);
    expect(t.stack.calls.image ?? 0).toBe(0);
    // A failed «Hacer magia» never costs a unit: it goes back (migration 038).
    expect(await entitlement(id)).toBe("released");
  });
});

describe("acceso directo a los datos: miembros, roles y otros workspaces", () => {
  let t: Teacher;
  let id: string;
  let versionId: string;
  let viewer: { id: string };
  let outsider: { id: string; workspaceId: string };
  beforeAll(async () => {
    t = await teacher();
    id = await created(t);
    await t.runAll(id);
    versionId = (await q<{ id: string }>("select id from public.adaptation_versions where adaptation_id = $1", [id]))[0]!.id;
    viewer = await createUser(db, "viewer-rec@example.com");
    await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [t.user.workspaceId, viewer.id]);
    outsider = await createUser(db, "outsider-rec@example.com");
  }, 60_000);

  const as_ = <T>(user: { id: string } | null, role: "authenticated" | "anon", sql: string, params: unknown[] = [versionId]) => as(db, role, user?.id ?? null, () => db.query<T>(sql, params).then((r) => r.rows));

  it("el propietario y el lector leen lo visible, y en ello no hay ninguna respuesta", async () => {
    for (const user of [t.user, viewer]) {
      const rows = await as_<{ materials_document: unknown }>(user, "authenticated", "select * from public.recreation_versions where adaptation_version_id = $1");
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(SECRET);
      const docs = await as_<{ document: unknown }>(user, "authenticated", "select document from public.adaptation_versions where id = $1");
      expect(JSON.stringify(docs)).not.toContain(SECRET);
    }
  });

  it("las respuestas, el plan y la verificación no se leen con ninguna consulta de un usuario (propietario, lector, otro workspace, anónimo)", async () => {
    for (const [user, role] of [[t.user, "authenticated"], [viewer, "authenticated"], [outsider, "authenticated"], [null, "anon"]] as const) {
      await denied(as_(user, role, "select answer_key, plan from public.recreation_internals where adaptation_version_id = $1"));
      await denied(as_(user, role, "select plan, verification from public.recreation_plans where adaptation_id = $1", [id]));
    }
  });

  it("otro workspace no ve nada, un anónimo tampoco, y nadie escribe desde el cliente", async () => {
    expect(await as_(outsider, "authenticated", "select 1 from public.recreation_versions where adaptation_version_id = $1")).toHaveLength(0);
    await denied(as_(null, "anon", "select 1 from public.recreation_versions where adaptation_version_id = $1"));
    await denied(as_(t.user, "authenticated", "update public.recreation_versions set state = 'ready' where adaptation_version_id = $1"));
    await denied(as_(t.user, "authenticated", "delete from public.recreation_versions where adaptation_version_id = $1"));
    await denied(as_(t.user, "authenticated", "insert into public.recreation_versions (adaptation_version_id, adaptation_id, workspace_id, state, explanation) select id, adaptation_id, workspace_id, 'ready', '{}'::jsonb from public.adaptation_versions where id = $1"));
  });

  it("las funciones que escriben las partes del motor solo las ejecuta el servidor", async () => {
    for (const fn of ["put_recreation_plan(null, null, null, '{}'::jsonb, '{}'::jsonb, null)", "get_recreation_plan(null)", "put_recreation_version(null, null, null, null, '{}'::jsonb, '{}'::jsonb)"]) {
      await denied(as_(t.user, "authenticated", `select public.${fn}`, []));
    }
  });

  it("la base de datos rechaza una parte visible con respuestas, en la ficha o en los materiales", async () => {
    // A version of the adaptation whose document carries an answer key can never be tied to the readable part.
    const dirty = (await q<{ id: string }>("insert into public.adaptation_versions (adaptation_id, workspace_id, version, document, source) select $1, workspace_id, 9, '{\"answer_key\": [{\"block_id\": \"blk_x0001\"}]}'::jsonb, 'teacher_edit' from public.adaptations where id = $1 returning id", [id]))[0]!.id;
    await expect(db.query("insert into public.recreation_versions (adaptation_version_id, adaptation_id, workspace_id, state, explanation) select $1, adaptation_id, workspace_id, 'ready', '{}'::jsonb from public.adaptation_versions where id = $1", [dirty])).rejects.toThrow(/answers_in_visible_document/);
    const clean = (await q<{ id: string }>("insert into public.adaptation_versions (adaptation_id, workspace_id, version, document, source) select $1, workspace_id, 10, '{\"answer_key\": []}'::jsonb, 'teacher_edit' from public.adaptations where id = $1 returning id", [id]))[0]!.id;
    await expect(db.query("insert into public.recreation_versions (adaptation_version_id, adaptation_id, workspace_id, state, explanation, materials_document) select $1, adaptation_id, workspace_id, 'ready', '{}'::jsonb, '{\"answer_key\": [{\"x\": 1}]}'::jsonb from public.adaptation_versions where id = $1", [clean])).rejects.toThrow(/recreation_versions_no_answers/);
  });
});
