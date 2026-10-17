import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Demo } from "./demo";

export function Hero() {
  return (
    <section aria-labelledby="hero-titulo" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow mb-5 text-primary">Un espacio de trabajo para docentes</p>
          <h1 id="hero-titulo" className="font-editorial text-[clamp(2.5rem,6vw,5.4rem)] leading-[1.07] tracking-[-0.045em] [overflow-wrap:anywhere]">
            Tus materiales de siempre.<br /><span className="text-primary">Adaptados a cada forma de aprender.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-xl">
            Sube una ficha, elige los apoyos funcionales y prepara una propuesta. Revísala con CLARO, ajusta lo necesario y descarga el PDF para tu aula.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <LinkButton href="/registro" size="lg">Empezar gratis<ArrowRight aria-hidden className="size-4" /></LinkButton>
            <Link href="#demostracion" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Explorar la demostración</Link>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Gratis, sin tarjeta. El docente conserva la decisión final.</p>
        </div>
        <div className="mt-12 sm:mt-16"><Demo /></div>
      </div>
    </section>
  );
}
