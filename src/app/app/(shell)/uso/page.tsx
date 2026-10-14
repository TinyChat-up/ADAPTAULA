import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { UsageMeter } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { countActiveProfiles } from "@/lib/profiles/repository";

export const metadata: Metadata = { title: "Plan y cuenta" };

function Meter({ title, used, limit, hint }: { title: string; used: number; limit: number; hint?: string }) {
  return (
    <div className="space-y-3 border-t border-border py-5">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-baseline justify-between gap-2">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">
            {used} de {limit}
          </p>
        </div>
      </div>
      <UsageMeter used={used} limit={limit} label={title} />
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** «Plan y cuenta»: what the plan allows and what is used, and who the account is (one screen; settings had nothing else yet). */
export default async function UsagePage() {
  const ctx = await requireWorkspace();
  const [usage, profiles] = await Promise.all([getWorkspaceUsage(ctx.workspace.id), countActiveProfiles(ctx.workspace.id)]);
  const account: [string, string][] = [
    ["Nombre", ctx.profile.fullName ?? "Sin indicar"],
    ["Email", ctx.user.email ?? "—"],
    ["Espacio de trabajo", ctx.workspace.name],
    ["Plan", usage.plan.name],
  ];
  const renews = `Se renuevan el ${formatDay(usage.period_end)}.`;
  return (
    <div className="space-y-10">
      <PageHeader
        title="Plan y cuenta"
        description={`Plan ${usage.plan.name}. El periodo actual se renueva el ${formatDay(usage.period_end)}.`}
        actions={
          <LinkButton href="/precios" variant="secondary">
            Ver planes
          </LinkButton>
        }
      />

      <section aria-labelledby="uso-periodo" className="space-y-4">
        <h2 id="uso-periodo" className="text-lg font-semibold">
          Uso de este periodo
        </h2>
        <div className="grid gap-x-10 md:grid-cols-2">
          <Meter title="Adaptaciones este periodo" used={usage.adaptations.used} limit={usage.adaptations.limit} hint={renews} />
          <Meter title="Perfiles guardados" used={profiles} limit={usage.max_profiles} hint="No se renuevan: cuentan los perfiles que tienes ahora." />
          {usage.images.limit > 0 ? <Meter title="Recursos visuales este periodo" used={usage.images.used} limit={usage.images.limit} hint={renews} /> : null}
        </div>
      </section>

      <section aria-labelledby="tu-cuenta" className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="border-t border-border pt-5">
          <h2 id="tu-cuenta" className="mb-3 text-lg font-semibold">
            Tu cuenta
          </h2>
          <dl className="divide-y divide-border">
            {account.map(([term, value]) => (
              <div key={term} className="grid gap-1 py-3 last:pb-0 sm:grid-cols-[12rem_1fr]">
                <dt className="text-sm font-medium text-muted-foreground">{term}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">La edición de la cuenta y la gestión de la suscripción llegarán más adelante.</p>
        </div>
        <div className="space-y-3 border-t border-border pt-5">
          <h2 className="text-lg font-semibold">¿Dudas?</h2>
          <ul className="space-y-1">
            <li>
              <Link href="/como-funciona" className="group flex min-h-11 items-center gap-3 rounded-control px-2 font-medium hover:bg-foreground/5">
                <span className="flex-1">Cómo funciona Adaptaula</span>
              </Link>
            </li>
            <li>
              <Link href="/privacidad" className="group flex min-h-11 items-center gap-3 rounded-control px-2 font-medium hover:bg-foreground/5">
                <span className="flex-1">Privacidad y datos del alumnado</span>
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
