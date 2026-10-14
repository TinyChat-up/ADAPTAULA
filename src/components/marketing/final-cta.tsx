import { LinkButton } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-final-titulo" className="border-y border-border bg-primary-soft">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 py-14 sm:px-8 sm:py-20 md:flex-row md:items-center">
        <div className="max-w-2xl space-y-4">
          <p className="eyebrow text-primary">Tu próxima ficha empieza aquí</p>
          <h2 id="cta-final-titulo" className="font-editorial text-3xl leading-tight tracking-tight sm:text-5xl">Empieza con un material que ya utilizas.</h2>
          <p className="text-muted-foreground">Crea tu cuenta gratis y prepara tu primera adaptación.</p>
        </div>
        <LinkButton href="/registro" size="lg" className="shrink-0">Adaptar mi primera ficha</LinkButton>
      </div>
    </section>
  );
}
