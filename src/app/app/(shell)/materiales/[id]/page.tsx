import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { StartAdaptationCard } from "@/components/adaptation/start-adaptation-card";
import { LimitReachedCard } from "@/components/app/limit-reached-card";
import { ActivitiesList, IdentifiedCard, ProtectedList, ReviewNotice, VisualsList } from "@/components/materials/analysis-summary";
import { AnalysisProgress } from "@/components/materials/analysis-progress";
import { ContextForm } from "@/components/materials/context-form";
import { MaterialActions } from "@/components/materials/material-actions";
import { OriginalPreview } from "@/components/materials/original-preview";
import { StatusBadge } from "@/components/materials/status-badge";
import { Alert, Badge } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { failureMessage } from "@/lib/ai/errors";
import { resolveContext } from "@/lib/analysis/context";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { analysisQuotaMessage } from "@/lib/materials/messages";
import { getMaterialDetail, getSubjects } from "@/lib/materials/repository";
import { checkEntitlement } from "@/lib/permissions/check-entitlement";
import { getUpgradeCta } from "@/lib/plans/upgrade";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { IN_PROGRESS, type MaterialStatus } from "@/lib/materials/types";
import { labelsFor } from "@/lib/profiles/catalog";
import { getCatalog, listProfiles } from "@/lib/profiles/repository";
import { AdaptationList } from "@/components/adaptation/adaptation-list";
import { listAdaptations } from "@/lib/adaptation/orchestration/page-data";
import { hasRole } from "@/lib/auth/workspace-select";
import { createAdaptationFromMaterialAction } from "../../adaptaciones/actions";
import { deleteMaterialAction, retryAnalysisAction, updateContextAction } from "../actions";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({ params, searchParams }: PageProps<"/app/materiales/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace();
  const [detail, catalog, subjects, profiles, recent] = await Promise.all([
    getMaterialDetail(ctx.workspace.id, id),
    getCatalog(),
    getSubjects(),
    listProfiles(ctx.workspace.id),
    listAdaptations({ materialId: id, limit: 10 }),
  ]);
  if (!detail) notFound();
  const profileOptions = profiles.map((p) => ({ id: p.id, name: p.display_name }));
  // `?perfil=` comes from "Adaptar un material" on a profile or right after creating one: only preselects, never trusted.
  const preselected = typeof query.perfil === "string" && profileOptions.some((p) => p.id === query.perfil) ? query.perfil : undefined;
  const canWrite = hasRole(ctx.role, WRITE_ROLES);

  const { material, file, analysis, meta, analysisOutdated } = detail;
  const status = material.status as MaterialStatus;
  const labels = labelsFor(catalog, material.stage_slug, material.grade_slug);
  const subjectName = subjects.find((s) => s.slug === material.subject_slug)?.name;
  const resolved = resolveContext(material, analysis);

  // A valid file waiting for an analysis because the monthly quota is used up: say so, with what to do next.
  const quota =
    status === "uploaded"
      ? await Promise.all([checkEntitlement(ctx, "analysis.start"), getWorkspaceUsage(ctx.workspace.id)]).then(([entitlement, usage]) =>
          !entitlement.allowed && entitlement.reason === "limit_reached" ? { entitlement, usage } : null,
        )
      : null;

  return (
    <div className="space-y-8">
      <Link href="/app/materiales" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Materiales
      </Link>
      <PageHeader title={material.title} actions={<StatusBadge status={status} />} />
      <div className="-mt-4 flex flex-wrap gap-2">
        {subjectName ? <Badge>{subjectName}</Badge> : null}
        {labels.stage ? <Badge>{labels.stage}</Badge> : null}
        {labels.grade ? <Badge>{labels.grade}</Badge> : null}
      </div>

      {quota ? (
        <LimitReachedCard
          title={analysisQuotaMessage(quota.entitlement.limit, formatDay(quota.usage.period_end))}
          upgrade={await getUpgradeCta(quota.entitlement)}
        >
          El material queda guardado: podrás analizarlo cuando se renueve tu límite.
        </LimitReachedCard>
      ) : null}

      {IN_PROGRESS.includes(status) && status !== "uploading" && !quota ? <AnalysisProgress materialId={material.id} initialStatus={status} /> : null}

      {status === "failed" ? (
        <Card className="space-y-4 border-danger/40">
          <Alert tone="danger" title="No hemos podido analizar este material.">
            {failureMessage(material.failure_code)}
          </Alert>
          <MaterialActions retry={retryAnalysisAction.bind(null, material.id)} remove={deleteMaterialAction.bind(null, material.id)} />
        </Card>
      ) : null}

      {analysisOutdated ? (
        <Alert tone="warning" title="El análisis guardado es de una versión anterior.">
          Vuelve a analizar el material para actualizarlo.
        </Alert>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          {analysis ? (
            <>
              <IdentifiedCard analysis={analysis} reused={meta?.source === "reused"} />
              <ReviewNotice analysis={analysis} />
              {/* The next step comes right after what was understood, not after every detail of the analysis. */}
              {status === "analyzed" ? (
                <div id="adaptar" className="scroll-mt-6">
                  <StartAdaptationCard
                    profiles={profileOptions}
                    initialProfileId={preselected}
                    canWrite={canWrite}
                    newProfileHref={`/app/alumnos/nuevo?material=${material.id}`}
                    create={createAdaptationFromMaterialAction.bind(null, material.id)}
                  />
                </div>
              ) : null}
              {recent.length > 0 ? (
                <section aria-labelledby="adaptaciones-material" className="space-y-3">
                  <h2 id="adaptaciones-material" className="text-lg font-semibold">
                    Adaptaciones de este material
                  </h2>
                  <AdaptationList items={recent} show={{ material: false, profile: true }} />
                </section>
              ) : null}
              <ActivitiesList analysis={analysis} />
              <ProtectedList analysis={analysis} />
              <VisualsList analysis={analysis} />
            </>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          {file ? <OriginalPreview materialId={material.id} file={file} /> : null}
          {analysis ? (
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Datos del material</h2>
              <ContextForm
                initial={{
                  title: material.title,
                  stage: material.stage_slug ?? "",
                  grade: material.grade_slug ?? "",
                  subject: material.subject_slug ?? "",
                  topic: material.topic ?? "",
                }}
                provenance={resolved}
                stages={catalog.stages}
                grades={catalog.grades}
                subjects={subjects}
                onSave={updateContextAction.bind(null, material.id)}
              />
            </Card>
          ) : null}
          {status === "analyzed" || status === "uploaded" ? (
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Más opciones</h2>
              <MaterialActions
                retry={retryAnalysisAction.bind(null, material.id)}
                retryLabel={status === "analyzed" ? "Volver a analizar" : "Analizar"}
                remove={deleteMaterialAction.bind(null, material.id)}
              />
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
