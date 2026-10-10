import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AdaptationView, type AdaptationActions } from "@/components/adaptation/adaptation-view";
import { PageHeader } from "@/components/ui/layout";
import { loadAdaptationPage } from "@/lib/adaptation/orchestration/page-data";
import { requireWorkspace } from "@/lib/auth/workspace";
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
      <PageHeader title="Adaptación" description={data.profileName ? `${data.context.materialTitle} · para ${data.profileName}` : data.context.materialTitle} />
      <AdaptationView initial={data.status} plan={data.plan} context={data.context} readyInfo={data.readyInfo} actions={actions} canWrite={data.canWrite} editing={editing} />
    </div>
  );
}
