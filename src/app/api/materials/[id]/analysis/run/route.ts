import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { processMaterialAnalysis } from "@/lib/materials/analysis-job";
import { describeServiceError, statusCodeFor } from "@/lib/materials/messages";
import { getMaterialDetail } from "@/lib/materials/repository";
import { materialStatusPayload } from "@/lib/materials/status";

// The analysis runs INSIDE this request and is awaited: its own deadline (270 s) stays below this budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Runs the material's pending analysis now (the normal path: the progress screen calls it as soon as the job exists). The job and
 * its unit of quota already exist; this only processes it. Idempotent: a second request, another tab or the recovery cron racing
 * it cannot run it twice (atomic claim), and a finished job is never run again. Answers the resulting state. Writers only (403).
 */
export async function POST(request: Request, { params }: RouteContext<"/api/materials/[id]/analysis/run">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  // Writer only, checked before anything is read or processed (the capability that uploads and re-analyses takes): a read-only
  // member can still read the status, but cannot start or resume the processing.
  if (!hasRole(auth.ctx.role, WRITE_ROLES)) return apiError(statusCodeFor("forbidden"), "forbidden", describeServiceError("forbidden"));

  const before = await getMaterialDetail(auth.ctx.workspace.id, id);
  if (!before) return apiError(404, "not_found", "No hemos encontrado ese material.");
  if (before.material.status === "queued" || before.material.status === "analyzing") await processMaterialAnalysis(id);

  const after = await getMaterialDetail(auth.ctx.workspace.id, id);
  return NextResponse.json(materialStatusPayload(after ?? before), { headers: { "Cache-Control": "no-store" } });
}
