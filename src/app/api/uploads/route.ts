import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getApiContext } from "@/lib/api/context";
import { effectiveLimits } from "@/lib/materials/config";
import { describeServiceError, statusCodeFor } from "@/lib/materials/messages";
import { initUpload } from "@/lib/materials/service";
import { getWorkspaceUsage } from "@/lib/plans/usage";

const BodySchema = z.object({
  name: z.string().min(1).max(512),
  size: z.number().int().min(0).max(1024 * 1024 * 1024),
  mime: z.string().max(100),
});

/** Step 1 of an upload: validates what the browser declares and returns a one-time signed upload. */
export async function POST(request: Request) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "invalid_request", "No hemos entendido la solicitud.");

  const result = await initUpload(auth.ctx, body.data);
  if (!result.ok) {
    const usage = await getWorkspaceUsage(auth.ctx.workspace.id).catch(() => null);
    const limits = usage ? effectiveLimits(usage.features) : undefined;
    return apiError(statusCodeFor(result.code), result.code, describeServiceError(result.code, limits));
  }
  return NextResponse.json({ materialId: result.materialId, path: result.path, token: result.token }, { headers: { "Cache-Control": "no-store" } });
}
