import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Demo } from "./demo";

export function Hero() {
  return (
    <section aria-labelledby="hero-titulo" className="border-b border-border">
      <div className="mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-8 sm:pb-16 sm:pt-12">
        <div className="mb-6 flex flex-wrap sm:mb-10 justify-between gap-3 border-b border-border pb-4 text-xs text-muted-foreground">
          <span className="eyebrow">Un estudio pedagógico digital</span>
          <span>Primaria · ESO · Bachillerato</span>
        </div>
        <div className="grid items-center gap-10 xl:grid-cols-[0.85fr_1.25fr] xl:gap-14">
          <div className="max-w-xl space-y-4 sm:space-y-6">
            <h1 id="hero-titulo" className="font-editorial text-[2.75rem] leading-[1.06] tracking-[-0.04em] sm:text-6xl xl:text-[4.25rem]">
              Un mismo material.<br /><span className="text-primary">Más formas de aprender.</span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
              Convierte las fichas que ya utilizas en materiales accesibles para tu alumnado. Tú conoces sus necesidades; Adaptaula te ayuda a darles forma.
            </p>
            <div className="flex flex-col items-start gap-1 pt-2 sm:gap-4">
              <LinkButton href="/registro" size="lg">Adaptar mi primera ficha<ArrowRight aria-hidden className="size-4" /></LinkButton>
              <Link href="#como-funciona" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Conoce el proceso</Link>
            </div>
            <p className="text-xs text-muted-foreground">Acceso anticipado. Gratis, sin tarjeta. Usa alias, no nombres del alumnado.</p>
          </div>
          <Demo />
        </div>
      </div>
    </section>
  );
}
