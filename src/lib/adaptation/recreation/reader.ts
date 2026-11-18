import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RecreationLineSchema, RECREATION_RECORD_VERSION, RecreationVersionSchema, type RecreationReader } from "@/lib/recreation/record";
import { loadRecreationView, type RecreationView } from "@/lib/recreation/view";
import type { GeneratedSource } from "@/lib/render/generated";

/**
 * Reads a recreated «Hacer magia» sheet FROM THE USER'S CLIENT (RLS), never the server's: another workspace's adaptation is simply not
 * there. It can only reach what a member may read — the adaptation's version (the sheet, without answers) and `recreation_versions`
 * (materials, explanation, state, picture references). `recreation_internals` and `recreation_plans` have no policy and no grant, so
 * not even a mistake here could return a solution. It imports no model or provider: opening, reloading or printing calls no AI.
 */

const key = (adaptationId: string) => `adaptation:${adaptationId}`;

export function supabaseRecreationReader(supabase: SupabaseClient): RecreationReader {
  const visible = async (adaptationId: string, version: number | null) => {
    let versions = supabase.from("adaptation_versions").select("id, version, document, created_at").eq("adaptation_id", adaptationId);
    versions = version === null ? versions.order("version", { ascending: false }) : versions.eq("version", version);
    const { data } = await versions.limit(1);
    const base = data?.[0];
    if (!base) return null;
    const { data: extra } = await supabase.from("recreation_versions").select("state, state_message, review_activities, materials_document, explanation, assets").eq("adaptation_version_id", base.id).maybeSingle();
    return extra ? { base, extra } : null;
  };
  return {
    async getLine(id) {
      const { data } = await supabase.from("adaptations").select("id, workspace_id, material_id, current_version").eq("id", id).maybeSingle();
      if (!data || !(data.current_version >= 1)) return null;
      // Only an adaptation that has a recreated version is a recreation: the original engine's sheets are not read here.
      const current = await visible(id, data.current_version);
      return current ? RecreationLineSchema.parse({ id: data.id, workspace_id: data.workspace_id, material_id: data.material_id, current_version: data.current_version, idempotency_key: key(data.id) }) : null;
    },
    async getVersion(lineId, version) {
      const found = await visible(lineId, version);
      if (!found) return null;
      const { data: row } = await supabase.from("adaptations").select("workspace_id, title").eq("id", lineId).maybeSingle();
      if (!row) return null;
      // Fails closed: a stored version that does not fit the contract (or carries an answer) is not shown.
      const parsed = RecreationVersionSchema.safeParse({
        record_version: RECREATION_RECORD_VERSION,
        id: found.base.id,
        line_id: lineId,
        version,
        workspace_id: row.workspace_id,
        title: row.title,
        created_at: found.base.created_at,
        state: found.extra.state,
        state_message: found.extra.state_message,
        review_activities: found.extra.review_activities ?? [],
        student: found.base.document,
        materials: found.extra.materials_document,
        explanation: found.extra.explanation,
        assets: found.extra.assets ?? [],
      });
      return parsed.success ? parsed.data : null;
    },
    async listVersions(lineId) {
      const { data } = await supabase.from("recreation_versions").select("state, adaptation_versions!inner(version, created_at)").eq("adaptation_id", lineId);
      const rows = (data ?? []) as unknown as Array<{ state: "ready" | "review" | "incomplete"; adaptation_versions: { version: number; created_at: string } | Array<{ version: number; created_at: string }> }>;
      return rows
        .map((r) => ({ state: r.state, ...(Array.isArray(r.adaptation_versions) ? r.adaptation_versions[0]! : r.adaptation_versions) }))
        .sort((a, b) => a.version - b.version);
    },
  };
}

/** The view of the page (current version, or an older one to look at). Null: not a recreation, or nothing the user may read. */
export async function loadRecreationScreen(supabase: SupabaseClient, adaptationId: string, version?: number): Promise<RecreationView | null> {
  return loadRecreationView(supabaseRecreationReader(supabase), adaptationId, version);
}

/** The materials document and the pictures of the CURRENT version, for the materials' PDF (the same RLS reads; nothing is generated). */
export async function recreationMaterialsOf(supabase: SupabaseClient, adaptationId: string): Promise<{ document: unknown; assets: GeneratedSource[] } | null> {
  const reader = supabaseRecreationReader(supabase);
  const line = await reader.getLine(adaptationId);
  const version = line ? await reader.getVersion(adaptationId, line.current_version) : null;
  if (!version?.materials) return null;
  return { document: version.materials, assets: version.assets.map((a) => ({ assetId: a.asset_id, sha256: a.sha256 })) };
}
