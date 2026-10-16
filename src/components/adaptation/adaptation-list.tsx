import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, XCircle, type LucideIcon } from "lucide-react";
import type { AdaptationListItem } from "@/lib/adaptation/orchestration/page-data";
import { listHref, type ListGroup } from "@/lib/adaptation/presentation/list";
import { formatDateTime } from "@/lib/format/date";
import { cn } from "@/lib/utils/cn";
import { PdfDownload } from "@/components/material/pdf-download";

const GROUP_STYLE: Record<ListGroup, { icon: LucideIcon; tone: string }> = {
  attention: { icon: AlertCircle, tone: "bg-warning/10 text-foreground" },
  working: { icon: Loader2, tone: "bg-primary/10 text-foreground" },
  done: { icon: CheckCircle2, tone: "bg-success/10 text-foreground" },
  closed: { icon: XCircle, tone: "bg-foreground/5 text-muted-foreground" },
};

/** The state as words plus an icon (never colour alone). The spinner does not spin: a list is a snapshot, not a live view. */
export function ListStateBadge({ item }: { item: Pick<AdaptationListItem, "state"> }) {
  const { icon: Icon, tone } = GROUP_STYLE[item.state.group];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium", tone)}>
      <Icon aria-hidden className="size-3.5" />
      {item.state.label}
    </span>
  );
}

/**
 * Adaptations as rows: material, profile alias, state and the next step as the link text. `show` hides what the context already
 * says (on a material's page, the material). Server component: no polling here; the adaptation page is the live view.
 */
export function AdaptationList({ items, show = { material: true, profile: true }, history = false, canWrite = false }: {
  items: AdaptationListItem[]; show?: { material?: boolean; profile?: boolean }; history?: boolean; canWrite?: boolean;
}) {
  return (
    <ul className="editorial-list">
      {items.map((item) => {
        const title = show.material ? item.materialTitle : item.profileName ? `Para ${item.profileName}` : "Adaptación";
        const detail = [show.material && show.profile && item.profileName ? `Para ${item.profileName}` : null, `Actualizada el ${formatDateTime(item.updatedAt)}`].filter(Boolean).join(" · ");
        return (
          <li key={item.id} className={cn("group flex flex-col gap-3 py-4 transition-colors duration-150 hover:bg-surface/60", history ? "items-stretch" : "sm:flex-row sm:items-center sm:gap-5")}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{detail}</p>
                {history ? <p className="text-xs text-muted-foreground">Creada el {formatDateTime(item.createdAt)} · {item.state.group === "done" ? "Adaptación generada" : "Adaptación pendiente"}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
              <ListStateBadge item={item} />
              <Link
                href={listHref(item.id, item.state)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-primary underline underline-offset-2 transition-colors hover:bg-primary-soft"
                aria-label={`${item.state.cta}: ${item.materialTitle}${item.profileName ? `, para ${item.profileName}` : ""}`}
              >
                {item.state.cta}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
            {history ? <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <Link href={`/app/materiales/${item.materialId}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ver original</Link>
              {item.state.group === "done" ? <>
                <Link href={`/app/adaptaciones/${item.id}/comparar`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Comparar versiones</Link>
                {canWrite ? <Link href={`/app/adaptaciones/${item.id}/editar`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Editar</Link> : null}
                <PdfDownload adaptationId={item.id} />
              </> : null}
            </div> : null}
          </li>
        );
      })}
    </ul>
  );
}
