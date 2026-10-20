import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runUploadCleanups, type UploadCleanupClaim, type UploadCleanupDeps } from "@/lib/materials/upload-cleanup";
import { ANALYSIS_LIMITS } from "@/lib/materials/config";
import { applyMigration, as, createTestDb, createUser, migrationFiles } from "./harness";

let db: PGlite;
let a: Awaited<ReturnType<typeof createUser>>;
let b: typeof a;
let viewer: typeof a;
const objects = new Set<string>();
beforeAll(async () => {
  db = await createTestDb();
  a = await createUser(db, "upload-a@example.test");
  b = await createUser(db, "upload-b@example.test");
  viewer = await createUser(db, "upload-reader@example.test");
  await db.query("insert into public.workspace_members(workspace_id,user_id,role) values ($1,$2,'viewer')", [a.workspaceId, viewer.id]);
});
beforeEach(async () => { objects.clear(); await db.exec("truncate public.material_upload_cleanups, public.materials cascade"); });
afterAll(async () => { await db.close(); });

async function upload(options: { expired?: boolean; legacyPath?: boolean; owner?: typeof a; extraFile?: boolean } = {}) {
  const u = options.owner ?? a;
  const id = randomUUID();
  const fileId = randomUUID();
  const path = options.legacyPath ? `${u.workspaceId}/${id}/${fileId}.pdf` : `${u.workspaceId}/${u.id}/${id}/${fileId}.pdf`;
  await db.query(`insert into public.materials(id,workspace_id,created_by,title,source_type,created_at,upload_expires_at)
    values ($1,$2,$3,'Ficha sintética','pdf',now()-interval '90 minutes',now()+$4::interval)`,
  [id, u.workspaceId, u.id, options.expired ? "-1 second" : "30 minutes"]);
  await db.query(`insert into public.material_files(id,material_id,workspace_id,bucket,storage_path,mime_type,size_bytes)
    values ($1,$2,$3,'source-materials',$4,'application/pdf',123)`, [fileId, id, u.workspaceId, path]);
  objects.add(path);
  if (options.extraFile) {
    const extra = `${u.workspaceId}/${u.id}/${id}/${randomUUID()}.png`;
    await db.query(`insert into public.material_files(material_id,workspace_id,bucket,storage_path,mime_type,size_bytes,kind)
      values ($1,$2,'source-materials',$3,'image/png',12,'thumbnail')`, [id,u.workspaceId,extra]);
    objects.add(extra);
  }
  return { id, fileId, path, user: u };
}
type Upload = Awaited<ReturnType<typeof upload>>;
async function complete(u: Upload, actor = u.user, workspace = u.user.workspaceId) {
  return (await db.query<{ result: string }>("select public.complete_material_upload($1,$2,$3,$4,123,1,$5) as result",
    [u.id, actor.id, workspace, u.fileId, "a".repeat(64)])).rows[0]!.result;
}
async function claim() {
  return (await db.query<{ claims: UploadCleanupClaim[] }>("select public.claim_material_upload_cleanups(20) as claims")).rows[0]!.claims;
}
async function finish(c: UploadCleanupClaim, error: string | null = null) {
  return (await db.query<{ removed: number }>("select public.finish_material_upload_cleanup($1,$2,$3) as removed", [c.materialId, c.token, error])).rows[0]!.removed;
}
async function recover() {
  await db.exec("update public.material_upload_cleanups set lease_until = case when lease_token is null then null else now()-interval '1 second' end, next_attempt_at=now()-interval '1 second'");
}
const exists = async (id: string) => (await db.query("select 1 from public.materials where id=$1", [id])).rows.length === 1;
const deps = (override: Partial<UploadCleanupDeps> = {}): UploadCleanupDeps => ({
  claim, finish,
  removeAndConfirm: async (file) => { objects.delete(file.path); return null; },
  ...override,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("029 · atomic finalization and recoverable Storage cleanup", () => {
  it("A/K: a completed original survives, finalization repeats without overwriting it", async () => {
    const u = await upload();
    expect(await complete(u)).toBe("completed");
    expect(await complete(u)).toBe("already_completed");
    // Age alone never makes a completed document eligible, even after its upload window.
    await db.query("update public.materials set upload_expires_at=now()-interval '1 second' where id=$1", [u.id]);
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 0, claimed: 0 });
    expect(objects.has(u.path)).toBe(true);
    expect(await exists(u.id)).toBe(true);
    expect((await db.query("select content_hash,page_count from public.materials where id=$1", [u.id])).rows[0])
      .toEqual({ content_hash: "a".repeat(64), page_count: 1 });
  });

  it("B: a cleanup claim permanently excludes completion and freezes the snapshot", async () => {
    const u = await upload({ expired: true });
    const [c] = await claim();
    expect(c?.materialId).toBe(u.id);
    expect(await complete(u)).toBe("expired");
    await expect(db.query("update public.materials set status='uploaded' where id=$1", [u.id])).rejects.toThrow(/upload_unavailable/);
    await expect(db.query("update public.material_files set size_bytes=999 where id=$1", [u.fileId])).rejects.toThrow(/upload_unavailable/);
    expect(objects.has(u.path)).toBe(true);
  });

  it("C: simultaneous RPC submissions have exactly one winner, with no delays", async () => {
    const u = await upload({ expired: true });
    const [completed, cleaned] = await Promise.all([complete(u), claim()]);
    expect(completed === "completed").not.toBe(cleaned.some((c) => c.materialId === u.id));
    expect(completed).toBe("expired");
    expect(cleaned).toHaveLength(1);
    await runUploadCleanups(deps({ claim: async () => cleaned }));
    expect(await exists(u.id)).toBe(false);
  });

  it("D: failed/partial Storage deletion keeps rows and every path, then retries", async () => {
    const u = await upload({ expired: true, extraFile: true });
    expect(await runUploadCleanups(deps({ removeAndConfirm: async (f) => {
      objects.delete(f.path); return "storage_unconfirmed";
    } }))).toMatchObject({ removed: 0, failed: 1 });
    expect(await exists(u.id)).toBe(true);
    const row = (await db.query<{ files: unknown[]; last_error: string }>("select files,last_error from public.material_upload_cleanups")).rows[0]!;
    expect(row.files).toHaveLength(2);
    expect(row.last_error).toBe("storage_unconfirmed");
    await recover();
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 1, failed: 0 });
    expect(objects.size).toBe(0);
  });

  it("E/G: a crash after Storage and before DB acknowledgment recovers and counts only the confirmed DELETE", async () => {
    const u = await upload({ expired: true });
    expect(await runUploadCleanups(deps({ finish: async () => { throw new Error("simulated crash"); } }))).toMatchObject({ removed: 0, failed: 1 });
    expect(objects.has(u.path)).toBe(false);
    expect(await exists(u.id)).toBe(true);
    await recover();
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 1 });
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 0, claimed: 0 });
  });

  it("F: two crons overlap at a controlled barrier; the second cannot acquire the live lease", async () => {
    const u = await upload({ expired: true });
    const reached = deferred(), release = deferred();
    const first = runUploadCleanups(deps({ removeAndConfirm: async (f) => {
      reached.resolve(); await release.promise; objects.delete(f.path); return null;
    } }));
    await reached.promise;
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 0, claimed: 0 });
    release.resolve();
    expect(await first).toMatchObject({ removed: 1 });
    expect(await exists(u.id)).toBe(false);
  });

  it("G: lease recovery fences the old worker and allows only the new token to acknowledge", async () => {
    const u = await upload({ expired: true });
    const [old] = await claim();
    await recover();
    const [current] = await claim();
    expect(current!.token).not.toBe(old!.token);
    expect(await finish(old!)).toBe(0);
    expect(await exists(u.id)).toBe(true);
    expect(await runUploadCleanups(deps({ claim: async () => [current!] }))).toMatchObject({ removed: 1 });
  });

  it("H: a 90-minute-old upload is still valid inside the actual two-hour token window", async () => {
    const u = await upload();
    expect(await claim()).toEqual([]);
    expect(await complete(u)).toBe("completed");
    const fresh = await upload();
    const before = Date.parse((await db.query<{ at: string }>("select clock_timestamp()::text as at")).rows[0]!.at);
    expect((await db.query<{ ok: boolean }>("select public.open_material_upload_window($1,$2,$3) as ok", [fresh.id,a.id,a.workspaceId])).rows[0]!.ok).toBe(true);
    const after = Date.parse((await db.query<{ at: string }>("select clock_timestamp()::text as at")).rows[0]!.at);
    const expiry = Date.parse((await db.query<{ at: string }>("select upload_expires_at::text as at from public.materials where id=$1", [fresh.id])).rows[0]!.at);
    expect(expiry).toBeGreaterThanOrEqual(before + ANALYSIS_LIMITS.signedUploadUrlSeconds * 1000);
    expect(expiry).toBeLessThanOrEqual(after + ANALYSIS_LIMITS.signedUploadUrlSeconds * 1000);
  });

  it("I: cross-workspace and read-only actors cannot finalize, reject or read cleanup paths", async () => {
    const u = await upload();
    expect(await complete(u,b,a.workspaceId)).toBe("not_found");
    expect(await complete(u,a,b.workspaceId)).toBe("not_found");
    expect(await complete(u,viewer,a.workspaceId)).toBe("not_found");
    const rejected = await db.query<{ ok: boolean }>("select public.reject_material_upload($1,$2,$3) as ok", [u.id,b.id,a.workspaceId]);
    expect(rejected.rows[0]!.ok).toBe(false);
    for (const role of ["anon", "authenticated"] as const) {
      await expect(as(db,role,a.id,() => db.query("select public.claim_material_upload_cleanups(20)"))).rejects.toThrow();
      await expect(as(db,role,a.id,() => db.query("select public.complete_material_upload($1,$2,$3,$4,123,1,$5)",[u.id,a.id,a.workspaceId,u.fileId,"a".repeat(64)]))).rejects.toThrow();
      await expect(as(db,role,a.id,() => db.query("select public.open_material_upload_window($1,$2,$3)",[u.id,a.id,a.workspaceId]))).rejects.toThrow();
      await expect(as(db,role,a.id,() => db.query("select public.reject_material_upload($1,$2,$3)",[u.id,a.id,a.workspaceId]))).rejects.toThrow();
      await expect(as(db,role,a.id,() => db.query("select public.finish_material_upload_cleanup($1,$2,null)",[u.id,randomUUID()]))).rejects.toThrow();
      await expect(as(db,role,a.id,() => db.query("select * from public.material_upload_cleanups"))).rejects.toThrow();
    }
    expect(await complete(u)).toBe("completed");
    expect(objects.has(u.path)).toBe(true);
  });

  it("J: a late Storage write is reaped from the durable tombstone without double-counting", async () => {
    const u = await upload({ expired: true });
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 1 });
    objects.add(u.path); // An already-started remote PUT finishes late, after the first cleanup.
    await recover();
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 0, claimed: 1 });
    expect(objects.has(u.path)).toBe(false);
    expect((await db.query("select files,row_deleted_at from public.material_upload_cleanups")).rows).toHaveLength(1);
  });

  it("never reuses a reclaimed path under another material before the next tombstone sweep", async () => {
    const old = await upload({ expired: true });
    await runUploadCleanups(deps());
    const fresh = await upload();
    await expect(db.query(`insert into public.material_files(material_id,workspace_id,bucket,storage_path,mime_type,size_bytes)
      values ($1,$2,'source-materials',$3,'application/pdf',123)`,[fresh.id,a.workspaceId,old.path])).rejects.toThrow(/upload_unavailable/);
    await expect(db.query("insert into public.materials(id,workspace_id,title,source_type) values ($1,$2,'Reused','pdf')",[old.id,a.workspaceId])).rejects.toThrow(/upload_unavailable/);
    expect(await complete(fresh)).toBe("completed");
    await recover();
    await runUploadCleanups(deps());
    expect(objects.has(fresh.path)).toBe(true);
  });

  it("J: a missing row is never counted as deleted, and a missing token never acknowledges", async () => {
    const u = await upload({ expired: true });
    const [c] = await claim();
    expect((await db.query<{ n: number }>("select public.finish_material_upload_cleanup($1,null,null) as n",[u.id])).rows[0]!.n).toBe(0);
    await db.query("delete from public.materials where id=$1",[u.id]);
    expect(await runUploadCleanups(deps({ claim: async () => [c!] }))).toMatchObject({ removed: 0 });
  });

  it("L: the historical workspace/material/file layout is still safely recoverable", async () => {
    const u = await upload({ expired: true, legacyPath: true });
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 1 });
    expect(objects.has(u.path)).toBe(false);
  });

  it("rejecting a pending file is durable, never removes a completed original and waits out its token", async () => {
    const u = await upload();
    expect((await db.query<{ ok: boolean }>("select public.reject_material_upload($1,$2,$3) as ok",[u.id,a.id,a.workspaceId])).rows[0]!.ok).toBe(true);
    expect(await complete(u)).toBe("expired");
    expect(await claim()).toEqual([]);
    expect(objects.has(u.path)).toBe(true);
    const valid = await upload();
    await complete(valid);
    expect((await db.query<{ ok: boolean }>("select public.reject_material_upload($1,$2,$3) as ok",[valid.id,a.id,a.workspaceId])).rows[0]!.ok).toBe(false);
    expect(objects.has(valid.path)).toBe(true);
  });

  it("L: migration backfill gives old uploading records a full safe window without changing completed originals", async () => {
    const old = await createTestDb({ through: "20261001002800" });
    try {
      const user = await createUser(old,"legacy-window@example.test");
      await old.query("insert into public.materials(workspace_id,title,source_type,status,created_at) values ($1,'Old','pdf','uploading',now()-interval '3 days')",[user.workspaceId]);
      const completedId = randomUUID();
      await old.query("insert into public.materials(id,workspace_id,title,source_type,status,content_hash) values ($1,$2,'Intacta','pdf','uploaded',$3)",[completedId,user.workspaceId,"b".repeat(64)]);
      const completedBefore = (await old.query("select title,status,content_hash,updated_at from public.materials where id=$1",[completedId])).rows[0];
      const inspect = async () => (await old.exec(readFileSync("scripts/staging/inspect-upload-integrity.sql", "utf8")))
        .flatMap((r) => (r.rows as Array<Record<string, unknown>>).map((row) => row.result ?? row.server_only));
      expect(await inspect()).toEqual(Array(9).fill("FAIL"));
      const before = Date.parse((await old.query<{ at: string }>("select clock_timestamp()::text as at")).rows[0]!.at);
      await applyMigration(old,migrationFiles().find((f) => f.includes("20261001002900"))!);
      const expiry = Date.parse((await old.query<{ at: string }>("select upload_expires_at::text as at from public.materials where status='uploading'")).rows[0]!.at);
      expect(expiry).toBeGreaterThanOrEqual(before + ANALYSIS_LIMITS.signedUploadUrlSeconds * 1000);
      expect((await old.query("select title,status,content_hash,updated_at from public.materials where id=$1",[completedId])).rows[0]).toEqual(completedBefore);
      expect(await inspect()).toEqual(Array(9).fill("PASS"));
      expect((await old.query<{ c: unknown[] }>("select public.claim_material_upload_cleanups(20) as c")).rows[0]!.c).toEqual([]);
    } finally { await old.close(); }
  });

  it("a bounded cron leaves unprocessed claims recoverable after its lease expires", async () => {
    await upload({ expired: true });
    let clock = 0;
    const result = await runUploadCleanups(deps({ claim: async () => { const rows = await claim(); clock = 2; return rows; } }), { budgetMs: 1, now: () => clock });
    expect(result).toMatchObject({ removed: 0, deferred: 1 });
    await recover();
    expect(await runUploadCleanups(deps())).toMatchObject({ removed: 1 });
  });
});
