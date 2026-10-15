import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** `interactive`: the card is (or contains) a link to somewhere; its border responds to hover and keyboard focus. */
export function Card({ className, children, interactive = false }: { className?: string; children: ReactNode; interactive?: boolean }) {
  return <div className={cn("rounded-card border border-border bg-surface p-5 shadow-card", interactive && "lift", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col gap-5 pb-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="space-y-3">
          <h1 className="break-words text-page font-semibold">{title}</h1>
          {description ? <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-dashed border-control-border bg-surface px-6 py-10 sm:p-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description ? <p className="mt-3 max-w-lg text-muted-foreground">{description}</p> : null}
      {children ? <div className="mt-6 flex flex-wrap gap-3">{children}</div> : null}
    </div>
  );
}
