import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { getSupabase } from "@/lib/auth/session";
import { loadRenderInput } from "@/lib/render/load";
import { applyEditorChanges } from "@/lib/editor/changes";
import { draftStore } from "@/lib/editor/store";
import type { SavedDraft } from "@/lib/editor/store";
import { SheetEditor } from "@/components/editor/sheet-editor";
import { Alert } from "@/components/ui/feedback";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Editar ficha" };
export const dynamic = "force-dynamic";

export default async function EditSheetPage({ params }: PageProps<"/app/adaptaciones/[id]/editar">) {
  const { id } = await params;
  const ctx = await requireWorkspace();
  const loaded = await loadRenderInput(ctx, id);
  if (loaded.kind === "not_found") notFound();
  if (!hasRole(ctx.role, WRITE_ROLES) || loaded.kind !== "ok") return <Alert title="Esta ficha no se puede editar.">Necesitas una ficha entregada y permiso para editar en tu espacio.</Alert>;
  let saved: SavedDraft | null;
  try {
    saved = await draftStore(await getSupabase()).read(id, loaded.version.version);
    if (saved) applyEditorChanges(loaded.document, saved.changes);
  } catch {
    return <div className="space-y-4"><Alert tone="danger" title="No hemos podido abrir el borrador.">Vuelve a intentarlo. La ficha generada sigue intacta.</Alert><LinkButton href={`/app/adaptaciones/${id}/vista`}>Ver ficha generada</LinkButton></div>;
  }
  // Answer keys and teacher notes are not needed by the editor or its student preview.
  const document = { ...loaded.document, answer_key: [], teacher_notes: undefined };
  const input = { document, subjectName: loaded.subjectName, assets: loaded.assets, figures: loaded.figures,
    assetFailures: loaded.assetFailures, requiredVisuals: loaded.requiredVisuals, resources: loaded.resources, generated: loaded.generated, deferred: loaded.deferred };
  return <SheetEditor adaptationId={id} baseVersion={loaded.version.version} input={input} saved={saved} />;
}
