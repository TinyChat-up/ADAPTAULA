import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { getMaterialDetail } from "@/lib/materials/repository";
import { materialStatusPayload } from "@/lib/materials/status";

/**
 * Polled by the progress screen: a read, nothing else. Running the analysis is `POST /api/materials/[id]/analysis/run` (the
 * screen calls it as soon as the job exists, and again if a job is left waiting); recovery of abandoned jobs is the daily cron.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/materials/[id]/status">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const detail = await getMaterialDetail(auth.ctx.workspace.id, id);
  if (!detail) return apiError(404, "not_found", "No hemos encontrado ese material.");
  return NextResponse.json(materialStatusPayload(detail), { headers: { "Cache-Control": "no-store" } });
}
