import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
  return (
    <div className="space-y-8" role="status" aria-label="Cargando perfiles">
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="space-y-px overflow-hidden rounded-card border border-border">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-none" />
        ))}
      </div>
    </div>
  );
}
