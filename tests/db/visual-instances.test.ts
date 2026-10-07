import { createHash } from "node:crypto";
import path from "node:path";
import { crc32 } from "node:zlib";
import type { PGlite } from "@electric-sql/pglite";
import { loadImage } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { cropPng, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE, assetIdentity, assetInstancePath, recipeFingerprint } from "@/lib/materials/visuals/recipe";
import { locateVisual, produceVisualAsset, readAssetInstance, resolveVisuals, retryVisualAsset, toLocator, type LocatorRow, type VisualActor } from "@/lib/materials/visuals/service";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { visualFixturePdf } from "../support/visual-fixture";
import { applyMigration, as, createTestDb, createUser, migrationFiles } from "./harness";
import { seedMaterial, type User } from "./orchestration-harness";
import { attachSource, visualHarness, type VisualHarness } from "./visual-harness";

/**
 * `identity` is the logical crop; each asset row is one immutable physical instance with the sha-256 of its own bytes. A valid
 * render may be byte-different in another runtime (Node, glibc, Skia), so regeneration must never depend on reproducing old bytes.
 * "Another runtime" is simulated with a valid PNG of the same crop whose bytes differ (an extra ancillary chunk).
 */

const analysis = fractionsAnalysis();
const ANALYSIS_FP = fingerprint(analysis);
const BOX = { x: 0.15, y: 0.22, w: 0.42, h: 0.14 };
const PAGE = 2;
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let pdf: Uint8Array;
let crop: Uint8Array;
beforeAll(async () => {
  pdf = await visualFixturePdf();
  // What THIS runtime renders for the locator used below (same steps as the producer).
  const page = await renderPage(pdf, "application/pdf", PAGE, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
  if (page.box.kind !== "pdf") throw new Error("pdf expected");
  const rect = pixelRect(withMargin(BOX, { width: page.box.width_pt, height: page.box.height_pt }, VISUAL_CROP_RECIPE.margin), page.width, page.height);
  crop = (await cropPng(page, rect)).png;
}, 60_000);

/** Same pixels, different bytes: a tEXt chunk after IHDR. A valid PNG, as another runtime's render of the same crop would be. */
function otherRuntime(png: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from("tEXt"), Buffer.from("Software\0another runtime")]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  const ihdrEnd = 8 + 25;
  return new Uint8Array(Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]));
}

interface Ctx {
  db: PGlite;
  user: User;
  material: string;
  sha: string;
  h: VisualHarness;
  actor: VisualActor;
}

let n = 0;
async function setup(db: PGlite): Promise<Ctx> {
  const user = await createUser(db, `instances-${++n}@example.com`);
  const material = await seedMaterial(db, user, analysis);
  const h = visualHarness(db, user);
  const sha = await attachSource(db, h, material, "application/pdf", pdf);
  return { db, user, material, sha, h, actor: { userId: user.id, workspaceId: user.workspaceId, canWrite: true } };
}

const rows = <T>(db: PGlite, sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const resolveFor = (c: Ctx) => resolveVisuals(c.h.deps, { materialId: c.material, analysisFingerprint: ANALYSIS_FP, sourceSha256: c.sha, visualIds: ["vis_1"], withBytes: true });

/** A saved locator with no instance yet (storing its first crop failed). */
async function locatorOnly(c: Ctx) {
  c.h.failPutOnce();
  expect(await locateVisual(c.h.deps, c.actor, { materialId: c.material, visualId: "vis_1", page: PAGE, bounds: BOX })).toMatchObject({ ok: true, status: "extraction_failed" });
  const [{ id }] = (await rows<{ id: string }>(c.db, "select id from public.material_visual_locators where material_id = $1", [c.material])) as [{ id: string }];
  const row = (await c.h.deps.admin.locator(id)) as LocatorRow;
  return { row, identity: assetIdentity(toLocator(row)) };
}

/** An instance stored as some earlier producer left it: its object plus its immutable row, `ageSeconds` relative to now. */
async function seedInstance(c: Ctx, row: LocatorRow, bytes: Uint8Array, options: { ageSeconds: number; path?: string }) {
  const identity = assetIdentity(toLocator(row));
  const storagePath = options.path ?? assetInstancePath(row.workspace_id, row.material_id, identity, sha256(bytes));
  const img = await loadImage(Buffer.from(bytes));
  c.h.objects.set(storagePath, bytes);
  await c.db.query("insert into storage.objects (bucket_id, name) values ('generated-assets', $1) on conflict do nothing", [storagePath]);
  const [inserted] = await as(c.db, "service_role", null, () =>
    rows<{ id: string }>(
      c.db,
      "insert into public.material_visual_assets (workspace_id, material_id, locator_id, identity, recipe_version, recipe_fingerprint, storage_path, mime, width, height, bytes, sha256, provenance, created_at) values ($1,$2,$3,$4,$5,$6,$7,'image/png',$8,$9,$10,$11,$12, now() - make_interval(secs => $13)) returning id",
      [row.workspace_id, row.material_id, row.id, identity, VISUAL_CROP_RECIPE.version, recipeFingerprint(), storagePath, img.width, img.height, bytes.length, sha256(bytes), JSON.stringify({ engine: { node: "another runtime" } }), options.ageSeconds],
    ),
  );
  return { id: inserted!.id, path: storagePath, sha: sha256(bytes) };
}

const instancesOf = (c: Ctx) => rows<{ id: string; storage_path: string; sha256: string; identity: string }>(c.db, "select id, storage_path, sha256, identity from public.material_visual_assets where material_id = $1 order by created_at, id", [c.material]);
const visualObjects = (c: Ctx) => [...c.h.objects.keys()].filter((k) => k.startsWith(`${c.user.workspaceId}/${c.material}/visuals/`)).sort();

describe("physical instances of one logical crop (same database, 017 applied)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);

  it("cross-runtime: a valid instance whose object is lost is regenerated as a NEW instance, never a false asset_corrupt", async () => {
    const c = await setup(db);
    const { row, identity } = await locatorOnly(c);
    const foreign = otherRuntime(crop);
    expect(sha256(foreign)).not.toBe(sha256(crop));
    expect((await loadImage(Buffer.from(foreign))).width).toBeGreaterThan(0);
    const a = await seedInstance(c, row, foreign, { ageSeconds: 60 });
    expect((await resolveFor(c)).states["vis_1"]).toMatchObject({ status: "ready" });
    const rowA = await rows(db, "select * from public.material_visual_assets where id = $1", [a.id]);

    c.h.objects.delete(a.path);
    expect((await resolveFor(c)).states["vis_1"]).toMatchObject({ status: "extraction_failed", failure: "asset_missing" });
    expect(await retryVisualAsset(c.h.deps, c.actor, c.material, "vis_1")).toEqual({ ok: true, status: "ready", revision: 1 });

    const all = await instancesOf(c);
    expect(all).toHaveLength(2);
    const b = all.find((i) => i.id !== a.id)!;
    expect(b).toMatchObject({ identity, sha256: sha256(crop), storage_path: assetInstancePath(c.user.workspaceId, c.material, identity, sha256(crop)) });
    expect(b.sha256).not.toBe(a.sha);
    expect(await rows(db, "select * from public.material_visual_assets where id = $1", [a.id])).toEqual(rowA);
    expect(c.h.objects.has(a.path)).toBe(false);
    expect(sha256(c.h.objects.get(b.storage_path)!)).toBe(b.sha256);

    const resolved = await resolveFor(c);
    expect(resolved.states["vis_1"]).toMatchObject({ status: "ready", provenance: { revision: 1 } });
    expect(resolved.bytes["vis_1"]).toEqual(crop);
    const locators = await rows<{ revision: number; superseded_at: string | null; last_failure: string | null }>(db, "select revision, superseded_at, last_failure from public.material_visual_locators where material_id = $1", [c.material]);
    expect(locators).toEqual([{ revision: 1, superseded_at: null, last_failure: null }]);

    // Retrying again is idempotent: no new rows, no object touched.
    const objects = visualObjects(c).map((k) => [k, c.h.objects.get(k)]);
    for (let i = 0; i < 3; i++) expect(await retryVisualAsset(c.h.deps, c.actor, c.material, "vis_1")).toEqual({ ok: true, status: "ready", revision: 1 });
    expect(await instancesOf(c)).toHaveLength(2);
    expect(visualObjects(c).map((k) => [k, c.h.objects.get(k)])).toEqual(objects);
  });

  it("same sha: a lost or damaged object is put back at ITS path with the certified bytes; no second row", async () => {
    const c = await setup(db);
    await locateVisual(c.h.deps, c.actor, { materialId: c.material, visualId: "vis_1", page: PAGE, bounds: BOX });
    const [before] = await instancesOf(c);
    const good = c.h.objects.get(before!.storage_path)!;
    for (const damage of [() => c.h.objects.delete(before!.storage_path), () => c.h.objects.set(before!.storage_path, new Uint8Array([1, 2, 3]))]) {
      damage();
      expect(await retryVisualAsset(c.h.deps, c.actor, c.material, "vis_1")).toEqual({ ok: true, status: "ready", revision: 1 });
      expect(await instancesOf(c)).toEqual([before]);
      expect(c.h.objects.get(before!.storage_path)).toEqual(good);
      expect(visualObjects(c)).toEqual([before!.storage_path]);
    }
  });

  it("a damaged instance never hides a valid one; with none valid, the newest instance's problem is reported", async () => {
    const c = await setup(db);
    await locateVisual(c.h.deps, c.actor, { materialId: c.material, visualId: "vis_1", page: PAGE, bounds: BOX });
    const [valid] = await instancesOf(c);
    const row = (await c.h.deps.admin.activeLocator(c.material, ANALYSIS_FP, "vis_1"))!;
    const newer = await seedInstance(c, row, otherRuntime(crop), { ageSeconds: -60 });
    c.h.objects.set(newer.path, new Uint8Array([9, 9, 9]));

    const resolved = await resolveFor(c);
    expect(resolved.states["vis_1"]!.status).toBe("ready");
    expect(resolved.bytes["vis_1"]).toEqual(crop);
    const snapshot = visualObjects(c).map((k) => [k, c.h.objects.get(k)]);
    expect(await produceVisualAsset(c.h.deps, row.id)).toEqual({ ok: true });
    expect(visualObjects(c).map((k) => [k, c.h.objects.get(k)])).toEqual(snapshot);
    expect(await instancesOf(c)).toHaveLength(2);

    c.h.objects.delete(valid!.storage_path);
    expect((await resolveFor(c)).states["vis_1"]).toMatchObject({ status: "extraction_failed", failure: "asset_corrupt" });
    expect(await retryVisualAsset(c.h.deps, c.actor, c.material, "vis_1")).toEqual({ ok: true, status: "ready", revision: 1 });
    expect(c.h.objects.get(valid!.storage_path)).toEqual(crop);
    expect(c.h.objects.get(newer.path)).toEqual(new Uint8Array([9, 9, 9]));
    expect(await instancesOf(c)).toHaveLength(2);
  });

  it("concurrency, same bytes: two producers leave one instance and one object, and neither fails", async () => {
    const c = await setup(db);
    const { row } = await locatorOnly(c);
    expect(await Promise.all([produceVisualAsset(c.h.deps, row.id), produceVisualAsset(c.h.deps, row.id)])).toEqual([{ ok: true }, { ok: true }]);
    const all = await instancesOf(c);
    expect(all).toHaveLength(1);
    expect(visualObjects(c)).toEqual([all[0]!.storage_path]);
    expect(sha256(c.h.objects.get(all[0]!.storage_path)!)).toBe(all[0]!.sha256);
  });

  it("concurrency, object already there: the same bytes are accepted (one row); other bytes fail safely and are left untouched", async () => {
    const same = await setup(db);
    const { row, identity } = await locatorOnly(same);
    const target = assetInstancePath(same.user.workspaceId, same.material, identity, sha256(crop));
    same.h.objects.set(target, crop);
    expect(await produceVisualAsset(same.h.deps, row.id)).toEqual({ ok: true });
    expect(await instancesOf(same)).toMatchObject([{ storage_path: target, sha256: sha256(crop) }]);

    const other = await setup(db);
    const second = await locatorOnly(other);
    const occupied = assetInstancePath(other.user.workspaceId, other.material, second.identity, sha256(crop));
    other.h.objects.set(occupied, new Uint8Array([7, 7, 7]));
    expect(await produceVisualAsset(other.h.deps, second.row.id)).toEqual({ ok: false, failure: "asset_corrupt" });
    expect(other.h.objects.get(occupied)).toEqual(new Uint8Array([7, 7, 7]));
    expect(await instancesOf(other)).toHaveLength(0);
  });

  it("concurrency, different bytes: both instances exist and neither overwrites the other", async () => {
    const c = await setup(db);
    const { row, identity } = await locatorOnly(c);
    const foreign = otherRuntime(crop);
    const foreignPath = assetInstancePath(c.user.workspaceId, c.material, identity, sha256(foreign));
    const img = await loadImage(Buffer.from(foreign));
    // Another runtime producing the same logical crop at the same time, through the same storage and database operations.
    const otherProducer = async () => {
      expect(await c.h.deps.admin.putObject(foreignPath, foreign, "create")).toBe("stored");
      await c.h.deps.admin.insertAsset({ workspace_id: row.workspace_id, material_id: row.material_id, locator_id: row.id, identity, recipe_version: VISUAL_CROP_RECIPE.version, recipe_fingerprint: recipeFingerprint(), storage_path: foreignPath, mime: "image/png", width: img.width, height: img.height, bytes: foreign.length, sha256: sha256(foreign), provenance: {} });
    };
    const [result] = await Promise.all([produceVisualAsset(c.h.deps, row.id), otherProducer()]);
    expect(result).toEqual({ ok: true });
    const all = await instancesOf(c);
    expect(new Set(all.map((i) => i.sha256))).toEqual(new Set([sha256(crop), sha256(foreign)]));
    expect(new Set(all.map((i) => i.identity))).toEqual(new Set([identity]));
    for (const instance of all) expect(sha256(c.h.objects.get(instance.storage_path)!)).toBe(instance.sha256);
    expect(visualObjects(c)).toHaveLength(2);
    expect((await resolveFor(c)).states["vis_1"]!.status).toBe("ready");
  });

  it("the database enforces the model: one row per (identity, sha256), several per identity, still immutable", async () => {
    const c = await setup(db);
    await locateVisual(c.h.deps, c.actor, { materialId: c.material, visualId: "vis_1", page: PAGE, bounds: BOX });
    const row = (await c.h.deps.admin.activeLocator(c.material, ANALYSIS_FP, "vis_1"))!;
    await expect(seedInstance(c, row, crop, { ageSeconds: 0, path: "elsewhere/x.png" })).rejects.toThrow(/duplicate key|unique/i);
    await seedInstance(c, row, otherRuntime(crop), { ageSeconds: 0 });
    expect(await instancesOf(c)).toHaveLength(2);
    await expect(db.query("update public.material_visual_assets set sha256 = $2 where material_id = $1", [c.material, "0".repeat(64)])).rejects.toThrow(/inmutable/);
  });

  it("exact pin: an (instance id, sha-256) gives those bytes or an explicit failure, never another instance of the same crop", async () => {
    const c = await setup(db);
    await locateVisual(c.h.deps, c.actor, { materialId: c.material, visualId: "vis_1", page: PAGE, bounds: BOX });
    const [first] = await instancesOf(c);
    const row = (await c.h.deps.admin.activeLocator(c.material, ANALYSIS_FP, "vis_1"))!;
    const second = await seedInstance(c, row, otherRuntime(crop), { ageSeconds: 60 });

    expect(await readAssetInstance(c.h.deps, { assetId: first!.id, sha256: first!.sha256 })).toEqual({ ok: true, bytes: crop });
    expect(await readAssetInstance(c.h.deps, { assetId: second.id, sha256: second.sha })).toEqual({ ok: true, bytes: otherRuntime(crop) });
    expect(await readAssetInstance(c.h.deps, { assetId: first!.id, sha256: second.sha })).toEqual({ ok: false, failure: "not_found" });

    c.h.objects.delete(first!.storage_path);
    expect(await readAssetInstance(c.h.deps, { assetId: first!.id, sha256: first!.sha256 })).toEqual({ ok: false, failure: "asset_missing" });
    expect((await resolveFor(c)).bytes["vis_1"]).toEqual(otherRuntime(crop));
    c.h.objects.set(second.path, new Uint8Array([1]));
    expect(await readAssetInstance(c.h.deps, { assetId: second.id, sha256: second.sha })).toEqual({ ok: false, failure: "asset_corrupt" });

    const intruder = await createUser(db, `intruder-instances-${++n}@example.com`);
    const intruderDeps = visualHarness(db, intruder, { objects: c.h.objects, sources: c.h.sources }).deps;
    expect(await readAssetInstance(intruderDeps, { assetId: second.id, sha256: second.sha })).toEqual({ ok: false, failure: "not_found" });
  });

  it("provenance records the engine that actually rendered, and never takes part in the identity", async () => {
    const c = await setup(db);
    await locateVisual(c.h.deps, c.actor, { materialId: c.material, visualId: "vis_1", page: PAGE, bounds: BOX });
    const [asset] = await rows<{ identity: string; provenance: { engine: Record<string, string | null> } }>(db, "select identity, provenance from public.material_visual_assets where material_id = $1", [c.material]);
    expect(asset!.provenance.engine).toEqual({ "pdfjs-dist": "6.4.299", "@napi-rs/canvas": "1.0.10", node: process.version, platform: process.platform, arch: process.arch });
    const row = (await c.h.deps.admin.activeLocator(c.material, ANALYSIS_FP, "vis_1"))!;
    expect(asset!.identity).toBe(assetIdentity(toLocator(row)));
  });
});

describe("017 over assets stored before it (legacy path, single instance per identity)", () => {
  it("existing rows and objects stay valid where they are: resolved, confirmed and repaired at their original path", async () => {
    const db = await createTestDb({ through: "20261001001600" });
    const c = await setup(db);
    const { row, identity } = await locatorOnly(c);
    const legacyPath = `${c.user.workspaceId}/${c.material}/visuals/${identity}.png`;
    const legacy = await seedInstance(c, row, crop, { ageSeconds: 60, path: legacyPath });
    const before = await rows(db, "select * from public.material_visual_assets where id = $1", [legacy.id]);

    const migration = migrationFiles().find((f) => path.basename(f).startsWith("20261001001700"))!;
    await applyMigration(db, migration);

    expect(await rows(db, "select * from public.material_visual_assets where id = $1", [legacy.id])).toEqual(before);
    const constraints = (await rows<{ conname: string }>(db, "select conname from pg_constraint where conrelid = 'public.material_visual_assets'::regclass and contype = 'u'")).map((r) => r.conname).sort();
    expect(constraints).toEqual(["material_visual_assets_identity_sha256_key", "material_visual_assets_storage_path_key"]);
    expect((await rows(db, "select 1 from pg_indexes where indexname = 'material_visual_assets_identity_idx'")).length).toBe(1);

    expect((await resolveFor(c)).bytes["vis_1"]).toEqual(crop);
    expect(await produceVisualAsset(c.h.deps, row.id)).toEqual({ ok: true });
    c.h.objects.delete(legacyPath);
    expect(await retryVisualAsset(c.h.deps, c.actor, c.material, "vis_1")).toEqual({ ok: true, status: "ready", revision: 1 });
    expect(c.h.objects.get(legacyPath)).toEqual(crop);
    expect(visualObjects(c)).toEqual([legacyPath]);
    expect(await instancesOf(c)).toHaveLength(1);
    expect(await rows(db, "select * from public.material_visual_assets where id = $1", [legacy.id])).toEqual(before);
  }, 60_000);
});
