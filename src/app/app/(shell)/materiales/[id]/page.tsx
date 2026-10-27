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
import { OriginalDocument } from "@/components/workspace/original-document";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import { WorkspaceDisclosure } from "@/components/workspace/disclosure";
import { summarizeProfile } from "@/lib/profiles/summary";
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
import { visualSupportOffer } from "@/lib/materials/visuals/illustrate/server";
import { deletionImpact } from "@/lib/materials/lifecycle";
import { purgeMaterialAction, retryAnalysisAction, setArchivedAction, updateContextAction } from "../actions";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({ params, searchParams }: PageProps<"/app/materiales/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace();
  const [detail, catalog, subjects, profiles, recent, impact] = await Promise.all([
    getMaterialDetail(ctx.workspace.id, id),
    getCatalog(),
    getSubjects(),
    listProfiles(ctx.workspace.id),
    listAdaptations({ materialId: id, limit: 10 }),
    deletionImpact(ctx.workspace.id, id),
  ]);
  if (!detail) notFound();
  const profileOptions = profiles.map((p) => ({ id: p.id, name: p.display_name, summary: summarizeProfile(p.functional_profile) }));
  // `?perfil=` comes from "Adaptar un material" on a profile or right after creating one: only preselects, never trusted.
  const preselected = typeof query.perfil === "string" && profileOptions.some((p) => p.id === query.perfil) ? query.perfil : undefined;
  const canWrite = hasRole(ctx.role, WRITE_ROLES);
  const visualOffer = canWrite && detail.material.status === "analyzed" ? await visualSupportOffer(ctx.workspace.id) : null;

  const { material, file, analysis, meta, analysisOutdated } = detail;
  const status = material.status as MaterialStatus;
  const adaptationCount = impact?.adaptations ?? 0;
  const deleting = material.deletion_requested_at !== null;
  const archived = material.archived_at !== null;
  const purge = impact ? { action: purgeMaterialAction.bind(null, material.id, impact.adaptations), impact } : undefined;
  const kept = adaptationCount === 0 ? "Las adaptaciones que crees después usarán el análisis nuevo." : `${adaptationCount === 1 ? "La adaptación ya creada se conserva" : `Las ${adaptationCount} adaptaciones ya creadas se conservan`} con el análisis con el que se hicieron; las nuevas usarán el análisis nuevo.`;
  const reanalyzeConfirm = `Se hará un análisis nuevo del archivo, que cuenta como un análisis de tu plan este mes. ${kept}`;
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

      {deleting ? (
        <Card className="space-y-3 border-danger/40">
          <Alert tone="danger" title="Eliminación pendiente">
            Este material se está eliminando y ya no se usa. Si la eliminación no terminó, vuelve a intentarlo.
          </Alert>
          {canWrite && purge ? <MaterialActions purge={purge} /> : null}
        </Card>
      ) : archived ? (
        <Card className="space-y-3">
          <Alert tone="info" title="Retirado de la biblioteca">
            No aparece en tu biblioteca ni en las listas para adaptar. Sus adaptaciones se conservan y siguen disponibles.
          </Alert>
          {canWrite ? <MaterialActions restore={setArchivedAction.bind(null, material.id, false)} /> : null}
        </Card>
      ) : canWrite && (status === "analyzed" || status === "failed") ? (
        <div className="space-y-2">
          <MaterialActions
            {...(status === "analyzed" ? { retry: retryAnalysisAction.bind(null, material.id), retryLabel: "Volver a analizar", retryConfirm: reanalyzeConfirm } : {})}
            archive={setArchivedAction.bind(null, material.id, true)}
          />
          {adaptationCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {adaptationCount === 1 ? "Este material tiene 1 adaptación." : `Este material tiene ${adaptationCount} adaptaciones.`} Volver a analizarlo o retirarlo no las cambia.
            </p>
          ) : null}
        </div>
      ) : null}

      <DocumentWorkspace
        nextLabel={status === "analyzed" ? canWrite ? "Elegir apoyos" : "Ver análisis" : "Ver estado"}
        document={file ? <OriginalDocument key={file.id} materialId={material.id} file={{
          mime_type: file.mime_type, size_bytes: file.size_bytes,
          page_count: file.page_count, original_name: file.original_name,
        }} /> : <Alert tone="info">El archivo original todavía no está disponible.</Alert>}
      >
        {quota ? (
          <LimitReachedCard
            title={analysisQuotaMessage(quota.entitlement.limit, formatDay(quota.usage.period_end))}
            upgrade={await getUpgradeCta(quota.entitlement)}
          >
            El material queda guardado: podrás analizarlo cuando se renueve tu límite.
          </LimitReachedCard>
        ) : null}

        {IN_PROGRESS.includes(status) && status !== "uploading" && !quota ? <AnalysisProgress materialId={material.id} initialStatus={status} canRun={canWrite} /> : null}

        {status === "failed" ? (
          <Card className="space-y-4 border-danger/40">
            <Alert tone="danger" title="No hemos podido analizar este material.">
              {failureMessage(material.failure_code)}
            </Alert>
            {canWrite && !deleting ? <MaterialActions retry={retryAnalysisAction.bind(null, material.id)} {...(purge ? { purge } : {})} /> : null}
          </Card>
        ) : null}

        {analysisOutdated ? (
          <Alert tone="warning" title="El análisis guardado es de una versión anterior.">
            Vuelve a analizar el material para actualizarlo.
          </Alert>
        ) : null}

        {analysis ? (
          <>
            <IdentifiedCard analysis={analysis} reused={meta?.source === "reused"} />
            <ReviewNotice analysis={analysis} />
            {/* The next step comes right after what was understood, not after every detail of the analysis. */}
            {status === "analyzed" && !deleting ? (
              <div id="adaptar" data-workspace-next={canWrite ? true : undefined} tabIndex={-1} aria-label={canWrite ? "Elegir apoyos" : "Acceso de solo lectura"} className="scroll-mt-28">
                <StartAdaptationCard
                  profiles={profileOptions}
                  initialProfileId={preselected}
                  canWrite={canWrite}
                  visualSupportOffer={visualOffer}
                  newProfileHref={`/app/alumnos/nuevo?material=${material.id}`}
                  create={createAdaptationFromMaterialAction.bind(null, material.id)}
                />
              </div>
            ) : null}
            <WorkspaceDisclosure title="Actividades y elementos a conservar">
              <ActivitiesList analysis={analysis} />
              <ProtectedList analysis={analysis} />
              <VisualsList analysis={analysis} />
            </WorkspaceDisclosure>
          </>
        ) : null}
        {analysis && canWrite ? (
          <WorkspaceDisclosure title="Datos del material">
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
          </WorkspaceDisclosure>
        ) : null}
        {canWrite && !deleting && !IN_PROGRESS.includes(status) && status !== "failed" ? (
          <WorkspaceDisclosure title="Más opciones del material">
            <MaterialActions
              {...(status === "uploaded" ? { retry: retryAnalysisAction.bind(null, material.id), retryLabel: "Analizar" } : {})}
              {...(purge ? { purge } : {})}
            />
          </WorkspaceDisclosure>
        ) : null}
      </DocumentWorkspace>
      {recent.length > 0 ? (
        <section aria-labelledby="adaptaciones-material" className="space-y-3">
          <h2 id="adaptaciones-material" className="text-lg font-semibold">
            Adaptaciones de este material
          </h2>
          <AdaptationList items={recent} show={{ material: false, profile: true }} />
        </section>
      ) : null}

    </div>
  );
}
