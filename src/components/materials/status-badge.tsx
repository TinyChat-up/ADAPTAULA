import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { STATUS_LABELS, type MaterialStatus } from "@/lib/materials/types";
import { cn } from "@/lib/utils/cn";

/** Status is always icon + text, never color alone. */
export function StatusBadge({ status }: { status: MaterialStatus }) {
  const Icon = status === "analyzed" ? CheckCircle2 : status === "failed" ? AlertTriangle : Loader2;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "analyzed" && "bg-success/10 text-success-strong",
        status === "failed" && "bg-danger/10 text-danger",
        status !== "analyzed" && status !== "failed" && "bg-primary/10 text-primary",
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", status !== "analyzed" && status !== "failed" && "motion-safe:animate-spin")} />
      {STATUS_LABELS[status]}
    </span>
  );
}
