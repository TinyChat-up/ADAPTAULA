import { Skeleton } from "@/components/ui/feedback";

/**
 * What a screen looks like while its data arrives: its header, a row of cards and a list, in the place they will occupy. Never an
 * empty spinner (docs/UX.md). Announced once to assistive technology by its label.
 */
export function PageSkeleton({ label, cards = 0, rows = 3, hero = false }: { label: string; cards?: number; rows?: number; hero?: boolean }) {
  return (
    <div className="space-y-8" role="status" aria-label={label}>
      {hero ? (
        <Skeleton className="h-36 rounded-2xl" />
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
      )}
      {cards > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className={i === 0 ? "col-span-2 h-32 rounded-card lg:col-span-1" : "h-32 rounded-card"} />
          ))}
        </div>
      ) : null}
      <div className="space-y-px overflow-hidden rounded-card border border-border">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-none" />
        ))}
      </div>
    </div>
  );
}
