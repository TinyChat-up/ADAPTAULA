import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

type User = Awaited<ReturnType<typeof createUser>>;

async function insertMaterial(u: User, status = "uploaded", title = "Ficha") {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.materials (workspace_id, created_by, title, source_type, status) values ($1, $2, $3, 'pdf', $4) returning id",
    [u.workspaceId, u.id, title, status],
  );
  return rows[0]!.id;
}

const service = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);

const enqueue = (material: string, userId: string, maxActive = 3) =>
  service(() =>
    db.query<{ id: string }>("select public.enqueue_analysis_job($1, $2, '{}'::jsonb, $3) as id", [material, userId, maxActive]),
  ).then((r) => r.rows[0]!.id);

const claim = (job: string, lease = 300) =>
  service(() => db.query<{ j: { id: string; attempts: number; status: string } | null }>("select public.claim_analysis_job($1, $2) as j", [job, lease])).then(
    (r) => r.rows[0]!.j,
  );

const statusOf = (table: "materials" | "adaptation_jobs", id: string) =>
  db.query<{ status: string; failure_code?: string }>(`select status from public.${table} where id = $1`, [id]).then((r) => r.rows[0]!.status);

describe("esquema de materiales (Fase 3)", () => {
  it("learner_profiles ya no tiene la columna notes", async () => {
    const { rows } = await db.query("select 1 from information_schema.columns where table_name = 'learner_profiles' and column_name = 'notes'");
    expect(rows).toEqual([]);
  });

  it("learner_profiles ya no tiene la columna contextual_tags (ni su permiso de edición)", async () => {
    const { rows } = await db.query("select 1 from information_schema.columns where table_name = 'learner_profiles' and column_name = 'contextual_tags'");
    expect(rows).toEqual([]);
    const u = await createUser(db, "sin-etiquetas@example.com");
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("insert into public.learner_profiles (workspace_id, display_name, created_by, contextual_tags) values ($1, 'A', $2, '{}')", [u.workspaceId, u.id]),
      ),
    ).rejects.toThrow(/contextual_tags/);
  });

  it("acepta los estados nuevos y rechaza los antiguos", async () => {
    const u = await createUser(db, "estados@example.com");
    for (const status of ["uploading", "uploaded", "queued", "analyzing", "analyzed", "failed"]) {
      await insertMaterial(u, status);
    }
    await expect(insertMaterial(u, "ready")).rejects.toThrow(/materials_status_check/);
  });

  it("ai_runs admite coste desconocido (null) y asocia la llamada al material", async () => {
    const u = await createUser(db, "airuns@example.com");
    const material = await insertMaterial(u);
    await db.query(
      `insert into public.ai_runs (workspace_id, material_id, purpose, model_alias, provider, model, status, estimated_cost_usd)
       values ($1, $2, 'analyze', 'STANDARD', 'anthropic', 'modelo', 'success', null)`,
      [u.workspaceId, material],
    );
    const { rows } = await db.query<{ c: string | null }>("select estimated_cost_usd as c from public.ai_runs where material_id = $1", [material]);
    expect(rows[0]!.c).toBeNull();
  });
});

describe("cola de análisis", () => {
  it("encolar es idempotente y deja el material en 'queued'", async () => {
    const u = await createUser(db, "cola@example.com");
    const material = await insertMaterial(u);
    const first = await enqueue(material, u.id);
    const second = await enqueue(material, u.id);
    expect(second).toBe(first);
    expect(await statusOf("materials", material)).toBe("queued");
    const { rows } = await db.query("select 1 from public.adaptation_jobs where material_id = $1", [material]);
    expect(rows).toHaveLength(1);
  });

  it("no encola materiales que todavía se están subiendo y respeta el máximo de análisis activos", async () => {
    const u = await createUser(db, "limite-cola@example.com");
    const uploading = await insertMaterial(u, "uploading");
    await expect(enqueue(uploading, u.id)).rejects.toThrow(/material_not_ready/);

    await enqueue(await insertMaterial(u), u.id, 2);
    await enqueue(await insertMaterial(u), u.id, 2);
    await expect(enqueue(await insertMaterial(u), u.id, 2)).rejects.toThrow(/analysis_limit_reached/);
  });

  it("el índice único impide dos análisis activos del mismo material aunque se inserte a mano", async () => {
    const u = await createUser(db, "unico@example.com");
    const material = await insertMaterial(u);
    await enqueue(material, u.id);
    await expect(
      db.query("insert into public.adaptation_jobs (workspace_id, material_id, kind, input) values ($1, $2, 'analyze', '{}')", [u.workspaceId, material]),
    ).rejects.toThrow(/adaptation_jobs_one_active_analysis/);
  });

  it("solo un procesador puede reclamar el job; otro lo recupera cuando caduca el lease", async () => {
    const u = await createUser(db, "lease@example.com");
    const material = await insertMaterial(u);
    const job = await enqueue(material, u.id);

    const first = await claim(job);
    expect(first).toMatchObject({ status: "processing", attempts: 1 });
    expect(await statusOf("materials", material)).toBe("analyzing");
    expect(await claim(job)).toBeNull();

    await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where id = $1", [job]);
    expect(await claim(job)).toMatchObject({ attempts: 2 });
  });

  it("un procesador con el lease perdido no puede sobrescribir el resultado del titular actual", async () => {
    const u = await createUser(db, "fencing@example.com");
    const material = await insertMaterial(u);
    const job = await enqueue(material, u.id);
    await claim(job);
    await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where id = $1", [job]);
    await claim(job);

    const complete = (attempt: number, analysis: object) =>
      service(() =>
        db.query<{ ok: boolean }>("select public.complete_analysis_job($1, $2, $3::jsonb, 'v1', '{\"cost\":null}'::jsonb, '{}'::jsonb) as ok", [
          job,
          attempt,
          JSON.stringify(analysis),
        ]),
      ).then((r) => r.rows[0]!.ok);

    expect(await complete(1, { from: "viejo" })).toBe(false);
    expect(await complete(2, { from: "actual" })).toBe(true);

    const { rows } = await db.query<{ status: string; analysis: { from: string }; analysis_prompt_version: string }>(
      "select status, analysis, analysis_prompt_version from public.materials where id = $1",
      [material],
    );
    expect(rows[0]).toMatchObject({ status: "analyzed", analysis: { from: "actual" }, analysis_prompt_version: "v1" });
    expect(await statusOf("adaptation_jobs", job)).toBe("completed");
    expect(await complete(2, { from: "otra vez" })).toBe(false);
  });

  it("guarda un análisis v3 tal cual y se lee igual, y un análisis v2 antiguo sigue en su fila sin tocar", async () => {
    const u = await createUser(db, "v3-guardado@example.com");
    const complete = (material: string, analysis: object, schemaVersion: number, prompt: string) =>
      enqueue(material, u.id).then(async (job) => {
        await claim(job);
        await service(() =>
          db.query("select public.complete_analysis_job($1, 1, $2::jsonb, $3, $4::jsonb, '{}'::jsonb)", [job, JSON.stringify(analysis), prompt, JSON.stringify({ schema_version: schemaVersion })]),
        );
      });
    const v3 = { schema_version: 3, activities: [{ id: "act_1", expected_answer: { basis: "inferred", value: "5/6" } }] };
    const v2 = { schema_version: 2, activities: [{ id: "act_1", content: "x" }] };
    const first = await insertMaterial(u, "uploaded", "Ficha v3");
    const second = await insertMaterial(u, "uploaded", "Ficha v2");
    await complete(first, v3, 3, "material_analyzer@v2");
    await complete(second, v2, 2, "material_analyzer@v1");
    const { rows } = await db.query<{ id: string; analysis: unknown; analysis_prompt_version: string; analysis_meta: { schema_version: number } }>(
      "select id, analysis, analysis_prompt_version, analysis_meta from public.materials where id in ($1, $2)",
      [first, second],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[first]).toMatchObject({ analysis: v3, analysis_prompt_version: "material_analyzer@v2", analysis_meta: { schema_version: 3 } });
    expect(byId[second]).toMatchObject({ analysis: v2, analysis_prompt_version: "material_analyzer@v1", analysis_meta: { schema_version: 2 } });
  });

  it("lo detectado rellena solo los campos sin confirmar: el contexto del docente nunca se pisa", async () => {
    const u = await createUser(db, "contexto@example.com");
    const material = await insertMaterial(u, "uploaded", "ficha-escaneada");
    await db.query("update public.materials set stage_slug = 'eso', topic = 'Mi tema', confirmed_fields = array['stage','topic'] where id = $1", [material]);
    const job = await enqueue(material, u.id);
    await claim(job);
    const context = JSON.stringify({ title: "Fracciones", stage: "primaria", grade: "5-primaria", subject: "matematicas", topic: "Otro tema" });
    await service(() =>
      db.query("select public.complete_analysis_job($1, 1, '{}'::jsonb, 'v1', '{}'::jsonb, $2::jsonb)", [job, context]),
    );
    const { rows } = await db.query<Record<string, string>>(
      "select title, stage_slug, grade_slug, subject_slug, topic from public.materials where id = $1",
      [material],
    );
    expect(rows[0]).toEqual({ title: "Fracciones", stage_slug: "eso", grade_slug: "5-primaria", subject_slug: "matematicas", topic: "Mi tema" });
  });

  it("un fallo reintentable vuelve a la cola con espera; uno definitivo cierra el job y marca el material", async () => {
    const u = await createUser(db, "fallos@example.com");
    const material = await insertMaterial(u);
    const job = await enqueue(material, u.id);
    await claim(job);

    const fail = (attempt: number, retryable: boolean) =>
      service(() => db.query<{ r: string }>("select public.fail_analysis_job($1, $2, 'provider_unavailable', $3, 60) as r", [job, attempt, retryable])).then(
        (r) => r.rows[0]!.r,
      );

    expect(await fail(1, true)).toBe("retry");
    expect(await statusOf("adaptation_jobs", job)).toBe("queued");
    expect(await claim(job)).toBeNull(); // todavía en espera

    await db.query("update public.adaptation_jobs set locked_until = null where id = $1", [job]);
    expect(await claim(job)).toMatchObject({ attempts: 2 });
    expect(await fail(2, false)).toBe("failed");
    expect(await statusOf("materials", material)).toBe("failed");
    const { rows } = await db.query<{ failure_code: string }>("select failure_code from public.materials where id = $1", [material]);
    expect(rows[0]!.failure_code).toBe("provider_unavailable");
    expect(await fail(2, false)).toBe("ignored");
  });

  it("agotados los intentos, el job se cierra como fallido", async () => {
    const u = await createUser(db, "agotado@example.com");
    const material = await insertMaterial(u);
    const job = await enqueue(material, u.id);
    for (let i = 0; i < 3; i++) {
      await claim(job);
      await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where id = $1", [job]);
    }
    expect(await claim(job)).toBeNull();
    expect(await statusOf("adaptation_jobs", job)).toBe("failed");
    expect(await statusOf("materials", material)).toBe("failed");
  });

  it("un reanálisis fallido conserva el análisis anterior", async () => {
    const u = await createUser(db, "reanalisis@example.com");
    const material = await insertMaterial(u, "analyzed");
    await db.query("update public.materials set analysis = '{\"ok\":true}' where id = $1", [material]);
    const job = await enqueue(material, u.id);
    await claim(job);
    await service(() => db.query("select public.fail_analysis_job($1, 1, 'invalid_output', false, 0)", [job]));
    const { rows } = await db.query<{ status: string; analysis: unknown }>("select status, analysis from public.materials where id = $1", [material]);
    expect(rows[0]).toEqual({ status: "analyzed", analysis: { ok: true } });
  });
});

const usageOf = (u: User) =>
  as(db, "authenticated", u.id, () =>
    db.query<{ u: { analyses: { used: number; limit: number }; adaptations: { used: number; limit: number }; plan: { slug: string } } }>(
      "select public.workspace_usage($1) as u",
      [u.workspaceId],
    ),
  ).then((r) => r.rows[0]!.u);

const jobsOf = (u: User) => db.query("select 1 from public.adaptation_jobs where workspace_id = $1", [u.workspaceId]).then((r) => r.rows.length);

describe("cuota mensual de análisis (monthly_analyses)", () => {
  it("los límites iniciales viven en los planes: Free 10, Pro 100, Max 250", async () => {
    const { rows } = await db.query<{ slug: string; n: number }>(
      "select slug, (features ->> 'monthly_analyses')::int as n from public.plans where slug in ('free', 'pro', 'max') order by sort_order",
    );
    expect(rows).toEqual([
      { slug: "free", n: 10 },
      { slug: "pro", n: 100 },
      { slug: "max", n: 250 },
    ]);
  });

  it("encolar reserva una unidad y la UI la ve en workspace_usage", async () => {
    const u = await createUser(db, "cuota-analisis@example.com");
    expect((await usageOf(u)).analyses).toEqual({ used: 0, limit: 10 });
    const job = await enqueue(await insertMaterial(u), u.id);
    expect((await usageOf(u)).analyses).toEqual({ used: 1, limit: 10 });
    const { rows } = await db.query<{ kind: string; units: number; job_id: string; user_id: string }>(
      "select kind, units, job_id, user_id from public.usage_events where workspace_id = $1",
      [u.workspaceId],
    );
    expect(rows).toEqual([{ kind: "analysis", units: 1, job_id: job, user_id: u.id }]);
  });

  it("Free permite 10 análisis al mes y la undécima petición no crea ningún job ni cambia el material", async () => {
    const u = await createUser(db, "cuota-agotada@example.com");
    for (let i = 0; i < 10; i++) await enqueue(await insertMaterial(u), u.id, 50);
    const extra = await insertMaterial(u);
    await expect(enqueue(extra, u.id, 50)).rejects.toThrow(/analysis_quota_exceeded/);
    expect(await jobsOf(u)).toBe(10);
    expect(await statusOf("materials", extra)).toBe("uploaded");
    expect((await usageOf(u)).analyses).toEqual({ used: 10, limit: 10 });
  });

  it("peticiones simultáneas nunca superan el límite", async () => {
    const u = await createUser(db, "cuota-carrera@example.com");
    const materials = await Promise.all(Array.from({ length: 14 }, () => insertMaterial(u)));
    const results = await Promise.allSettled(materials.map((m) => enqueue(m, u.id, 50)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
    expect((await usageOf(u)).analyses.used).toBe(10);
  });

  it("encolar dos veces el mismo material reserva una sola unidad", async () => {
    const u = await createUser(db, "cuota-idempotente@example.com");
    const material = await insertMaterial(u);
    expect(await enqueue(material, u.id)).toBe(await enqueue(material, u.id));
    expect((await usageOf(u)).analyses.used).toBe(1);
  });

  it("no es la cuota de adaptaciones: cada una agota la suya sin tocar la otra", async () => {
    const u = await createUser(db, "cuota-independiente@example.com");
    await enqueue(await insertMaterial(u), u.id);
    let usage = await usageOf(u);
    expect(usage.adaptations.used).toBe(0);

    for (let i = 1; i <= 5; i++) {
      await service(() => db.query("select public.consume_quota($1, 'adaptation', 1, null, null, $2)", [u.workspaceId, `adapt:${u.id}:${i}`]));
    }
    usage = await usageOf(u);
    expect(usage).toMatchObject({ adaptations: { used: 5, limit: 5 }, analyses: { used: 1, limit: 10 } });
    await enqueue(await insertMaterial(u), u.id); // las adaptaciones agotadas no bloquean el análisis
    expect((await usageOf(u)).analyses.used).toBe(2);
  });

  it("un análisis entregado conserva su unidad consumida", async () => {
    const u = await createUser(db, "cuota-entregado@example.com");
    const material = await insertMaterial(u);
    const job = await enqueue(material, u.id);
    await claim(job);
    await service(() => db.query("select public.complete_analysis_job($1, 1, '{}'::jsonb, 'v1', '{}'::jsonb, '{}'::jsonb)", [job]));
    expect((await usageOf(u)).analyses.used).toBe(1);
  });

  it("un fallo reintentable no devuelve la unidad; el fallo definitivo, sí, y una sola vez", async () => {
    const u = await createUser(db, "cuota-devuelta@example.com");
    const material = await insertMaterial(u);
    const job = await enqueue(material, u.id);
    await claim(job);
    const fail = (attempt: number, retryable: boolean) =>
      service(() => db.query<{ r: string }>("select public.fail_analysis_job($1, $2, 'provider_unavailable', $3, 0) as r", [job, attempt, retryable])).then((r) => r.rows[0]!.r);

    expect(await fail(1, true)).toBe("retry");
    expect((await usageOf(u)).analyses.used).toBe(1);

    await claim(job);
    expect(await fail(2, false)).toBe("failed");
    expect((await usageOf(u)).analyses.used).toBe(0);
    expect(await fail(2, false)).toBe("ignored");
    expect((await usageOf(u)).analyses.used).toBe(0);
  });

  it("agotados los intentos, la unidad también se devuelve", async () => {
    const u = await createUser(db, "cuota-agotados@example.com");
    const job = await enqueue(await insertMaterial(u), u.id);
    for (let i = 0; i < 3; i++) {
      await claim(job);
      await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where id = $1", [job]);
    }
    expect(await claim(job)).toBeNull();
    expect((await usageOf(u)).analyses.used).toBe(0);
  });

  it("un reanálisis fallido devuelve su unidad y conserva el análisis previo", async () => {
    const u = await createUser(db, "cuota-reanalisis@example.com");
    const material = await insertMaterial(u, "analyzed");
    await db.query("update public.materials set analysis = '{\"ok\":true}' where id = $1", [material]);
    const job = await enqueue(material, u.id);
    expect((await usageOf(u)).analyses.used).toBe(1);
    await claim(job);
    await service(() => db.query("select public.fail_analysis_job($1, 1, 'refusal', false, 0)", [job]));
    expect((await usageOf(u)).analyses.used).toBe(0);
    expect(await statusOf("materials", material)).toBe("analyzed");
  });

  it("devolver la unidad libera cupo: se puede volver a analizar tras agotar el límite con fallos", async () => {
    const u = await createUser(db, "cuota-libera@example.com");
    const jobs: string[] = [];
    for (let i = 0; i < 10; i++) jobs.push(await enqueue(await insertMaterial(u), u.id, 50));
    await expect(enqueue(await insertMaterial(u), u.id, 50)).rejects.toThrow(/analysis_quota_exceeded/);
    await claim(jobs[0]!);
    await service(() => db.query("select public.fail_analysis_job($1, 1, 'refusal', false, 0)", [jobs[0]]));
    await enqueue(await insertMaterial(u), u.id, 50);
    expect((await usageOf(u)).analyses.used).toBe(10);
  });

  it("el indicador force del reanálisis viaja hasta el job reclamado (de ahí sale forced_reanalysis)", async () => {
    const u = await createUser(db, "cuota-force@example.com");
    const material = await insertMaterial(u, "analyzed");
    const job = await service(() =>
      db.query<{ id: string }>("select public.enqueue_analysis_job($1, $2, '{\"force\": true, \"prompt_version\": 1}'::jsonb, 3) as id", [material, u.id]),
    ).then((r) => r.rows[0]!.id);
    const claimed = await service(() => db.query<{ j: { input: { force?: boolean } } }>("select public.claim_analysis_job($1, 300) as j", [job]));
    expect(claimed.rows[0]!.j.input.force).toBe(true);
  });

  it("el límite sale del plan activo: Pro permite 100", async () => {
    const u = await createUser(db, "cuota-pro@example.com");
    await db.query(
      `insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status, period_start, period_end)
       select $1, 'sub_analisis_pro', 'price_test', id, 'month', 'active', now() - interval '3 days', now() + interval '27 days'
       from public.plans where slug = 'pro'`,
      [u.workspaceId],
    );
    expect((await usageOf(u)).analyses.limit).toBe(100);
    for (let i = 0; i < 11; i++) await enqueue(await insertMaterial(u), u.id, 50);
    expect((await usageOf(u)).analyses).toEqual({ used: 11, limit: 100 });
  });

  it("un plan sin monthly_analyses no permite analizar (falla cerrado)", async () => {
    const u = await createUser(db, "cuota-sin-clave@example.com");
    const { rows } = await db.query<{ id: string }>(
      "insert into public.plans (slug, name, monthly_adaptations, max_profiles, max_classes, features) values ('sin-analisis', 'Sin análisis', 5, 2, 0, '{}') returning id",
    );
    await db.query(
      `insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status, period_start, period_end)
       values ($1, 'sub_sin_analisis', 'price_x', $2, 'month', 'active', now() - interval '1 day', now() + interval '29 days')`,
      [u.workspaceId, rows[0]!.id],
    );
    await expect(enqueue(await insertMaterial(u), u.id)).rejects.toThrow(/analysis_quota_exceeded/);
  });

  it("los usuarios no pueden insertar movimientos de uso directamente", async () => {
    const u = await createUser(db, "cuota-directa@example.com");
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("insert into public.usage_events (workspace_id, kind, units, idempotency_key) values ($1, 'analysis', -5, 'trampa')", [u.workspaceId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("permisos y aislamiento", () => {
  it("las funciones de la cola no son accesibles para usuarios ni anónimos", async () => {
    const u = await createUser(db, "func@example.com");
    const material = await insertMaterial(u);
    for (const role of ["authenticated", "anon"] as const) {
      await expect(
        as(db, role, role === "anon" ? null : u.id, () => db.query("select public.enqueue_analysis_job($1, $2, '{}'::jsonb, 3)", [material, u.id])),
        role,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("un usuario del workspace A no ve ni toca materiales, ficheros ni jobs del workspace B", async () => {
    const a = await createUser(db, "mat-a@example.com");
    const b = await createUser(db, "mat-b@example.com");
    const material = await insertMaterial(a);
    await enqueue(material, a.id);

    for (const table of ["materials", "adaptation_jobs"]) {
      const seen = await as(db, "authenticated", b.id, () => db.query(`select id from public.${table}`));
      expect(seen.rows, table).toEqual([]);
    }
    const hacked = await as(db, "authenticated", b.id, () =>
      db.query("update public.materials set title = 'hackeado' where id = $1 returning id", [material]),
    );
    expect(hacked.rows).toEqual([]);
    const deleted = await as(db, "authenticated", b.id, () => db.query("delete from public.materials where id = $1 returning id", [material]));
    expect(deleted.rows).toEqual([]);

    await expect(
      as(db, "authenticated", b.id, () =>
        db.query("insert into public.materials (workspace_id, created_by, title, source_type) values ($1, $2, 'intruso', 'pdf')", [a.workspaceId, b.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("el docente corrige el contexto pero no puede cambiar estado, análisis ni hash", async () => {
    const u = await createUser(db, "ctx@example.com");
    const material = await insertMaterial(u, "analyzed");
    await as(db, "authenticated", u.id, () =>
      db.query("update public.materials set stage_slug = 'primaria', topic = 'Fracciones', confirmed_fields = array['stage','topic'] where id = $1", [material]),
    );
    for (const column of ["status = 'uploaded'", "analysis = '{}'", "content_hash = repeat('a', 64)", "analysis_meta = '{}'"]) {
      await expect(
        as(db, "authenticated", u.id, () => db.query(`update public.materials set ${column} where id = $1`, [material])),
        column,
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      as(db, "authenticated", u.id, () => db.query("update public.materials set confirmed_fields = array['analysis'] where id = $1", [material])),
    ).rejects.toThrow(/confirmed_fields_check/);
  });

  it("un viewer no puede crear materiales", async () => {
    const owner = await createUser(db, "mat-owner@example.com");
    const viewer = await createUser(db, "mat-viewer@example.com");
    await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [owner.workspaceId, viewer.id]);
    await expect(
      as(db, "authenticated", viewer.id, () =>
        db.query("insert into public.materials (workspace_id, created_by, title, source_type) values ($1, $2, 'x', 'pdf')", [owner.workspaceId, viewer.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("un usuario no puede crear un material directamente como 'analyzed' ni con análisis", async () => {
    const u = await createUser(db, "directo-mat@example.com");
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("insert into public.materials (workspace_id, created_by, title, source_type, status) values ($1, $2, 'x', 'pdf', 'analyzed')", [u.workspaceId, u.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("borrado seguro", () => {
  it("un material con adaptaciones no se puede borrar; uno sin ellas sí, y arrastra sus ficheros y jobs", async () => {
    const u = await createUser(db, "borrado@example.com");
    const withAdaptation = await insertMaterial(u, "analyzed", "Con adaptación");
    await db.query(
      "insert into public.adaptations (workspace_id, material_id, title, adaptation_type, profile_snapshot) values ($1, $2, 'A', 'accessibility', '{}')",
      [u.workspaceId, withAdaptation],
    );
    await expect(
      as(db, "authenticated", u.id, () => db.query("delete from public.materials where id = $1", [withAdaptation])),
    ).rejects.toThrow(/adaptations_material_id_fkey/);

    const plain = await insertMaterial(u, "uploaded", "Sin adaptación");
    await db.query(
      "insert into public.material_files (material_id, workspace_id, bucket, storage_path, mime_type, size_bytes) values ($1, $2, 'source-materials', $3, 'application/pdf', 10)",
      [plain, u.workspaceId, `${u.workspaceId}/${u.id}/${plain}/f.pdf`],
    );
    await enqueue(plain, u.id);
    await as(db, "authenticated", u.id, () => db.query("delete from public.materials where id = $1", [plain]));
    for (const table of ["material_files", "adaptation_jobs"]) {
      const { rows } = await db.query(`select 1 from public.${table} where material_id = $1`, [plain]);
      expect(rows, table).toEqual([]);
    }
  });
});

describe("storage: aislamiento de ficheros de materiales", () => {
  it("solo los miembros leen los objetos de su workspace, también con ruta workspace/usuario/material/fichero", async () => {
    const a = await createUser(db, "stor-a@example.com");
    const b = await createUser(db, "stor-b@example.com");
    const path = `${a.workspaceId}/${a.id}/m1/0f3e.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('source-materials', $1)", [path]);
    const list = (id: string) => as(db, "authenticated", id, () => db.query<{ name: string }>("select name from storage.objects"));
    expect((await list(a.id)).rows).toEqual([{ name: path }]);
    expect((await list(b.id)).rows).toEqual([]);
  });

  it("los usuarios no pueden escribir ni borrar objetos directamente", async () => {
    const a = await createUser(db, "stor-w@example.com");
    const path = `${a.workspaceId}/${a.id}/m1/1.pdf`;
    await expect(
      as(db, "authenticated", a.id, () => db.query("insert into storage.objects (bucket_id, name) values ('source-materials', $1)", [path])),
    ).rejects.toThrow(/row-level security/);
    await db.query("insert into storage.objects (bucket_id, name) values ('source-materials', $1)", [path]);
    const deleted = await as(db, "authenticated", a.id, () => db.query("delete from storage.objects where name = $1 returning name", [path]));
    expect(deleted.rows).toEqual([]);
  });
});
