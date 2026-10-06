import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { SEED_FILE, as, createTestDb, createUser } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

async function insertProfile(workspaceId: string, userId: string, name: string) {
  return db.query<{ id: string }>(
    "insert into public.learner_profiles (workspace_id, display_name, created_by) values ($1, $2, $3) returning id",
    [workspaceId, name, userId],
  );
}

describe("migraciones y seed", () => {
  it("el seed es idempotente", async () => {
    await db.exec(readFileSync(SEED_FILE, "utf8"));
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.plans");
    expect(rows[0]!.n).toBe(3);
  });

  it("todas las tablas de public tienen RLS activado", async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
});

describe("alta de usuario", () => {
  it("crea perfil, workspace personal y membresía owner", async () => {
    const u = await createUser(db, "alta@example.com", "Ana");
    const { rows } = await db.query<{ full_name: string; type: string; role: string }>(
      `select p.full_name, w.type, m.role from public.profiles p
       join public.workspace_members m on m.user_id = p.id
       join public.workspaces w on w.id = m.workspace_id where p.id = $1`,
      [u.id],
    );
    expect(rows).toEqual([{ full_name: "Ana", type: "personal", role: "owner" }]);
  });
});

describe("aprovisionamiento de usuario", () => {
  const countWorkspaces = (userId: string) =>
    db
      .query<{ n: number }>("select count(*)::int as n from public.workspaces where owner_id = $1 and type = 'personal'", [userId])
      .then((r) => r.rows[0]!.n);

  it("ensure_personal_workspace repara un usuario sin workspace y es idempotente", async () => {
    const u = await createUser(db, "reparar@example.com", "Rosa");
    await db.query("delete from public.workspace_members where user_id = $1", [u.id]);
    await db.query("delete from public.workspaces where owner_id = $1", [u.id]);
    expect(await countWorkspaces(u.id)).toBe(0);

    const first = await as(db, "authenticated", u.id, () => db.query<{ id: string }>("select public.ensure_personal_workspace() as id"));
    const second = await as(db, "authenticated", u.id, () => db.query<{ id: string }>("select public.ensure_personal_workspace() as id"));
    expect(second.rows[0]!.id).toBe(first.rows[0]!.id);
    expect(await countWorkspaces(u.id)).toBe(1);

    const role = await db.query<{ role: string }>("select role from public.workspace_members where user_id = $1", [u.id]);
    expect(role.rows).toEqual([{ role: "owner" }]);
  });

  it("no permite un segundo workspace personal para la misma persona", async () => {
    const u = await createUser(db, "doble@example.com");
    await expect(
      db.query("insert into public.workspaces (name, type, owner_id) values ('otro', 'personal', $1)", [u.id]),
    ).rejects.toThrow(/workspaces_one_personal_per_owner/);
    await db.query("insert into public.workspaces (name, type, owner_id) values ('Colegio', 'school', $1)", [u.id]);
  });

  it("anon no puede aprovisionar y nadie puede llamar a provision_user", async () => {
    const u = await createUser(db, "prov@example.com");
    await expect(as(db, "anon", null, () => db.query("select public.ensure_personal_workspace()"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(db, "authenticated", u.id, () => db.query("select public.provision_user($1, 'x')", [u.id])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("aislamiento entre workspaces (RLS)", () => {
  it("un usuario no ve ni modifica datos de otro workspace", async () => {
    const a = await createUser(db, "a@example.com");
    const b = await createUser(db, "b@example.com");
    await as(db, "authenticated", a.id, () => insertProfile(a.workspaceId, a.id, "AL"));

    const seenByB = await as(db, "authenticated", b.id, () =>
      db.query("select id from public.learner_profiles where workspace_id = $1", [a.workspaceId]),
    );
    expect(seenByB.rows).toEqual([]);

    const workspacesSeenByB = await as(db, "authenticated", b.id, () => db.query("select id from public.workspaces"));
    expect(workspacesSeenByB.rows).toEqual([{ id: b.workspaceId }]);

    await expect(
      as(db, "authenticated", b.id, () => insertProfile(a.workspaceId, b.id, "intruso")),
    ).rejects.toThrow(/row-level security/);

    const renamed = await as(db, "authenticated", b.id, () =>
      db.query("update public.workspaces set name = 'hackeado' where id = $1 returning id", [a.workspaceId]),
    );
    expect(renamed.rows).toEqual([]);

    await expect(
      as(db, "authenticated", b.id, () => db.query("select public.workspace_usage($1)", [a.workspaceId])),
    ).rejects.toThrow(/forbidden/);
  });

  it("anon no lee datos de negocio pero sí el catálogo y los planes", async () => {
    await expect(as(db, "anon", null, () => db.query("select * from public.learner_profiles"))).rejects.toThrow(
      /permission denied/,
    );
    const plans = await as(db, "anon", null, () => db.query("select slug from public.plans order by sort_order"));
    expect(plans.rows).toEqual([{ slug: "free" }, { slug: "pro" }, { slug: "max" }]);
  });

  it("las tablas internas no son accesibles para usuarios autenticados", async () => {
    const u = await createUser(db, "interno@example.com");
    for (const table of ["ai_runs", "prompt_versions", "app_settings", "stripe_events", "audit_logs", "system_admins"]) {
      await expect(
        as(db, "authenticated", u.id, () => db.query(`select * from public.${table}`)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("un usuario solo puede editar columnas permitidas de su propio perfil", async () => {
    const u = await createUser(db, "perfil@example.com");
    const other = await createUser(db, "otro@example.com");
    await as(db, "authenticated", u.id, () =>
      db.query("update public.profiles set full_name = 'Nuevo', onboarding_completed = true where id = $1", [u.id]),
    );
    const { rows } = await db.query<{ full_name: string }>("select full_name from public.profiles where id = $1", [u.id]);
    expect(rows[0]!.full_name).toBe("Nuevo");

    const touched = await as(db, "authenticated", u.id, () =>
      db.query("update public.profiles set full_name = 'X' where id = $1 returning id", [other.id]),
    );
    expect(touched.rows).toEqual([]);

    await expect(
      as(db, "authenticated", u.id, () => db.query("update public.profiles set created_at = now() where id = $1", [u.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("un usuario no puede crear workspaces ni hacerse miembro de otro", async () => {
    const u = await createUser(db, "ws@example.com");
    const victim = await createUser(db, "victima@example.com");
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("insert into public.workspaces (name, owner_id) values ('x', $1)", [u.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [
          victim.workspaceId,
          u.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("viewer lee pero no escribe", async () => {
    const owner = await createUser(db, "owner@example.com");
    const viewer = await createUser(db, "viewer@example.com");
    await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [
      owner.workspaceId,
      viewer.id,
    ]);
    await as(db, "authenticated", owner.id, () => insertProfile(owner.workspaceId, owner.id, "MR"));

    const seen = await as(db, "authenticated", viewer.id, () =>
      db.query("select display_name from public.learner_profiles where workspace_id = $1", [owner.workspaceId]),
    );
    expect(seen.rows).toEqual([{ display_name: "MR" }]);

    await expect(
      as(db, "authenticated", viewer.id, () => insertProfile(owner.workspaceId, viewer.id, "NO")),
    ).rejects.toThrow(/row-level security/);
  });

  it("impide relacionar registros de workspaces distintos", async () => {
    const a = await createUser(db, "mix-a@example.com");
    const b = await createUser(db, "mix-b@example.com");
    await db.query("update public.plans set max_classes = 5 where slug = 'free'");
    try {
      const cls = await db.query<{ id: string }>(
        "insert into public.classes (workspace_id, name, created_by) values ($1, '5ºA', $2) returning id",
        [a.workspaceId, a.id],
      );
      const prof = await insertProfile(b.workspaceId, b.id, "JP");
      await expect(
        db.query("insert into public.class_learners (class_id, learner_profile_id, workspace_id) values ($1, $2, $3)", [
          cls.rows[0]!.id,
          prof.rows[0]!.id,
          a.workspaceId,
        ]),
      ).rejects.toThrow(/workspace_mismatch/);
    } finally {
      await db.query("update public.plans set max_classes = 0 where slug = 'free'");
    }
  });
});

describe("límites del plan en base de datos", () => {
  it("Free permite 2 perfiles activos; archivar libera hueco y desarchivar respeta el límite", async () => {
    const u = await createUser(db, "limite@example.com");
    const run = <T>(fn: () => Promise<T>) => as(db, "authenticated", u.id, fn);

    const first = await run(() => insertProfile(u.workspaceId, u.id, "P1"));
    await run(() => insertProfile(u.workspaceId, u.id, "P2"));
    await expect(run(() => insertProfile(u.workspaceId, u.id, "P3"))).rejects.toThrow(/limit_reached:profiles/);

    await run(() =>
      db.query("update public.learner_profiles set archived_at = now() where id = $1", [first.rows[0]!.id]),
    );
    await run(() => insertProfile(u.workspaceId, u.id, "P3"));

    await expect(
      run(() => db.query("update public.learner_profiles set archived_at = null where id = $1", [first.rows[0]!.id])),
    ).rejects.toThrow(/limit_reached:profiles/);
  });

  it("Free no permite clases", async () => {
    const u = await createUser(db, "clases@example.com");
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("insert into public.classes (workspace_id, name, created_by) values ($1, '5ºA', $2)", [
          u.workspaceId,
          u.id,
        ]),
      ),
    ).rejects.toThrow(/limit_reached:classes/);
  });
});

describe("cuotas", () => {
  const consume = (ws: string, key: string, units = 1) =>
    as(db, "service_role", null, () =>
      db.query<{ r: { allowed: boolean; used: number; limit: number; duplicate?: boolean } }>(
        "select public.consume_quota($1, 'adaptation', $2, null, null, $3) as r",
        [ws, units, key],
      ),
    ).then((res) => res.rows[0]!.r);

  it("Free permite 5 adaptaciones al mes y bloquea la sexta", async () => {
    const u = await createUser(db, "cuota@example.com");
    for (let i = 1; i <= 5; i++) {
      expect(await consume(u.workspaceId, `reserve:${u.id}:${i}`)).toMatchObject({ allowed: true, used: i, limit: 5 });
    }
    expect(await consume(u.workspaceId, `reserve:${u.id}:6`)).toMatchObject({ allowed: false, used: 5, limit: 5 });
  });

  it("la reserva y la devolución son idempotentes", async () => {
    const u = await createUser(db, "idem@example.com");
    const key = `reserve:${u.id}:x`;
    await consume(u.workspaceId, key, 2);
    expect(await consume(u.workspaceId, key, 2)).toMatchObject({ allowed: true, duplicate: true, used: 2 });

    const refund = () =>
      as(db, "service_role", null, () => db.query("select public.refund_quota($1)", [key]));
    await refund();
    await refund();

    const usage = await as(db, "authenticated", u.id, () =>
      db.query<{ u: { adaptations: { used: number } } }>("select public.workspace_usage($1) as u", [u.workspaceId]),
    );
    expect(usage.rows[0]!.u.adaptations.used).toBe(0);
  });

  it("los usuarios no pueden reservar ni devolver cuota directamente", async () => {
    const u = await createUser(db, "directo@example.com");
    await expect(
      as(db, "authenticated", u.id, () =>
        db.query("select public.consume_quota($1, 'adaptation', 1, null, null, 'k')", [u.workspaceId]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, "authenticated", u.id, () => db.query("select public.refund_quota('k')")),
    ).rejects.toThrow(/permission denied/);
  });

  it("una suscripción activa a Pro sube el límite a 75", async () => {
    const u = await createUser(db, "pro@example.com");
    await db.query(
      `insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval,
         status, period_start, period_end)
       select $1, 'sub_test_pro', 'price_test', id, 'month', 'active', now() - interval '3 days', now() + interval '27 days'
       from public.plans where slug = 'pro'`,
      [u.workspaceId],
    );
    expect(await consume(u.workspaceId, `reserve:${u.id}:1`)).toMatchObject({ allowed: true, limit: 75 });

    await db.query("update public.subscriptions set status = 'canceled' where workspace_id = $1", [u.workspaceId]);
    expect(await consume(u.workspaceId, `reserve:${u.id}:2`)).toMatchObject({ limit: 5 });
  });
});

describe("periodo de cuota", () => {
  const period = (ws: string, at: string) =>
    db
      .query<{ period_start: Date; period_end: Date }>("select * from public.current_period($1, $2::timestamptz)", [ws, at])
      .then((r) => ({ start: r.rows[0]!.period_start.toISOString(), end: r.rows[0]!.period_end.toISOString() }));

  it("Free usa el mes natural en Europe/Madrid", async () => {
    const u = await createUser(db, "periodo-free@example.com");
    // 31 mar 23:30 UTC = 1 abr 01:30 en Madrid (horario de verano).
    expect(await period(u.workspaceId, "2026-03-31T23:30:00Z")).toEqual({
      start: "2026-03-31T22:00:00.000Z",
      end: "2026-04-30T22:00:00.000Z",
    });
  });

  it("el plan anual reinicia mensualmente anclado al día de alta", async () => {
    const u = await createUser(db, "periodo-anual@example.com");
    await db.query(
      `insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval,
         status, period_start, period_end)
       select $1, 'sub_test_annual', 'price_test', id, 'year', 'active', '2026-01-31T10:00:00Z', '2027-01-31T10:00:00Z'
       from public.plans where slug = 'pro'`,
      [u.workspaceId],
    );
    const p = await period(u.workspaceId, "2026-03-30T12:00:00Z");
    expect(p).toEqual({ start: "2026-02-28T10:00:00.000Z", end: "2026-03-31T10:00:00.000Z" });
  });
});

describe("storage", () => {
  it("solo los miembros leen los objetos de su workspace y las rutas malformadas no rompen la política", async () => {
    const a = await createUser(db, "st-a@example.com");
    const b = await createUser(db, "st-b@example.com");
    await db.query(
      "insert into storage.objects (bucket_id, name) values ('source-materials', $1), ('source-materials', 'no-es-uuid/x.pdf')",
      [`${a.workspaceId}/m1/ficha.pdf`],
    );
    const list = (userId: string) =>
      as(db, "authenticated", userId, () => db.query<{ name: string }>("select name from storage.objects"));

    expect((await list(a.id)).rows).toEqual([{ name: `${a.workspaceId}/m1/ficha.pdf` }]);
    expect((await list(b.id)).rows).toEqual([]);
  });
});
