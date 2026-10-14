import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assetIdentity, assetInstancePath, VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { produceVisualAsset, readAssetInstance, resolveVisuals, toLocator, type AssetRow, type LocatorRow, type VisualDeps } from "@/lib/materials/visuals/service";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bytes = new Uint8Array([1, 2, 3]);
const sha = createHash("sha256").update(bytes).digest("hex");
const evidence = { engine: "auto_visuals@v2", shape: "bar", signature: true, placement: true, unique: true, clean: true, anchor: "act_1",
  vision: { used: false, agrees: false, confidence: null, iou: null } };
const locator: LocatorRow = { id: id(1), workspace_id: id(2), material_id: id(3), analysis_fingerprint: "a".repeat(64), visual_id: "vis_1", source_sha256: "b".repeat(64),
  locator_version: 1, revision: 1, method: "auto", confidence: .9, evidence, page: 1, x: .1, y: .2, w: .5, h: .1,
  page_box: { kind: "pdf", width_pt: 595, height_pt: 842, rotation: 0, view: [0, 0, 595, 842] }, superseded_at: null, last_failure: null };
const identity = assetIdentity(toLocator(locator));
const asset: AssetRow = { id: id(4), locator_id: locator.id, identity, recipe_version: VISUAL_CROP_RECIPE.version,
  storage_path: assetInstancePath(locator.workspace_id, locator.material_id, identity, sha), width: 400, height: 60, bytes: bytes.length, sha256: sha };
const input = { materialId: locator.material_id, analysisFingerprint: locator.analysis_fingerprint, sourceSha256: locator.source_sha256, visualIds: ["vis_1"] };
const pin = { assetId: asset.id, sha256: sha };

function reader(row: unknown = locator, instance: unknown = asset) {
  const read = vi.fn(async () => bytes);
  // Deliberately malformed persistence results: a TypeScript cast is not a runtime trust boundary.
  const deps = { reader: {
    activeLocators: async () => row ? [{ ...row, assets: instance ? [instance] : [] }] : [],
    asset: async () => instance ? { ...instance, locator: row } : null, readObject: read,
  }, admin: { locator: async () => row, assetInstances: async () => instance ? [instance] : [], readObject: read, setFailure: vi.fn() } } as unknown as VisualDeps;
  return { deps, read };
}

describe("persisted crop provenance fails closed before reading bytes", () => {
  it.each([
    ["missing locator", null],
    ["missing method", { ...locator, method: undefined }],
    ["unknown method", { ...locator, method: "scan" }],
    ["missing evidence", { ...locator, evidence: undefined }],
    ["null evidence", { ...locator, evidence: null }],
    ["empty evidence", { ...locator, evidence: {} }],
    ["unknown engine", { ...locator, evidence: { ...evidence, engine: "auto_visuals@v999" } }],
    ["scan flag even null", { ...locator, evidence: { ...evidence, scan: null } }],
    ["missing anchor", { ...locator, evidence: { ...evidence, anchor: null, placement: false } }],
    ["missing source", { ...locator, source_sha256: undefined }],
    ["missing locator reference", { ...locator, id: undefined }],
    ["unknown locator version", { ...locator, locator_version: 2 }],
    ["missing page geometry", { ...locator, page_box: undefined }],
    ["image-only auto locator", { ...locator, page_box: { kind: "image", width_px: 800, height_px: 600 } }],
    ["human provenance omitted instead of null", { ...locator, method: "human", confidence: null, evidence: undefined }],
  ])("%s", async (_name, row) => {
    const { deps, read } = reader(row);
    for (const options of [{ verify: false }, { withBytes: true }]) {
      const result = await resolveVisuals(deps, { ...input, ...options });
      expect(result.states.vis_1!.status).not.toBe("ready");
      expect(result.bytes).toEqual({});
      expect(result.instances).toEqual({});
    }
    expect(await readAssetInstance(deps, pin)).toMatchObject({ ok: false });
    expect(await produceVisualAsset(deps, locator.id)).toMatchObject({ ok: false });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["missing asset", null],
    ["missing locator_id", { ...asset, locator_id: undefined }],
    ["different locator_id", { ...asset, locator_id: id(9) }],
    ["wrong logical identity", { ...asset, identity: "c".repeat(64) }],
    ["unknown recipe", { ...asset, recipe_version: "visual_crop@v999" }],
    ["missing asset id", { ...asset, id: undefined }],
    ["missing hash", { ...asset, sha256: undefined }],
    ["foreign object path", { ...asset, storage_path: `other/visuals/${sha}.png` }],
  ])("%s cannot be served via a pin or the active locator", async (_name, instance) => {
    const { deps, read } = reader(locator, instance);
    expect(await readAssetInstance(deps, pin)).toMatchObject({ ok: false });
    const result = await resolveVisuals(deps, { ...input, withBytes: true });
    expect(result.states.vis_1!.status).not.toBe("ready");
    expect(result.bytes).toEqual({});
    expect(read).not.toHaveBeenCalled();
  });

  it("does not substitute another instance for the requested asset id", async () => {
    const { deps, read } = reader(locator, { ...asset, id: id(8) });
    expect(await readAssetInstance(deps, pin)).toMatchObject({ ok: false });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([locator, { ...locator, method: "human", confidence: null, evidence: null }])("preserves valid $method crops and exact pins", async (row) => {
    const { deps } = reader(row);
    expect((await resolveVisuals(deps, { ...input, withBytes: true })).bytes.vis_1).toEqual(bytes);
    expect(await readAssetInstance(deps, pin)).toEqual({ ok: true, bytes });
    expect(await produceVisualAsset(deps, locator.id)).toEqual({ ok: true });
  });
});
