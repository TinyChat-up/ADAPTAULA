import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, applyMigration, createTestDb, createUser, migrationFiles } from "./harness";

describe("account deletion requests", () => {
  let db: PGlite;
  let a: Awaited<ReturnType<typeof createUser>>;
  let b: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => {
    db = await createTestDb();
    a = await createUser(db, "privacy-a@example.test");
    b = await createUser(db, "privacy-b@example.test");
  });
  afterAll(async () => { await db.close(); });

  it("does not allow an authenticated client to register a request through the RPC", async () => {
    await expect(as(db, "authenticated", a.id, () => db.query("select public.request_account_deletion()"))).rejects.toThrow();
    await expect(as(db, "authenticated", a.id, () => db.query("select public.request_account_deletion($1::uuid)", [a.id]))).rejects.toThrow();
    await expect(as(db, "authenticated", a.id, () => db.query("insert into public.account_deletion_requests(user_id) values ($1)", [b.id]))).rejects.toThrow();
    const requests = await db.query("select count(*)::int as total from public.account_deletion_requests where user_id = $1", [a.id]);
    expect(requests.rows[0]).toEqual({ total: 0 });
  });

  it("permits only the service role, preserves idempotence and RLS, and leaves the account intact", async () => {
    await expect(as(db, "anon", null, () => db.query("select public.request_account_deletion()"))).rejects.toThrow();
    const first = await as(db, "service_role", null, () => db.query<{ id: string }>("select public.request_account_deletion($1::uuid) as id", [a.id]));
    const second = await as(db, "service_role", null, () => db.query<{ id: string }>("select public.request_account_deletion($1::uuid) as id", [a.id]));
    expect(second.rows[0]?.id).toBe(first.rows[0]?.id);
    await as(db, "service_role", null, () => db.query("select public.request_account_deletion($1::uuid)", [b.id]));
    const own = await as(db, "authenticated", a.id, () => db.query<{ user_id: string; status: string }>("select user_id,status from public.account_deletion_requests"));
    expect(own.rows).toEqual([{ user_id: a.id, status: "requested" }]);
    const other = await as(db, "authenticated", b.id, () => db.query("select * from public.account_deletion_requests"));
    expect(other.rows).toHaveLength(1);
    expect(other.rows[0]).toMatchObject({ user_id: b.id });
    await expect(as(db, "authenticated", b.id, () => db.query("update public.account_deletion_requests set status='completed'"))).rejects.toThrow();
    const material = await db.query("select count(*)::int as n from public.workspaces where id = $1", [a.workspaceId]);
    expect(material.rows[0]).toEqual({ n: 1 });
    expect((await db.query("select count(*)::int as n from auth.users where id = $1", [a.id])).rows[0]).toEqual({ n: 1 });
  });

  it("closes a legacy 027 RPC through the compensating migration", async () => {
    const legacy = await createTestDb({ through: "20261001002700" });
    try {
      const user = await createUser(legacy, "legacy-privacy@example.test");
      await legacy.exec(`create function public.request_account_deletion() returns uuid language sql security definer set search_path = '' as $$
        insert into public.account_deletion_requests(user_id) values ((select auth.uid())) returning id
      $$;
      grant execute on function public.request_account_deletion() to authenticated;`);
      const migration = migrationFiles().find((file) => file.includes("20261001002800"));
      expect(migration).toBeDefined();
      await applyMigration(legacy, migration!);
      await expect(as(legacy, "authenticated", user.id, () => legacy.query("select public.request_account_deletion()"))).rejects.toThrow();
      await expect(as(legacy, "authenticated", user.id, () => legacy.query("select public.request_account_deletion($1::uuid)", [user.id]))).rejects.toThrow();
      expect((await legacy.query("select count(*)::int as n from public.account_deletion_requests")).rows[0]).toEqual({ n: 0 });
    } finally {
      await legacy.close();
    }
  });
});
