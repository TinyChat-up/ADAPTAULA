import { z } from "zod";
import { apiError } from "@/lib/api/context";
import { privateRead } from "@/lib/adaptation/orchestration/http";
import { getAdaptationPlan } from "@/lib/adaptation/orchestration/service";

export const dynamic = "force-dynamic";

/** The current plan with the validator's verdict per decision, for the review screen. Private, never cached. */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/plan">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "No hemos encontrado esa adaptación.");
  return privateRead(request, (deps, actor) => getAdaptationPlan(deps, actor, id));
}
