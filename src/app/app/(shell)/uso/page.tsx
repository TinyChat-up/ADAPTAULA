import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { AccountNameForm } from "@/components/account/account-name-form";
import { UsageSummary } from "@/components/account/usage-summary";
import { Button, LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { countActiveProfiles } from "@/lib/profiles/repository";
import { updateAccountName } from "./actions";

export const metadata: Metadata = { title: "Plan y cuenta" };

export default async function UsagePage() {
  const ctx = await requireWorkspace();
  const [usage, profiles] = await Promise.all([getWorkspaceUsage(ctx.workspace.id), countActiveProfiles(ctx.workspace.id)]);
  return (
    <div className="space-y-10">
      <PageHeader title="Plan y cuenta" description="Tu capacidad de trabajo y los datos de tu cuenta, en un mismo lugar." />
      <section aria-labelledby="uso-periodo" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 id="uso-periodo" className="text-xl font-semibold">Tu plan {usage.plan.name}</h2>
            <p className="text-sm text-muted-foreground">Periodo: {formatDay(usage.period_start)} – {formatDay(usage.period_end)}.</p>
            <p className="text-sm text-muted-foreground">Las cuotas se renuevan el {formatDay(usage.period_end)}.</p>
          </div>
          <LinkButton href="/precios" variant="secondary">Ver planes</LinkButton>
        </div>
        <div className="grid gap-x-10 md:grid-cols-2">
          <UsageSummary title="Adaptaciones este periodo" used={usage.adaptations.used} limit={usage.adaptations.limit} hint="Fichas adaptadas; incluye las reservas en curso." />
          <UsageSummary title="Análisis este periodo" used={usage.analyses.used} limit={usage.analyses.limit} hint="Comprender el original no consume adaptaciones." />
          <UsageSummary title="Perfiles guardados" used={profiles} limit={usage.max_profiles} hint="Cuentan los perfiles actuales; no se renuevan cada mes." />
          {usage.images.limit > 0 ? <UsageSummary title="Recursos visuales este periodo" used={usage.images.used} limit={usage.images.limit} hint="Disponibilidad sujeta a las funciones habilitadas." /> : null}
        </div>
        <Link href="/app/alumnos" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Gestionar perfiles</Link>
      </section>

      <section aria-labelledby="tu-cuenta" className="grid gap-8 border-t border-border pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-6">
          <h2 id="tu-cuenta" className="text-xl font-semibold">Tu cuenta</h2>
          <AccountNameForm name={ctx.profile.fullName ?? ""} action={updateAccountName} />
          <dl className="divide-y divide-border">
            {[["Correo electrónico", ctx.user.email ?? "Sin indicar"], ["Espacio de trabajo", ctx.workspace.name]].map(([term, value]) => (
              <div key={term} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className="text-sm text-muted-foreground">{term}</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0 space-y-5">
          <h2 className="text-xl font-semibold">Acceso y privacidad</h2>
          <p className="text-sm text-muted-foreground">Elige una contraseña nueva desde el formulario protegido de tu sesión.</p>
          <LinkButton href="/reset-password" variant="secondary">Cambiar contraseña</LinkButton>
          <form action={signOut}><Button type="submit" variant="ghost">Cerrar sesión</Button></form>
          <div className="border-t border-border pt-3">
            <Link href="/como-funciona" className="flex min-h-11 items-center text-sm text-primary underline underline-offset-4">Cómo funciona Adaptaula</Link>
            <Link href="/privacidad" className="flex min-h-11 items-center text-sm text-primary underline underline-offset-4">Privacidad y datos del alumnado</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
