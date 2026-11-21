import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adaptationStore } from "@/lib/adaptation/orchestration/server";
import { inWorkspaceList } from "@/lib/adaptation/recreation/engine";
import { serverEnv } from "@/lib/config/env.server";
import { downloadSource } from "@/lib/materials/storage";
import { pdfEngine } from "@/lib/render/print/server";
import type { DirectedBridgeDeps } from "./bridge";

/** Whether this workspace may preview the director's sheet. Server's switch only; empty by default (nobody). */
export const directorPreviewAllowed = (workspaceId: string): boolean => inWorkspaceList(serverEnv().DIRECTOR_PREVIEW_WORKSPACES, workspaceId);

/**
 * The bridge's dependencies. The material and the profile are read with the USER's client (RLS: another workspace's rows do not exist
 * for them). The pipeline snapshot and the original's bytes need the server's access, and are read only after the caller checked that
 * the user can read this adaptation (the same order the PDF export follows).
 */
export function directedBridgeDeps(supabase: SupabaseClient): DirectedBridgeDeps {
  const store = adaptationStore();
  return {
    pipeline: (id) => store.getPipeline(id),
    async material(id) {
      const { data } = await supabase.from("materials").select("id, workspace_id, subject_slug, content_hash, deletion_requested_at").eq("id", id).maybeSingle();
      if (!data) return null;
      const { data: file } = await supabase.from("material_files").select("storage_path").eq("material_id", id).eq("kind", "source").maybeSingle();
      return { ...data, source_path: file?.storage_path ?? null };
    },
    async profile(id) {
      const { data } = await supabase.from("learner_profiles").select("id, workspace_id, functional_profile, updated_at").eq("id", id).maybeSingle();
      return data ?? null;
    },
    original: downloadSource,
    engine: pdfEngine(),
  };
}
