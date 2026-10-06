import { z } from "zod";
import { apiError } from "@/lib/api/context";
import { privateRead } from "@/lib/adaptation/orchestration/http";
import { getAdaptationStatus } from "@/lib/adaptation/orchestration/service";

export const dynamic = "force-dynamic";

/** Polled by the adaptation screen: the stable status DTO. Private, never cached. */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/status">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "No hemos encontrado esa adaptación.");
  return privateRead(request, (deps, actor) => getAdaptationStatus(deps, actor, id));
}
