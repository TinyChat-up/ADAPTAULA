import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { UsageMeter } from "@/components/ui/feedback";
import { Card, EmptyState } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay, greetingFor } from "@/lib/format/date";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { listMaterials } from "@/lib/materials/repository";
import { StatusBadge } from "@/components/materials/status-badge";
import type { MaterialStatus } from "@/lib/materials/types";
import { countActiveProfiles } from "@/lib/profiles/repository";
import { AdaptationList } from "@/components/adaptation/adaptation-list";
import { listAdaptations } from "@/lib/adaptation/orchestration/page-data";

export const metadata: Metadata = { title: "Inicio" };

export default async function DashboardPage() {
  const ctx = await requireWorkspace();
  const [usage, profiles, materials, adaptations] = await Promise.all([
    getWorkspaceUsage(ctx.workspace.id),
    countActiveProfiles(ctx.workspace.id),
    listMaterials(ctx.workspace.id),
    listAdaptations({ limit: 30 }),
  ]);
  const attention = adaptations.filter((a) => a.state.group === "attention").slice(0, 5);
  const working = adaptations.filter((a) => a.state.group === "working").slice(0, 5);
  const done = adaptations.filter((a) => a.state.group === "done").slice(0, 3);
  const analyzed = materials.filter((m) => m.status === "analyzed");
  const firstName = ctx.profile.fullName?.split(" ")[0];
  const greeting = `${greetingFor(new Date())}${firstName ? `, ${firstName}` : ""}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting}</h1>
        <LinkButton href="/app/adaptar" size="lg">
          <FilePlus2 aria-hidden className="size-5" />
          Adaptar material
        </LinkButton>
      </div>

      <section aria-label="Resumen" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Adaptaciones este mes</h2>
          <p className="text-2xl font-semibold">
            {usage.adaptations.used} <span className="text-base font-normal text-muted-foreground">de {usage.adaptations.limit}</span>
          </p>
          <UsageMeter used={usage.adaptations.used} limit={usage.adaptations.limit} label="Adaptaciones usadas este mes" />
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Perfiles</h2>
          <p className="text-2xl font-semibold">
            {profiles} <span className="text-base font-normal text-muted-foreground">de {usage.max_profiles}</span>
          </p>
          <Link href="/app/alumnos" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Gestionar perfiles
          </Link>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Plan</h2>
          <p className="text-2xl font-semibold">{usage.plan.name}</p>
          <Link href="/precios" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Ver planes
          </Link>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Uso</h2>
          <p className="text-sm">Se renueva el {formatDay(usage.period_end)}.</p>
          <Link href="/app/uso" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Ver detalle
          </Link>
        </Card>
      </section>

      {attention.length > 0 ? (
        <section aria-labelledby="atencion" className="space-y-3">
          <h2 id="atencion" className="text-xl font-semibold">
            Necesitan tu atención
          </h2>
          <AdaptationList items={attention} />
        </section>
      ) : null}

      {working.length > 0 ? (
        <section aria-labelledby="en-curso" className="space-y-3">
          <h2 id="en-curso" className="text-xl font-semibold">
            En curso
          </h2>
          <AdaptationList items={working} />
        </section>
      ) : null}

      {done.length > 0 ? (
        <section aria-labelledby="preparadas" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="preparadas" className="text-xl font-semibold">
              Fichas preparadas
            </h2>
            <Link href="/app/historial" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              Ver todas las adaptaciones
            </Link>
          </div>
          <AdaptationList items={done} />
        </section>
      ) : null}

      {adaptations.length === 0 && analyzed.length > 0 ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Siguiente paso: adapta un material</h2>
          <p className="text-sm text-muted-foreground">
            {profiles === 0 ? "Crea un perfil con las necesidades que quieres tener en cuenta y elige un material analizado." : "Abre un material analizado y elige para qué perfil quieres adaptarlo."}
          </p>
          <div className="flex flex-wrap gap-3">
            {profiles === 0 ? <LinkButton href="/app/alumnos/nuevo">Crear un perfil</LinkButton> : <LinkButton href={`/app/materiales/${analyzed[0]!.id}#adaptar`}>{`Adaptar «${analyzed[0]!.title}»`}</LinkButton>}
          </div>
        </Card>
      ) : null}

      {materials.length === 0 ? (
        <EmptyState
          icon={FilePlus2}
          title="Empieza subiendo una ficha que ya utilizas."
          description="Cuando subas tu primer material, aparecerá aquí para que puedas retomarlo."
        >
          <LinkButton href="/app/adaptar">Adaptar material</LinkButton>
          <LinkButton href="/app/alumnos/nuevo" variant="secondary">
            Crear un perfil
          </LinkButton>
        </EmptyState>
      ) : (
        <section aria-labelledby="recientes" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="recientes" className="text-xl font-semibold">
              Tus materiales
            </h2>
            <Link href="/app/materiales" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              Ver todos
            </Link>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
            {materials.slice(0, 4).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 p-4">
                <Link href={`/app/materiales/${m.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {m.title}
                </Link>
                <StatusBadge status={m.status as MaterialStatus} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
