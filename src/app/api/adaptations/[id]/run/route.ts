import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { PRIVATE_HEADERS } from "@/lib/adaptation/orchestration/http";
import { PUBLIC_SERVICE_ERRORS } from "@/lib/adaptation/orchestration/public";
import { authorizeStageRun, getAdaptationStatus, type Actor } from "@/lib/adaptation/orchestration/service";
import { orchestratorDeps, serviceDeps } from "@/lib/adaptation/orchestration/server";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";

// The stage runs INSIDE this request and is awaited: planning or generation + review, each call with its own timeout.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Runs the adaptation's pending stage now (the normal path: the screen calls it right after "Adaptar", "Generar" or "Reintentar"
 * persisted the job, and again if a job is left waiting). A Route Handler and not a Server Action: Next.js dispatches a client's
 * Server Actions one at a time, so a minutes-long action would hold back "Cancelar". The job, its entitlement and every domain
 * rule already exist; this only processes it. Idempotent: a second request, another tab or the recovery cron racing it cannot run
 * it twice (atomic claim), a finished job is never run again, and a job waiting out a backoff is not touched. Only a writer can
 * run it (like starting or retrying); a read-only member can still read the status.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/adaptations/[id]/run">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "No hemos encontrado esa adaptación.");
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const actor: Actor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  const deps = serviceDeps(await getSupabase());

  // Writer only, checked before anything else; then ownership through the user's own client (RLS): another workspace's adaptation
  // is simply not found, and so is a role without permission (the convention of every adaptation command).
  const visible = await authorizeStageRun(deps, actor, id);
  if (!visible.ok) {
    const { status, message } = PUBLIC_SERVICE_ERRORS[visible.code];
    return apiError(status, visible.code, message);
  }
  if (visible.data.phase === "working") await processAdaptationStage(orchestratorDeps(), id);

  const after = await getAdaptationStatus(deps, actor, id);
  return NextResponse.json(after.ok ? after.data : visible.data, { headers: PRIVATE_HEADERS });
}
