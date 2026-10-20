import { z } from "zod";
import { randomUUID } from "node:crypto";
import { apiError, getApiContext } from "@/lib/api/context";
import { logger } from "@/lib/logger";
import { serviceDeps } from "@/lib/adaptation/orchestration/server";
import type { Actor } from "@/lib/adaptation/orchestration/service";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { visualDeps } from "@/lib/materials/visuals/server";
import { resourceDeps } from "@/lib/adaptation/resources/server";
import { generatedDeps } from "@/lib/render/generated";
import { exportAdaptationPdf, type PdfExportError } from "@/lib/render/pdf-export";
import { pdfEngine } from "@/lib/render/print/server";
import { draftStore } from "@/lib/editor/store";
import { PDF_HEADERS, pdfRevision } from "@/lib/render/pdf-contract";

// The first PDF of a new instance unpacks Chromium (≈2–3 s); a render is well under a second after that.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ERRORS: Record<PdfExportError, { status: number; message: string }> = {
  not_found: { status: 404, message: "No hemos encontrado esa adaptación." },
  not_ready: { status: 409, message: "Esta adaptación todavía no tiene una ficha entregada." },
  resource_pending: { status: 409, message: "Falta completar un recurso de la ficha (una imagen). Complétalo en la ficha y podrás descargar el PDF." },
  not_renderable: { status: 409, message: "Esta ficha todavía no se puede descargar completa. Revisa la vista docente para ver qué falta." },
  render_failed: { status: 503, message: "No hemos podido preparar el PDF. Inténtalo de nuevo en unos minutos." },
  version_changed: { status: 409, message: "La ficha generada ha cambiado. Recarga la ficha para abrir la versión actual antes de preparar el PDF." },
};

/**
 * PDF of the adaptation's current delivered sheet, generated now and returned as a download (nothing is stored). Whoever may read
 * the sheet may download it (read-only members too); another workspace's adaptation is simply not found (the user's RLS). Private:
 * never cached by anyone.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/pdf">) {
  const requestId = randomUUID();
  const started = performance.now();
  const withRequestId = <T extends Response>(response: T): T => {
    response.headers.set("X-Request-ID", requestId);
    return response;
  };
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return withRequestId(auth.response);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return withRequestId(apiError(404, "not_found", ERRORS.not_found.message));

  const supabase = await getSupabase();
  const rawDraft = new URL(request.url).searchParams.get("borrador");
  const draftRevision = rawDraft === null ? undefined : Number(rawDraft);
  if (draftRevision !== undefined && (!Number.isInteger(draftRevision) || draftRevision < 1)) return withRequestId(apiError(404, "not_found", ERRORS.not_found.message));
  const rawVersion = new URL(request.url).searchParams.get("version");
  const expectedVersion = rawVersion === null ? undefined : Number(rawVersion);
  if (expectedVersion !== undefined && !z.number().int().positive().safeParse(expectedVersion).success) return withRequestId(apiError(404, "not_found", ERRORS.not_found.message));
  const actor: Actor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  const result = await exportAdaptationPdf({ service: serviceDeps(supabase), visuals: visualDeps(supabase), resources: resourceDeps(supabase), generated: generatedDeps(supabase), engine: pdfEngine(), drafts: draftStore(supabase) }, actor, id, draftRevision, expectedVersion);
  if (!result.ok) {
    logger.warn("pdf_request", { requestId, outcome: result.code, durationMs: Math.round(performance.now() - started) });
    return withRequestId(apiError(ERRORS[result.code].status, result.code, ERRORS[result.code].message));
  }

  logger.info("pdf_request", { requestId, outcome: "ready", durationMs: Math.round(performance.now() - started), pages: result.pageCount, bytes: result.pdf.byteLength });

  return withRequestId(new Response(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": result.contentDisposition,
      "Content-Length": String(result.pdf.byteLength),
      [PDF_HEADERS.pages]: String(result.pageCount),
      [PDF_HEADERS.bytes]: String(result.pdf.byteLength),
      [PDF_HEADERS.revision]: pdfRevision(draftRevision),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  }));
}
