import type { Metadata } from "next";
import Link from "next/link";
import { FileText, FolderOpen, ImageIcon, Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { SelectField } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import { MaterialActions } from "@/components/materials/material-actions";
import { StatusBadge } from "@/components/materials/status-badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { listMaterials, getSubjects } from "@/lib/materials/repository";
import { MATERIAL_STATUSES, STATUS_LABELS, type MaterialStatus } from "@/lib/materials/types";
import { labelsFor } from "@/lib/profiles/catalog";
import { getCatalog } from "@/lib/profiles/repository";
import { deleteMaterialAction, retryAnalysisAction } from "./actions";

export const metadata: Metadata = { title: "Materiales" };

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function MaterialsPage({ searchParams }: PageProps<"/app/materiales">) {
  const ctx = await requireWorkspace();
  const params = await searchParams;
  const status = MATERIAL_STATUSES.find((s) => s === first(params.estado));
  const stage = first(params.etapa) || undefined;
  const subject = first(params.asignatura) || undefined;
  const filtered = Boolean(status || stage || subject);

  const [materials, catalog, subjects] = await Promise.all([
    listMaterials(ctx.workspace.id, { status, stage, subject }),
    getCatalog(),
    getSubjects(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Materiales"
        description="Tus fichas y textos, analizados una sola vez y listos para adaptar."
        actions={
          <LinkButton href="/app/adaptar">
            <Plus aria-hidden className="size-4" />
            Subir material
          </LinkButton>
        }
      />
      {first(params.aviso) === "eliminado" ? <Alert tone="success">Material eliminado.</Alert> : null}

      <form method="get" className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <SelectField label="Etapa" name="etapa" defaultValue={stage ?? ""}>
          <option value="">Todas</option>
          {catalog.stages.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Asignatura" name="asignatura" defaultValue={subject ?? ""}>
          <option value="">Todas</option>
          {subjects.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Estado" name="estado" defaultValue={status ?? ""}>
          <option value="">Todos</option>
          {MATERIAL_STATUSES.filter((s) => s !== "uploading").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <div className="flex gap-2">
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

      {materials.length === 0 ? (
        filtered ? (
          <EmptyState icon={FolderOpen} title="No hay materiales con estos filtros" description="Prueba a quitar algún filtro.">
            <LinkButton href="/app/materiales" variant="secondary">
              Limpiar filtros
            </LinkButton>
          </EmptyState>
        ) : (
          <EmptyState icon={FolderOpen} title="Todavía no has subido ningún material." description="Sube una ficha que ya utilizas y la analizaremos para dejarla lista.">
            <LinkButton href="/app/adaptar">Subir mi primera ficha</LinkButton>
          </EmptyState>
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {materials.map((m) => {
            const labels = labelsFor(catalog, m.stage_slug, m.grade_slug);
            const subjectName = subjects.find((s) => s.slug === m.subject_slug)?.name;
            const Icon = m.source_type === "pdf" ? FileText : ImageIcon;
            return (
              <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
                <span aria-hidden className="hidden size-12 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary sm:flex">
                  <Icon className="size-6" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/app/materiales/${m.id}`} className="block truncate text-lg font-semibold hover:underline">
                    {m.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    {subjectName ? <Badge>{subjectName}</Badge> : null}
                    {labels.stage ? <Badge>{labels.stage}</Badge> : null}
                    {labels.grade ? <Badge>{labels.grade}</Badge> : null}
                    <span className="text-xs text-muted-foreground">Subido el {formatDay(m.created_at)}</span>
                  </div>
                </div>
                <StatusBadge status={m.status as MaterialStatus} />
                <div className="flex items-center gap-2">
                  <LinkButton href={`/app/materiales/${m.id}`} variant="secondary" size="sm">
                    Abrir
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
