import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadSource } from "../storage";
import type { AssetRow, LocatorRow, VisualDeps } from "./service";

/**
 * Production `VisualDeps`. Reads go through the USER's client (RLS on the tables and the storage policy on the private
 * `generated-assets` bucket); writes and the source download use the service role, only after the reader has authorised the
 * material. No signed URL is created or stored: crops are streamed by an authorised route.
 */
const BUCKET = "generated-assets";
const LOCATOR_COLUMNS = "id, workspace_id, material_id, analysis_fingerprint, visual_id, source_sha256, locator_version, revision, method, page, x, y, w, h, page_box, superseded_at, last_failure";
const ASSET_COLUMNS = "id, locator_id, identity, recipe_version, storage_path, width, height, bytes, sha256";

const toBytes = async (blob: Blob | null) => (blob ? new Uint8Array(await blob.arrayBuffer()) : null);
const locatorOf = (r: Record<string, unknown>): LocatorRow => ({ ...(r as unknown as LocatorRow), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) });

export function visualDeps(supabase: SupabaseClient): VisualDeps {
  const admin = createAdminClient();
  return {
    reader: {
      async material(id) {
        const { data } = await supabase.from("materials").select("id, workspace_id, analysis, content_hash").eq("id", id).maybeSingle();
        return data ?? null;
      },
      async activeLocators(materialId, analysisFingerprint) {
        const { data: locators } = await supabase.from("material_visual_locators").select(LOCATOR_COLUMNS).eq("material_id", materialId).eq("analysis_fingerprint", analysisFingerprint).is("superseded_at", null);
        if (!locators?.length) return [];
        const { data: assets } = await supabase.from("material_visual_assets").select(ASSET_COLUMNS).in("locator_id", locators.map((l) => l.id));
        return locators.map((l) => ({ ...locatorOf(l), assets: ((assets ?? []) as AssetRow[]).filter((a) => a.locator_id === l.id) }));
      },
      async readObject(path) {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        return error ? null : toBytes(data);
      },
    },
    admin: {
      async source(materialId) {
        const { data } = await admin.from("material_files").select("storage_path, mime_type").eq("material_id", materialId).eq("kind", "source").limit(1);
        const file = data?.[0];
        return file ? { mime: file.mime_type, storagePath: file.storage_path } : null;
      },
      download: (path) => downloadSource(path),
      async createLocator(i) {
        const { data, error } = await admin.rpc("create_visual_locator", {
          p_workspace: i.workspaceId,
          p_material: i.materialId,
          p_analysis: i.analysisFingerprint,
          p_visual: i.visualId,
          p_source: i.sourceSha256,
          p_method: "human",
          p_page: i.page,
          p_x: i.bounds.x,
          p_y: i.bounds.y,
          p_w: i.bounds.w,
          p_h: i.bounds.h,
          p_page_box: i.pageBox,
          p_user: i.userId,
        });
        if (error || !data) throw new Error("No se ha podido guardar la localización.");
        return data as { id: string; revision: number };
      },
      async locator(id) {
        const { data } = await admin.from("material_visual_locators").select(LOCATOR_COLUMNS).eq("id", id).maybeSingle();
        return data ? locatorOf(data) : null;
      },
      async activeLocator(materialId, analysisFingerprint, visualId) {
        const { data } = await admin.from("material_visual_locators").select(LOCATOR_COLUMNS).eq("material_id", materialId).eq("analysis_fingerprint", analysisFingerprint).eq("visual_id", visualId).is("superseded_at", null).maybeSingle();
        return data ? locatorOf(data) : null;
      },
      async assetByIdentity(identity) {
        const { data } = await admin.from("material_visual_assets").select(ASSET_COLUMNS).eq("identity", identity).maybeSingle();
        return (data as AssetRow | null) ?? null;
      },
      async readObject(path) {
        const { data, error } = await admin.storage.from(BUCKET).download(path);
        return error ? null : toBytes(data);
      },
      async putObject(path, png) {
        // Same signed-upload pattern as the originals; upsert because a retry may repair an object with identical bytes.
        const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (signed.error || !signed.data) return false;
        const { error } = await admin.storage.from(BUCKET).uploadToSignedUrl(path, signed.data.token, png, { contentType: "image/png", upsert: true });
        return !error;
      },
      async insertAsset(row) {
        const { error } = await admin.from("material_visual_assets").insert(row);
        // Two producers finishing the same identity at once: the row already exists, which is the expected outcome.
        if (error && error.code !== "23505") throw new Error("No se ha podido registrar el recorte.");
      },
      async setFailure(locatorId, failure) {
        await admin.from("material_visual_locators").update({ last_failure: failure }).eq("id", locatorId);
      },
    },
  };
}
