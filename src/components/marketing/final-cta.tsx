import { LinkButton } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-final-titulo" className="border-t border-border bg-surface py-16 sm:py-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 text-center sm:px-6">
        <h2 id="cta-final-titulo" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Empieza con una ficha que ya utilizas.
        </h2>
        <p className="text-lg text-muted-foreground">Crea tu cuenta gratis y prueba con tu propio material.</p>
        <LinkButton href="/registro" size="lg">
          Adaptar mi primera ficha
        </LinkButton>
      </div>
    </section>
  );
}
