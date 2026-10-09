import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { IMAGE_REJECTION_COPY, MAX_UPLOAD_BYTES, normaliseTeacherImage } from "@/lib/adaptation/resources/image";
import { RESOURCE_DECISION, omitVisualResource, provideVisualResource, resolveResources, type ResourceActor, type ResourceResult } from "@/lib/adaptation/resources/service";
import { resourceDeps } from "@/lib/adaptation/resources/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * A visual a plan decision asked for and the original does not have (docs/VISUAL_RESOURCES.md).
 *  GET  streams the image the teacher provided, after matching its recorded sha-256 (RLS on the adaptation, the row and the
 *       private object). No signed or public URL.
 *  POST «Añadir recurso» (multipart: `file` + `rights`) or «Continuar sin esta imagen» (JSON `{action:"omit"}`). Writers only,
 *       same origin; the adaptation, its current delivered version and the decision are resolved on the server. The image is
 *       validated on its bytes and normalised (PNG, no metadata) before it is stored. Nothing is regenerated, no quota is touched.
 */
const MESSAGES = {
  not_found: "No hemos encontrado ese recurso.",
  forbidden: "Tienes acceso de solo lectura: no puedes cambiar esta ficha.",
  invalid: "Revisa los datos y vuelve a intentarlo.",
  rights: "Confirma que puedes usar esta imagen en tu clase.",
  storage_failed: "No hemos podido guardar la imagen. Inténtalo de nuevo.",
  needs_resource: "Esta imagen es imprescindible para resolver la actividad y la ficha no tiene alternativa: añádela para poder imprimirla.",
} as const;

const valid = (id: string, decisionId: string) => z.uuid().safeParse(id).success && RESOURCE_DECISION.test(decisionId);
const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/resources/[decisionId]">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id, decisionId } = await params;
  if (!valid(id, decisionId)) return apiError(404, "not_found", MESSAGES.not_found);
  const resolved = await resolveResources(resourceDeps(await getSupabase()), id, [decisionId], { withBytes: true });
  const bytes = resolved.bytes[decisionId];
  if (!bytes) return apiError(404, "not_found", MESSAGES.not_found);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } });
}

function answer(result: ResourceResult) {
  if (result.ok) return reply({ ok: true, status: result.state.status }, 200);
  const status = result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : result.code === "storage_failed" ? 503 : result.code === "needs_resource" ? 409 : 422;
  return reply({ ok: false, message: MESSAGES[result.code] }, status);
}

export async function POST(request: Request, { params }: RouteContext<"/api/adaptations/[id]/resources/[decisionId]">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id, decisionId } = await params;
  if (!valid(id, decisionId)) return apiError(404, "not_found", MESSAGES.not_found);
  const actor: ResourceActor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  if (!actor.canWrite) return reply({ ok: false, message: MESSAGES.forbidden }, 403);
  const deps = resourceDeps(await getSupabase());

  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) {
    const body = z.object({ action: z.literal("omit") }).strict().safeParse(await request.json().catch(() => null));
    if (!body.success) return reply({ ok: false, message: MESSAGES.invalid }, 422);
    return answer(await omitVisualResource(deps, actor, { adaptationId: id, decisionId }));
  }
  if (!type.startsWith("multipart/form-data")) return reply({ ok: false, message: MESSAGES.invalid }, 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return reply({ ok: false, message: IMAGE_REJECTION_COPY.too_large }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return reply({ ok: false, message: MESSAGES.invalid }, 422);
  if (form?.get("rights") !== "on") return reply({ ok: false, message: MESSAGES.rights }, 422);
  if (file.size > MAX_UPLOAD_BYTES) return reply({ ok: false, message: IMAGE_REJECTION_COPY.too_large }, 413);
  const image = await normaliseTeacherImage(new Uint8Array(await file.arrayBuffer()));
  if (!image.ok) return reply({ ok: false, message: IMAGE_REJECTION_COPY[image.reason] }, 422);
  const result = await provideVisualResource(deps, actor, { adaptationId: id, decisionId, png: image.png, width: image.width, height: image.height, rightsConfirmed: true });
  // Opaque ids only: never the file's name, its type as declared by the browser or anything about the learner.
  logger.info("visual_resource_saved", { adaptationId: id, decisionId, ok: result.ok, reused: result.ok ? result.reused : null });
  return answer(result);
}
