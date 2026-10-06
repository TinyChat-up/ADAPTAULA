import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MaterialSheet } from "@/components/material/sheet";
import { TeacherPanel } from "@/components/material/teacher-panel";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { warningLines } from "@/lib/adaptation/presentation/view-model";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { buildRenderModel } from "@/lib/render/model";
import { loadRenderInput } from "@/lib/render/load";

export const metadata: Metadata = { title: "Ficha adaptada" };
export const dynamic = "force-dynamic";

export default async function SheetPage({ params, searchParams }: PageProps<"/app/adaptaciones/[id]/vista">) {
  const { id } = await params;
  const query = await searchParams;
  const student = query.modo === "alumno";
  const ctx = await requireWorkspace();
  const loaded = await loadRenderInput(ctx, id);
  const canWrite = hasRole(ctx.role, WRITE_ROLES);
  if (loaded.kind === "not_found") notFound();

  const back = (
    <Link href={`/app/adaptaciones/${id}`} className="ms-chrome inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
      <ChevronLeft aria-hidden className="size-4" />
      Volver a la adaptación
    </Link>
  );

  if (loaded.kind !== "ok") {
    return (
      <div className="space-y-8">
        {back}
        <Card className="space-y-3">
          <h1 className="text-xl font-semibold">{loaded.kind === "invalid_document" ? "No podemos mostrar esta ficha" : "Esta adaptación todavía no tiene una ficha entregada"}</h1>
          <p className="text-muted-foreground">{loaded.kind === "invalid_document" ? "El documento guardado no se puede leer. Vuelve a la adaptación." : "Cuando la adaptación esté preparada podrás ver aquí la ficha."}</p>
        </Card>
      </div>
    );
  }

  const { model, validation } = buildRenderModel(loaded.document, {
    mode: student ? "student" : "teacher_preview",
    requiredVisuals: loaded.requiredVisuals,
    assets: loaded.assets,
    assetFailures: loaded.assetFailures,
    deferred: loaded.deferred,
  });

  return (
    <div className="space-y-6">
      {back}
      <div className="ms-chrome space-y-4">
        <PageHeader title="Ficha adaptada" description={student ? "Así la verá el alumnado." : "Vista docente de la ficha, con avisos."} />
        <nav aria-label="Modo de vista" className="flex flex-wrap gap-2">
          <LinkButton href={`/app/adaptaciones/${id}/vista`} variant={student ? "secondary" : "primary"} aria-current={student ? undefined : "page"}>
            Vista docente
          </LinkButton>
          <LinkButton href={`/app/adaptaciones/${id}/vista?modo=alumno`} variant={student ? "primary" : "secondary"} aria-current={student ? "page" : undefined}>
            Vista del alumno
          </LinkButton>
        </nav>
      </div>

      {student && validation.status === "not_renderable" ? (
        <Alert tone="warning" title="Esta ficha todavía no se puede mostrar completa.">
          Revisa la vista docente para ver qué falta.
        </Alert>
      ) : (
        <div className="ms-stage" role="region" aria-label="Hoja de la ficha (se puede desplazar)" tabIndex={0}>
          <MaterialSheet model={model} />
        </div>
      )}

      {student ? null : (
        <TeacherPanel
          validation={validation}
          version={loaded.version.version}
          observations={warningLines(loaded.status)}
          visuals={loaded.visuals.map((state) => {
            const block = loaded.document.pages.flatMap((p) => p.blocks).find((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === state.visualId);
            return {
              state,
              label: (block?.type === "image" ? block.caption : undefined) ?? "Recurso visual de la actividad",
              essential: loaded.requiredVisuals.includes(state.visualId),
              locateHref: canWrite ? `/app/materiales/${loaded.materialId}/visuales/${state.visualId}?volver=${encodeURIComponent(`/app/adaptaciones/${id}/vista`)}` : null,
            };
          })}
        />
      )}
    </div>
  );
}
