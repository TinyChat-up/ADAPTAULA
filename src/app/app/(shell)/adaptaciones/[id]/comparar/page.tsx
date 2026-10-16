import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { getSupabase } from "@/lib/auth/session";
import { loadRenderInput, sheetModel } from "@/lib/render/load";
import { readinessOf } from "@/lib/render/readiness";
import { draftStore } from "@/lib/editor/store";
import { applyEditorChanges } from "@/lib/editor/changes";
import { getMaterialDetail } from "@/lib/materials/repository";
import { OriginalDocument } from "@/components/workspace/original-document";
import { DocumentComparison, type ComparisonVersion } from "@/components/workspace/document-comparison";
import { PageHeader } from "@/components/ui/layout";
import { Alert } from "@/components/ui/feedback";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Comparar documentos" };
export const dynamic = "force-dynamic";

export default async function CompareSheetPage({ params }: PageProps<"/app/adaptaciones/[id]/comparar">) {
  const { id } = await params;
  const ctx = await requireWorkspace();
  const loaded = await loadRenderInput(ctx, id);
  if (loaded.kind === "not_found") notFound();
  if (loaded.kind !== "ok") return <div className="space-y-4"><Alert title="Esta ficha todavía no se puede comparar.">Necesitas una adaptación entregada que se pueda leer.</Alert><LinkButton href={`/app/adaptaciones/${id}`}>Volver a la adaptación</LinkButton></div>;
  const original = await getMaterialDetail(ctx.workspace.id, loaded.materialId);
  const file = original?.file;
  const generated = { model: sheetModel(loaded, "student").model, printable: readinessOf(loaded).printable };
  let draft: (ComparisonVersion & { revision: number; contentChanged: boolean }) | null = null;
  let draftError = false;
  try {
    const saved = await draftStore(await getSupabase()).read(id, loaded.version.version);
    if (saved) {
      const applied = applyEditorChanges(loaded.document, saved.changes);
      if (applied.contentBlocks.length && !saved.contentAcknowledged) throw new Error("unacknowledged_content");
      const view = sheetModel({ ...loaded, document: applied.document }, "student");
      draft = { model: view.model, printable: generated.printable && view.validation.status !== "not_renderable", revision: saved.revision, contentChanged: applied.contentBlocks.length > 0 };
    }
  } catch { draftError = true; }
  return <div className="space-y-6">
    <LinkButton variant="ghost" href={`/app/adaptaciones/${id}/vista`}>Volver a la ficha</LinkButton>
    <PageHeader title="Comparar documentos" description={loaded.document.meta.title} />
    <DocumentComparison adaptationId={id} baseVersion={loaded.version.version} generated={generated} draft={draft} draftError={draftError} canWrite={hasRole(ctx.role, WRITE_ROLES)}
      original={file ? <OriginalDocument materialId={loaded.materialId} file={{ mime_type: file.mime_type, size_bytes: file.size_bytes, page_count: file.page_count, original_name: file.original_name }} /> : <Alert title="El original no está disponible.">Puedes seguir revisando la adaptación.</Alert>} />
  </div>;
}
