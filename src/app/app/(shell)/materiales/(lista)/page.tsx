import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { SelectField, TextField } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import { MaterialActions } from "@/components/materials/material-actions";
import { StatusBadge } from "@/components/materials/status-badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { listMaterials, getSubjects } from "@/lib/materials/repository";
import { MATERIAL_STATUSES, STATUS_LABELS, type MaterialStatus } from "@/lib/materials/types";
import { labelsFor } from "@/lib/profiles/catalog";
import { getCatalog } from "@/lib/profiles/repository";
import { deleteMaterialAction, retryAnalysisAction } from "../actions";

export const metadata: Metadata = { title: "Materiales" };

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function MaterialsPage({ searchParams }: PageProps<"/app/materiales">) {
  const ctx = await requireWorkspace();
  const params = await searchParams;
  const status = MATERIAL_STATUSES.find((s) => s !== "uploading" && s === first(params.estado));
  const search = first(params.buscar)?.trim().slice(0, 80) || undefined;
  const sort = (["recent", "oldest", "title"] as const).find((value) => value === first(params.orden)) ?? "recent";

  const [catalog, subjects] = await Promise.all([getCatalog(), getSubjects()]);
  const stage = catalog.stages.find((s) => s.slug === first(params.etapa))?.slug;
  const grade = catalog.grades.find((g) => g.slug === first(params.curso) && (!stage || g.stage_slug === stage))?.slug;
  const subject = subjects.find((s) => s.slug === first(params.asignatura))?.slug;
  const filtered = Boolean(status || stage || grade || subject || search || sort !== "recent");
  const selectedFilters = [status, stage, grade, subject, sort !== "recent" ? sort : undefined].filter(Boolean).length;
  const materials = await listMaterials(ctx.workspace.id, { status, stage, grade, subject, search, sort });

  return (
    <div className="space-y-8">
      <PageHeader
        icon={FolderOpen}
        title="Materiales"
        description="Encuentra un original y retoma sus adaptaciones desde la misma ficha."
        actions={
          <LinkButton href="/app/adaptar">
            Subir material
          </LinkButton>
        }
      />
      {first(params.aviso) === "eliminado" ? <Alert tone="success">Material eliminado.</Alert> : null}

      <form method="get" className="min-w-0 space-y-4 border-b border-border pb-6 [&_input]:min-w-0 [&_select]:min-w-0">
        <TextField label="Buscar por título" name="buscar" maxLength={80} defaultValue={search ?? ""} placeholder="Nombre de la ficha" />
        <details className="group rounded-control border border-border bg-surface p-3">
          <summary className="cursor-pointer py-1 font-medium marker:text-primary"><span>Filtros y orden</span>{selectedFilters > 0 ? <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedFilters} {selectedFilters === 1 ? "activo" : "activos"}</span> : null}</summary>
          <div className="mt-4 grid min-w-0 gap-4 [&>div]:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
            <SelectField label="Etapa" name="etapa" defaultValue={stage ?? ""}>
              <option value="">Todas</option>
              {catalog.stages.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </SelectField>
            <SelectField label="Curso" name="curso" defaultValue={grade ?? ""}>
              <option value="">Todos</option>
              {catalog.grades.filter((g) => !stage || g.stage_slug === stage).map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
            </SelectField>
            <SelectField label="Asignatura" name="asignatura" defaultValue={subject ?? ""}>
              <option value="">Todas</option>
              {subjects.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </SelectField>
            <SelectField label="Ordenar" name="orden" defaultValue={sort}>
              <option value="recent">Más recientes</option>
              <option value="oldest">Más antiguos</option>
              <option value="title">Título (A–Z)</option>
            </SelectField>
            <SelectField label="Estado" name="estado" defaultValue={status ?? ""}>
              <option value="">Todos</option>
              {MATERIAL_STATUSES.filter((s) => s !== "uploading").map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </SelectField>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {filtered ? (
            <LinkButton href="/app/materiales" variant="ghost">
              Limpiar
            </LinkButton>
          ) : null}
        </div>
      </form>
      {materials.length > 0 ? <p role="status" className="text-sm text-muted-foreground">{materials.length} {materials.length === 1 ? "material" : "materiales"}{materials.length === 200 ? " entre los 200 primeros resultados" : ""}</p> : null}

      {materials.length === 0 ? (
        filtered ? (
          <EmptyState icon={FolderOpen} title="No hay materiales con estos filtros" description="Prueba a quitar algún filtro.">
            <LinkButton href="/app/materiales" variant="secondary">
              Limpiar filtros
            </LinkButton>
          </EmptyState>
        ) : (
          <EmptyState icon={FolderOpen} title="Todavía no has subido ningún material." description="Sube una ficha que ya utilizas y la analizaremos para dejarla lista.">
            <LinkButton href="/app/adaptar" variant="secondary">Subir mi primera ficha</LinkButton>
          </EmptyState>
        )
      ) : (
        <ul className="editorial-list">
          {materials.map((m) => {
            const labels = labelsFor(catalog, m.stage_slug, m.grade_slug);
            const subjectName = subjects.find((s) => s.slug === m.subject_slug)?.name;
            return (
              <li key={m.id} className="flex flex-col gap-3 py-5 transition-colors hover:bg-surface/60 lg:flex-row lg:items-center lg:gap-5">
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/app/materiales/${m.id}`} className="block break-words text-lg font-semibold hover:underline">
                    {m.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">{[m.source_type.toUpperCase(), subjectName, labels.stage, labels.grade].filter(Boolean).join(" · ")}</span>
                    <span className="text-xs text-muted-foreground">Subido el {formatDay(m.created_at)}</span>
                  </div>
                </div>
                <StatusBadge status={m.status as MaterialStatus} />
                <div className="flex flex-wrap items-center gap-2">
                  <LinkButton href={`/app/materiales/${m.id}`} variant="secondary" size="sm">
                    Abrir ficha
                  </LinkButton>
                  <MaterialActions
                    {...(m.status === "failed" || m.status === "uploaded" ? { retry: retryAnalysisAction.bind(null, m.id), retryLabel: m.status === "failed" ? "Reintentar" : "Analizar" } : {})}
                    remove={deleteMaterialAction.bind(null, m.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
