import { NextResponse } from "next/server";
import { after } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { effectiveLimits } from "@/lib/materials/config";
import { runAnalysisJob } from "@/lib/materials/analysis-job";
import { describeServiceError, statusCodeFor } from "@/lib/materials/messages";
import { completeUpload } from "@/lib/materials/service";
import { getWorkspaceUsage } from "@/lib/plans/usage";

// The analysis runs after the response, inside this function's budget.
export const maxDuration = 300;

/** Step 2: the file is in Storage. Validate the real bytes, then reuse an analysis or queue a new one. */
export async function POST(request: Request, { params }: RouteContext<"/api/uploads/[id]/complete">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const result = await completeUpload(auth.ctx, id);
  if (!result.ok) {
    const usage = await getWorkspaceUsage(auth.ctx.workspace.id).catch(() => null);
    return apiError(statusCodeFor(result.code), result.code, describeServiceError(result.code, usage ? effectiveLimits(usage.features) : undefined));
  }
  const jobId = result.jobId;
  if (jobId) after(() => runAnalysisJob(jobId));
  return NextResponse.json({ status: result.status, reused: result.reused }, { headers: { "Cache-Control": "no-store" } });
}
