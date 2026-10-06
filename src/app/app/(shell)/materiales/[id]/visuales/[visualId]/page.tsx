import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { VisualLocator } from "@/components/materials/visual-locator";
import { Alert } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { getSupabase } from "@/lib/auth/session";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { getMaterialDetail } from "@/lib/materials/repository";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import { visualDeps } from "@/lib/materials/visuals/server";
import { FAILURE_COPY, failureOfState } from "@/lib/render/visual-assets";

export const metadata: Metadata = { title: "Localizar en el original" };
export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  image: "Imagen",
  diagram: "Diagrama",
  chart: "Gráfico",
  table: "Tabla",
  number_line: "Recta numérica",
  geometric_figure: "Figura geométrica",
  map: "Mapa",
  decorative: "Decoración",
  other: "Recurso visual",
};
/** Only a return to a sheet viewer of this app (never an open redirect). */
const RETURN = /^\/app\/adaptaciones\/[0-9a-f-]{36}\/vista(\?modo=alumno)?$/;

export default async function LocateVisualPage({ params, searchParams }: PageProps<"/app/materiales/[id]/visuales/[visualId]">) {
  const { id, visualId } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace();
  const detail = await getMaterialDetail(ctx.workspace.id, id);
  const visual = detail?.analysis?.visuals.find((v) => v.id === visualId);
  if (!detail?.analysis || !detail.file || !visual) notFound();

  const returnTo = typeof query.volver === "string" && RETURN.test(query.volver) ? query.volver : `/app/materiales/${id}`;
  const canWrite = hasRole(ctx.role, WRITE_ROLES);
  const pageCount = detail.file.page_count ?? 1;
  const deps = visualDeps(await getSupabase());
  const material = await deps.reader.material(id);
  const state = (await resolveVisuals(deps, { materialId: id, analysisFingerprint: fingerprint(detail.analysis), sourceSha256: material?.content_hash ?? null, visualIds: [visualId] })).states[visualId]!;
  const activities = detail.analysis.activities.filter((a) => a.resource_ids.includes(visualId)).map((a, i) => `Actividad ${a.label ?? i + 1}`);
  const failure = failureOfState(state);

  return (
    <div className="space-y-6">
      <Link href={returnTo} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Volver
      </Link>
      <PageHeader title="Localizar en el original" description="Señala dónde está este recurso en el material original. Adaptaula lo recortará del original y lo usará en todas las adaptaciones de este material." />
      <Card className="space-y-1">
        <h2 className="font-semibold">{visual.title ?? KIND_LABELS[visual.kind] ?? "Recurso visual"}</h2>
        <p className="text-sm text-muted-foreground">
          {KIND_LABELS[visual.kind] ?? "Recurso visual"}
          {activities.length > 0 ? ` · ${activities.join(", ")}` : ""} · página {visual.page} según el análisis
        </p>
        <p className="text-sm" role="status">
          {state.status === "ready" ? `Ya está localizado (página ${state.provenance?.page}). Si el recorte no es correcto, puedes seleccionarlo de nuevo.` : failure ? `Estado: ${FAILURE_COPY[failure]}.` : null}
        </p>
      </Card>
      {canWrite ? (
        <VisualLocator materialId={id} visualId={visualId} pageCount={pageCount} initialPage={Math.min(Math.max(1, visual.page), pageCount)} suggestedPage={visual.page} returnTo={returnTo} canRetry={state.status === "extraction_failed"} />
      ) : (
        <Alert tone="info" title="Tu rol permite ver el material, pero no cambiarlo." />
      )}
    </div>
  );
}
