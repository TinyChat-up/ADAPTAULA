import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { processMaterialAnalysis } from "@/lib/materials/analysis-job";
import { getMaterialDetail } from "@/lib/materials/repository";
import { materialStatusPayload } from "@/lib/materials/status";

// The analysis runs INSIDE this request and is awaited: its own deadline (270 s) stays below this budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Runs the material's pending analysis now (the normal path: the progress screen calls it as soon as the job exists). The job and
 * its unit of quota already exist; this only processes it. Idempotent: a second request, another tab or the recovery cron racing
 * it cannot run it twice (atomic claim), and a finished job is never run again. Answers the resulting state.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/materials/[id]/analysis/run">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const before = await getMaterialDetail(auth.ctx.workspace.id, id);
  if (!before) return apiError(404, "not_found", "No hemos encontrado ese material.");
  if (before.material.status === "queued" || before.material.status === "analyzing") await processMaterialAnalysis(id);

  const after = await getMaterialDetail(auth.ctx.workspace.id, id);
  return NextResponse.json(materialStatusPayload(after ?? before), { headers: { "Cache-Control": "no-store" } });
}
