import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AdaptationView, type AdaptationActions } from "@/components/adaptation/adaptation-view";
import { OriginalDocument } from "@/components/workspace/original-document";
import { getMaterialDetail } from "@/lib/materials/repository";
import { PageHeader } from "@/components/ui/layout";
import { loadAdaptationPage } from "@/lib/adaptation/orchestration/page-data";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getSupabase } from "@/lib/auth/session";
import {
  cancelAdaptationAction,
  reopenReviewAction,
  retryAdaptationStageAction,
  startGenerationAction,
  startPlanningAction,
  submitPlanReviewAction,
} from "../actions";

export const metadata: Metadata = { title: "Adaptación" };
export const dynamic = "force-dynamic";

export default async function AdaptationPage({ params, searchParams }: PageProps<"/app/adaptaciones/[id]">) {
  const { id } = await params;
  // «Revisar y editar» after «Hacer magia» stopped: an explicit choice of the teacher, never a default.
  const editing = (await searchParams).editar === "1";
  const ctx = await requireWorkspace();
  const data = await loadAdaptationPage(ctx, id, { editing });
  if (!data) notFound();
  const { data: snapshot } = await (await getSupabase()).from("adaptations").select("context_snapshot").eq("id", id).maybeSingle();
  const supportsRequested = (snapshot?.context_snapshot as { visual_supports?: { requested?: boolean } } | null)?.visual_supports?.requested === true;
  const original = await getMaterialDetail(ctx.workspace.id, data.context.materialId);

  const actions: AdaptationActions = {
    start: startPlanningAction.bind(null, id),
    submit: submitPlanReviewAction.bind(null, id),
    generate: startGenerationAction.bind(null, id),
    reopen: reopenReviewAction.bind(null, id),
    retry: retryAdaptationStageAction.bind(null, id),
    cancel: cancelAdaptationAction.bind(null, id),
  };

  return (
    <div className="space-y-8">
      <Link href={`/app/materiales/${data.context.materialId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Volver al material
      </Link>
      <div className="space-y-3"><p className="eyebrow text-muted-foreground">Adaptación{data.profileName ? ` · Perfil ${data.profileName}` : ""}</p><PageHeader title={data.context.materialTitle} description="El material, los apoyos y el estado de tu ficha, en un mismo lugar." /></div>
      {supportsRequested ? <p role="status" className="rounded-xl border border-border p-4 text-sm">Apoyos visuales solicitados. Solo se incorporan si aportan ayuda y superan los controles. Las ilustraciones aprobadas consumen cupo; las representaciones exactas no. Revisa los recursos y el PDF antes de usar la ficha.</p> : null}
      <AdaptationView original={original?.file ? <OriginalDocument key={original.file.id} materialId={data.context.materialId} file={{
        mime_type: original.file.mime_type, size_bytes: original.file.size_bytes,
        page_count: original.file.page_count, original_name: original.file.original_name,
      }} /> : undefined} initial={data.status} plan={data.plan} context={data.context} readyInfo={data.readyInfo} actions={actions} canWrite={data.canWrite} editing={editing} />
    </div>
  );
}
