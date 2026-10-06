import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE, assetIdentity } from "@/lib/materials/visuals/recipe";
import { locateVisual, produceVisualAsset, resolveVisuals, retryVisualAsset, toLocator, type LocatorRow, type VisualActor } from "@/lib/materials/visuals/service";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { expectedMarker, visualFixtureImage, visualFixturePdf } from "../support/visual-fixture";
import { as, createTestDb, createUser } from "./harness";
import { seedMaterial, type User } from "./orchestration-harness";
import { attachSource, visualHarness, type VisualHarness } from "./visual-harness";

let db: PGlite;
let pdf: Uint8Array;
const analysis = fractionsAnalysis();
const ANALYSIS_FP = fingerprint(analysis);
beforeAll(async () => {
  db = await createTestDb();
  pdf = await visualFixturePdf();
}, 60_000);

let n = 0;
async function setup(mime = "application/pdf", bytes?: Uint8Array) {
  const user = await createUser(db, `visual-${++n}@example.com`);
  const material = await seedMaterial(db, user, analysis);
  const h = visualHarness(db, user);
  const sha = await attachSource(db, h, material, mime, bytes ?? pdf);
  const actor: VisualActor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  return { user, material, h, sha, actor };
}
const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const BOX = { x: 0.15, y: 0.22, w: 0.42, h: 0.14 };
const resolveFor = (s: { material: string; sha: string; h: VisualHarness }, visualIds = ["vis_1"], analysisFingerprint = ANALYSIS_FP) =>
  resolveVisuals(s.h.deps, { materialId: s.material, analysisFingerprint, sourceSha256: s.sha, visualIds, withBytes: true });

describe("locate → locator revision → server crop → private asset", () => {
  it("2/8 · a valid rectangle is saved as a locator and the server produces a PNG crop of the original (vector page)", async () => {
    const s = await setup();
    const result = await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    expect(result).toEqual({ ok: true, status: "ready", revision: 1 });
    const [locator] = await q<{ page: number; method: string; source_sha256: string; analysis_fingerprint: string; page_box: { kind: string } }>("select page, method, source_sha256, analysis_fingerprint, page_box from public.material_visual_locators where material_id = $1", [s.material]);
    expect(locator).toMatchObject({ page: 2, method: "human", source_sha256: s.sha, analysis_fingerprint: ANALYSIS_FP, page_box: { kind: "pdf" } });
    const [asset] = await q<{ storage_path: string; mime: string; width: number; height: number; sha256: string; recipe_version: string }>("select storage_path, mime, width, height, sha256, recipe_version from public.material_visual_assets where material_id = $1", [s.material]);
    expect(asset).toMatchObject({ mime: "image/png", recipe_version: VISUAL_CROP_RECIPE.version });
    expect(asset!.storage_path.startsWith(`${s.user.workspaceId}/${s.material}/visuals/`)).toBe(true);
    expect(asset!.storage_path).not.toMatch(/vis_|ficha|\.pdf/i);
    const bytes = s.h.objects.get(asset!.storage_path)!;
    expect(sha256(bytes)).toBe(asset!.sha256);
    // 200 ppp: 42 % of an A4 width plus the 1 % margins ≈ 0.44 × 1654 px.
    expect(asset!.width).toBeGreaterThan(700);
    expect(asset!.width / asset!.height).toBeCloseTo((0.42 + 0.02 * (595.28 / 595.28)) * 595.28 / ((0.14 + 0.02 * (595.28 / 841.89)) * 841.89), 1);
  });

  it("3/24 · invalid input never creates anything: too-small, outside, non-numeric, missing page", async () => {
    const s = await setup();
    for (const bounds of [{ x: 0.1, y: 0.1, w: 0.005, h: 0.2 }, { x: 0.9, y: 0.1, w: 0.3, h: 0.2 }, { x: "0.1", y: 0, w: 0.3, h: 0.2 }, null]) {
      expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 1, bounds })).toEqual({ ok: false, code: "invalid" });
    }
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 7, bounds: BOX })).toEqual({ ok: false, code: "page_missing" });
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 1.5, bounds: BOX })).toEqual({ ok: false, code: "invalid" });
    expect((await q("select 1 from public.material_visual_locators where material_id = $1", [s.material])).length).toBe(0);
  });

  it("1/16 · the client cannot invent a material, a visual or a workspace; a viewer cannot locate", async () => {
    const a = await setup();
    const b = await setup();
    expect(await locateVisual(a.h.deps, a.actor, { materialId: b.material, visualId: "vis_1", page: 1, bounds: BOX })).toEqual({ ok: false, code: "not_found" });
    expect(await locateVisual(a.h.deps, { ...a.actor, workspaceId: b.user.workspaceId }, { materialId: b.material, visualId: "vis_1", page: 1, bounds: BOX })).toEqual({ ok: false, code: "not_found" });
    expect(await locateVisual(a.h.deps, a.actor, { materialId: a.material, visualId: "vis_99", page: 1, bounds: BOX })).toEqual({ ok: false, code: "not_found" });
    expect(await locateVisual(a.h.deps, { ...a.actor, canWrite: false }, { materialId: a.material, visualId: "vis_1", page: 1, bounds: BOX })).toEqual({ ok: false, code: "forbidden" });
  });

  it("5/6 · another page can be chosen, and on a rotated page the crop is the region the person saw", async () => {
    const s = await setup();
    const e = expectedMarker(3); // 90°: the red square is now near the top-right corner of the page as shown
    const around = { x: e.x - 0.03, y: e.y - 0.025, w: 0.06, h: 0.05 };
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 3, bounds: around })).toMatchObject({ ok: true, status: "ready" });
    const [asset] = await q<{ storage_path: string; width: number; height: number }>("select storage_path, width, height from public.material_visual_assets where material_id = $1", [s.material]);
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(s.h.objects.get(asset!.storage_path)!));
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext("2d").drawImage(img, 0, 0);
    const centre = canvas.getContext("2d").getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
    expect(centre[0]).toBeGreaterThan(200);
    expect(centre[1]).toBeLessThan(60);
    expect((await q<{ page: number }>("select page from public.material_visual_locators where material_id = $1", [s.material]))[0]!.page).toBe(3);
  }, 30_000);

  it("7 · an uploaded image is one logical page with the same coordinates", async () => {
    const image = await visualFixtureImage();
    const s = await setup("image/png", image);
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX })).toEqual({ ok: false, code: "page_missing" });
    // Red square at (100–160, 80–140) of 800×600.
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 1, bounds: { x: 100 / 800, y: 80 / 600, w: 60 / 800, h: 60 / 600 } })).toMatchObject({ ok: true, status: "ready" });
    const [asset] = await q<{ width: number; height: number }>("select width, height from public.material_visual_assets where material_id = $1", [s.material]);
    // 60 px plus a margin of 1 % of 600 = 6 px on each side, never upscaled.
    expect(asset).toEqual({ width: 72, height: 72 });
  });
});

describe("identity, retry, correction and history", () => {
  it("10 · producing the same locator again is idempotent: same identity, one row, one object", async () => {
    const s = await setup();
    await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    const [locator] = await q<{ id: string }>("select id from public.material_visual_locators where material_id = $1", [s.material]);
    const before = [...s.h.objects.entries()];
    expect(await produceVisualAsset(s.h.deps, locator!.id)).toEqual({ ok: true });
    expect(await produceVisualAsset(s.h.deps, locator!.id)).toEqual({ ok: true });
    expect((await q("select 1 from public.material_visual_assets where material_id = $1", [s.material])).length).toBe(1);
    expect([...s.h.objects.entries()]).toEqual(before);
  });

  it("11 · if storing the crop fails, the locator is kept with its failure and a retry finishes it without a new selection", async () => {
    const s = await setup();
    s.h.failPutOnce();
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX })).toEqual({ ok: true, status: "extraction_failed", failure: "extraction_failed", revision: 1 });
    expect((await resolveFor(s)).states["vis_1"]).toMatchObject({ status: "extraction_failed", failure: "extraction_failed" });
    expect((await q("select 1 from public.material_visual_assets where material_id = $1", [s.material])).length).toBe(0);
    expect(await retryVisualAsset(s.h.deps, s.actor, s.material, "vis_1")).toEqual({ ok: true, status: "ready", revision: 1 });
    expect((await q("select 1 from public.material_visual_locators where material_id = $1", [s.material])).length).toBe(1);
    expect((await resolveFor(s)).states["vis_1"]).toMatchObject({ status: "ready" });
    expect(await retryVisualAsset(s.h.deps, s.actor, s.material, "vis_2")).toEqual({ ok: false, code: "geometry_missing" });
  });

  it("12/13 · a correction is a new revision with a new identity; the previous locator and asset stay untouched", async () => {
    const s = await setup();
    await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    const [first] = await q<{ storage_path: string; sha256: string; identity: string }>("select storage_path, sha256, identity from public.material_visual_assets where material_id = $1", [s.material]);
    const firstBytes = s.h.objects.get(first!.storage_path)!;
    expect(await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: { ...BOX, w: 0.3 } })).toEqual({ ok: true, status: "ready", revision: 2 });
    const locators = await q<{ revision: number; superseded_at: string | null }>("select revision, superseded_at from public.material_visual_locators where material_id = $1 order by revision", [s.material]);
    expect(locators.map((l) => [l.revision, l.superseded_at !== null])).toEqual([[1, true], [2, false]]);
    const assets = await q<{ identity: string }>("select identity from public.material_visual_assets where material_id = $1", [s.material]);
    expect(assets).toHaveLength(2);
    expect(new Set(assets.map((a) => a.identity)).size).toBe(2);
    expect(s.h.objects.get(first!.storage_path)).toEqual(firstBytes);
    // The current preview follows the active (corrected) locator.
    expect((await resolveFor(s)).states["vis_1"]).toMatchObject({ status: "ready", provenance: { revision: 2, page: 2, method: "human" } });
    // Locators and assets are immutable in the database itself.
    await expect(db.query("update public.material_visual_assets set width = 1 where material_id = $1", [s.material])).rejects.toThrow(/inmutable/);
    await expect(db.query("update public.material_visual_locators set x = 0 where material_id = $1", [s.material])).rejects.toThrow(/inmutable/);
    await expect(db.query("update public.material_visual_locators set superseded_at = null where material_id = $1 and revision = 1", [s.material])).rejects.toThrow(/no se reactiva/);
  });

  it("14/15 · the asset belongs to material + source + analysis + visual, never to an adaptation; another analysis or file does not reuse it", async () => {
    const s = await setup();
    await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    const first = await resolveFor(s);
    const second = await resolveFor(s);
    expect(first.states["vis_1"]!.status).toBe("ready");
    expect(second.bytes["vis_1"]).toEqual(first.bytes["vis_1"]);
    expect((await resolveFor(s, ["vis_1"], "f".repeat(64))).states["vis_1"]).toEqual({ visualId: "vis_1", status: "missing_locator" });
    expect((await resolveVisuals(s.h.deps, { materialId: s.material, analysisFingerprint: ANALYSIS_FP, sourceSha256: "e".repeat(64), visualIds: ["vis_1"] })).states["vis_1"]!.status).toBe("missing_locator");
    const columns = await q<{ column_name: string }>("select column_name from information_schema.columns where table_name in ('material_visual_locators', 'material_visual_assets')");
    expect(columns.map((c) => c.column_name)).not.toContain("adaptation_id");
    const [locator] = await q<Record<string, unknown>>("select * from public.material_visual_locators where material_id = $1", [s.material]);
    const identity = assetIdentity(toLocator({ ...(locator! as unknown as LocatorRow), x: Number(locator!.x), y: Number(locator!.y), w: Number(locator!.w), h: Number(locator!.h) }));
    expect((await q<{ identity: string }>("select identity from public.material_visual_assets where material_id = $1", [s.material]))[0]!.identity).toBe(identity);
  });

  it("a changed original (another file under the same material) is never cropped with an old locator", async () => {
    const s = await setup();
    await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    const [asset] = await q<{ storage_path: string }>("select storage_path from public.material_visual_assets where material_id = $1", [s.material]);
    s.h.objects.delete(asset!.storage_path);
    s.h.sources.set(s.material, { mime: "image/png", bytes: await visualFixtureImage() });
    expect(await retryVisualAsset(s.h.deps, s.actor, s.material, "vis_1")).toMatchObject({ ok: true, status: "extraction_failed", failure: "source_missing" });
  });
});

describe("integrity and isolation", () => {
  it("19/36 · metadata alone is not 'ready': a missing or corrupt object is reported, and a retry repairs it deterministically", async () => {
    const s = await setup();
    await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    const [asset] = await q<{ storage_path: string; sha256: string }>("select storage_path, sha256 from public.material_visual_assets where material_id = $1", [s.material]);
    const good = s.h.objects.get(asset!.storage_path)!;
    s.h.objects.set(asset!.storage_path, new Uint8Array([1, 2, 3]));
    expect((await resolveFor(s)).states["vis_1"]).toMatchObject({ status: "extraction_failed", failure: "asset_corrupt" });
    s.h.objects.delete(asset!.storage_path);
    expect((await resolveFor(s)).states["vis_1"]).toMatchObject({ status: "extraction_failed", failure: "asset_missing" });
    expect(await retryVisualAsset(s.h.deps, s.actor, s.material, "vis_1")).toMatchObject({ ok: true, status: "ready" });
    expect(s.h.objects.get(asset!.storage_path)).toEqual(good);
    expect((await resolveFor(s)).states["vis_1"]!.status).toBe("ready");
  });

  it("16/17/18 · another workspace sees no locator, no asset row and no object (the bucket stays private)", async () => {
    const owner = await setup();
    await locateVisual(owner.h.deps, owner.actor, { materialId: owner.material, visualId: "vis_1", page: 2, bounds: BOX });
    const intruder: User = await createUser(db, `intruder-${++n}@example.com`);
    const intruderHarness = visualHarness(db, intruder, { objects: owner.h.objects, sources: owner.h.sources });
    expect(await as(db, "authenticated", intruder.id, () => db.query("select 1 from public.material_visual_locators where material_id = $1", [owner.material]))).toMatchObject({ rows: [] });
    expect(await as(db, "authenticated", intruder.id, () => db.query("select 1 from public.material_visual_assets where material_id = $1", [owner.material]))).toMatchObject({ rows: [] });
    const [asset] = await q<{ storage_path: string }>("select storage_path from public.material_visual_assets where material_id = $1", [owner.material]);
    expect(await intruderHarness.deps.reader.readObject(asset!.storage_path)).toBeNull();
    expect((await resolveVisuals(intruderHarness.deps, { materialId: owner.material, analysisFingerprint: ANALYSIS_FP, sourceSha256: owner.sha, visualIds: ["vis_1"] })).states["vis_1"]!.status).toBe("missing_locator");
    await expect(as(db, "anon", null, () => db.query("select 1 from public.material_visual_assets"))).rejects.toThrow(/permission denied/);
    expect((await q<{ public: boolean }>("select public from storage.buckets where id = 'generated-assets'"))[0]!.public).toBe(false);
    // Writes are server-only, even for a member.
    await expect(as(db, "authenticated", owner.user.id, () => db.query("insert into public.material_visual_locators (workspace_id, material_id, analysis_fingerprint, visual_id, source_sha256, locator_version, revision, method, page, x, y, w, h, page_box) values ($1, $2, $3, 'vis_1', $4, 1, 9, 'human', 1, 0, 0, 0.5, 0.5, '{}')", [owner.user.workspaceId, owner.material, ANALYSIS_FP, owner.sha]))).rejects.toThrow();
    await expect(as(db, "authenticated", owner.user.id, () => db.query("select public.create_visual_locator($1, $2, $3, 'vis_1', $4, 'human', 1, 0, 0, 0.5, 0.5, '{}', $5)", [owner.user.workspaceId, owner.material, ANALYSIS_FP, owner.sha, owner.user.id]))).rejects.toThrow();
  });

  it("the crop is the original's pixels at the recipe's density, rendered by the same rasteriser (no client bitmap involved)", async () => {
    const s = await setup();
    await locateVisual(s.h.deps, s.actor, { materialId: s.material, visualId: "vis_1", page: 2, bounds: BOX });
    const page = await renderPage(pdf, "application/pdf", 2, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
    const [asset] = await q<{ provenance: { pixel_rect: { left: number; top: number; width: number; height: number } }; width: number }>("select provenance, width from public.material_visual_assets where material_id = $1", [s.material]);
    expect(asset!.provenance.pixel_rect.left).toBe(Math.floor((BOX.x - 0.01) * page.width));
    expect(asset!.width).toBe(asset!.provenance.pixel_rect.width);
  });
});
