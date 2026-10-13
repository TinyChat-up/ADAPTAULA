import { z } from "zod";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { generatedDeps, resolveGenerated } from "@/lib/render/generated";

export const dynamic = "force-dynamic";

/**
 * An approved illustration generated for one sheet (docs/VISUAL_RESOURCES.md § Ilustraciones generadas). Authorisation is the
 * user's RLS on the adaptation, the `generated_assets` row and the private object; the bytes are served only after matching the
 * sha-256 the row records. No signed or public URL.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/generated/[assetId]">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id, assetId } = await params;
  const notFound = () => apiError(404, "not_found", "No hemos encontrado esa imagen.");
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(assetId).success) return notFound();

  const supabase = await getSupabase();
  const { data: adaptation } = await supabase.from("adaptations").select("id").eq("id", id).maybeSingle();
  if (!adaptation) return notFound();
  const deps = generatedDeps(supabase);
  const row = await deps.row(assetId);
  if (!row) return notFound();
  const resolved = await resolveGenerated(deps, id, [{ assetId, sha256: row.sha256 }], { withBytes: true });
  const bytes = resolved.bytes[assetId];
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}
