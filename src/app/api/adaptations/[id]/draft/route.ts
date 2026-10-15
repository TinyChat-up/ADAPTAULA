import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { loadRenderInput } from "@/lib/render/load";
import { applyEditorChanges, EditorChangesSchema } from "@/lib/editor/changes";
import { draftStore } from "@/lib/editor/store";

export const dynamic = "force-dynamic";
const SaveSchema = z.object({ baseVersion: z.number().int().positive(), revision: z.number().int().min(0), changes: EditorChangesSchema, acknowledged: z.boolean() }).strict();

export async function PUT(request: Request, { params }: RouteContext<"/api/adaptations/[id]/draft">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "No hemos encontrado esa ficha.");
  const loaded = await loadRenderInput(auth.ctx, id);
  if (loaded.kind === "not_found") return apiError(404, "not_found", "No hemos encontrado esa ficha.");
  if (!hasRole(auth.ctx.role, WRITE_ROLES)) return apiError(403, "forbidden", "Tu permiso permite ver la ficha, pero no editarla.");
  if (loaded.kind !== "ok") return apiError(409, "not_ready", "Esta adaptación todavía no tiene una ficha editable.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 250000) return apiError(413, "too_large", "Los cambios son demasiado extensos.");
  let input: unknown;
  try { input = JSON.parse(text); } catch { return apiError(400, "invalid", "No hemos podido leer los cambios."); }
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return apiError(400, "invalid", "Revisa el enunciado y el espacio para responder.");
  const { baseVersion, revision, changes, acknowledged } = parsed.data;
  if (baseVersion !== loaded.version.version) return apiError(409, "conflict", "La ficha ha cambiado. Recarga antes de guardar.");
  try {
    const applied = applyEditorChanges(loaded.document, changes);
    if (applied.contentBlocks.length && !acknowledged)
      return apiError(422, "review_required", "Has cambiado contenido. Confirma que comprobarás los datos, las relaciones y que no das respuestas.");
  } catch { return apiError(400, "invalid", "Estos cambios no se pueden aplicar a la ficha."); }
  try {
    const result = await draftStore(await getSupabase()).save(id, baseVersion, revision, changes, acknowledged);
    if ("error" in result) {
      if (result.error === "conflict") return apiError(409, "conflict", "Hay una versión guardada más reciente. Recarga para recuperarla; tus cambios no se han sobrescrito.");
      return apiError(result.error === "forbidden" ? 403 : 404, result.error, "No se ha podido guardar esta ficha.");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch { return apiError(503, "save_failed", "No hemos podido guardar. Tus cambios siguen aquí; vuelve a intentarlo."); }
}
