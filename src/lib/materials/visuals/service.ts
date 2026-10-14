import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import type { VisualAssetFailure, VisualState } from "@/lib/render/visual-assets";
import { VisualSpecSchema, type VisualSpec } from "@/lib/visuals/spec";
import { ACCEPT } from "./auto/locate";
import { SPEC_EXTRACTOR_VERSION } from "./auto/extract";
import { NormalizedBoundsSchema, pixelRect, withMargin, type NormalizedBounds } from "./geometry";
import { RasterError, cropPng, engineProvenance, pageBox, pageCount, renderPage, sameBox, type PageBox } from "./raster";
import { VISUAL_CROP_RECIPE, VisualLocatorSchema, assetIdentity, assetInstancePath, recipeFingerprint, type LocatorMethod, type VisualLocator } from "./recipe";

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
  method: LocatorMethod;
  confidence?: number | null;
  evidence: unknown;
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

/** A verified reconstruction of an automatically located visual (migration 022), immutable, addressed by its sha-256. */
export interface SpecRow {
  id: string;
  locator_id: string;
  visual_id: string;
  extractor_version: string;
  spec: unknown;
  spec_sha256: string;
}

export interface MaterialForVisuals {
  id: string;
  workspace_id: string;
  analysis: unknown;
  content_hash: string | null;
}

/**
 * `identity` is the LOGICAL crop (locator + recipe); each asset row is one immutable PHYSICAL instance of it, with the sha-256 of
 * its own bytes. A valid render is not guaranteed to be byte-identical in another runtime, so one identity may have several
 * instances; the sha-256 only certifies the bytes of its own row. Lists of instances are always newest first:
 * `created_at desc, id desc` (the order in which they are tried).
 */
export interface VisualDeps {
  /** Reads with the USER's rights (RLS): another workspace's material, locator, asset or object is simply not there. */
  reader: {
    material(id: string): Promise<MaterialForVisuals | null>;
    /** Each locator with ALL its instances, newest first, and its reconstructions (when it was located automatically). */
    activeLocators(materialId: string, analysisFingerprint: string): Promise<Array<LocatorRow & { assets: AssetRow[]; specs?: SpecRow[] }>>;
    asset(id: string): Promise<(AssetRow & { locator: LocatorRow }) | null>;
    readObject(path: string): Promise<Uint8Array | null>;
  };
  /** Server side (service role), only after the reader has authorised the material. */
  admin: {
    source(materialId: string): Promise<{ mime: string; storagePath: string } | null>;
    download(path: string): Promise<Uint8Array | null>;
    /**
     * A person's locator supersedes the active one. An automatic one (`method: "auto"`, with its confidence and evidence) never
     * does: if a locator is already active it is returned unchanged with `created: false`.
     */
    createLocator(input: { workspaceId: string; materialId: string; analysisFingerprint: string; visualId: string; sourceSha256: string; page: number; bounds: NormalizedBounds; pageBox: PageBox; userId: string | null; method?: LocatorMethod; confidence?: number; evidence?: Record<string, unknown> }): Promise<{ id: string; revision: number; created?: boolean }>;
    locator(id: string): Promise<LocatorRow | null>;
    activeLocator(materialId: string, analysisFingerprint: string, visualId: string): Promise<LocatorRow | null>;
    /** Every instance of a logical crop, newest first. */
    assetInstances(identity: string): Promise<AssetRow[]>;
    readObject(path: string): Promise<Uint8Array | null>;
    /**
     * `create` never replaces an object: if the path is taken it answers `exists` and writes nothing. `repair` replaces the
     * object; it is only used to put back the exact bytes an instance's row certifies (same sha-256).
     */
    putObject(path: string, png: Uint8Array, mode: "create" | "repair"): Promise<"stored" | "exists" | "failed">;
    /** A second insert of the same (identity, sha256) — a concurrent producer of the same bytes — is not an error. */
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
  locator_version: row.locator_version as 1,
  material_id: row.material_id,
  analysis_fingerprint: row.analysis_fingerprint,
  visual_id: row.visual_id,
  source_sha256: row.source_sha256,
  revision: row.revision,
  method: row.method,
  page: row.page,
  bounds: { x: row.x, y: row.y, w: row.w, h: row.h },
});

const PageBoxSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), width_px: z.number().positive(), height_px: z.number().positive() }),
  z.object({ kind: z.literal("pdf"), width_pt: z.number().positive(), height_pt: z.number().positive(), rotation: z.number().finite(), view: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
]);
const AutoEvidenceSchema = z.object({
  engine: z.enum(["auto_visuals@v1", "auto_visuals@v2", "auto_visuals@v3", "auto_visuals@v4", "auto_visuals@v5"]),
  shape: z.enum(["bar", "number_line", "figure"]), signature: z.boolean(), unique: z.boolean(),
  placement: z.literal(true), clean: z.literal(true), anchor: z.string().regex(/^act_[0-9]{1,4}$/),
  vision: z.object({ used: z.boolean(), agrees: z.boolean(), confidence: z.number().min(0).max(1).nullable(), iou: z.number().min(0).max(1).nullable() }),
});

/** Missing evidence is not evidence of safety. Human selections legitimately store null; automatic ones need an activity anchor. */
function verifiedLocator(row: LocatorRow | null | undefined): row is LocatorRow {
  if (!row || !z.uuid().safeParse(row.id).success || !z.uuid().safeParse(row.workspace_id).success
    || !VisualLocatorSchema.safeParse(toLocator(row)).success || !PageBoxSchema.safeParse(row.page_box).success) return false;
  if (row.method === "human") return row.evidence === null && row.confidence == null;
  return row.page_box.kind === "pdf" && typeof row.confidence === "number" && row.confidence >= ACCEPT && row.confidence <= 1
    && !!row.evidence && typeof row.evidence === "object" && !("scan" in row.evidence) && AutoEvidenceSchema.safeParse(row.evidence).success;
}

/** Bind every instance to its locator, recipe and private object, including historical pre-017 paths. */
function matchesLocator(instance: AssetRow, row: LocatorRow): boolean {
  const identity = assetIdentity(toLocator(row));
  return z.uuid().safeParse(instance.id).success && /^[a-f0-9]{64}$/.test(instance.sha256)
    && instance.locator_id === row.id && instance.recipe_version === VISUAL_CROP_RECIPE.version && instance.identity === identity
    && (instance.storage_path === assetInstancePath(row.workspace_id, row.material_id, identity, instance.sha256)
      || instance.storage_path === `${row.workspace_id}/${row.material_id}/visuals/${identity}.png`);
}

/** The material as the user may see it, with its current analysis and that analysis's fingerprint (the one adaptations pin). */
async function authorisedMaterial(deps: VisualDeps, actor: VisualActor, materialId: string) {
  const material = await deps.reader.material(materialId);
  if (!material || material.workspace_id !== actor.workspaceId) return null;
  const { analysis } = parseStoredAnalysis(material.analysis);
  if (!analysis) return null;
  return { material, analysis, analysisFingerprint: fingerprint(analysis) };
}

export async function loadSource(deps: Pick<VisualDeps, "admin">, materialId: string, expectedSha: string | null) {
  const source = await deps.admin.source(materialId);
  if (!source || !expectedSha) return null;
  const bytes = await deps.admin.download(source.storagePath);
  // The locator belongs to ONE original file: if the stored bytes are not that file any more, nothing is cropped.
  if (!bytes || sha256(bytes) !== expectedSha) return null;
  return { ...source, bytes };
}

/**
 * The first instance (newest first) whose object is readable AND holds exactly the bytes its own row certifies. A damaged or
 * missing instance never hides a valid one; when none is valid, the problem reported is the newest instance's.
 */
async function verifiedInstance(read: (path: string) => Promise<Uint8Array | null>, instances: readonly AssetRow[]): Promise<{ instance: AssetRow; stored: Uint8Array } | { failure: "asset_missing" | "asset_corrupt" }> {
  let failure: "asset_missing" | "asset_corrupt" | null = null;
  for (const instance of instances) {
    const stored = await read(instance.storage_path);
    if (stored && sha256(stored) === instance.sha256) return { instance, stored };
    failure ??= stored ? "asset_corrupt" : "asset_missing";
  }
  return { failure: failure ?? "asset_missing" };
}

/**
 * Produces (or confirms) the crop of a saved locator. Idempotent and safe under concurrency:
 *   · an instance of this logical crop that still verifies → done, nothing is rendered or written;
 *   · otherwise render; if the bytes match an existing instance (its object was lost or damaged), put those exact bytes back at
 *     ITS path; if not (e.g. another runtime), store a NEW instance at its own content-addressed path.
 * A new render is never compared with an older instance as a condition of correctness, and no object is ever replaced by bytes
 * other than the ones its row certifies.
 */
export async function produceVisualAsset(deps: Pick<VisualDeps, "admin">, locatorId: string, preloaded?: { mime: string; bytes: Uint8Array }): Promise<{ ok: true } | { ok: false; failure: VisualAssetFailure }> {
  const row = await deps.admin.locator(locatorId);
  if (!verifiedLocator(row) || row.id !== locatorId) return { ok: false, failure: "geometry_missing" };
  const fail = async (failure: VisualAssetFailure) => {
    await deps.admin.setFailure(row.id, failure);
    return { ok: false as const, failure };
  };
  const done = async () => {
    await deps.admin.setFailure(row.id, null);
    return { ok: true as const };
  };
  // createLocator can return an existing revision: preloaded bytes must match THAT revision too.
  if (preloaded && sha256(preloaded.bytes) !== row.source_sha256) return fail("source_missing");
  const locator = toLocator(row);
  const identity = assetIdentity(locator);

  const instances = (await deps.admin.assetInstances(identity)).filter((a) => matchesLocator(a, row));
  if ("stored" in (await verifiedInstance((path) => deps.admin.readObject(path), instances))) return done();

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
  const sha = sha256(png.png);

  const same = instances.find((i) => i.sha256 === sha);
  if (same) return (await deps.admin.putObject(same.storage_path, png.png, "repair")) === "stored" ? done() : fail("extraction_failed");

  const path = assetInstancePath(row.workspace_id, row.material_id, identity, sha);
  const stored = await deps.admin.putObject(path, png.png, "create");
  if (stored === "failed") return fail("extraction_failed");
  if (stored === "exists") {
    // Another producer of the same bytes got there first (or an earlier attempt stored the object but not its row). The path is
    // named after the bytes it must hold: anything else there is a damaged object, and it is left as it is.
    const there = await deps.admin.readObject(path);
    if (!there || sha256(there) !== sha) return fail("asset_corrupt");
  }
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
    sha256: sha,
    provenance: { pixel_rect: rect, engine: engineProvenance() },
  });
  return done();
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
  /** The exact physical instance whose bytes are in `bytes` (asset id + sha-256): what an export pins. Only with `withBytes`. */
  instances: Record<string, { assetId: string; sha256: string }>;
}

/**
 * The state of each visual of one material + analysis + source file, with the USER's rights. The current preview uses the ACTIVE
 * locator (a later correction shows up here). Among the instances of its logical crop, the newest that verifies is served
 * (`created_at desc, id desc`): an object only counts if it is readable AND matches its own row's sha-256, so database metadata
 * alone never makes a visual "ready", and a damaged instance does not hide a valid one.
 */
export async function resolveVisuals(deps: VisualDeps, input: { materialId: string; analysisFingerprint: string; sourceSha256: string | null; visualIds: readonly string[]; withBytes?: boolean; verify?: boolean }): Promise<ResolvedVisuals> {
  const out: ResolvedVisuals = { states: {}, bytes: {}, instances: {} };
  const active = input.sourceSha256 ? await deps.reader.activeLocators(input.materialId, input.analysisFingerprint) : [];
  for (const visualId of input.visualIds) {
    const locator = active.find((l) => l.material_id === input.materialId && l.analysis_fingerprint === input.analysisFingerprint && l.visual_id === visualId && l.source_sha256 === input.sourceSha256);
    if (!verifiedLocator(locator)) {
      out.states[visualId] = { visualId, status: "missing_locator", resolution: "D" };
      continue;
    }
    const provenance = { page: locator.page, revision: locator.revision, method: locator.method, ...(locator.method === "auto" && typeof locator.confidence === "number" ? { confidence: locator.confidence } : {}) };
    const instances = locator.assets.filter((a) => matchesLocator(a, locator));
    if (instances.length === 0) {
      out.states[visualId] = locator.last_failure ? { visualId, status: "extraction_failed", failure: locator.last_failure, provenance, resolution: "D" } : { visualId, status: "located_processing", provenance, resolution: "D" };
      continue;
    }
    const ready = (instance: AssetRow): VisualState => {
      const spec = locator.method === "auto" ? verifiedSpec(locator.specs ?? []) : null;
      return { visualId, status: "ready", provenance, resolution: locator.method === "human" ? "A" : spec ? "C" : "B", ...(spec ? { spec } : {}), widthMm: Math.round(((instance.width * 25.4) / VISUAL_CROP_RECIPE.dpi) * 10) / 10 };
    };
    // Lists only (`verify: false`): an instance row counts without reading its object; the sheet and the PDF always verify.
    if (input.verify === false && !input.withBytes) {
      out.states[visualId] = ready(instances[0]!);
      continue;
    }
    const verified = await verifiedInstance((path) => deps.reader.readObject(path), instances);
    if ("failure" in verified) out.states[visualId] = { visualId, status: "extraction_failed", failure: verified.failure, provenance, resolution: "D" };
    else {
      out.states[visualId] = ready(verified.instance);
      if (input.withBytes) {
        out.bytes[visualId] = verified.stored;
        out.instances[visualId] = { assetId: verified.instance.id, sha256: verified.instance.sha256 };
      }
    }
  }
  return out;
}

/** The reconstruction of the current extractor, only if it is a valid spec AND its bytes are the ones its row certifies. */
function verifiedSpec(specs: readonly SpecRow[]): VisualSpec | null {
  const row = specs.find((s) => s.extractor_version === SPEC_EXTRACTOR_VERSION);
  if (!row || fingerprint(row.spec) !== row.spec_sha256) return null;
  const parsed = VisualSpecSchema.safeParse(row.spec);
  return parsed.success ? parsed.data : null;
}

/**
 * Exact pin (what a historical export must record: instance id + sha-256). Returns the bytes of THAT instance or an explicit
 * failure; it never falls back to another instance of the same logical crop.
 */
export async function readAssetInstance(deps: VisualDeps, pin: { assetId: string; sha256: string }): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; failure: "not_found" | "asset_missing" | "asset_corrupt" }> {
  const instance = await deps.reader.asset(pin.assetId);
  if (!instance || instance.id !== pin.assetId || instance.sha256 !== pin.sha256 || !verifiedLocator(instance.locator)
    || !matchesLocator(instance, instance.locator)) return { ok: false, failure: "not_found" };
  const stored = await deps.reader.readObject(instance.storage_path);
  if (!stored) return { ok: false, failure: "asset_missing" };
  if (sha256(stored) !== pin.sha256) return { ok: false, failure: "asset_corrupt" };
  return { ok: true, bytes: stored };
}
