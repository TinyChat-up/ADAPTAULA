import { Download, FileUp, ListChecks, Users, type LucideIcon } from "lucide-react";

export const STEPS = [
  { title: "Sube tu ficha", text: "Un PDF o una imagen del material que ya utilizas: ficha, texto, examen o problema." },
  { title: "Elige para quién", text: "Elige un perfil guardado con las necesidades funcionales que quieres tener en cuenta." },
  { title: "Revisa la propuesta", text: "Adaptaula te presenta una propuesta editable y te explica qué ha cambiado y por qué." },
  { title: "Descarga y usa", text: "Descarga la ficha en PDF lista para imprimir y repite con otros perfiles sin volver a subirla." },
] as const;

const ICONS: readonly LucideIcon[] = [FileUp, Users, ListChecks, Download];

export function StepsList() {
  return (
    <ol className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {/* The path that joins the steps (wide screens): decoration only. */}
      <span aria-hidden className="absolute left-[12%] right-[12%] top-6 hidden h-px bg-linear-to-r from-primary/40 via-accent/40 to-primary/40 lg:block" />
      {STEPS.map((step, i) => {
        const Icon = ICONS[i]!;
        return (
          <li key={step.title} className="lift relative rounded-card border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent text-base font-semibold text-primary-foreground shadow-md shadow-primary/25">
                {i + 1}
              </span>
              <Icon aria-hidden className="size-5 text-primary" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">
              <span className="sr-only">Paso {i + 1}: </span>
              {step.title}
            </h3>
            <p className="mt-1 text-muted-foreground">{step.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
