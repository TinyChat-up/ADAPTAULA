import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigration, createTestDb, migrationFiles } from "./harness";

const sql = readFileSync(path.join(import.meta.dirname, "../../scripts/staging/inspect-schema.sql"), "utf8");
type Check = { check_id: string; result: "PASS" | "FAIL" };

describe("staging preflight SQL (read-only)", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.close(); });

  it("passes with the current migrations and does not mutate data", async () => {
    const before = (await db.query("select count(*)::int as n from public.account_deletion_requests")).rows;
    const { rows } = await db.query<Check>(sql);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.filter((row) => row.result === "FAIL")).toEqual([]);
    expect((await db.query("select count(*)::int as n from public.account_deletion_requests")).rows).toEqual(before);
  });

  it("detects the old vulnerable signature until 028 is applied", async () => {
    const legacy = await createTestDb({ through: "20261001002700" });
    try {
      await legacy.exec("create function public.request_account_deletion() returns uuid language sql security definer set search_path = '' as $$ select gen_random_uuid() $$; grant execute on function public.request_account_deletion() to authenticated;");
      const before = await legacy.query<Check>(sql);
      expect(before.rows.find((row) => row.check_id === "028.old_rpc_absent")?.result).toBe("FAIL");
      await applyMigration(legacy, migrationFiles().find((file) => file.includes("20261001002800"))!);
      const after = await legacy.query<Check>(sql);
      expect(after.rows.filter((row) => row.result === "FAIL")).toEqual([]);
    } finally { await legacy.close(); }
  });

  it("detects drift in the commercial policy", async () => {
    await db.exec("update public.plans set monthly_adaptations = 2 where slug = 'free'");
    const { rows } = await db.query<Check>(sql);
    expect(rows.find((row) => row.check_id === "026.free_contract")?.result).toBe("FAIL");
  });
});
