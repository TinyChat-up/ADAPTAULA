import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveLimits } from "@/lib/materials/config";
import { applyMigration, as, createTestDb, createUser, migrationFiles } from "./harness";

let db: PGlite;
const migration = migrationFiles().find((f) => f.includes("02600"))!;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => { await db?.close(); });

describe("política comercial 4A", () => {
  for (const [slug, adaptations, analyses, profiles, pages, price] of [
    ["free", 1, 2, 2, 5, 0], ["pro", 15, 30, 30, 15, 2490], ["max", 30, 50, 100, 25, 4990],
  ] as const) {
    it(`${slug}: contrato persistido, cuotas separadas, reintentos y aislamiento`, async () => {
      const u = await createUser(db, `${slug}@example.com`);
      if (slug !== "free") await db.query(`insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status)
        select $1, $2, 'price_fixture', id, 'month', 'active' from public.plans where slug=$3`, [u.workspaceId, `sub_fixture_${slug}`, slug]);
      const plan = (await db.query<{ max_profiles: number; monthly_price_cents: number; monthly_images: number; features: { max_pages_per_material: number } }>("select * from public.plans where slug=$1", [slug])).rows[0]!;
      expect(plan.max_profiles).toBe(profiles);
      expect(plan.monthly_price_cents).toBe(price);
      expect(plan.monthly_images).toBe(0);
      expect(effectiveLimits(plan.features).maxPages).toBe(pages);
      for (const [kind, limit] of [["adaptation", adaptations], ["analysis", analyses]] as const) {
        const consume = (key: string) => as(db, "service_role", null, async () => (await db.query<{ r: { allowed: boolean; duplicate?: boolean; used: number; limit: number } }>(
          "select public.consume_quota($1, $2, 1, null, null, $3) r", [u.workspaceId, kind, key])).rows[0]!.r);
        for (let i = 1; i <= limit; i++) expect(await consume(`${slug}:${kind}:${i}`)).toMatchObject({ allowed: true, used: i, limit });
        expect(await consume(`${slug}:${kind}:1`)).toMatchObject({ allowed: true, duplicate: true, used: limit });
        expect(await consume(`${slug}:${kind}:overflow`)).toMatchObject({ allowed: false, used: limit });
      }
      for (let i = 0; i < profiles; i++) await as(db, "authenticated", u.id, () => db.query(
        "insert into public.learner_profiles (workspace_id, created_by, display_name) values ($1, $2, $3)", [u.workspaceId, u.id, `Perfil ${i}`]));
      await expect(as(db, "authenticated", u.id, () => db.query(
        "insert into public.learner_profiles (workspace_id, created_by, display_name) values ($1, $2, 'Extra')", [u.workspaceId, u.id]))).rejects.toThrow(/limit_reached:profiles/);
      const other = await createUser(db, `other-${slug}@example.com`);
      await expect(as(db, "authenticated", other.id, () => db.query("select public.workspace_usage($1)", [u.workspaceId]))).rejects.toThrow();
      const own = await as(db, "authenticated", other.id, () => db.query<{ u: { adaptations: { used: number } } }>("select public.workspace_usage($1) u", [other.workspaceId]));
      expect(own.rows[0]!.u.adaptations.used).toBe(0);
    });
  }

  it("el consumo anterior permanece y los periodos no se mezclan", async () => {
    const u = await createUser(db, "periodo@example.com");
    await db.query("insert into public.usage_events (workspace_id, kind, units, idempotency_key, created_at) values ($1, 'adaptation', 5, 'old-period', now()-interval '2 months')", [u.workspaceId]);
    const usage = () => as(db, "authenticated", u.id, async () => (await db.query<{ u: { adaptations: { used: number; limit: number } } }>("select public.workspace_usage($1) u", [u.workspaceId])).rows[0]!.u);
    expect((await usage()).adaptations).toEqual({ used: 0, limit: 1 });
    await db.query("insert into public.usage_events (workspace_id, kind, units, idempotency_key) values ($1, 'adaptation', 5, 'existing-current-period')", [u.workspaceId]);
    expect((await usage()).adaptations).toEqual({ used: 5, limit: 1 });
    const result = await as(db, "service_role", null, () => db.query<{ r: { allowed: boolean } }>("select public.consume_quota($1, 'adaptation', 1, null, null, 'over-new-limit') r", [u.workspaceId]));
    expect(result.rows[0]!.r.allowed).toBe(false);
  });

  it("preserva contratos y precios Stripe anteriores; no toca consumo; es idempotente", async () => {
    const previous = await createTestDb({ through: "20261001002500" });
    try {
      await previous.exec("update public.plans set features=features-'commercial_policy'");
      await previous.exec("update public.plans set monthly_adaptations=5, features=features || '{\"monthly_analyses\":10,\"unlimited_adaptations\":true}'::jsonb where slug='free'");
      const freeId = (await previous.query("select id from public.plans where slug='free'")).rows;
      await previous.exec("update public.plans set stripe_price_annual_id='price_old_max_annual', annual_price_cents=17900 where slug='max'");
      await previous.exec(`update public.plans set features=features-'commercial_policy', monthly_adaptations=75,
        monthly_price_cents=999, annual_price_cents=9900, stripe_price_monthly_id='price_old_pro' where slug='pro'`);
      const u = await createUser(previous, "legacy@example.com");
      await previous.query(`insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status)
        select $1, 'sub_legacy', 'price_old_pro', id, 'year', 'active' from public.plans where slug='pro'`, [u.workspaceId]);
      await previous.query("insert into public.usage_events (workspace_id, kind, units, idempotency_key) values ($1, 'adaptation', 3, 'legacy-usage')", [u.workspaceId]);
      const ledger = (await previous.query("select * from public.usage_events")).rows;
      for (const status of ["trialing", "past_due", "canceled", "paused"]) {
        const legacy = await createUser(previous, `${status}@example.com`);
        await previous.query(`insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status)
          select $1, $2, 'price_old_pro', id, 'month', $3 from public.plans where slug='pro'`, [legacy.workspaceId, `sub_${status}`, status]);
      }
      const before = (await previous.query("select * from public.subscriptions")).rows;
      await applyMigration(previous, migration);
      expect((await previous.query("select * from public.subscriptions")).rows).toEqual(before);
      expect((await previous.query("select * from public.usage_events")).rows).toEqual(ledger);
      expect((await previous.query("select id from public.plans where slug='free'")).rows).toEqual(freeId);
      expect((await previous.query("select monthly_adaptations, features->'unlimited_adaptations' unlimited from public.plans where slug='free'")).rows).toEqual([{ monthly_adaptations: 1, unlimited: null }]);
      expect((await previous.query("select annual_price_cents, active from public.plans where stripe_price_annual_id='price_old_max_annual'")).rows).toEqual([{ annual_price_cents: 17900, active: false }]);
      const effective = (await previous.query<{ monthly_adaptations: number; monthly_price_cents: number; active: boolean }>("select (public.workspace_plan($1)).*", [u.workspaceId])).rows[0]!;
      expect(effective).toMatchObject({ monthly_adaptations: 75, monthly_price_cents: 999, active: false });
      expect((await previous.query("select monthly_adaptations, stripe_price_monthly_id from public.plans where slug='pro'")).rows).toEqual([{ monthly_adaptations: 15, stripe_price_monthly_id: null }]);
      const snapshot = (await previous.query("select * from public.plans order by id")).rows;
      await applyMigration(previous, migration);
      expect((await previous.query("select * from public.plans order by id")).rows).toEqual(snapshot);
      await previous.exec("update public.subscriptions set status='canceled'");
      expect((await previous.query<{ slug: string }>("select (public.workspace_plan($1)).slug", [u.workspaceId])).rows[0]!.slug).toBe("free");
    } finally { await previous.close(); }
  }, 60_000);
});
