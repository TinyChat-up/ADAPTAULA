import { z } from "zod";
import { apiError } from "@/lib/api/context";
import { privateRead } from "@/lib/adaptation/orchestration/http";
import { getAdaptationVersion } from "@/lib/adaptation/orchestration/service";

export const dynamic = "force-dynamic";

/** The current version (or `?v=N`) the caller is authorised to read. Private, never cached. */
export async function GET(request: Request, { params }: RouteContext<"/api/adaptations/[id]/version">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "No hemos encontrado esa adaptación.");
  const raw = new URL(request.url).searchParams.get("v");
  const version = raw === null ? null : Number(raw);
  if (version !== null && (!Number.isInteger(version) || version < 1)) return apiError(404, "not_found", "No hemos encontrado esa adaptación.");
  return privateRead(request, (deps, actor) => getAdaptationVersion(deps, actor, id, version));
}
