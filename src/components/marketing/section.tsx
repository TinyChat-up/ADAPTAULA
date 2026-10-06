import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Section({
  id,
  title,
  intro,
  tone = "plain",
  children,
}: {
  id?: string;
  title: string;
  intro?: string;
  tone?: "plain" | "surface";
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={cn("py-16 sm:py-20", tone === "surface" && "border-y border-border bg-surface")}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 max-w-2xl space-y-3">
          <h2 id={id ? `${id}-titulo` : undefined} className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h2>
          {intro ? <p className="text-lg text-muted-foreground">{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
