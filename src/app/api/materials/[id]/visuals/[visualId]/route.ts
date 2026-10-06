import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { VISUAL_MESSAGES, toPublicVisualResult } from "@/lib/materials/visuals/public";
import { locateVisual, retryVisualAsset, type VisualActor } from "@/lib/materials/visuals/service";
import { visualDeps } from "@/lib/materials/visuals/server";

export const dynamic = "force-dynamic";

/**
 * Locate a visual (a page + a normalised rectangle) or retry its crop with the saved geometry. A job-like command: it renders the
 * original and stores a private PNG, so it is a Route Handler (same-origin enforced) and not a Server Action. Workspace, role,
 * analysis, source file, page count and page box are all resolved on the server; the body carries nothing else.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("locate"), page: z.number().int().min(1).max(500), bounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict() }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);

export async function POST(request: Request, { params }: RouteContext<"/api/materials/[id]/visuals/[visualId]">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id, visualId } = await params;
  if (!z.uuid().safeParse(id).success || !/^vis_[0-9]{1,4}$/.test(visualId)) return apiError(404, "not_found", VISUAL_MESSAGES.not_found);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, message: VISUAL_MESSAGES.invalid }, { status: 422, headers: { "Cache-Control": "no-store" } });

  const actor: VisualActor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  const deps = visualDeps(await getSupabase());
  const result = body.data.action === "locate" ? await locateVisual(deps, actor, { materialId: id, visualId, page: body.data.page, bounds: body.data.bounds }) : await retryVisualAsset(deps, actor, id, visualId);
  const status = result.ok ? 200 : result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : 422;
  return NextResponse.json(toPublicVisualResult(result), { status, headers: { "Cache-Control": "no-store" } });
}
