import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Logo } from "@/components/ui/logo";

const PROMISES = ["Sube la ficha que ya utilizas", "Elige el perfil de necesidades funcionales", "Descarga la ficha adaptada, lista para imprimir"] as const;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden lg:grid lg:grid-cols-[1fr_1.1fr]">
      {/* Brand side (wide screens): what the account is for, in three steps. Decoration and copy only, no controls. */}
      <aside className="relative hidden overflow-hidden bg-linear-to-br from-primary to-accent p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-80 rounded-full bg-white/10" />
        <p className="relative text-lg font-semibold">Adaptaula</p>
        <div className="relative max-w-md space-y-6">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Un mismo material. Adaptado para cada alumno.</p>
          <ul className="space-y-3">
            {PROMISES.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-white/15">
                  <Check className="size-4" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm">Adaptaula propone, tú decides: nunca sustituye al criterio del docente ni al orientador.</p>
      </aside>
      <div className="brand-wash relative flex min-h-screen flex-col items-center px-4 py-10 sm:py-16 lg:justify-center">
        <Logo />
        <main id="contenido" className="page-enter mt-8 w-full max-w-md">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-primary/5 sm:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
