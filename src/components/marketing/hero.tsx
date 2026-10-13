import { ArrowRight, Check, FileText, Sparkles, Users, Wand2 } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

const PROMISES = ["Empieza gratis, sin tarjeta", "Sin datos médicos ni nombres", "Primaria, ESO y Bachillerato"] as const;

/** A miniature of the product's path (upload → profile → adapted sheet): illustration only, the demo below shows the real change. */
function HeroPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md lg:mx-0">
      <div className="absolute -inset-6 rounded-[2rem] bg-linear-to-br from-primary/15 via-accent/10 to-transparent blur-2xl" />
      <div className="relative rounded-2xl border border-border bg-surface p-5 shadow-xl shadow-primary/10">
        <div className="flex items-center gap-3 rounded-card border border-border bg-background p-3">
          <span className="inline-flex size-9 items-center justify-center rounded-control bg-accent-soft text-accent">
            <FileText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Ficha 4. Fracciones.pdf</p>
            <p className="text-xs text-muted-foreground">Material analizado · 6 actividades</p>
          </div>
          <Check className="size-5 text-success" />
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-card border border-border bg-background p-3">
          <span className="inline-flex size-9 items-center justify-center rounded-control bg-primary-soft text-primary">
            <Users className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Perfil M.R.</p>
            <p className="text-xs text-muted-foreground">Atención y planificación · Lectura</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 rounded-card bg-linear-to-r from-primary to-accent px-4 py-3 text-sm font-medium text-primary-foreground">
          <Wand2 className="size-4" />
          Hacer magia
        </div>
        <div className="mt-4 space-y-2 rounded-card border border-primary/25 bg-primary-soft/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Ficha adaptada</p>
          <div className="h-2 w-3/4 rounded-full bg-primary/25" />
          <div className="h-2 w-full rounded-full bg-foreground/10" />
          <div className="h-2 w-5/6 rounded-full bg-foreground/10" />
          <div className="mt-3 h-8 rounded-control border border-dashed border-primary/30" />
        </div>
      </div>
      <div className="float-soft absolute -left-4 top-24 hidden rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-lg sm:block">
        <Sparkles className="mr-1 inline size-3.5 text-accent" />
        Instrucciones en pasos
      </div>
      <div className="float-soft absolute -right-3 bottom-16 hidden rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-lg [animation-delay:1.5s] sm:block">
        <Check className="mr-1 inline size-3.5 text-success" />
        Ejemplo resuelto antes
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-titulo" className="relative overflow-hidden">
      <div aria-hidden className="brand-wash glow-in absolute inset-0" />
      <div aria-hidden className="grid-fade absolute inset-0" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/50 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            Acceso anticipado
          </span>
          <h1 id="hero-titulo" className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Un mismo material.{" "}
            <span className="bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">Adaptado para cada alumno.</span>
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Sube tus fichas y crea versiones adaptadas a las necesidades de aprendizaje de tu alumnado en minutos. Para docentes de
            Primaria, ESO y Bachillerato.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/registro" size="lg">
              Adaptar mi primera ficha
              <ArrowRight aria-hidden className="size-5 transition-transform group-hover/button:translate-x-0.5" />
            </LinkButton>
            <LinkButton href="#como-funciona" variant="secondary" size="lg">
              Ver cómo funciona
            </LinkButton>
          </div>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5">
            {PROMISES.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check aria-hidden className="size-4 text-accent" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <HeroPreview />
      </div>
    </section>
  );
}
