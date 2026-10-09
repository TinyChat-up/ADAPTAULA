import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ResourceDeps, ResourceRow } from "./service";

/**
 * Production `ResourceDeps`. Reads go through the USER's client (RLS on adaptations, versions and resources, and the storage
 * policy of the private `generated-assets` bucket); the service role only writes, after that read authorised the adaptation.
 * No signed or public URL is ever created: images are streamed by an authorised route.
 */
const BUCKET = "generated-assets";
const COLUMNS = "id, decision_id, resolution, storage_path, sha256, width, height, created_at";

const isDuplicate = (error: unknown) => {
  const e = error as { statusCode?: string | number; status?: number; message?: string } | null;
  return !!e && (String(e.statusCode) === "409" || e.status === 409 || /already exists|duplicate/i.test(e.message ?? ""));
};

export function resourceDeps(supabase: SupabaseClient): ResourceDeps {
  const admin = createAdminClient();
  return {
    reader: {
      async adaptation(id) {
        const { data } = await supabase.from("adaptations").select("id, workspace_id").eq("id", id).maybeSingle();
        return data ?? null;
      },
      async currentDocument(adaptationId) {
        const { data: adaptation } = await supabase.from("adaptations").select("current_version, delivered_at, status").eq("id", adaptationId).maybeSingle();
        if (!adaptation?.current_version || !adaptation.delivered_at || adaptation.status !== "ready") return null;
        const { data } = await supabase.from("adaptation_versions").select("document").eq("adaptation_id", adaptationId).eq("version", adaptation.current_version).maybeSingle();
        const parsed = MaterialDocumentSchema.safeParse(data?.document);
        return parsed.success ? parsed.data : null;
      },
      async activeResources(adaptationId) {
        const { data } = await supabase.from("adaptation_visual_resources").select(COLUMNS).eq("adaptation_id", adaptationId).is("superseded_at", null);
        return (data ?? []) as ResourceRow[];
      },
      async readObject(path) {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        return error || !data ? null : new Uint8Array(await data.arrayBuffer());
      },
    },
    admin: {
      async putObject(path, png) {
        const { error } = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
        if (!error) return "stored";
        return isDuplicate(error) ? "exists" : "failed";
      },
      async setResource(i) {
        const { data, error } = await admin.rpc("set_adaptation_visual_resource", {
          p_workspace: i.workspaceId,
          p_adaptation: i.adaptationId,
          p_decision: i.decisionId,
          p_resolution: i.resolution,
          p_storage_path: i.storagePath,
          p_sha256: i.sha256,
          p_width: i.width,
          p_height: i.height,
          p_bytes: i.bytes,
          p_rights: i.rightsConfirmed,
          p_user: i.userId,
        });
        if (error || !data) throw new Error("No se ha podido guardar el recurso.");
        return data as { id: string; reused: boolean };
      },
    },
  };
}
