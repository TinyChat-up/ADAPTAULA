import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { exportAdaptationPdf } from "@/lib/render/pdf-export";
import { pdfEngine } from "@/lib/render/print/server";
import { as, createTestDb } from "../db/harness";
import { deliveredWithVisuals, footprint, replaceDocument, type World } from "../db/pdf-export-harness";
import { analyzePdf } from "./analyze";
import { document, image, lines, table, withSecretKey, ANSWER_KEY_SECRET } from "./fixtures";
import { applyEditorChanges, type SavedDraft } from "@/lib/editor/changes";

let db: PGlite, w: World;
beforeAll(async () => { db = await createTestDb(); w = await deliveredWithVisuals(db); }, 90000);
afterAll(async () => { await db?.close(); });

it("the saved draft produces a real CLARO PDF with edited text, answer space, table and pinned figures, keeping the original and key untouched", async () => {
  const activity = lines("1", "Observa las dos figuras y explica tu elección.", 3);
  const original = withSecretKey(document([[image("vis_1", "Primera figura"), image("vis_2", "Segunda figura"), table("Medidas conservadas", 2), activity]]));
  await replaceDocument(db, w.id, original);
  const changes = { presentation: { font_scale: 1.15 as const, spacing: "wide" as const }, activities: [{ blockId: activity.id, prompt: "Compara ambas figuras y justifica tu elección.", lines: 10 }] };
  const before = await footprint(db, w);
  await as(db, "authenticated", w.user.id, () => db.query("select public.save_adaptation_draft($1,1,0,$2,true)", [w.id, JSON.stringify(changes)]));
  const drafts = { async read(id: string, base: number, revision?: number): Promise<SavedDraft | null> {
    const row = await as(db, "authenticated", w.user.id, async () => (await db.query<{ revision: number; changes: SavedDraft["changes"]; content_acknowledged: boolean }>(
      "select revision,changes,content_acknowledged from public.adaptation_drafts where adaptation_id=$1 and base_version=$2 and revision=$3", [id, base, revision])).rows[0]);
    return row ? { revision: row.revision, changes: row.changes, contentAcknowledged: row.content_acknowledged } : null;
  } };
  const deps = { service: w.deps, visuals: w.visuals.deps, engine: pdfEngine(), drafts };
  const result = await exportAdaptationPdf(deps, w.actor, w.id, 1);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  const pages = await analyzePdf(result.pdf);
  expect(result.pageCount).toBe(pages.length);
  const text = pages.map((p) => p.text).join(" ");
  expect(text).toContain("Compara ambas figuras");
  expect(text).not.toContain("Observa las dos figuras");
  expect(text).toContain("Medidas conservadas");
  expect(text).toContain("Cabecera 1");
  expect(text).not.toContain(ANSWER_KEY_SECRET);
  await as(db, "authenticated", w.user.id, () => db.query("select public.save_adaptation_draft($1,1,1,$2,true)", [w.id, JSON.stringify({ ...changes, activities: [{ blockId: activity.id, prompt: "Otra revisión posterior con las mismas figuras.", lines: 4 }] })]));
  const pinnedRevision = await exportAdaptationPdf(deps, w.actor, w.id, 1);
  if (!pinnedRevision.ok) throw new Error(pinnedRevision.code);
  const pinnedText = (await analyzePdf(pinnedRevision.pdf)).map((p) => p.text).join(" ");
  expect(pinnedText).toContain("Compara ambas figuras");
  expect(pinnedText).not.toContain("Otra revisión posterior");
  expect(applyEditorChanges(original, changes).document.pages[0]!.blocks.find((b) => b.id === activity.id)).toMatchObject({ response: { lines: 10 } });
  const originalResult = await exportAdaptationPdf(deps, w.actor, w.id);
  if (!originalResult.ok) throw new Error(originalResult.code);
  const originalText = (await analyzePdf(originalResult.pdf)).map((p) => p.text).join(" ");
  expect(originalText).toContain("Observa las dos figuras");
  expect(originalText).not.toContain("Compara ambas figuras");
  expect(await footprint(db, w)).toEqual(before);
  expect(await exportAdaptationPdf(deps, w.actor, w.id, 99)).toEqual({ ok: false, code: "not_found" });
  expect(await exportAdaptationPdf(deps, w.actor, w.id, 1, 2)).toEqual({ ok: false, code: "version_changed" });
  const unacknowledged = { ...deps, drafts: { read: async () => ({ revision: 1, changes, contentAcknowledged: false }) } };
  expect(await exportAdaptationPdf(unacknowledged, w.actor, w.id, 1)).toEqual({ ok: false, code: "not_renderable" });
}, 90000);
