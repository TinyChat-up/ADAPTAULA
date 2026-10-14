import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { AUTO_ENGINE_VERSION, prepareVisuals, type AutoRunInput } from "@/lib/materials/visuals/auto/service";
import { cropPng, renderPage, pageBox } from "@/lib/materials/visuals/raster";
import { locateVisual, produceVisualAsset, readAssetInstance, resolveVisuals, toLocator } from "@/lib/materials/visuals/service";
import { assetIdentity, assetInstancePath, recipeFingerprint, VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { pixelRect } from "@/lib/materials/visuals/geometry";
import { adversarialScanPdf } from "../support/scan-adversarial-case";
import { cellCaseAnalysis } from "../support/cell-case";
import { SCHEME_BOUNDS, scannedPdf, scannedPng } from "../support/scan-case";
import { createTestDb, createUser } from "./harness";
import { seedMaterial } from "./orchestration-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/** Scans stay unresolved automatically; explicit human selection keeps the existing crop and private-storage path. */

let db: PGlite;
let base: Uint8Array;
beforeAll(async () => {
  db = await createTestDb();
  base = await scannedPdf();
}, 120_000);

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
let n = 0;

async function world(source: { mime: string; bytes: Uint8Array } = { mime: "application/pdf", bytes: base }) {
  const user = await createUser(db, `scan-visuals-${++n}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  const analysis = cellCaseAnalysis();
  const materialId = await seedMaterial(db, user, analysis);
  const visuals = visualHarness(db, user);
  const sourceSha256 = await attachSource(db, visuals, materialId, source.mime, source.bytes);
  const auto = autoHarness(db, visuals);
  const input: AutoRunInput = { workspaceId: user.workspaceId, materialId, analysis, analysisFingerprint: fingerprint(analysis), sourceSha256, adaptationId: null };
  const resolve = (sha = sourceSha256) => resolveVisuals(visuals.deps, { materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256: sha, visualIds: ["vis_1"] });
  return { user, materialId, visuals, auto, input, resolve };
}

describe("scanned originals: restricted acceptance, manual fallback and versions", () => {
  const select = (w: Awaited<ReturnType<typeof world>>) => locateVisual(w.visuals.deps, { userId: w.user.id, workspaceId: w.user.workspaceId, canWrite: true },
    { materialId: w.materialId, visualId: "vis_1", page: 1, bounds: SCHEME_BOUNDS });

  it("PDF: no identity evidence, no automatic locator or asset, idempotent stop", async () => {
    const w = await world();
    w.auto.deps.vision = { locate: async () => { throw new Error("scan must not reach a provider"); } };
    const first = await prepareVisuals(w.auto.deps, w.input);
    expect(first).toMatchObject({ status: "completed", result: { engine: AUTO_ENGINE_VERSION, vision_pages: 0,
      visuals: { vis_1: { choice: "D", reason: "scan_identity_unverified" } } } });
    expect(await prepareVisuals(w.auto.deps, w.input)).toEqual({ status: "cached", result: "result" in first ? first.result : null });
    expect(await q("select id from public.material_visual_locators where material_id=$1", [w.materialId])).toEqual([]);
    expect(await q("select id from public.material_visual_assets where material_id=$1", [w.materialId])).toEqual([]);
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "missing_locator", resolution: "D" });
    expect(await q("select id from public.ai_runs where material_id=$1", [w.materialId])).toEqual([]);
  });

  it("PNG: same restriction, never an image-only bypass", async () => {
    const w = await world({ mime: "image/png", bytes: await scannedPng() });
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ result: { visuals: { vis_1: { choice: "D" } } } });
    expect((await w.resolve()).states.vis_1!.status).not.toBe("ready");
  });

  it("a teacher's explicit selection is preserved, rasterised and stored privately with its source hash", async () => {
    const w = await world();
    expect(await select(w)).toMatchObject({ ok: true, status: "ready" });
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ result: { visuals: { vis_1: { choice: "A", reason: "kept_human" } } } });
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "ready", resolution: "A", provenance: { method: "human" } });
    expect(await q("select source_sha256, method from public.material_visual_locators where material_id=$1", [w.materialId])).toEqual([{ source_sha256: w.input.sourceSha256, method: "human" }]);
    const stranger = await createUser(db, `scan-stranger-${++n}@example.com`);
    const foreign = visualHarness(db, stranger, w.visuals);
    const resolved = await resolveVisuals(foreign.deps, { ...w.input, visualIds: ["vis_1"], withBytes: true });
    expect(resolved.states.vis_1!.status).toBe("missing_locator");
    expect(resolved.bytes).toEqual({});
  });

  it("changing the source cannot inherit a manually selected figure from the old version", async () => {
    const w = await world();
    await select(w);
    const second = await attachSource(db, w.visuals, w.materialId, "application/pdf", await scannedPdf({ scheme: false }));
    expect(second).not.toBe(w.input.sourceSha256);
    expect(await prepareVisuals(w.auto.deps, { ...w.input, sourceSha256: second })).toMatchObject({ result: { visuals: { vis_1: { choice: "D" } } } });
    expect((await w.resolve(second)).states.vis_1!.status).not.toBe("ready");
    expect(await q("select source_sha256 from public.material_visual_locators where material_id=$1", [w.materialId])).toEqual([{ source_sha256: w.input.sourceSha256 }]);
  });

  it("a wrong logo reaches neither private Storage nor ready state", async () => {
    const w = await world({ mime: "application/pdf", bytes: await adversarialScanPdf("C") });
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ result: { visuals: { vis_1: { choice: "D" } } } });
    expect(await q("select id from public.material_visual_assets where material_id=$1", [w.materialId])).toEqual([]);
    expect((await w.resolve()).states.vis_1!.status).not.toBe("ready");
  });

  it("the locator returned by the RPC must match the preloaded original, including an existing revision", async () => {
    const w = await world();
    const args = { workspaceId: w.user.workspaceId, materialId: w.materialId, analysisFingerprint: w.input.analysisFingerprint,
      visualId: "vis_1", sourceSha256: w.input.sourceSha256!, page: 1, bounds: SCHEME_BOUNDS,
      pageBox: await pageBox(base, "application/pdf", 1), userId: w.user.id };
    const first = await w.visuals.deps.admin.createLocator(args);
    const changed = await scannedPdf({ scheme: false });
    const hash = createHash("sha256").update(changed).digest("hex");
    const returned = await w.visuals.deps.admin.createLocator({ ...args, sourceSha256: hash, method: "auto", confidence: .9, evidence: {} });
    expect(returned).toMatchObject({ id: first.id, created: false });
    expect(await produceVisualAsset(w.visuals.deps, returned.id, { mime: "application/pdf", bytes: changed })).toMatchObject({ ok: false, failure: "source_missing" });
    expect(await q("select id from public.material_visual_assets where material_id=$1", [w.materialId])).toEqual([]);
  });

  it("legacy scan assets cannot bypass the gate through cached runs, quick reads, pins or retries; manual correction remains possible", async () => {
    const w = await world();
    const created = await w.visuals.deps.admin.createLocator({ workspaceId: w.user.workspaceId, materialId: w.materialId, analysisFingerprint: w.input.analysisFingerprint,
      visualId: "vis_1", sourceSha256: w.input.sourceSha256!, page: 1, bounds: SCHEME_BOUNDS, pageBox: await pageBox(base, "application/pdf", 1),
      userId: null, method: "auto", confidence: .75, evidence: { engine: "auto_visuals@v3", scan: { method: "scan_single_region@v1" } } });
    const row = (await w.visuals.deps.admin.locator(created.id))!;
    // Seed an experimental v3 asset directly, without disabling immutable triggers or calling the corrected producer.
    const page = await renderPage(base, "application/pdf", 1, { dpi: 200, maxPx: 4096 });
    const crop = await cropPng(page, pixelRect(SCHEME_BOUNDS, page.width, page.height));
    const sha256 = createHash("sha256").update(crop.png).digest("hex");
    const identity = assetIdentity(toLocator(row));
    const storage_path = assetInstancePath(w.user.workspaceId, w.materialId, identity, sha256);
    await w.visuals.deps.admin.putObject(storage_path, crop.png, "create");
    await w.visuals.deps.admin.insertAsset({ workspace_id: row.workspace_id, material_id: row.material_id, locator_id: row.id, identity,
      recipe_version: VISUAL_CROP_RECIPE.version, recipe_fingerprint: recipeFingerprint(), storage_path, mime: "image/png",
      width: crop.width, height: crop.height, bytes: crop.png.length, sha256, provenance: {} });
    const [asset] = await q<{ id: string }>("select id from public.material_visual_assets where locator_id=$1", [row.id]);
    const pin = { assetId: asset!.id, sha256 };
    for (const options of [{ verify: false }, { withBytes: true }]) {
      const resolved = await resolveVisuals(w.visuals.deps, { ...w.input, visualIds: ["vis_1"], ...options });
      expect(resolved.states.vis_1!.status).not.toBe("ready");
      expect(resolved.bytes).toEqual({});
    }
    expect(await readAssetInstance(w.visuals.deps, pin)).toMatchObject({ ok: false });
    expect(await produceVisualAsset(w.visuals.deps, row.id)).toMatchObject({ ok: false });
    const old = await w.auto.deps.runs.claim({ ...w.input, sourceSha256: w.input.sourceSha256!, engine: "auto_visuals@v4" });
    if (!old.claimed) throw new Error("fixture run must be new");
    await w.auto.deps.runs.complete(old.id, "completed", { engine: "auto_visuals@v4", vision_pages: 0,
      visuals: { vis_1: { choice: "B", reason: "accepted", confidence: .75, method: "auto", spec: null } } }, 0);
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ status: "completed", result: { visuals: { vis_1: { choice: "D", reason: "auto_not_revalidated" } } } });
    expect(await select(w)).toMatchObject({ ok: true, status: "ready", revision: 2 });
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "ready", resolution: "A" });
    expect(await readAssetInstance(w.visuals.deps, pin)).toMatchObject({ ok: false });
  });
});
