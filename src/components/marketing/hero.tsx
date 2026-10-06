import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";

export function Hero() {
  return (
    <section aria-labelledby="hero-titulo" className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
      <div className="max-w-3xl space-y-6">
        <Badge tone="accent">Acceso anticipado</Badge>
        <h1 id="hero-titulo" className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Un mismo material. Adaptado para cada alumno.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
          Sube tus fichas y crea versiones adaptadas a las necesidades de aprendizaje de tu alumnado en minutos. Para docentes de
          Primaria, ESO y Bachillerato.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton href="/registro" size="lg">
            Adaptar mi primera ficha
          </LinkButton>
          <LinkButton href="#como-funciona" variant="secondary" size="lg">
            Ver cómo funciona
          </LinkButton>
        </div>
        <p className="text-sm text-muted-foreground">Empieza gratis. Sin tarjeta.</p>
      </div>
    </section>
  );
}
