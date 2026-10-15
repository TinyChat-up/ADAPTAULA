import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** A labelled group keeps native Tab order; role=toolbar would require arrow-key navigation. */
export function ActionBar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="group" aria-label={label} className={cn("action-bar surface-glass", className)}>{children}</div>;
}
