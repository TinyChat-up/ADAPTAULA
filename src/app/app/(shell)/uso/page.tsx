import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CircleHelp, CircleUserRound, FileCheck2, Shield, Sparkles, Users, type LucideIcon } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { UsageMeter } from "@/components/ui/feedback";
import { Card, IconBadge, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { countActiveProfiles } from "@/lib/profiles/repository";

export const metadata: Metadata = { title: "Plan y cuenta" };

function Meter({ title, used, limit, hint, icon }: { title: string; used: number; limit: number; hint?: string; icon: LucideIcon }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <IconBadge icon={icon} />
        <div className="flex flex-1 items-baseline justify-between gap-2">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">
            {used} de {limit}
          </p>
        </div>
      </div>
      <UsageMeter used={used} limit={limit} label={title} />
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </Card>
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
        icon={CircleUserRound}
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
        <div className="stagger grid gap-4 md:grid-cols-2">
          <Meter icon={FileCheck2} title="Adaptaciones este periodo" used={usage.adaptations.used} limit={usage.adaptations.limit} hint={renews} />
          <Meter icon={Users} title="Perfiles guardados" used={profiles} limit={usage.max_profiles} hint="No se renuevan: cuentan los perfiles que tienes ahora." />
          {usage.images.limit > 0 ? <Meter icon={Sparkles} title="Recursos visuales este periodo" used={usage.images.used} limit={usage.images.limit} hint={renews} /> : null}
        </div>
      </section>

      <section aria-labelledby="tu-cuenta" className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
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
        </Card>
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">¿Dudas?</h2>
          <ul className="space-y-1">
            <li>
              <Link href="/como-funciona" className="group flex min-h-11 items-center gap-3 rounded-control px-2 font-medium hover:bg-foreground/5">
                <CircleHelp aria-hidden className="size-5 text-primary" />
                <span className="flex-1">Cómo funciona Adaptaula</span>
                <ArrowUpRight aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </li>
            <li>
              <Link href="/privacidad" className="group flex min-h-11 items-center gap-3 rounded-control px-2 font-medium hover:bg-foreground/5">
                <Shield aria-hidden className="size-5 text-primary" />
                <span className="flex-1">Privacidad y datos del alumnado</span>
                <ArrowUpRight aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
