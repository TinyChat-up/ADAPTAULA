import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createAdaptation } from "@/lib/adaptation/orchestration/orchestrator";
import { ADAPTATION_STATUSES, TRANSITIONS, canTransition } from "@/lib/adaptation/orchestration/state-machine";
import { AdaptationStore, InvalidStateError, LeaseLostError } from "@/lib/adaptation/orchestration/store";
import { InvalidTransitionError } from "@/lib/adaptation/orchestration/state-machine";
import { aggregateCost } from "@/lib/adaptation/orchestration/cost";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { as, createTestDb, createUser } from "./harness";
import { expireLeases, fp, pgRpc, seedLearner, seedMaterial, stageRun, versions, type User } from "./orchestration-harness";

let db: PGlite;
let store: AdaptationStore;
const analysis = fractionsAnalysis();

beforeAll(async () => {
  db = await createTestDb();
  store = new AdaptationStore(pgRpc(db));
}, 60_000);

let counter = 0;
async function newAdaptation(u: User, material?: string) {
  const m = material ?? (await seedMaterial(db, u, analysis));
  const { adaptationId } = await createAdaptation(
    { store, services: (() => undefined) as never },
    { workspaceId: u.workspaceId, userId: u.id, materialId: m, storedAnalysis: analysis, learnerProfileId: null, profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, adaptationType: "accessibility", title: "Prueba", requestKey: `key-${++counter}-${Math.random().toString(36).slice(2)}`, versions: versions() },
  );
  return { id: adaptationId, material: m };
}

const status = (id: string) => db.query<{ status: string }>("select status from public.adaptations where id = $1", [id]).then((r) => r.rows[0]!.status);
const F = (c: string) => c.repeat(64).slice(0, 64);

describe("máquina de estados: la base de datos y la aplicación dicen lo mismo", () => {
  it("cada par (origen, destino) coincide con adaptation_transition_allowed", async () => {
    for (const from of ADAPTATION_STATUSES) {
      for (const to of ADAPTATION_STATUSES) {
        const { rows } = await db.query<{ ok: boolean }>("select public.adaptation_transition_allowed($1, $2) as ok", [from, to]);
        expect(rows[0]!.ok, `${from} → ${to}`).toBe(canTransition(from, to));
      }
    }
    expect(TRANSITIONS.awaiting_plan_review).not.toContain("generating");
    expect(TRANSITIONS.queued).not.toContain("generating");
  });

  it("una transición inválida se rechaza y una válida con estado de origen distinto no cambia nada", async () => {
    const u = await createUser(db, "transiciones@example.com");
    const { id } = await newAdaptation(u);
    await expect(store.transition(id, "queued", "generating")).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await store.transition(id, "planning", "awaiting_plan_review")).toBe(false);
    expect(await status(id)).toBe("queued");
    expect(await store.transition(id, "queued", "planning")).toBe(true);
  });
});

describe("alta, versiones fijadas e idempotencia", () => {
  it("crear con la misma clave devuelve la misma adaptación; las versiones y el contexto quedan fijados y minimizados", async () => {
    const u = await createUser(db, "alta@example.com");
    const learner = await seedLearner(db, u, "Marta Alumna");
    const material = await seedMaterial(db, u, analysis);
    const make = (key: string) =>
      createAdaptation({ store, services: (() => undefined) as never }, { workspaceId: u.workspaceId, userId: u.id, materialId: material, storedAnalysis: analysis, learnerProfileId: learner, profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, adaptationType: "accessibility", title: "Marta · fracciones", requestKey: key, versions: versions() });
    const first = await make("misma-clave-123");
    const second = await make("misma-clave-123");
    expect(second.adaptationId).toBe(first.adaptationId);
    const { rows } = await db.query<{ n: string }>("select count(*)::text as n from public.adaptations where material_id = $1", [material]);
    expect(rows[0]!.n).toBe("1");

    const row = (await db.query<{ pipeline_versions: Record<string, unknown>; context_snapshot: unknown; profile_snapshot: unknown; status: string }>("select pipeline_versions, context_snapshot, profile_snapshot, status from public.adaptations where id = $1", [first.adaptationId])).rows[0]!;
    expect(row.status).toBe("queued");
    expect(row.pipeline_versions).toMatchObject({ planner: { prompt_version: 2 }, context_policy: 2, generator: { prompt_version: 2 }, reviewer: { prompt_version: 1 }, analysis_schema: 3, plan_schema: 1, document_schema: 1, review_schema: 1 });
    const stored = JSON.stringify(row.context_snapshot) + JSON.stringify(row.profile_snapshot);
    expect(stored).not.toMatch(/Marta|display_name|contextual_tags|notes|learner/i);
    expect(row.profile_snapshot).toEqual({ minimized: true });
  });

  it("no se crea una adaptación sobre un material sin analizar", async () => {
    const u = await createUser(db, "sinanalisis@example.com");
    const material = await seedMaterial(db, u, analysis, "uploaded");
    await expect(
      createAdaptation({ store, services: (() => undefined) as never }, { workspaceId: u.workspaceId, userId: u.id, materialId: material, storedAnalysis: analysis, learnerProfileId: null, profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, adaptationType: "accessibility", title: "x", requestKey: "sin-analizar-1", versions: versions() }),
    ).rejects.toThrow();
  });
});

describe("cola por etapa: lease, fencing y ambigüedad", () => {
  async function claimed() {
    const u = await createUser(db, `lease-${++counter}@example.com`);
    const { id } = await newAdaptation(u);
    const q = await store.enqueueStage(id, "planning", F("a"), 3);
    return { u, id, q };
  }

  it("encolar es idempotente por etapa; solo hay un job activo; una etapa fuera de su estado se rechaza", async () => {
    const { id, q } = await claimed();
    const again = await store.enqueueStage(id, "planning", F("b"), 3);
    expect(again.jobId).toBe(q.jobId);
    expect(again.reused).toBe(true);
    await expect(store.enqueueStage(id, "generation", F("c"), 3)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("dos procesadores no ejecutan a la vez: el segundo no obtiene el lease; caducado, sí; el intento antiguo queda fuera", async () => {
    const { id, q } = await claimed();
    const first = await store.claimStage(q.jobId, 300, false);
    expect(first?.attempts).toBe(1);
    expect(await store.claimStage(q.jobId, 300, false)).toBeNull();
    await expireLeases(db);
    const second = await store.claimStage(q.jobId, 300, false);
    expect(second?.attempts).toBe(2);
    // The first worker woke up: it can neither complete nor persist anything.
    expect(await store.completeStage(q.jobId, 1)).toBe(false);
    await expect(store.putArtifact(id, { jobId: q.jobId, attempt: 1 }, "planner_draft", F("d"), F("e"), { draft: {} })).rejects.toBeInstanceOf(LeaseLostError);
    expect((await store.putArtifact(id, { jobId: q.jobId, attempt: 2 }, "planner_draft", F("d"), F("e"), { draft: {} })).created).toBe(true);
  });

  it("agotados los intentos el job se cierra y la adaptación pasa a failed", async () => {
    const u = await createUser(db, `exhausted-${++counter}@example.com`);
    const { id } = await newAdaptation(u);
    const q = await store.enqueueStage(id, "planning", F("a"), 1);
    expect(await store.claimStage(q.jobId, 300, false)).not.toBeNull();
    await expireLeases(db);
    expect(await store.claimStage(q.jobId, 300, false)).toBeNull();
    expect(await status(id)).toBe("failed");
  });

  it("un intento con la llamada al proveedor marcada y sin resolver es AMBIGUO al caducar; reconocerlo lo limpia", async () => {
    const { q } = await claimed();
    const first = await store.claimStage(q.jobId, 300, false);
    expect(await store.markProviderCall(q.jobId, first!.attempts)).toBe(true);
    await expireLeases(db);
    const second = await store.claimStage(q.jobId, 300, false);
    expect(second?.ambiguous_previous).toBe(true);
    await expireLeases(db);
    const third = await store.claimStage(q.jobId, 300, true);
    expect(third?.ambiguous_previous).toBe(false);
  });

  it("un fallo reintentable vuelve a la cola con espera; uno final cierra el job", async () => {
    const { id, q } = await claimed();
    const c = await store.claimStage(q.jobId, 300, false);
    expect(await store.failStage(q.jobId, c!.attempts, "provider_transient", true, 600)).toBe("retry");
    expect(await store.claimStage(q.jobId, 300, false)).toBeNull();
    await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where id = $1", [q.jobId]);
    const c2 = await store.claimStage(q.jobId, 300, false);
    expect(await store.failStage(q.jobId, c2!.attempts, "provider_refusal", false, 0)).toBe("failed");
    expect(await status(id)).toBe("failed");
    expect(await store.failStage(q.jobId, c2!.attempts, "x", false, 0)).toBe("ignored");
  });
});

describe("artefactos, versiones y entrega: historial inmutable", () => {
  it("un artefacto no se duplica: misma entrada o mismo contenido devuelve el existente", async () => {
    const u = await createUser(db, "artefactos@example.com");
    const { id } = await newAdaptation(u);
    const a = await store.putArtifact(id, null, "plan", F("1"), F("2"), { x: 1 });
    const b = await store.putArtifact(id, null, "plan", F("1"), F("3"), { x: 2 });
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    const r1 = await store.putArtifact(id, null, "plan_review", F("1"), F("4"), { r: 1 });
    const r2 = await store.putArtifact(id, null, "plan_review", F("1"), F("5"), { r: 2 });
    expect(r2.created).toBe(true);
    expect((await store.listArtifacts(id, "plan_review")).map((x) => x.id)).toEqual([r1.id, r2.id]);
  });

  it("los artefactos no se pueden actualizar ni borrar por un usuario, y no se leen desde otro workspace", async () => {
    const a = await createUser(db, "art-a@example.com");
    const b = await createUser(db, "art-b@example.com");
    const { id } = await newAdaptation(a);
    await store.putArtifact(id, null, "plan", F("7"), F("8"), { x: 1 });
    const mine = await as(db, "authenticated", a.id, () => db.query("select id from public.adaptation_artifacts where adaptation_id = $1", [id]));
    expect(mine.rows).toHaveLength(1);
    const theirs = await as(db, "authenticated", b.id, () => db.query("select id from public.adaptation_artifacts where adaptation_id = $1", [id]));
    expect(theirs.rows).toEqual([]);
    await expect(as(db, "authenticated", a.id, () => db.query("update public.adaptation_artifacts set payload = '{}'::jsonb where adaptation_id = $1", [id]))).rejects.toThrow();
    await expect(as(db, "authenticated", a.id, () => db.query("delete from public.adaptation_artifacts where adaptation_id = $1", [id]))).rejects.toThrow();
  });

  it("una versión nueva no destruye la anterior; la revisión de una versión se escribe una vez; entregar exige ready", async () => {
    const u = await createUser(db, "versiones@example.com");
    const { id } = await newAdaptation(u);
    // Walk the machine like the orchestrator does.
    await store.transition(id, "queued", "planning");
    await store.transition(id, "planning", "awaiting_plan_review");
    await store.transition(id, "awaiting_plan_review", "generation_queued");
    await store.transition(id, "generation_queued", "generating");
    await store.transition(id, "generating", "reviewing_deterministic");
    const v1 = await store.persistVersion(id, null, { schema_version: 1, n: 1 }, { plan: F("a"), review: F("b"), generation: F("c") });
    expect(v1).toMatchObject({ version: 1, created: true });
    expect((await store.persistVersion(id, null, { n: "otra" }, { plan: F("a"), review: F("b"), generation: F("c") })).created).toBe(false);
    await store.transition(id, "reviewing_deterministic", "reviewing_ai");
    const blocked = await store.finalize(id, null, v1.id, { verdict: "blocked" }, "blocked");
    expect(blocked.status).toBe("blocked");
    const row = (await db.query<{ current_version: number; delivered_at: string | null; status: string }>("select current_version, delivered_at, status from public.adaptations where id = $1", [id])).rows[0]!;
    expect(row).toMatchObject({ current_version: 0, delivered_at: null, status: "blocked" });

    await store.transition(id, "blocked", "awaiting_plan_review");
    await store.transition(id, "awaiting_plan_review", "generation_queued");
    await store.transition(id, "generation_queued", "generating");
    await store.transition(id, "generating", "reviewing_deterministic");
    await store.transition(id, "reviewing_deterministic", "reviewing_ai");
    const v2 = await store.persistVersion(id, null, { n: 2 }, { plan: F("a"), review: F("d"), generation: F("e") });
    expect(v2.version).toBe(2);
    await store.finalize(id, null, v2.id, { verdict: "approved_with_warnings" }, "ready");
    const after = (await db.query<{ current_version: number; delivered_at: string | null; status: string }>("select current_version, delivered_at, status from public.adaptations where id = $1", [id])).rows[0]!;
    expect(after).toMatchObject({ current_version: 2, status: "ready" });
    expect(after.delivered_at).not.toBeNull();
    const versionsRows = (await db.query<{ version: number; review: { verdict: string } | null; document: { n: number } }>("select version, review, document from public.adaptation_versions where adaptation_id = $1 order by version", [id])).rows;
    expect(versionsRows.map((v) => [v.version, v.review?.verdict, v.document.n])).toEqual([[1, "blocked", 1], [2, "approved_with_warnings", 2]]);
    // The review of v1 is never rewritten.
    await store.finalize(id, null, v1.id, { verdict: "approved" }, "ready");
    expect((await db.query<{ review: { verdict: string } }>("select review from public.adaptation_versions where id = $1", [v1.id])).rows[0]!.review.verdict).toBe("blocked");
  });
});

describe("ai_runs por etapa y coste", () => {
  it("registra stage, versiones, call_kind y huellas; el mismo intento no se registra dos veces; el coste se agrega por etapa sin mezclar el análisis", async () => {
    const u = await createUser(db, "coste@example.com");
    const { id, material } = await newAdaptation(u);
    const q = await store.enqueueStage(id, "planning", F("9"), 3);
    const c = await store.claimStage(q.jobId, 300, false);
    const v = versions();
    const ids = { workspace_id: u.workspaceId, job_id: q.jobId, adaptation_id: id, material_id: material };
    const row = (purpose: string, over: Record<string, unknown> = {}) => {
      const r = stageRun(purpose as never, v.planner, "adaptation_planner");
      return { ...ids, purpose, model_alias: r.alias, provider: r.provider, model: r.model, prompt_key: r.promptKey, prompt_version: r.promptVersion, effort: r.effort, input_tokens: 1000, output_tokens: 500, cached_input_tokens: 0, cache_creation_input_tokens: 3000, estimated_cost_usd: 0.02, latency_ms: 4000, status: "success", error_code: null, attempt: 1, schema_version: 2, call_kind: "initial", reasoning_tokens: null, input_fingerprint: fp("in"), output_fingerprint: fp("out"), job_attempt: c!.attempts, ...over };
    };
    expect(await store.recordAiRun(row("plan") as never)).toBe(true);
    expect(await store.recordAiRun(row("plan") as never)).toBe(false);
    await store.recordAiRun(row("generate", { estimated_cost_usd: 0.015, input_fingerprint: fp("g") }) as never);
    await store.recordAiRun(row("review", { estimated_cost_usd: null, input_fingerprint: fp("r") }) as never);
    await db.query(
      "insert into public.ai_runs (workspace_id, material_id, purpose, model_alias, provider, model, status, estimated_cost_usd) values ($1, $2, 'analyze', 'STANDARD', 'anthropic', 'm', 'success', 0.055)",
      [u.workspaceId, material],
    );
    const cost = aggregateCost(await store.listAiRuns({ adaptationId: id }), await store.listAiRuns({ materialId: material }));
    expect(cost.planning).toMatchObject({ calls: 1, usd: 0.02 });
    expect(cost.generation).toMatchObject({ calls: 1, usd: 0.015 });
    expect(cost.review).toMatchObject({ calls: 1, usd: 0, unknown: 1 });
    expect(cost.incomplete).toBe(true);
    expect(cost.adaptationTotalUsd).toBeCloseTo(0.035, 6);
    expect(cost.sharedAnalysisUsd).toBeCloseTo(0.055, 6);
    const { rows } = await db.query<{ schema_version: number; call_kind: string; job_attempt: number }>("select schema_version, call_kind, job_attempt from public.ai_runs where adaptation_id = $1 and purpose = 'plan'", [id]);
    expect(rows).toEqual([{ schema_version: 2, call_kind: "initial", job_attempt: c!.attempts }]);
  });
});

describe("aislamiento entre workspaces", () => {
  it("otro usuario no ve la adaptación, sus versiones ni sus trabajos: para él no existen", async () => {
    const a = await createUser(db, "ws-a@example.com");
    const b = await createUser(db, "ws-b@example.com");
    const { id } = await newAdaptation(a);
    const q = await store.enqueueStage(id, "planning", F("f"), 3);
    expect(q.jobId).toBeTruthy();
    for (const table of ["adaptations", "adaptation_jobs"]) {
      const col = table === "adaptations" ? "id" : "adaptation_id";
      const mine = await as(db, "authenticated", a.id, () => db.query(`select 1 from public.${table} where ${col} = $1`, [id]));
      const theirs = await as(db, "authenticated", b.id, () => db.query(`select 1 from public.${table} where ${col} = $1`, [id]));
      expect(mine.rows.length, table).toBeGreaterThan(0);
      expect(theirs.rows, table).toEqual([]);
    }
    await expect(as(db, "authenticated", b.id, () => db.query("select public.get_adaptation_pipeline($1)", [id]))).rejects.toThrow();
  });
});
