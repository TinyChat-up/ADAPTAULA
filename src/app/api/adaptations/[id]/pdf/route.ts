import { z } from "zod";
import { apiError, getApiContext } from "@/lib/api/context";
import { serviceDeps } from "@/lib/adaptation/orchestration/server";
import type { Actor } from "@/lib/adaptation/orchestration/service";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { visualDeps } from "@/lib/materials/visuals/server";
import { resourceDeps } from "@/lib/adaptation/resources/server";
import { exportAdaptationPdf, type PdfExportError } from "@/lib/render/pdf-export";
import { pdfEngine } from "@/lib/render/print/server";

// The first PDF of a new instance unpacks Chromium (≈2–3 s); a render is well under a second after that.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ERRORS: Record<PdfExportError, { status: number; message: string }> = {
  not_found: { status: 404, message: "No hemos encontrado esa adaptación." },
  not_ready: { status: 409, message: "Esta adaptación todavía no tiene una ficha entregada." },
  resource_pending: { status: 409, message: "Falta completar un recurso de la ficha (una imagen). Complétalo en la ficha y podrás descargar el PDF." },
  not_renderable: { status: 409, message: "Esta ficha todavía no se puede descargar completa. Revisa la vista docente para ver qué falta." },
  render_failed: { status: 503, message: "No hemos podido preparar el PDF. Inténtalo de nuevo en unos minutos." },
};

/**
 * PDF of the adaptation's current delivered sheet, generated now and returned as a download (nothing is stored). Whoever may read
 * the sheet may download it (read-only members too); another workspace's adaptation is simply not found (the user's RLS). Private:
 * never cached by anyone.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/pdf">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", ERRORS.not_found.message);

  const supabase = await getSupabase();
  const actor: Actor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  const result = await exportAdaptationPdf({ service: serviceDeps(supabase), visuals: visualDeps(supabase), resources: resourceDeps(supabase), engine: pdfEngine() }, actor, id);
  if (!result.ok) return apiError(ERRORS[result.code].status, result.code, ERRORS[result.code].message);

  return new Response(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": result.contentDisposition,
      "Content-Length": String(result.pdf.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });
}
