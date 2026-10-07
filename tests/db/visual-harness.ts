import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { AssetRow, LocatorRow, VisualDeps } from "@/lib/materials/visuals/service";
import { as } from "./harness";
import type { User } from "./orchestration-harness";

/**
 * `VisualDeps` over PGlite with the real migrations: the reader runs as the user (RLS on the tables AND on storage.objects), the
 * admin side as service_role. Object bytes live in memory, keyed like Supabase Storage; a row in storage.objects is what the
 * storage policy checks, exactly as in production.
 */
export interface VisualHarness {
  deps: VisualDeps;
  objects: Map<string, Uint8Array>;
  sources: Map<string, { mime: string; bytes: Uint8Array }>;
  failPutOnce: () => void;
}

const BUCKET = "generated-assets";
const num = (v: unknown) => Number(v);
const locatorRow = (r: Record<string, unknown>): LocatorRow => ({ ...(r as unknown as LocatorRow), x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) });
const LOCATOR_COLUMNS = "id, workspace_id, material_id, analysis_fingerprint, visual_id, source_sha256, locator_version, revision, method, page, x, y, w, h, page_box, superseded_at, last_failure";
const ASSET_COLUMNS = "id, locator_id, identity, recipe_version, storage_path, width, height, bytes, sha256";

export function visualHarness(db: PGlite, user: User, shared?: Pick<VisualHarness, "objects" | "sources">): VisualHarness {
  const objects = shared?.objects ?? new Map<string, Uint8Array>();
  const sources = shared?.sources ?? new Map<string, { mime: string; bytes: Uint8Array }>();
  let failNextPut = false;
  const asUser = <T>(fn: () => Promise<T>) => as(db, "authenticated", user.id, fn);
  const asService = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);

  const deps: VisualDeps = {
    reader: {
      material: async (id) => (await asUser(() => db.query<never>("select id, workspace_id, analysis, content_hash from public.materials where id = $1", [id]))).rows[0] ?? null,
      activeLocators: async (materialId, analysisFingerprint) => {
        const locators = (await asUser(() => db.query<Record<string, unknown>>(`select ${LOCATOR_COLUMNS} from public.material_visual_locators where material_id = $1 and analysis_fingerprint = $2 and superseded_at is null`, [materialId, analysisFingerprint]))).rows.map(locatorRow);
        const assets = (await asUser(() => db.query<AssetRow>(`select ${ASSET_COLUMNS} from public.material_visual_assets where material_id = $1 order by created_at desc, id desc`, [materialId]))).rows;
        return locators.map((l) => ({ ...l, assets: assets.filter((a) => a.locator_id === l.id) }));
      },
      asset: async (id) => (await asUser(() => db.query<AssetRow>(`select ${ASSET_COLUMNS} from public.material_visual_assets where id = $1`, [id]))).rows[0] ?? null,
      readObject: async (path) => {
        const visible = (await asUser(() => db.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [BUCKET, path]))).rows.length > 0;
        return visible ? (objects.get(path) ?? null) : null;
      },
    },
    admin: {
      source: async (materialId) => {
        const s = sources.get(materialId);
        return s ? { mime: s.mime, storagePath: `src/${materialId}` } : null;
      },
      download: async (path) => sources.get(path.replace(/^src\//, ""))?.bytes ?? null,
      createLocator: async (i) =>
        (
          await asService(() =>
            db.query<{ r: { id: string; revision: number } }>("select public.create_visual_locator($1, $2, $3, $4, $5, 'human', $6, $7, $8, $9, $10, $11, $12) as r", [
              i.workspaceId, i.materialId, i.analysisFingerprint, i.visualId, i.sourceSha256, i.page, i.bounds.x, i.bounds.y, i.bounds.w, i.bounds.h, JSON.stringify(i.pageBox), i.userId,
            ]),
          )
        ).rows[0]!.r,
      locator: async (id) => {
        const r = (await asService(() => db.query<Record<string, unknown>>(`select ${LOCATOR_COLUMNS} from public.material_visual_locators where id = $1`, [id]))).rows[0];
        return r ? locatorRow(r) : null;
      },
      activeLocator: async (materialId, analysisFingerprint, visualId) => {
        const r = (await asService(() => db.query<Record<string, unknown>>(`select ${LOCATOR_COLUMNS} from public.material_visual_locators where material_id = $1 and analysis_fingerprint = $2 and visual_id = $3 and superseded_at is null`, [materialId, analysisFingerprint, visualId]))).rows[0];
        return r ? locatorRow(r) : null;
      },
      assetInstances: async (identity) => (await asService(() => db.query<AssetRow>(`select ${ASSET_COLUMNS} from public.material_visual_assets where identity = $1 order by created_at desc, id desc`, [identity]))).rows,
      readObject: async (path) => objects.get(path) ?? null,
      putObject: async (path, png, mode) => {
        if (failNextPut) {
          failNextPut = false;
          return "failed";
        }
        // Like Supabase Storage without upsert: an existing object is never replaced.
        if (mode === "create" && objects.has(path)) return "exists";
        objects.set(path, png);
        await asService(() => db.query("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing", [BUCKET, path]));
        return "stored";
      },
      insertAsset: async (row) => {
        await asService(() =>
          db.query(
            "insert into public.material_visual_assets (workspace_id, material_id, locator_id, identity, recipe_version, recipe_fingerprint, storage_path, mime, width, height, bytes, sha256, provenance) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (identity, sha256) do nothing",
            [row.workspace_id, row.material_id, row.locator_id, row.identity, row.recipe_version, row.recipe_fingerprint, row.storage_path, row.mime, row.width, row.height, row.bytes, row.sha256, JSON.stringify(row.provenance)],
          ),
        );
      },
      setFailure: async (locatorId, failure) => {
        await asService(() => db.query("update public.material_visual_locators set last_failure = $2 where id = $1", [locatorId, failure]));
      },
    },
  };
  return { deps, objects, sources, failPutOnce: () => (failNextPut = true) };
}

/** Registers `bytes` as the material's original (content_hash = its sha-256, as the upload flow does). */
export async function attachSource(db: PGlite, h: VisualHarness, materialId: string, mime: string, bytes: Uint8Array) {
  h.sources.set(materialId, { mime, bytes });
  const hash = createHash("sha256").update(bytes).digest("hex");
  await db.query("update public.materials set content_hash = $2 where id = $1", [materialId, hash]);
  return hash;
}
