import { UsageMeter } from "@/components/ui/feedback";

export function UsageSummary({ title, used, limit, hint }: { title: string; used: number; limit: number; hint: string }) {
  const remaining = Math.max(0, limit - used);
  return (
    <div className="min-w-0 space-y-3 border-t border-border py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{used} de {limit}</p>
      </div>
      <UsageMeter used={used} limit={limit} label={title} />
      <p className="text-sm"><strong className="font-semibold">{remaining} {remaining === 1 ? "disponible" : "disponibles"}</strong><span className="text-muted-foreground"> · {hint}</span></p>
    </div>
  );
}
