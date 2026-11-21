import { z } from "zod";
import { randomUUID } from "node:crypto";
import { apiError, getApiContext } from "@/lib/api/context";
import { logger } from "@/lib/logger";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { directedSheet } from "@/lib/adaptation/directed/bridge";
import { directedBridgeDeps, directorPreviewAllowed } from "@/lib/adaptation/directed/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NOT_FOUND = "No hemos encontrado esa adaptación.";

/**
 * Preview of the sheet the pedagogical director 2.0 would make for an existing adaptation, as a PDF (nothing stored, no model called,
 * no quota consumed, no state changed). Only for workspaces the server lists in DIRECTOR_PREVIEW_WORKSPACES; anyone else gets a 404,
 * so «Hacer magia» is unchanged. A teacher of the workspace only: the adaptation must be readable with the user's own permissions
 * before the server reads anything with its own. When the director cannot make the sheet, the reasons are returned as codes (no content).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/director-pdf">) {
  const requestId = randomUUID();
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const workspaceId = auth.ctx.workspace.id;
  if (!z.uuid().safeParse(id).success || !directorPreviewAllowed(workspaceId)) return apiError(404, "not_found", NOT_FOUND);
  if (!hasRole(auth.ctx.role, WRITE_ROLES)) return apiError(403, "forbidden", "Solo el profesorado del espacio puede preparar esta vista previa.");

  const supabase = await getSupabase();
  const { data: visible } = await supabase.from("adaptations").select("id, workspace_id").eq("id", id).maybeSingle();
  if (!visible || visible.workspace_id !== workspaceId) return apiError(404, "not_found", NOT_FOUND);

  const result = await directedSheet(directedBridgeDeps(supabase), workspaceId, id);
  if (result.status === "blocked") {
    const codes = result.issues.map(({ code, original_id }) => (original_id ? `${code}:${original_id}` : code));
    logger.warn("director_preview", { requestId, outcome: "blocked", codes: codes.slice(0, 20).join(",") });
    return Response.json({ error: { code: "director_blocked", message: "El director pedagógico todavía no puede preparar esta ficha.", reasons: codes.slice(0, 50) } }, { status: 409, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } });
  }
  logger.info("director_preview", { requestId, outcome: "review_pending", bytes: result.pdf.byteLength, supports: result.checks.supports });
  return new Response(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="ficha-director-vista-previa.pdf"',
      "Content-Length": String(result.pdf.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
      Vary: "Cookie",
    },
  });
}
