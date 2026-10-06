import { z } from "zod";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import { visualDeps } from "@/lib/materials/visuals/server";

export const dynamic = "force-dynamic";

/**
 * The crop of one original visual for the sheet viewer. Authorisation is the user's RLS on the adaptation, the locator, the asset
 * row and the private object; the bytes are only served after matching their recorded fingerprint. No signed or public URL.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/visuals/[visualId]">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id, visualId } = await params;
  const notFound = () => apiError(404, "not_found", "No hemos encontrado esa imagen.");
  if (!z.uuid().safeParse(id).success || !/^vis_[0-9]{1,4}$/.test(visualId)) return notFound();

  const supabase = await getSupabase();
  const { data: adaptation } = await supabase.from("adaptations").select("material_id, analysis_fingerprint").eq("id", id).maybeSingle();
  if (!adaptation?.analysis_fingerprint) return notFound();
  const deps = visualDeps(supabase);
  const material = await deps.reader.material(adaptation.material_id);
  if (!material) return notFound();
  const resolved = await resolveVisuals(deps, { materialId: material.id, analysisFingerprint: adaptation.analysis_fingerprint, sourceSha256: material.content_hash, visualIds: [visualId], withBytes: true });
  const bytes = resolved.bytes[visualId];
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}
