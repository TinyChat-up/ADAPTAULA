import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createTestDb, createUser } from "./harness";

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

  it("requires authentication and exposes only the user's request", async () => {
    await expect(as(db, "anon", null, () => db.query("select public.request_account_deletion()"))).rejects.toThrow();
    const first = await as(db, "authenticated", a.id, () => db.query<{ id: string }>("select public.request_account_deletion() as id"));
    const second = await as(db, "authenticated", a.id, () => db.query<{ id: string }>("select public.request_account_deletion() as id"));
    expect(second.rows[0]?.id).toBe(first.rows[0]?.id);
    const own = await as(db, "authenticated", a.id, () => db.query<{ user_id: string; status: string }>("select user_id,status from public.account_deletion_requests"));
    expect(own.rows).toEqual([{ user_id: a.id, status: "requested" }]);
    const other = await as(db, "authenticated", b.id, () => db.query("select * from public.account_deletion_requests"));
    expect(other.rows).toHaveLength(0);
    await expect(as(db, "authenticated", b.id, () => db.query("update public.account_deletion_requests set status='completed'"))).rejects.toThrow();
    const material = await db.query("select count(*)::int as n from public.workspaces where id = $1", [a.workspaceId]);
    expect(material.rows[0]).toEqual({ n: 1 });
  });
});
