import "server-only";
import { createHash } from "node:crypto";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import type { VisualAssetFailure, VisualState } from "@/lib/render/visual-assets";
import { NormalizedBoundsSchema, pixelRect, withMargin, type NormalizedBounds } from "./geometry";
import { RasterError, cropPng, pageBox, pageCount, renderPage, sameBox, type PageBox } from "./raster";
import { VISUAL_CROP_RECIPE, assetIdentity, assetPath, recipeFingerprint, type VisualLocator } from "./recipe";

/**
 * Visual locators and their crops. The browser only ever sends a page and a rectangle; everything else (which material, which
 * analysis, which source file, whether the visual exists, how many pages there are, the page box) is resolved HERE from data the
 * user is authorised to read, and the image is produced HERE from the stored original. No provider, no OCR, no client bitmap.
 *
 *   locate → persist locator revision (atomic: supersedes the active one) → render page → crop → validate → store → record asset
 *
 * A failure after the locator is saved is recorded on it (`last_failure`): the teacher retries with the same geometry.
 */

export interface LocatorRow {
  id: string;
  workspace_id: string;
  material_id: string;
  analysis_fingerprint: string;
  visual_id: string;
  source_sha256: string;
  locator_version: number;
  revision: number;
  method: "human";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  page_box: PageBox;
  superseded_at: string | null;
  last_failure: VisualAssetFailure | null;
}

export interface AssetRow {
  id: string;
  locator_id: string;
  identity: string;
  recipe_version: string;
  storage_path: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export interface MaterialForVisuals {
  id: string;
  workspace_id: string;
  analysis: unknown;
  content_hash: string | null;
}

export interface VisualDeps {
  /** Reads with the USER's rights (RLS): another workspace's material, locator, asset or object is simply not there. */
  reader: {
    material(id: string): Promise<MaterialForVisuals | null>;
    activeLocators(materialId: string, analysisFingerprint: string): Promise<Array<LocatorRow & { assets: AssetRow[] }>>;
    readObject(path: string): Promise<Uint8Array | null>;
  };
  /** Server side (service role), only after the reader has authorised the material. */
  admin: {
    source(materialId: string): Promise<{ mime: string; storagePath: string } | null>;
    download(path: string): Promise<Uint8Array | null>;
    createLocator(input: { workspaceId: string; materialId: string; analysisFingerprint: string; visualId: string; sourceSha256: string; page: number; bounds: NormalizedBounds; pageBox: PageBox; userId: string }): Promise<{ id: string; revision: number }>;
    locator(id: string): Promise<LocatorRow | null>;
    activeLocator(materialId: string, analysisFingerprint: string, visualId: string): Promise<LocatorRow | null>;
    assetByIdentity(identity: string): Promise<AssetRow | null>;
    readObject(path: string): Promise<Uint8Array | null>;
    putObject(path: string, png: Uint8Array): Promise<boolean>;
    insertAsset(row: Omit<AssetRow, "id"> & { workspace_id: string; material_id: string; recipe_fingerprint: string; mime: "image/png"; provenance: Record<string, unknown> }): Promise<void>;
    setFailure(locatorId: string, failure: VisualAssetFailure | null): Promise<void>;
  };
}

export interface VisualActor {
  userId: string;
  workspaceId: string;
  canWrite: boolean;
}

export type VisualResult =
  | { ok: true; status: "ready"; revision: number }
  | { ok: true; status: "extraction_failed"; failure: VisualAssetFailure; revision: number }
  | { ok: false; code: "forbidden" | "not_found" | "invalid" | VisualAssetFailure };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => b.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((v, i) => b[i] === v);

export const toLocator = (row: LocatorRow): VisualLocator => ({
  locator_version: 1,
  material_id: row.material_id,
  analysis_fingerprint: row.analysis_fingerprint,
  visual_id: row.visual_id,
  source_sha256: row.source_sha256,
  revision: row.revision,
  method: row.method,
  page: row.page,
  bounds: { x: row.x, y: row.y, w: row.w, h: row.h },
});

/** The material as the user may see it, with its current analysis and that analysis's fingerprint (the one adaptations pin). */
async function authorisedMaterial(deps: VisualDeps, actor: VisualActor, materialId: string) {
  const material = await deps.reader.material(materialId);
  if (!material || material.workspace_id !== actor.workspaceId) return null;
  const { analysis } = parseStoredAnalysis(material.analysis);
  if (!analysis) return null;
  return { material, analysis, analysisFingerprint: fingerprint(analysis) };
}

async function loadSource(deps: VisualDeps, materialId: string, expectedSha: string | null) {
  const source = await deps.admin.source(materialId);
  if (!source || !expectedSha) return null;
  const bytes = await deps.admin.download(source.storagePath);
  // The locator belongs to ONE original file: if the stored bytes are not that file any more, nothing is cropped.
  if (!bytes || sha256(bytes) !== expectedSha) return null;
  return { ...source, bytes };
}

/** Produces (or confirms) the crop of a saved locator. Idempotent: same locator + recipe → same identity, same object, one row. */
export async function produceVisualAsset(deps: VisualDeps, locatorId: string, preloaded?: { mime: string; bytes: Uint8Array }): Promise<{ ok: true } | { ok: false; failure: VisualAssetFailure }> {
  const row = await deps.admin.locator(locatorId);
  if (!row) return { ok: false, failure: "geometry_missing" };
  const fail = async (failure: VisualAssetFailure) => {
    await deps.admin.setFailure(row.id, failure);
    return { ok: false as const, failure };
  };
  const locator = toLocator(row);
  const identity = assetIdentity(locator);
  const path = assetPath(row.workspace_id, row.material_id, identity);

  const existing = await deps.admin.assetByIdentity(identity);
  if (existing) {
    const stored = await deps.admin.readObject(existing.storage_path);
    if (stored && sha256(stored) === existing.sha256) {
      await deps.admin.setFailure(row.id, null);
      return { ok: true };
    }
  }

  const source = preloaded ?? (await loadSource(deps, row.material_id, row.source_sha256));
  if (!source) return fail("source_missing");
  if (!NormalizedBoundsSchema.safeParse(locator.bounds).success) return fail("invalid_bounds");

  let png: { png: Buffer; width: number; height: number };
  let rect: ReturnType<typeof pixelRect>;
  try {
    const page = await renderPage(source.bytes, source.mime, row.page, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
    // The page must still be the page the person looked at (same box and rotation), or the rectangle means something else.
    if (!sameBox(page.box, row.page_box)) return fail("invalid_bounds");
    const surface = page.box.kind === "pdf" ? { width: page.box.width_pt, height: page.box.height_pt } : { width: page.width, height: page.height };
    rect = pixelRect(withMargin(locator.bounds, surface, VISUAL_CROP_RECIPE.margin), page.width, page.height);
    png = await cropPng(page, rect);
  } catch (error) {
    return fail(error instanceof RasterError ? error.code : "extraction_failed");
  }
  if (!isPng(png.png) || png.width <= 0 || png.height <= 0 || png.width > VISUAL_CROP_RECIPE.max_px || png.height > VISUAL_CROP_RECIPE.max_px) return fail("asset_corrupt");

  if (!(await deps.admin.putObject(existing?.storage_path ?? path, png.png))) return fail("extraction_failed");
  if (existing) {
    // Repaired a missing/corrupt object: deterministic, so the bytes match the recorded fingerprint again.
    if (sha256(png.png) !== existing.sha256) return fail("asset_corrupt");
  } else {
    await deps.admin.insertAsset({
      workspace_id: row.workspace_id,
      material_id: row.material_id,
      locator_id: row.id,
      identity,
      recipe_version: VISUAL_CROP_RECIPE.version,
      recipe_fingerprint: recipeFingerprint(),
      storage_path: path,
      mime: "image/png",
      width: png.width,
      height: png.height,
      bytes: png.png.length,
      sha256: sha256(png.png),
      provenance: { pixel_rect: rect, rasteriser: "pdfjs-dist@6.4.299+@napi-rs/canvas@1.0.10" },
    });
  }
  await deps.admin.setFailure(row.id, null);
  return { ok: true };
}

export interface LocateInput {
  materialId: string;
  visualId: string;
  page: number;
  bounds: unknown;
}

/** A person says where `visualId` is. Creates a new locator revision (the previous one is kept, superseded) and produces the crop. */
export async function locateVisual(deps: VisualDeps, actor: VisualActor, input: LocateInput): Promise<VisualResult> {
  if (!actor.canWrite) return { ok: false, code: "forbidden" };
  const found = await authorisedMaterial(deps, actor, input.materialId);
  if (!found) return { ok: false, code: "not_found" };
  if (!found.analysis.visuals.some((v) => v.id === input.visualId)) return { ok: false, code: "not_found" };
  const bounds = NormalizedBoundsSchema.safeParse(input.bounds);
  if (!bounds.success || !Number.isInteger(input.page) || input.page < 1) return { ok: false, code: "invalid" };

  const source = await loadSource(deps, found.material.id, found.material.content_hash);
  if (!source) return { ok: false, code: "source_missing" };
  let box: PageBox;
  try {
    const pages = await pageCount(source.bytes, source.mime);
    if (input.page > pages) return { ok: false, code: "page_missing" };
    box = await pageBox(source.bytes, source.mime, input.page);
  } catch (error) {
    return { ok: false, code: error instanceof RasterError ? error.code : "extraction_failed" };
  }

  const created = await deps.admin.createLocator({
    workspaceId: found.material.workspace_id,
    materialId: found.material.id,
    analysisFingerprint: found.analysisFingerprint,
    visualId: input.visualId,
    sourceSha256: found.material.content_hash!,
    page: input.page,
    bounds: bounds.data,
    pageBox: box,
    userId: actor.userId,
  });
  const produced = await produceVisualAsset(deps, created.id, source);
  return produced.ok ? { ok: true, status: "ready", revision: created.revision } : { ok: true, status: "extraction_failed", failure: produced.failure, revision: created.revision };
}

/** Retry the crop of the ACTIVE locator with the same geometry (no new selection, no new revision). */
export async function retryVisualAsset(deps: VisualDeps, actor: VisualActor, materialId: string, visualId: string): Promise<VisualResult> {
  if (!actor.canWrite) return { ok: false, code: "forbidden" };
  const found = await authorisedMaterial(deps, actor, materialId);
  if (!found) return { ok: false, code: "not_found" };
  const active = await deps.admin.activeLocator(materialId, found.analysisFingerprint, visualId);
  if (!active || active.workspace_id !== actor.workspaceId) return { ok: false, code: "geometry_missing" };
  const produced = await produceVisualAsset(deps, active.id);
  return produced.ok ? { ok: true, status: "ready", revision: active.revision } : { ok: true, status: "extraction_failed", failure: produced.failure, revision: active.revision };
}

export interface ResolvedVisuals {
  states: Record<string, VisualState>;
  /** Verified PNG bytes per ready visual (only when asked for, e.g. the image route). */
  bytes: Record<string, Uint8Array>;
}

/**
 * The state of each visual of one material + analysis + source file, with the USER's rights. The current preview uses the ACTIVE
 * locator (a later correction shows up here); an asset only counts as ready if its object is readable AND matches its recorded
 * fingerprint: database metadata alone never makes a visual "ready".
 */
export async function resolveVisuals(deps: VisualDeps, input: { materialId: string; analysisFingerprint: string; sourceSha256: string | null; visualIds: readonly string[]; withBytes?: boolean }): Promise<ResolvedVisuals> {
  const out: ResolvedVisuals = { states: {}, bytes: {} };
  const active = input.sourceSha256 ? await deps.reader.activeLocators(input.materialId, input.analysisFingerprint) : [];
  for (const visualId of input.visualIds) {
    const locator = active.find((l) => l.visual_id === visualId && l.source_sha256 === input.sourceSha256);
    if (!locator) {
      out.states[visualId] = { visualId, status: "missing_locator" };
      continue;
    }
    const provenance = { page: locator.page, revision: locator.revision, method: locator.method };
    const asset = locator.assets.find((a) => a.recipe_version === VISUAL_CROP_RECIPE.version && a.identity === assetIdentity(toLocator(locator)));
    if (!asset) {
      out.states[visualId] = locator.last_failure ? { visualId, status: "extraction_failed", failure: locator.last_failure, provenance } : { visualId, status: "located_processing", provenance };
      continue;
    }
    const stored = await deps.reader.readObject(asset.storage_path);
    if (!stored) out.states[visualId] = { visualId, status: "extraction_failed", failure: "asset_missing", provenance };
    else if (sha256(stored) !== asset.sha256) out.states[visualId] = { visualId, status: "extraction_failed", failure: "asset_corrupt", provenance };
    else {
      out.states[visualId] = { visualId, status: "ready", provenance };
      if (input.withBytes) out.bytes[visualId] = stored;
    }
  }
  return out;
}
