import { ArrowRight } from "lucide-react";

const CHANGES = ["Instrucciones en pasos", "Ejemplo resuelto antes de empezar", "Menos tareas a la vista", "Más espacio para escribir"];

export function Demo() {
  return (
    <section aria-labelledby="demo-titulo" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
      <h2 id="demo-titulo" className="sr-only">
        Ejemplo: de la ficha original a la versión adaptada
      </h2>
      <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <article aria-label="Ficha original" className="rounded-card border border-border bg-surface p-6 shadow-card">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Original</p>
          <h3 className="text-lg font-semibold">Ficha 4. Fracciones</h3>
          <p className="mt-3 text-sm leading-snug">
            Lee atentamente el enunciado de cada problema, identifica los datos relevantes, plantea la operación necesaria y
            resuelve, justificando por escrito el procedimiento seguido en cada caso.
          </p>
          <ol className="mt-4 space-y-1 text-sm leading-snug">
            <li>1. Calcula 1/2 + 1/4.</li>
            <li>2. Calcula 2/3 + 1/6.</li>
            <li>3. Calcula 3/4 − 1/8.</li>
            <li>4. Ana come 1/3 de una pizza y Luis 1/4. ¿Qué fracción han comido?</li>
            <li>5. Calcula 5/6 − 1/3.</li>
            <li>6. Calcula 1/5 + 3/10.</li>
          </ol>
        </article>

        <div aria-hidden className="flex items-center justify-center text-muted-foreground">
          <ArrowRight className="size-8 rotate-90 lg:rotate-0" />
        </div>

        <article aria-label="Ficha adaptada" className="rounded-card border border-primary/30 bg-surface p-6 shadow-card">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-primary">Adaptado</p>
          <h3 className="text-lg font-semibold">Ficha 4. Fracciones</h3>
          <ol className="mt-3 space-y-1.5 text-base">
            <li>
              <strong>Paso 1.</strong> Lee el problema.
            </li>
            <li>
              <strong>Paso 2.</strong> Subraya los datos.
            </li>
            <li>
              <strong>Paso 3.</strong> Escribe la operación.
            </li>
            <li>
              <strong>Paso 4.</strong> Resuelve y escribe el resultado.
            </li>
          </ol>
          <p className="mt-4 rounded-control bg-accent-soft px-3 py-2 text-sm text-accent">
            <strong>Ejemplo:</strong> 1/2 + 1/4 = 2/4 + 1/4 = 3/4
          </p>
          <div className="mt-4 space-y-3 text-base">
            <p>
              <strong>Ejercicio 1.</strong> Calcula 2/3 + 1/6.
            </p>
            <div aria-hidden className="h-10 rounded-control border border-dashed border-border" />
            <p>
              <strong>Ejercicio 2.</strong> Calcula 3/4 − 1/8.
            </p>
            <div aria-hidden className="h-10 rounded-control border border-dashed border-border" />
          </div>
        </article>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ul aria-label="Qué ha cambiado" className="flex flex-wrap gap-2">
          {CHANGES.map((c) => (
            <li key={c} className="rounded-full border border-border bg-surface px-3 py-1 text-sm">
              {c}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">Ejemplo ilustrativo preparado por nosotros. No son datos reales.</p>
      </div>
    </section>
  );
}
