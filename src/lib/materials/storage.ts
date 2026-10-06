import "server-only";
import { getSupabase } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ANALYSIS_LIMITS, SOURCE_BUCKET } from "./config";

/**
 * Storage access. Writes and deletions go through the service role, but only for paths the server built
 * after resolving the workspace. Reads for a user go through RLS (the storage policy checks membership).
 */

export async function createSignedUpload(path: string): Promise<{ token: string }> {
  const { data, error } = await createAdminClient().storage.from(SOURCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("No se ha podido preparar la subida.");
  return { token: data.token };
}

export async function downloadSource(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(SOURCE_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeSources(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await createAdminClient().storage.from(SOURCE_BUCKET).remove(paths);
  return !error;
}

/** Short-lived URL created with the USER's client: if RLS does not let them read the object, there is no URL. */
export async function createReadUrl(path: string, options: { download?: boolean } = {}): Promise<string | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .createSignedUrl(path, ANALYSIS_LIMITS.signedReadUrlSeconds, options.download ? { download: true } : undefined);
  return error || !data ? null : data.signedUrl;
}
