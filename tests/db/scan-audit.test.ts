import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { prepareVisuals, type AutoRunInput } from "@/lib/materials/visuals/auto/service";
import { adversarialScanPdf } from "../support/scan-adversarial-case";
import { pageBox } from "@/lib/materials/visuals/raster";
import { locateVisual, produceVisualAsset, readAssetInstance, resolveVisuals } from "@/lib/materials/visuals/service";
import { cellCaseAnalysis } from "../support/cell-case";
import { scannedPdf } from "../support/scan-case";
import { createTestDb, createUser } from "./harness";
import { seedMaterial } from "./orchestration-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/** Audit regressions reproduced against ccfbf3e: wrong identity, wrong source hash and stale crop delivery. */

let db: PGlite;
let base: Uint8Array;
beforeAll(async () => {
  db = await createTestDb();
  base = await scannedPdf();
}, 120_000);

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
let n = 0;

async function world(source: { mime: string; bytes: Uint8Array } = { mime: "application/pdf", bytes: base }) {
  const user = await createUser(db, `scan-audit-${++n}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  const analysis = cellCaseAnalysis();
  const materialId = await seedMaterial(db, user, analysis);
  const visuals = visualHarness(db, user);
  const sourceSha256 = await attachSource(db, visuals, materialId, source.mime, source.bytes);
  const auto = autoHarness(db, visuals);
  const input: AutoRunInput = { workspaceId: user.workspaceId, materialId, analysis, analysisFingerprint: fingerprint(analysis), sourceSha256, adaptationId: null };
  const resolve = (sha = sourceSha256) => resolveVisuals(visuals.deps, { materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256: sha, visualIds: ["vis_1"] });
  return { user, materialId, visuals, auto, input, resolve };
}

describe("PR #30: integration invariants", () => {
  it("a wrong logo reaches neither the private crop nor ready state", async () => {
    const w = await world({ mime: "application/pdf", bytes: await adversarialScanPdf("C") });
    const result = await prepareVisuals(w.auto.deps, w.input);
    expect(result).toMatchObject({ status: "completed", result: { visuals: { vis_1: { choice: "D" } } } });
    expect(await q("select id from public.material_visual_assets where material_id = $1", [w.materialId])).toEqual([]);
    expect((await w.resolve()).states.vis_1!.status).not.toBe("ready");
  });

  it("a preloaded original cannot be cropped under another original's hash", async () => {
    const w = await world();
    const locator = await w.visuals.deps.admin.createLocator({ workspaceId: w.user.workspaceId, materialId: w.materialId, analysisFingerprint: w.input.analysisFingerprint,
      visualId: "vis_1", sourceSha256: w.input.sourceSha256!, page: 1, bounds: { x: .2, y: .2, w: .5, h: .22 },
      pageBox: await pageBox(base, "application/pdf", 1), userId: w.user.id });
    expect(await produceVisualAsset(w.visuals.deps, locator.id, { mime: "application/pdf", bytes: await scannedPdf({ scheme: false }) })).toMatchObject({ ok: false, failure: "source_missing" });
    expect(await q("select id from public.material_visual_assets where material_id = $1", [w.materialId])).toEqual([]);
  });

  it("an old scan crop and its exact pin cannot bypass rejection when no run is executed", async () => {
    const w = await world();
    // Seed the immutable crop before assigning the evidence of the rejected scan engine (identity/bytes stay unchanged).
    const locator = await w.visuals.deps.admin.createLocator({ workspaceId: w.user.workspaceId, materialId: w.materialId, analysisFingerprint: w.input.analysisFingerprint,
      visualId: "vis_1", sourceSha256: w.input.sourceSha256!, page: 1, bounds: { x: .2, y: .2, w: .5, h: .22 },
      pageBox: await pageBox(base, "application/pdf", 1), userId: null, method: "auto", confidence: .75, evidence: { engine: "auto_visuals@v2", placement: true } });
    expect(await produceVisualAsset(w.visuals.deps, locator.id)).toEqual({ ok: true });
    // Fixture only: emulate a row written by the old engine; production locators remain immutable.
    await q("alter table public.material_visual_locators disable trigger material_visual_locators_immutable");
    try {
      await q("update public.material_visual_locators set evidence=$2 where id=$1", [locator.id, JSON.stringify({ engine: "auto_visuals@v3", scan: { method: "scan_single_region@v1" } })]);
    } finally {
      await q("alter table public.material_visual_locators enable trigger material_visual_locators_immutable");
    }
    const [asset] = await q<{ id: string; sha256: string }>("select id, sha256 from public.material_visual_assets where locator_id=$1", [locator.id]);
    // These reads do not call prepareVisuals; a new engine version alone cannot protect them.
    expect((await w.resolve()).states.vis_1!.status).not.toBe("ready");
    expect(await readAssetInstance(w.visuals.deps, { assetId: asset!.id, sha256: asset!.sha256 })).toMatchObject({ ok: false });
    expect(await produceVisualAsset(w.visuals.deps, locator.id)).toMatchObject({ ok: false });
    for (const options of [{ verify: false }, { withBytes: true }]) {
      const resolved = await resolveVisuals(w.visuals.deps, { ...w.input, visualIds: ["vis_1"], ...options });
      expect(resolved.states.vis_1!.status).not.toBe("ready");
      expect(resolved.bytes).toEqual({});
    }
    // Correction is explicit and keeps the rejected revision: no silent replacement/deletion of history.
    expect(await locateVisual(w.visuals.deps, { userId: w.user.id, workspaceId: w.user.workspaceId, canWrite: true },
      { materialId: w.materialId, visualId: "vis_1", page: 1, bounds: { x: .2, y: .197, w: .5, h: .21 } })).toMatchObject({ ok: true, status: "ready", revision: 2 });
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "ready", resolution: "A" });
    expect(await readAssetInstance(w.visuals.deps, { assetId: asset!.id, sha256: asset!.sha256 })).toMatchObject({ ok: false });
  });
});
