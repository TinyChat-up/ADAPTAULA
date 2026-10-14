import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { AUTO_ENGINE_VERSION, prepareVisuals, type AutoRunInput } from "@/lib/materials/visuals/auto/service";
import { SCAN_METHOD } from "@/lib/materials/visuals/auto/scan";
import { pageBox } from "@/lib/materials/visuals/raster";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import { cellCaseAnalysis } from "../support/cell-case";
import { scannedPdf, scannedPng } from "../support/scan-case";
import { createTestDb, createUser } from "./harness";
import { seedMaterial } from "./orchestration-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/**
 * Phase 8.2B.6 over the real migrations (PGlite): the scanned cell sheet goes through the SAME automatic run as any material —
 * claim per (material, analysis, original, engine), an `auto` locator with page, coordinates, page box, source sha-256 and engine,
 * the crop produced by the person's recipe into private storage — and nothing else. 0 model calls (no vision configured).
 */

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

describe("a scanned sheet with one essential figure, located without words", () => {
  it("an `auto` locator with its page, coordinates, page box, source and engine; the crop in private storage; choice B", async () => {
    const w = await world();
    const summary = await prepareVisuals(w.auto.deps, w.input);
    expect(summary).toMatchObject({ status: "completed", result: { engine: AUTO_ENGINE_VERSION, vision_pages: 0, visuals: { vis_1: { choice: "B", reason: "accepted", method: "auto", confidence: 0.75 } } } });
    const [locator] = await q<{ method: string; page: number; x: number; y: number; w: number; h: number; page_box: Record<string, unknown>; source_sha256: string; confidence: number; evidence: Record<string, unknown>; created_by: string | null }>(
      "select method, page, x, y, w, h, page_box, source_sha256, confidence, evidence, created_by from public.material_visual_locators where material_id = $1",
      [w.materialId],
    );
    expect(locator).toMatchObject({ method: "auto", page: 1, source_sha256: w.input.sourceSha256, created_by: null, page_box: { kind: "pdf", rotation: 0 } });
    expect(Number(locator!.confidence)).toBeGreaterThanOrEqual(0.75);
    expect(locator!.evidence).toMatchObject({ engine: AUTO_ENGINE_VERSION, placement: false, unique: true, clean: true, scan: { method: SCAN_METHOD, sole_visual: true, regions: 1 } });
    // Signals and coordinates only: no word of the material in the evidence.
    expect(JSON.stringify(locator!.evidence)).not.toMatch(/Observa|esquema|célula|núcleo/i);
    const [asset] = await q<{ storage_path: string; recipe_version: string; width: number; height: number }>("select storage_path, recipe_version, width, height from public.material_visual_assets where material_id = $1", [w.materialId]);
    expect(asset).toMatchObject({ recipe_version: "visual_crop@v1" });
    expect(w.visuals.objects.has(asset!.storage_path)).toBe(true);
    // The teacher (RLS) reads it ready, from the automatic engine.
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "ready", resolution: "B", provenance: { method: "auto" } });
  });

  it("a photo/scan uploaded as an image is located the same way (its page box is the image)", async () => {
    const w = await world({ mime: "image/png", bytes: await scannedPng() });
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ result: { visuals: { vis_1: { choice: "B" } } } });
    expect(await q("select page_box->>'kind' as kind from public.material_visual_locators where material_id = $1", [w.materialId])).toEqual([{ kind: "image" }]);
  });
});

describe("the honest stop and the material's versions", () => {
  it("two drawings on the scanned page: D with the reason, no locator, no crop, nothing ready", async () => {
    const w = await world({ mime: "application/pdf", bytes: await scannedPdf({ secondFigure: true }) });
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ result: { visuals: { vis_1: { choice: "D", reason: "scan_ambiguous" } } } });
    expect(await q("select id from public.material_visual_locators where material_id = $1", [w.materialId])).toEqual([]);
    expect(await q("select id from public.material_visual_assets where material_id = $1", [w.materialId])).toEqual([]);
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "missing_locator", resolution: "D" });
  });

  it("a new version of the original (another scan, without the scheme) never inherits the earlier crop: D, nothing ready for it", async () => {
    const w = await world();
    await prepareVisuals(w.auto.deps, w.input);
    expect((await w.resolve()).states.vis_1).toMatchObject({ status: "ready" });
    const second = await attachSource(db, w.visuals, w.materialId, "application/pdf", await scannedPdf({ scheme: false }));
    expect(second).not.toBe(w.input.sourceSha256);
    const summary = await prepareVisuals(w.auto.deps, { ...w.input, sourceSha256: second });
    expect(summary).toMatchObject({ status: "completed", result: { visuals: { vis_1: { choice: "D", reason: "scan_no_region" } } } });
    expect((await w.resolve(second)).states.vis_1!.status).not.toBe("ready");
    // The earlier locator stays bound to the version it was cut from.
    expect(await q("select source_sha256 from public.material_visual_locators where material_id = $1", [w.materialId])).toEqual([{ source_sha256: w.input.sourceSha256 }]);
  });

  it("an earlier automatic crop over the wrong place (the answer lines) is not kept: this engine does not find it again → D", async () => {
    const w = await world();
    await w.visuals.deps.admin.createLocator({
      workspaceId: w.user.workspaceId,
      materialId: w.materialId,
      analysisFingerprint: w.input.analysisFingerprint,
      visualId: "vis_1",
      sourceSha256: w.input.sourceSha256!,
      page: 1,
      bounds: { x: 0.12, y: 0.42, w: 0.76, h: 0.07 },
      pageBox: await pageBox(base, "application/pdf", 1),
      userId: null,
      method: "auto",
      confidence: 0.8,
      evidence: { engine: "auto_visuals@v2" },
    });
    expect(await prepareVisuals(w.auto.deps, w.input)).toMatchObject({ result: { visuals: { vis_1: { choice: "D", reason: "auto_not_revalidated" } } } });
  });
});
