import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { effectiveLimits } from "@/lib/materials/config";
import { describeServiceError, statusCodeFor } from "@/lib/materials/messages";
import { completeUpload } from "@/lib/materials/service";
import { getWorkspaceUsage } from "@/lib/plans/usage";

// Downloading and checking the real bytes of the file (page count of a large PDF).
export const maxDuration = 300;

/**
 * Step 2: the file is in Storage. Validate the real bytes, then reuse an analysis or queue a new one (its unit of quota is reserved
 * with the job). The analysis itself starts right away from the progress screen, `POST /api/materials/[id]/analysis/run`.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/uploads/[id]/complete">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const result = await completeUpload(auth.ctx, id);
  if (!result.ok) {
    const usage = await getWorkspaceUsage(auth.ctx.workspace.id).catch(() => null);
    return apiError(statusCodeFor(result.code), result.code, describeServiceError(result.code, usage ? effectiveLimits(usage.features) : undefined));
  }
  return NextResponse.json({ status: result.status, reused: result.reused }, { headers: { "Cache-Control": "no-store" } });
}
