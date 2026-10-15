import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { as, createTestDb, createUser } from "./harness";
import { deliveredWithVisuals, footprint, type World } from "./pdf-export-harness";
import { applyEditorChanges, emptyChanges } from "@/lib/editor/changes";
import type { EditorChanges } from "@/lib/editor/changes";

let db: PGlite, w: World;
beforeAll(async () => { db = await createTestDb(); w = await deliveredWithVisuals(db); }, 90000);
afterAll(async () => { await db?.close(); });
async function save(userId: string, changes: EditorChanges, revision: number, version = 1) {
  return as(db, "authenticated", userId, async () => (await db.query<{ result: { revision?: number; error?: string } }>(
    "select public.save_adaptation_draft($1,$2,$3,$4,true) result", [w.id, version, revision, JSON.stringify(changes)])).rows[0]!.result);
}

describe("teacher drafts over real migrations and RLS", () => {
  it("saves append-only revisions, recovers the latest, rejects stale tabs and never touches the generated/source document", async () => {
    const before = await footprint(db, w);
    expect(await save(w.user.id, { presentation: { font_scale: 1.3 }, activities: [] }, 0)).toEqual({ revision: 1 });
    expect(await save(w.user.id, emptyChanges(), 0)).toEqual({ error: "conflict" });
    expect(await save(w.user.id, { presentation: { font_scale: 1.15 }, activities: [] }, 1)).toEqual({ revision: 2 });
    const rows = await as(db, "authenticated", w.user.id, async () => (await db.query<{ revision: number; changes: EditorChanges; created_by: string }>(
      "select revision,changes,created_by from public.adaptation_drafts where adaptation_id=$1 order by revision desc", [w.id])).rows);
    expect(rows.map((r) => r.revision)).toEqual([2, 1]);
    expect(rows[0]!.changes.presentation.font_scale).toBe(1.15);
    expect(rows[0]!.created_by).toBe(w.user.id);
    expect(await footprint(db, w)).toEqual(before);
    await expect(as(db, "authenticated", w.user.id, () => db.query("update public.adaptation_drafts set revision=99 where adaptation_id=$1", [w.id]))).rejects.toThrow(/permission denied/);
    expect(await save(w.user.id, emptyChanges(), 2, 99)).toEqual({ error: "conflict" });
  });
  it("another workspace cannot read or write the draft, and a viewer cannot save", async () => {
    const other = await createUser(db, "editor-other@example.com");
    const rows = await as(db, "authenticated", other.id, () => db.query("select id from public.adaptation_drafts where adaptation_id=$1", [w.id]));
    expect(rows.rows).toEqual([]);
    expect(await save(other.id, emptyChanges(), 2)).toEqual({ error: "not_found" });
    await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [w.user.workspaceId, other.id]);
    expect(await save(other.id, emptyChanges(), 2)).toEqual({ error: "forbidden" });
    await expect(as(db, "anon", null, () => db.query("select public.save_adaptation_draft($1,1,2,'{}',false)", [w.id]))).rejects.toThrow(/permission denied/);
  });
  it("stores content edits as teacher changes, without replacing or approving the original review", async () => {
    const version = (await db.query<{ document: Parameters<typeof applyEditorChanges>[0] }>("select document from public.adaptation_versions where adaptation_id=$1", [w.id])).rows[0]!;
    const activity = version.document.pages.flatMap((p) => p.blocks).find((b) => b.type === "activity")!;
    const changes = { presentation: {}, activities: [{ blockId: activity.id, prompt: activity.prompt + " Revisa los datos." }] };
    const before = await footprint(db, w);
    expect(await save(w.user.id, changes, 2)).toEqual({ revision: 3 });
    expect(applyEditorChanges(version.document, changes).contentBlocks).toEqual([activity.id]);
    expect(await footprint(db, w)).toEqual(before);
  });
});
