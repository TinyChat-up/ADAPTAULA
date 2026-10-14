import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

const PROMISES = ["Sube la ficha que ya utilizas", "Elige el perfil de necesidades funcionales", "Revisa el resultado y descarga el PDF cuando esté listo"] as const;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden lg:grid lg:grid-cols-[1fr_1.1fr]">
      {/* Brand side (wide screens): what the account is for, in three steps. Decoration and copy only, no controls. */}
      <aside className="relative hidden overflow-hidden bg-foreground p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <p className="relative text-lg font-semibold">Adaptaula</p>
        <div className="relative max-w-md space-y-6">
          <p className="font-editorial text-5xl leading-tight tracking-tight">Un mismo material. Adaptado para cada alumno.</p>
          <ul className="space-y-3">
            {PROMISES.map((p, i) => (
              <li key={p} className="flex items-start gap-4 border-t border-white/25 py-3 text-sm">
                <span aria-hidden className="tabular-nums">0{i + 1}</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm">Adaptaula propone, tú decides: nunca sustituye al criterio del docente ni al orientador.</p>
      </aside>
      <div className="bg-background relative flex min-h-screen flex-col items-center px-4 py-10 sm:py-16 lg:justify-center">
        <Logo />
        <main id="contenido" className="mt-8 w-full max-w-md">
          <div className="border-t-2 border-foreground bg-surface p-6 sm:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
