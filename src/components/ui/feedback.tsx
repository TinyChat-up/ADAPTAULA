import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "info" | "success" | "warning" | "danger";

const tones: Record<Tone, { icon: LucideIcon; classes: string; role: "status" | "alert" }> = {
  info: { icon: Info, classes: "border-primary/30 bg-primary/5", role: "status" },
  success: { icon: CheckCircle2, classes: "border-success/30 bg-success/5", role: "status" },
  warning: { icon: AlertTriangle, classes: "border-warning/40 bg-warning/5", role: "status" },
  danger: { icon: XCircle, classes: "border-danger/40 bg-danger/5", role: "alert" },
};

const iconColor: Record<Tone, string> = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { icon: Icon, classes, role } = tones[tone];
  return (
    <div role={role} className={cn("flex gap-3 rounded-card border p-4 text-sm", classes)}>
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", iconColor[tone])} />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-foreground/90">{children}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-border/70", className)} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "accent" ? "bg-accent-soft text-accent" : "bg-foreground/5 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function UsageMeter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      aria-valuetext={`${used} de ${limit}`}
      className="h-2 w-full overflow-hidden rounded-full bg-border"
    >
      <div className={cn("h-full rounded-full", percent >= 100 ? "bg-warning" : "bg-primary")} style={{ width: `${percent}%` }} />
    </div>
  );
}
