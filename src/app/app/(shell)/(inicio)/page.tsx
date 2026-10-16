import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
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

const FIRST_STEPS = [
  { title: "Sube tu ficha", text: "Un PDF o una imagen del material que ya utilizas." },
  { title: "Elige un perfil", text: "Indica las necesidades funcionales que quieres atender." },
  { title: "Prepara y revisa", text: "Elige Hacer magia o revisa la propuesta antes de crear la ficha." },
];

function SectionHeading({ id, title, href, linkText, linkDetail }: { id: string; title: string; href?: string; linkText?: string; linkDetail?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {href && linkText ? (
        <Link href={href} className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4">
          <span>{linkText}{linkDetail ? <span className="sr-only sm:not-sr-only"> {linkDetail}</span> : null}</span>
          <ArrowRight aria-hidden className="size-4" />
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
  const subtitle = attention.length > 0
    ? attention.length === 1 ? "Tienes una adaptación que necesita tu atención." : `Tienes ${attention.length} adaptaciones que necesitan tu atención.`
    : working.length > 0 ? "Estamos preparando tus fichas. Puedes seguir trabajando mientras tanto." : "¿Qué material adaptamos hoy?";

  return (
    <div className="space-y-9 sm:space-y-10">
      <section aria-labelledby="saludo" className="border-b border-foreground pb-6">
        <p className="eyebrow mb-5 text-muted-foreground">Tu mesa de trabajo</p>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <h1 id="saludo" className="text-3xl font-semibold tracking-tight sm:text-4xl">{greeting}</h1>
            <p className="max-w-xl text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </section>

      {attention.length > 0 ? (
        <section aria-labelledby="atencion" className="space-y-3">
          <SectionHeading id="atencion" title="Necesitan tu atención" />
          <AdaptationList items={attention} />
        </section>
      ) : null}
      <section aria-labelledby="nuevo-material" className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div><h2 id="nuevo-material" className="text-lg font-semibold">Adaptar un nuevo material</h2><p className="mt-1 text-sm text-muted-foreground">Empieza con una ficha que ya utilizas.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton href="/app/adaptar">Adaptar material<ArrowRight aria-hidden className="size-4" /></LinkButton>
          {profiles === 0 ? <Link href="/app/alumnos/nuevo" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Crear un perfil</Link> : null}
        </div>
      </section>
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
        <section className="border-l-2 border-primary pl-5">
          <h2 className="text-lg font-semibold">Siguiente paso: adapta un material</h2>
          <p className="mb-3 mt-2 text-sm text-muted-foreground">{profiles === 0 ? "Crea un perfil con las necesidades que quieres tener en cuenta y elige un material analizado." : "Abre un material analizado y elige para qué perfil quieres adaptarlo."}</p>
          <LinkButton variant="secondary" href={profiles === 0 ? "/app/alumnos/nuevo" : `/app/materiales/${analyzed[0]!.id}#adaptar`}>{profiles === 0 ? "Crear un perfil" : `Adaptar «${analyzed[0]!.title}»`}</LinkButton>
        </section>
      ) : null}

      {materials.length === 0 ? (
        <section aria-labelledby="empieza" className="py-2">
          <h2 id="empieza" className="font-editorial text-2xl sm:text-3xl">Empieza subiendo una ficha que ya utilizas.</h2>
          <p className="mt-3 max-w-xl text-muted-foreground">Cuando subas tu primer material, aparecerá aquí para que puedas retomarlo.</p>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {FIRST_STEPS.map((step, i) => (
              <li key={step.title} className="border-t border-border pt-4">
                <span aria-hidden className="text-xs text-primary">0{i + 1}</span>
                <h3 className="mb-2 mt-3 font-semibold"><span className="sr-only">Paso {i + 1}: </span>{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section aria-labelledby="recientes" className="space-y-3">
          <SectionHeading id="recientes" title="Materiales recientes" href="/app/materiales" linkText="Ver todos" />
          <ul className="editorial-list">
            {materials.slice(0, 4).map((m) => (
              <li key={m.id} className="relative flex flex-wrap items-center justify-between gap-3 py-4 hover:bg-surface/60">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/materiales/${m.id}`} className="block break-words font-medium after:absolute after:inset-0 hover:underline">{m.title}</Link>
                  <p className="mt-1 text-xs text-muted-foreground">Subido el {formatDay(m.created_at)}</p>
                </div>
                <StatusBadge status={m.status as MaterialStatus} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer aria-label="Resumen de uso" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-xs text-muted-foreground">
        <span>Plan {usage.plan.name} · {usage.adaptations.used} de {usage.adaptations.limit} adaptaciones</span>
        <Link href="/app/alumnos" className="underline underline-offset-4">Perfiles: {profiles} de {usage.max_profiles}</Link>
        <Link href="/app/uso" className="inline-flex min-h-9 items-center font-medium text-primary underline underline-offset-4">Plan y cuenta</Link>
      </footer>
    </div>
  );
}
