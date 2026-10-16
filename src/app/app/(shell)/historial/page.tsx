import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { AdaptationList } from "@/components/adaptation/adaptation-list";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { listAdaptations } from "@/lib/adaptation/orchestration/page-data";
import type { ListGroup } from "@/lib/adaptation/presentation/list";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Adaptaciones" };
export const dynamic = "force-dynamic";

/** Filters by what the teacher does next (the list's own groups); the address keeps the choice (`?estado=`). */
const FILTERS: Array<{ key: string; label: string; groups: ListGroup[] | null }> = [
  { key: "todas", label: "Todas", groups: null },
  { key: "atencion", label: "Necesitan tu atención", groups: ["attention"] },
  { key: "en-curso", label: "En curso", groups: ["working"] },
  { key: "preparadas", label: "Preparadas", groups: ["done"] },
  { key: "canceladas", label: "Canceladas", groups: ["closed"] },
];

export default async function HistoryPage({ searchParams }: PageProps<"/app/historial">) {
  const ctx = await requireWorkspace();
  const query = await searchParams;
  const items = await listAdaptations({ limit: 100 });
  const chosen = FILTERS.find((f) => f.key === query.estado) ?? FILTERS[0]!;
  const count = (groups: ListGroup[] | null) => (groups ? items.filter((i) => groups.includes(i.state.group)).length : items.length);
  const shown = chosen.groups ? items.filter((i) => chosen.groups!.includes(i.state.group)) : items;
  // A filter with nothing in it is not offered (except the one chosen and «Todas»).
  const offered = FILTERS.filter((f) => f.groups === null || f === chosen || count(f.groups) > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        icon={FileCheck2}
        title="Adaptaciones"
        description="Retoma una ficha, consulta su original o descarga la versión preparada. Se muestran las 100 más recientes."
        actions={
          items.length > 0 ? (
            <LinkButton href="/app/adaptar">
              Adaptar material
            </LinkButton>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={FileCheck2} title="Aún no hay adaptaciones" description="Sube un material, elige un perfil y aquí verás cada adaptación y en qué punto está.">
          <LinkButton href="/app/adaptar">Adaptar material</LinkButton>
        </EmptyState>
      ) : (
        <>
          <nav aria-label="Filtrar adaptaciones" className="-mx-1 overflow-x-auto px-1 pb-1">
            <ul className="flex flex-wrap gap-2">
              {offered.map((f) => {
                const active = f === chosen;
                return (
                  <li key={f.key}>
                    <Link
                      href={f.key === "todas" ? "/app/historial" : `/app/historial?estado=${f.key}`}
                      aria-current={active ? "page" : undefined}
                      scroll={false}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-2 rounded-control border px-3 text-sm font-medium transition-colors duration-150",
                        active ? "border-foreground bg-foreground text-primary-foreground" : "border-border bg-surface text-foreground hover:border-primary/40 hover:bg-primary-soft/60",
                      )}
                    >
                      {f.label}
                      <span className={cn("rounded-sm px-2 py-0.5 text-xs tabular-nums", active ? "bg-white/15" : "bg-foreground/5 text-muted-foreground")}>{count(f.groups)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {shown.length > 0 ? (
            <AdaptationList items={shown} history canWrite={hasRole(ctx.role, WRITE_ROLES)} />
          ) : (
            <EmptyState title="No hay adaptaciones en este estado" description="Prueba con otro filtro o mira todas tus adaptaciones.">
              <LinkButton href="/app/historial" variant="secondary">
                Ver todas
              </LinkButton>
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
