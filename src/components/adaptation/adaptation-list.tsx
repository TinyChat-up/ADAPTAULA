import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, XCircle, type LucideIcon } from "lucide-react";
import type { AdaptationListItem } from "@/lib/adaptation/orchestration/page-data";
import { listHref, type ListGroup } from "@/lib/adaptation/presentation/list";
import { formatDateTime } from "@/lib/format/date";
import { cn } from "@/lib/utils/cn";

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
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tone)}>
      <Icon aria-hidden className="size-3.5" />
      {item.state.label}
    </span>
  );
}

/**
 * Adaptations as rows: material, profile alias, state and the next step as the link text. `show` hides what the context already
 * says (on a material's page, the material). Server component: no polling here; the adaptation page is the live view.
 */
export function AdaptationList({ items, show = { material: true, profile: true } }: { items: AdaptationListItem[]; show?: { material?: boolean; profile?: boolean } }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
      {items.map((item) => {
        const title = show.material ? item.materialTitle : item.profileName ? `Para ${item.profileName}` : "Adaptación";
        const detail = [show.material && show.profile && item.profileName ? `Para ${item.profileName}` : null, `Actualizada el ${formatDateTime(item.updatedAt)}`].filter(Boolean).join(" · ");
        return (
          <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
            <ListStateBadge item={item} />
            <Link
              href={listHref(item.id, item.state)}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2"
              aria-label={`${item.state.cta}: ${item.materialTitle}${item.profileName ? `, para ${item.profileName}` : ""}`}
            >
              {item.state.cta}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
