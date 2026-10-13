import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Section({
  id,
  title,
  intro,
  eyebrow,
  tone = "plain",
  children,
}: {
  id?: string;
  title: string;
  intro?: string;
  /** A short label above the title (the section's theme in one or two words). */
  eyebrow?: string;
  tone?: "plain" | "surface";
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={cn("py-16 sm:py-24", tone === "surface" && "border-y border-border bg-surface")}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="reveal mb-10 max-w-2xl space-y-3">
          {eyebrow ? <p className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p> : null}
          <h2 id={id ? `${id}-titulo` : undefined} className="text-2xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          {intro ? <p className="text-lg text-muted-foreground">{intro}</p> : null}
        </div>
        <div className="reveal">{children}</div>
      </div>
    </section>
  );
}
