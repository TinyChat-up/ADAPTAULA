import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EditorChangesSchema, type EditorChanges, type SavedDraft } from "./changes";
export type { SavedDraft } from "./changes";

export interface DraftReader { read(id: string, baseVersion: number, revision?: number): Promise<SavedDraft | null> }

/** The session client's RLS applies to every read. No service-role client or provider. */
export function draftStore(supabase: SupabaseClient) {
  return {
    async read(id: string, baseVersion: number, revision?: number): Promise<SavedDraft | null> {
      let query = supabase.from("adaptation_drafts").select("revision, changes, content_acknowledged")
        .eq("adaptation_id", id).eq("base_version", baseVersion).order("revision", { ascending: false }).limit(1);
      if (revision !== undefined) query = query.eq("revision", revision);
      const { data, error } = await query;
      if (error) throw new Error("draft_read_failed");
      if (!data?.[0]) return null;
      const parsed = EditorChangesSchema.safeParse(data[0].changes);
      if (!parsed.success) throw new Error("invalid_draft");
      return { revision: data[0].revision, changes: parsed.data, contentAcknowledged: data[0].content_acknowledged };
    },
    async save(id: string, baseVersion: number, revision: number, changes: EditorChanges, acknowledged: boolean) {
      const { data, error } = await supabase.rpc("save_adaptation_draft", { p_adaptation: id, p_base_version: baseVersion, p_revision: revision, p_changes: changes, p_acknowledged: acknowledged });
      if (error) throw new Error("draft_save_failed");
      return data as { revision: number } | { error: "not_found" | "forbidden" | "conflict" | "invalid" };
    },
  };
}
