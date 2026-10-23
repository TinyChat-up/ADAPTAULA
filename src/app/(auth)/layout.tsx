import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

const STEPS = ["Sube un PDF o una imagen", "Elige apoyos funcionales", "Revisa la ficha y descarga el PDF"] as const;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <aside className="hidden border-r border-border bg-surface-muted px-10 py-12 text-foreground lg:flex lg:flex-col lg:justify-between xl:px-16">
        <Logo size="lg" />
        <div className="max-w-lg space-y-8">
          <p className="eyebrow text-primary">Del documento al aula</p>
          <p className="font-editorial text-5xl leading-[1.12] tracking-tight">Tus materiales de siempre. Más formas de aprender.</p>
          <ol className="divide-y divide-border border-y border-border text-sm">
            {STEPS.map((step, i) => <li key={step} className="flex gap-5 py-4"><span aria-hidden className="font-medium tabular-nums text-primary">0{i + 1}</span>{step}</li>)}
          </ol>
        </div>
        <p className="max-w-md text-sm text-muted-foreground">Adaptaula prepara propuestas. Tú decides qué usar y conservas el documento original.</p>
      </aside>
      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-10 lg:justify-center lg:px-14 xl:px-24">
        <div className="mb-10 lg:hidden"><Logo /></div>
        <main id="contenido" className="mx-auto w-full max-w-md">
          <div className="mb-7 hidden lg:block"><p className="eyebrow text-primary">Tu espacio de trabajo</p></div>
          {children}
          <p className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">Usa alias para los perfiles de alumnado. Evita incluir datos personales innecesarios en los materiales.</p>
        </main>
      </div>
    </div>
  );
}
