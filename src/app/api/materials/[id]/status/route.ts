import { NextResponse } from "next/server";
import { after } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { failureMessage } from "@/lib/ai/errors";
import { findRecoverableJob, runAnalysisJob } from "@/lib/materials/analysis-job";
import { getMaterialDetail } from "@/lib/materials/repository";

export const maxDuration = 300;

/**
 * Polled by the progress screen. It is also the recovery path: if a job's worker died (lease expired) or its
 * retry backoff has passed, whoever asks first re-launches it. The database guarantees only one runs.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/materials/[id]/status">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const detail = await getMaterialDetail(auth.ctx.workspace.id, id);
  if (!detail) return apiError(404, "not_found", "No hemos encontrado ese material.");

  const { material, job } = detail;
  if (material.status === "queued" || material.status === "analyzing") {
    const recoverable = await findRecoverableJob(id);
    if (recoverable) after(() => runAnalysisJob(recoverable));
  }

  return NextResponse.json(
    {
      status: material.status,
      step: job?.status === "processing" || job?.status === "queued" ? job.step : null,
      progress: job?.progress ?? 0,
      failure: material.failure_code ? { code: material.failure_code, message: failureMessage(material.failure_code) } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
