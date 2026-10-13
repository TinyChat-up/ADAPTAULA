import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";

/**
 * The approved illustrations a sheet shows (docs/VISUAL_RESOURCES.md § Ilustraciones generadas), read with the USER's rights:
 * the `generated_assets` row (RLS: members of its workspace) and the private object (storage policy on the workspace folder). An
 * illustration counts only if its row belongs to THIS adaptation and its bytes are exactly the sha-256 the document pins.
 */

export interface GeneratedRow {
  id: string;
  adaptation_id: string;
  storage_path: string;
  sha256: string;
}

export interface GeneratedDeps {
  row(assetId: string): Promise<GeneratedRow | null>;
  readObject(path: string): Promise<Uint8Array | null>;
}

export interface GeneratedSource {
  assetId: string;
  sha256: string;
  width: number;
  height: number;
}

export function generatedSourcesOf(document: MaterialDocument): GeneratedSource[] {
  const seen = new Map<string, GeneratedSource>();
  for (const b of allBlocks(document)) {
    if (b.type === "image" && b.source.kind === "generated" && !seen.has(b.source.asset_id)) seen.set(b.source.asset_id, { assetId: b.source.asset_id, sha256: b.source.sha256, width: b.source.width, height: b.source.height });
  }
  return [...seen.values()];
}

/** Printed size: wide enough to read every part, never more than the column; a portrait picture stays narrower. */
export const generatedWidthMm = (width: number, height: number) => (width >= height * 1.2 ? 140 : height >= width * 1.2 ? 90 : 110);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function resolveGenerated(deps: GeneratedDeps, adaptationId: string, sources: readonly GeneratedSource[], options: { withBytes?: boolean; verify?: boolean } = {}): Promise<{ ready: Set<string>; bytes: Record<string, Uint8Array> }> {
  const ready = new Set<string>();
  const bytes: Record<string, Uint8Array> = {};
  for (const source of sources) {
    const row = await deps.row(source.assetId);
    if (!row || row.adaptation_id !== adaptationId || row.sha256 !== source.sha256) continue;
    if (options.verify === false && !options.withBytes) {
      ready.add(source.assetId);
      continue;
    }
    const stored = await deps.readObject(row.storage_path);
    if (!stored || sha256(stored) !== source.sha256) continue;
    ready.add(source.assetId);
    if (options.withBytes) bytes[source.assetId] = stored;
  }
  return { ready, bytes };
}

const BUCKET = "generated-assets";

/** Production deps over the user's client: nothing here uses the service role. */
export function generatedDeps(supabase: SupabaseClient): GeneratedDeps {
  return {
    async row(assetId) {
      const { data } = await supabase.from("generated_assets").select("id, adaptation_id, storage_path, sha256").eq("id", assetId).not("sha256", "is", null).maybeSingle();
      return (data as GeneratedRow | null) ?? null;
    },
    async readObject(path) {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
  };
}
