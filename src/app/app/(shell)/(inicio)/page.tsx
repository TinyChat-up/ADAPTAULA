import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleUserRound, FileCheck2, FilePlus2, FileText, FolderOpen, Sparkles, UserRoundPlus, Users, Wand2 } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { UsageMeter } from "@/components/ui/feedback";
import { Card, IconBadge } from "@/components/ui/layout";
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

/** The path of the product in three steps: shown while the teacher has not adapted anything yet. */
const FIRST_STEPS = [
  { icon: FilePlus2, title: "Sube tu ficha", text: "Un PDF o una foto del material que ya utilizas." },
  { icon: Users, title: "Elige un perfil", text: "Las necesidades funcionales que quieres tener en cuenta." },
  { icon: Wand2, title: "Haz magia", text: "Adaptaula prepara la ficha adaptada, lista para imprimir." },
] as const;

/** `linkDetail` completes the link's text from `sm` up; on a phone it stays in the accessible name only, so the row does not wrap. */
function SectionHeading({ id, title, href, linkText, linkDetail }: { id: string; title: string; href?: string; linkText?: string; linkDetail?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 id={id} className="min-w-0 text-xl font-semibold">
        {title}
      </h2>
      {href && linkText ? (
        <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
          <span>
            {linkText}
            {linkDetail ? <span className="sr-only sm:not-sr-only"> {linkDetail}</span> : null}
          </span>
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}
    </div>
  );
}

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
  const subtitle =
    attention.length > 0
      ? attention.length === 1
        ? "Tienes una adaptación que necesita tu atención."
        : `Tienes ${attention.length} adaptaciones que necesitan tu atención.`
      : working.length > 0
        ? "Estamos preparando tus fichas. Puedes seguir trabajando mientras tanto."
        : "¿Qué material adaptamos hoy?";

  return (
    <div className="space-y-10">
      <section aria-labelledby="saludo" className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div aria-hidden className="brand-wash glow-in absolute inset-0" />
        <div aria-hidden className="grid-fade absolute inset-0" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h1 id="saludo" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting}
            </h1>
            <p className="max-w-xl text-muted-foreground sm:text-lg">{subtitle}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/app/adaptar" size="lg">
              <FilePlus2 aria-hidden className="size-5" />
              Adaptar material
            </LinkButton>
            {profiles === 0 ? (
              <LinkButton href="/app/alumnos/nuevo" size="lg" variant="secondary">
                <UserRoundPlus aria-hidden className="size-5" />
                Crear un perfil
              </LinkButton>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-label="Resumen" className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Card className="col-span-2 space-y-3 lg:col-span-1">
          <div className="flex items-center gap-3">
            <IconBadge icon={FileCheck2} />
            <h2 className="text-sm font-medium text-muted-foreground">Adaptaciones este mes</h2>
          </div>
          <p className="text-2xl font-semibold">
            {usage.adaptations.used} <span className="text-base font-normal text-muted-foreground">de {usage.adaptations.limit}</span>
          </p>
          <UsageMeter used={usage.adaptations.used} limit={usage.adaptations.limit} label="Adaptaciones usadas este mes" />
        </Card>
        <Card interactive className="space-y-3">
          <div className="flex items-center gap-3">
            <IconBadge icon={Users} tone="accent" />
            <h2 className="text-sm font-medium text-muted-foreground">Perfiles</h2>
          </div>
          <p className="text-2xl font-semibold">
            {profiles} <span className="text-base font-normal text-muted-foreground">de {usage.max_profiles}</span>
          </p>
          <Link href="/app/alumnos" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Gestionar perfiles
          </Link>
        </Card>
        <Card interactive className="space-y-3">
          <div className="flex items-center gap-3">
            <IconBadge icon={CircleUserRound} />
            <h2 className="text-sm font-medium text-muted-foreground">Plan</h2>
          </div>
          <p className="text-2xl font-semibold">{usage.plan.name}</p>
          <p className="text-sm text-muted-foreground">Se renueva el {formatDay(usage.period_end)}.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/app/uso" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              Ver detalle
            </Link>
            <Link href="/precios" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              Ver planes
            </Link>
          </div>
        </Card>
      </section>

      {attention.length > 0 ? (
        <section aria-labelledby="atencion" className="space-y-3">
          <SectionHeading id="atencion" title="Necesitan tu atención" />
          <AdaptationList items={attention} />
        </section>
      ) : null}

      {working.length > 0 ? (
        <section aria-labelledby="en-curso" className="space-y-3">
          <SectionHeading id="en-curso" title="En curso" />
          <AdaptationList items={working} />
        </section>
      ) : null}

      {done.length > 0 ? (
        <section aria-labelledby="preparadas" className="space-y-3">
          <SectionHeading id="preparadas" title="Fichas preparadas" href="/app/historial" linkText="Ver todas" linkDetail="las adaptaciones" />
          <AdaptationList items={done} />
        </section>
      ) : null}

      {adaptations.length === 0 && analyzed.length > 0 ? (
        <Card className="relative overflow-hidden">
          <div aria-hidden className="absolute -right-10 -top-10 size-40 rounded-full bg-accent-soft" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            <IconBadge icon={Sparkles} tone="accent" className="size-12" />
            <div className="flex-1 space-y-1">
              <h2 className="text-lg font-semibold">Siguiente paso: adapta un material</h2>
              <p className="text-sm text-muted-foreground">
                {profiles === 0 ? "Crea un perfil con las necesidades que quieres tener en cuenta y elige un material analizado." : "Abre un material analizado y elige para qué perfil quieres adaptarlo."}
              </p>
            </div>
            {profiles === 0 ? <LinkButton href="/app/alumnos/nuevo">Crear un perfil</LinkButton> : <LinkButton href={`/app/materiales/${analyzed[0]!.id}#adaptar`}>{`Adaptar «${analyzed[0]!.title}»`}</LinkButton>}
          </div>
        </Card>
      ) : null}

      {materials.length === 0 ? (
        <section aria-labelledby="empieza" className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-surface px-6 py-10 sm:px-10">
          <div aria-hidden className="grid-fade pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-3xl text-center">
            <span aria-hidden className="float-soft mx-auto mb-5 inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary ring-8 ring-primary-soft/40">
              <FilePlus2 className="size-7" />
            </span>
            <h2 id="empieza" className="text-lg font-semibold sm:text-xl">
              Empieza subiendo una ficha que ya utilizas.
            </h2>
            <p className="mx-auto mt-1 max-w-md text-muted-foreground">Cuando subas tu primer material, aparecerá aquí para que puedas retomarlo.</p>
            <ol className="stagger mt-8 grid gap-3 text-left sm:grid-cols-3">
              {FIRST_STEPS.map((step, i) => (
                <li key={step.title} className="rounded-card border border-border bg-background/60 p-4">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <step.icon aria-hidden className="size-5 text-primary" />
                  </div>
                  <h3 className="mt-3 font-semibold">
                    <span className="sr-only">Paso {i + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <LinkButton href="/app/adaptar">Adaptar material</LinkButton>
              <LinkButton href="/app/alumnos/nuevo" variant="secondary">
                Crear un perfil
              </LinkButton>
            </div>
          </div>
        </section>
      ) : (
        <section aria-labelledby="recientes" className="space-y-3">
          <SectionHeading id="recientes" title="Tus materiales" href="/app/materiales" linkText="Ver todos" />
          <ul className="stagger grid gap-3 sm:grid-cols-2">
            {materials.slice(0, 4).map((m) => (
              <li key={m.id} className="lift relative flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-card">
                <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
                  {m.status === "analyzed" ? <FileText className="size-5" /> : <FolderOpen className="size-5" />}
                </span>
                {/* The whole card is the link's target area (an overlay), the title is its accessible name. */}
                <Link href={`/app/materiales/${m.id}`} className="min-w-0 flex-1 truncate font-medium after:absolute after:inset-0 after:rounded-card hover:underline">
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
