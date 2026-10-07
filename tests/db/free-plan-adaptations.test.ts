import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { cancelAdaptationCommand, createAdaptationCommand, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions } from "./orchestration-harness";

/**
 * The Free plan exactly as seeded (`supabase/seed.sql`, the single source of the limits): no override anywhere in this file.
 * 5 adaptations a month is PROVISIONAL (docs/PRODUCT.md § Planes); these tests pin what the app enforces and shows today.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

let n = 0;
async function teacher() {
  const user = await createUser(db, `free-${++n}@example.com`);
  const material = await seedMaterial(db, user, fractionsAnalysis());
  const learner = await seedLearner(db, user);
  const orchestrator = makeDeps(db, scriptedServices(newSpy()));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions, now: () => new Date() };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const create = (requestKey = `free-${n}-${Math.random().toString(36).slice(2)}`) => createAdaptationCommand(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey });
  const usage = async () =>
    (await as(db, "authenticated", user.id, () => db.query<{ u: { adaptations: { used: number; limit: number } } }>("select public.workspace_usage($1) as u", [user.workspaceId]))).rows[0]!.u.adaptations;
  const units = async () => Number((await db.query<{ s: string | null }>("select coalesce(sum(units), 0)::text s from public.usage_events where workspace_id = $1 and kind = 'adaptation'", [user.workspaceId])).rows[0]!.s);
  return { user, deps, actor, create, usage, units };
}

describe("Free plan · adaptations (provisional 5 a month)", () => {
  it("the seed is the source: Free allows 5 adaptations a month and no unlimited flag", async () => {
    const { rows } = await db.query<{ monthly_adaptations: number; unlimited: unknown }>("select monthly_adaptations, features -> 'unlimited_adaptations' as unlimited from public.plans where slug = 'free'");
    expect(rows[0]).toEqual({ monthly_adaptations: 5, unlimited: null });
  });

  it("a Free teacher creates 5; the 6th is refused with the plan-limit error; usage shows 5 of 5", async () => {
    const t = await teacher();
    expect(await t.usage()).toEqual({ used: 0, limit: 5 });
    for (let i = 1; i <= 5; i++) expect((await t.create()).ok, `adaptación ${i}`).toBe(true);
    expect(await t.usage()).toEqual({ used: 5, limit: 5 });
    const sixth = await t.create();
    expect(sixth).toMatchObject({ ok: false, code: "entitlement_exhausted" });
    expect(await t.units()).toBe(5);
    expect(await t.usage()).toEqual({ used: 5, limit: 5 });
  });

  it("no double consumption: the same request (double click, retry) is one adaptation and one unit", async () => {
    const t = await teacher();
    const first = await t.create("same-key");
    const again = await t.create("same-key");
    expect(first.ok && again.ok && first.data.adaptationId === again.data.adaptationId).toBe(true);
    expect(await t.units()).toBe(1);
    expect(await t.usage()).toEqual({ used: 1, limit: 5 });
  });

  it("cancelling an undelivered adaptation gives its unit back, so a 6th fits again", async () => {
    const t = await teacher();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await t.create();
      if (r.ok) ids.push(r.data.adaptationId);
    }
    expect((await t.create()).ok).toBe(false);
    expect((await cancelAdaptationCommand(t.deps, t.actor, ids[0]!)).ok).toBe(true);
    expect(await t.usage()).toEqual({ used: 4, limit: 5 });
    expect((await t.create()).ok).toBe(true);
  });

  it("upgrading still works: an active Pro subscription lifts the limit for the same workspace", async () => {
    const t = await teacher();
    for (let i = 0; i < 5; i++) await t.create();
    expect((await t.create()).ok).toBe(false);
    await db.query(
      `insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status, period_start, period_end)
       select $1, $2, 'price_test', id, 'month', 'active', now() - interval '1 day', now() + interval '29 days' from public.plans where slug = 'pro'`,
      [t.user.workspaceId, `sub_free_upgrade_${n}`],
    );
    expect((await t.create()).ok).toBe(true);
    expect((await t.usage()).limit).toBe((await db.query<{ m: number }>("select monthly_adaptations m from public.plans where slug = 'pro'")).rows[0]!.m);
  });
});
