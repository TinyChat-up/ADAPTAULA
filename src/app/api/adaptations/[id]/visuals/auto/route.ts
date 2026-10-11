import { NextResponse } from "next/server";
import { z } from "zod";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { getAdaptationStatus, type Actor } from "@/lib/adaptation/orchestration/service";
import { serviceDeps } from "@/lib/adaptation/orchestration/server";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { prepareAdaptationVisuals } from "@/lib/materials/visuals/auto/server";

export const dynamic = "force-dynamic";

/**
 * «Buscar en el original»: the teacher asks the automatic locator for the figures of a delivered sheet (one made before it
 * existed, or in «Revisar antes de crear»). Same engine and same rules as «Hacer magia»: it never replaces a figure a person
 * located, it creates no adaptation, it consumes no unit, and it runs at most once per material version (a repeated click answers
 * from the recorded run). Writers only, same origin; the adaptation, its analysis and its material are resolved on the server.
 */
const MESSAGES = {
  not_found: "No hemos encontrado esa ficha.",
  forbidden: "Tienes acceso de solo lectura: no puedes cambiar esta ficha.",
  failed: "No hemos podido buscar las imágenes ahora. Puedes localizarlas tú en el original.",
} as const;
const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: RouteContext<"/api/adaptations/[id]/visuals/auto">) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", MESSAGES.not_found);
  const actor: Actor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  if (!actor.canWrite) return reply({ ok: false, message: MESSAGES.forbidden }, 403);
  const deps = serviceDeps(await getSupabase());
  // The user's own rights decide whether the adaptation exists for them (RLS); only then is the pipeline read on the server.
  const status = await getAdaptationStatus(deps, actor, id);
  if (!status.ok || !status.data.delivered) return reply({ ok: false, message: MESSAGES.not_found }, 404);
  const snapshot = await deps.orchestrator.store.getPipeline(id);
  const row = snapshot?.adaptation;
  const parsed = parseStoredAnalysis(snapshot?.analysis.analysis);
  if (!row || row.workspace_id !== actor.workspaceId || !row.analysis_fingerprint || !parsed.analysis || fingerprint(parsed.analysis) !== row.analysis_fingerprint) return reply({ ok: false, message: MESSAGES.not_found }, 404);
  const summary = await prepareAdaptationVisuals({ workspaceId: row.workspace_id, materialId: row.material_id, adaptationId: id, analysis: parsed.analysis, analysisFingerprint: row.analysis_fingerprint });
  if (summary.status === "failed") return reply({ ok: false, message: MESSAGES.failed }, 503);
  const outcomes = "result" in summary && summary.result ? Object.values(summary.result.visuals) : [];
  return reply({ ok: true, found: outcomes.filter((o) => o.choice !== "D").length, missing: outcomes.filter((o) => o.choice === "D").length }, 200);
}
