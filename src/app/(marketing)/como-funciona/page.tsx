import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { StepsList } from "@/components/marketing/steps";

export const metadata: Metadata = {
  title: "Cómo funciona",
  description: "Sube una ficha, elige para quién la adaptas, revisa la propuesta y descárgala.",
};

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Cómo funciona Adaptaula</h1>
        <p className="text-lg text-muted-foreground">
          Del material que ya tienes a una versión adaptada, sin empezar de cero y sin cambiar tu forma de preparar las clases.
        </p>
      </div>
      <StepsList />
      <div className="max-w-2xl space-y-4 border-t border-border pt-10">
        <h2 className="text-xl font-semibold">Tú decides siempre</h2>
        <p className="text-muted-foreground">
          Adaptaula propone y te explica qué ha cambiado y por qué. No diagnostica y no sustituye el criterio del docente ni del
          orientador: la adaptación es un borrador que revisas y editas antes de usarlo.
        </p>
        <LinkButton href="/registro" size="lg">
          Adaptar mi primera ficha
        </LinkButton>
      </div>
    </div>
  );
}
