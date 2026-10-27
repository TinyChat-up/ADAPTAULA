import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser } from "./harness";

/** Migration 033: pinned analysis copies, «Retirar de la biblioteca» and the two-step definitive deletion (docs/ADAPTATION.md). */
let db: PGlite;
beforeAll(async () => { db = await createTestDb(); }, 120_000);
afterAll(async () => { await db.close(); });
type User = Awaited<ReturnType<typeof createUser>>;
let n = 0;
const user = () => createUser(db, `ciclo-${++n}@example.com`);
const service = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function material(u: User, status = "analyzed") {
  return (await one<{ id: string }>("insert into public.materials (workspace_id, created_by, title, source_type, status, analysis) values ($1, $2, 'Célula', 'pdf', $3, '{\"v\":\"new\"}') returning id", [u.workspaceId, u.id, status])).id;
}
async function adaptation(u: User, materialId: string, delivered = false) {
  return (await one<{ id: string }>(
    "insert into public.adaptations (workspace_id, material_id, title, adaptation_type, profile_snapshot, analysis_fingerprint, status, delivered_at) values ($1, $2, 'A', 'accessibility', '{}', $3, $4, $5) returning id",
    [u.workspaceId, materialId, "a".repeat(64), delivered ? "ready" : "blocked", delivered ? new Date().toISOString() : null],
  )).id;
}

describe("an adaptation keeps the analysis it was made with", () => {
  it("after a re-analysis its pipeline reads its own copy; one without a copy still reads the material", async () => {
    const u = await user();
    const m = await material(u);
    const a = await adaptation(u, m);
    const read = async () => (await one<{ p: { analysis: { analysis: unknown; status: string } } }>("select public.get_adaptation_pipeline($1) p", [a])).p.analysis;
    expect((await read()).analysis).toEqual({ v: "new" });
    await service(() => db.query("insert into public.material_analysis_snapshots (workspace_id, material_id, fingerprint, analysis) values ($1, $2, $3, '{\"v\":\"old\"}')", [u.workspaceId, m, "a".repeat(64)]));
    expect(await read()).toEqual({ analysis: { v: "old" }, prompt_version: null, status: "analyzed" });
    await expect(service(() => db.query("update public.material_analysis_snapshots set analysis = '{}' where material_id = $1", [m]))).rejects.toThrow(/analysis_snapshot_immutable/);
  });

  it("members read their copies; another workspace and the browser write or read nothing", async () => {
    const u = await user();
    const other = await user();
    const m = await material(u);
    await service(() => db.query("insert into public.material_analysis_snapshots (workspace_id, material_id, fingerprint, analysis) values ($1, $2, $3, '{}')", [u.workspaceId, m, "b".repeat(64)]));
    expect((await as(db, "authenticated", u.id, () => db.query("select 1 from public.material_analysis_snapshots where material_id = $1", [m]))).rows).toHaveLength(1);
    expect((await as(db, "authenticated", other.id, () => db.query("select 1 from public.material_analysis_snapshots where material_id = $1", [m]))).rows).toHaveLength(0);
    await expect(as(db, "authenticated", u.id, () => db.query("insert into public.material_analysis_snapshots (workspace_id, material_id, fingerprint, analysis) values ($1, $2, $3, '{}')", [u.workspaceId, m, "c".repeat(64)]))).rejects.toThrow();
  });
});

describe("«Retirar de la biblioteca»", () => {
  it("hides and restores a material with adaptations without touching them; another workspace cannot", async () => {
    const u = await user();
    const other = await user();
    const m = await material(u);
    const a = await adaptation(u, m, true);
    await as(db, "authenticated", u.id, () => db.query("select public.set_material_archived($1, true)", [m]));
    expect((await one<{ archived_at: string | null }>("select archived_at from public.materials where id = $1", [m])).archived_at).not.toBeNull();
    expect((await one<{ status: string }>("select status from public.adaptations where id = $1", [a])).status).toBe("ready");
    await expect(as(db, "authenticated", other.id, () => db.query("select public.set_material_archived($1, false)", [m]))).rejects.toThrow(/material_not_found/);
    await as(db, "authenticated", u.id, () => db.query("select public.set_material_archived($1, false)", [m]));
    expect((await one<{ archived_at: string | null }>("select archived_at from public.materials where id = $1", [m])).archived_at).toBeNull();
  });
});

describe("«Eliminar definitivamente» with adaptations", () => {
  it("needs the confirmed count, refuses work in progress, then deletes rows and keeps the usage ledger and AI costs", async () => {
    const u = await user();
    const m = await material(u);
    const a = await adaptation(u, m, true);
    await adaptation(u, m);
    await db.query("insert into public.usage_events (workspace_id, kind, units, idempotency_key) values ($1, 'adaptation', 1, $2)", [u.workspaceId, `k-${a}`]);
    await db.query("insert into public.ai_runs (workspace_id, adaptation_id, purpose, model_alias, provider, model, status) values ($1, $2, 'generate', 'STANDARD', 'mock', 'm', 'success')", [u.workspaceId, a]).catch(() => undefined);
    await db.query("insert into public.material_files (material_id, workspace_id, bucket, storage_path, mime_type, size_bytes) values ($1, $2, 'source-materials', $3, 'application/pdf', 10)", [m, u.workspaceId, `${u.workspaceId}/${u.id}/${m}/f.pdf`]);

    await expect(service(() => db.query("select public.begin_material_deletion($1, $2, $3, 1)", [m, u.workspaceId, u.id]))).rejects.toThrow(/confirmation_stale/);
    const other = await user();
    await expect(service(() => db.query("select public.begin_material_deletion($1, $2, $3, 2)", [m, other.workspaceId, other.id]))).rejects.toThrow(/material_not_found/);
    await expect(as(db, "authenticated", u.id, () => db.query("select public.begin_material_deletion($1, $2, $3, 2)", [m, u.workspaceId, u.id]))).rejects.toThrow();

    const begun = await service(() => one<{ r: { adaptations: number; files: Array<{ bucket: string; path: string }> } }>("select public.begin_material_deletion($1, $2, $3, 2) r", [m, u.workspaceId, u.id]));
    expect(begun.r.adaptations).toBe(2);
    expect(begun.r.files).toEqual([{ bucket: "source-materials", path: `${u.workspaceId}/${u.id}/${m}/f.pdf` }]);
    // Repeating the first step (a retry after a Storage failure) returns the same list; nothing new starts on the material.
    expect((await service(() => one<{ r: unknown }>("select public.begin_material_deletion($1, $2, $3, 99) r", [m, u.workspaceId, u.id]))).r).toEqual(begun.r);
    await expect(adaptation(u, m)).rejects.toThrow(/material_deleting/);

    expect((await service(() => one<{ r: boolean }>("select public.finish_material_deletion($1, $2, $3) r", [m, u.workspaceId, u.id]))).r).toBe(true);
    expect((await db.query("select 1 from public.adaptations where material_id = $1", [m])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.materials where id = $1", [m])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.usage_events where idempotency_key = $1", [`k-${a}`])).rows).toHaveLength(1);
    expect((await service(() => one<{ r: boolean }>("select public.finish_material_deletion($1, $2, $3) r", [m, u.workspaceId, u.id]))).r).toBe(false);
  });

  it("a material with an analysis in progress is not deleted", async () => {
    const u = await user();
    const m = await material(u, "queued");
    await db.query("insert into public.adaptation_jobs (workspace_id, material_id, requested_by, kind, input, status) values ($1, $2, $3, 'analyze', '{}', 'queued')", [u.workspaceId, m, u.id]);
    await expect(service(() => db.query("select public.begin_material_deletion($1, $2, $3, 0)", [m, u.workspaceId, u.id]))).rejects.toThrow(/material_busy/);
  });
});
