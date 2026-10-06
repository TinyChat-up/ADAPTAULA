import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { UsageMeter } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { countActiveProfiles } from "@/lib/profiles/repository";

export const metadata: Metadata = { title: "Uso" };

function Meter({ title, used, limit, hint }: { title: string; used: number; limit: number; hint?: string }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {used} de {limit}
        </p>
      </div>
      <UsageMeter used={used} limit={limit} label={title} />
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export default async function UsagePage() {
  const ctx = await requireWorkspace();
  const [usage, profiles] = await Promise.all([getWorkspaceUsage(ctx.workspace.id), countActiveProfiles(ctx.workspace.id)]);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Uso"
        description={`Plan ${usage.plan.name}. El periodo actual se renueva el ${formatDay(usage.period_end)}.`}
        actions={
          <LinkButton href="/precios" variant="secondary">
            Ver planes
          </LinkButton>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Meter title="Adaptaciones este periodo" used={usage.adaptations.used} limit={usage.adaptations.limit} />
        <Meter title="Perfiles guardados" used={profiles} limit={usage.max_profiles} hint="No se renuevan: cuentan los perfiles que tienes ahora." />
        {usage.images.limit > 0 ? (
          <Meter title="Recursos visuales este periodo" used={usage.images.used} limit={usage.images.limit} />
        ) : null}
      </div>
    </div>
  );
}
