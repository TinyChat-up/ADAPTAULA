import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** `interactive`: the card is (or contains) a link to somewhere; it lifts on hover and keyboard focus. */
export function Card({ className, children, interactive = false }: { className?: string; children: ReactNode; interactive?: boolean }) {
  return <div className={cn("rounded-card border border-border bg-surface p-5 shadow-card", interactive && "lift", className)}>{children}</div>;
}

/** An icon in a soft tinted square: the one visual cue a card or a header carries (never the only one: text goes with it). */
export function IconBadge({ icon: Icon, tone = "primary", className }: { icon: LucideIcon; tone?: "primary" | "accent" | "warning" | "success"; className?: string }) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
  } as const;
  return (
    <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-control", tones[tone], className)}>
      <Icon className="size-5" />
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        {icon ? <IconBadge icon={icon} className="mt-1 hidden size-12 sm:inline-flex" /> : null}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description ? <p className="max-w-2xl text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
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
    <div className="relative flex flex-col items-center overflow-hidden rounded-card border border-dashed border-border bg-surface px-6 py-14 text-center">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0" />
      {Icon ? (
        <span aria-hidden className="float-soft relative mb-5 inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary ring-8 ring-primary-soft/40">
          <Icon className="size-7" />
        </span>
      ) : null}
      <h2 className="relative text-lg font-semibold">{title}</h2>
      {description ? <p className="relative mt-1 max-w-md text-muted-foreground">{description}</p> : null}
      {children ? <div className="relative mt-6 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}
