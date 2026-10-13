import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-final-titulo" className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="reveal relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-linear-to-br from-primary to-accent px-6 py-14 text-center text-primary-foreground shadow-xl shadow-primary/20 sm:px-12">
        <div aria-hidden className="absolute -right-16 -top-16 size-64 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -bottom-20 -left-10 size-56 rounded-full bg-white/10" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
          <h2 id="cta-final-titulo" className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Empieza con una ficha que ya utilizas.
          </h2>
          <p className="text-lg">Crea tu cuenta gratis y prueba con tu propio material.</p>
          <Link
            href="/registro"
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-surface px-6 text-base font-semibold text-primary shadow-lg shadow-black/10 transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
          >
            Adaptar mi primera ficha
            <ArrowRight aria-hidden className="size-5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
