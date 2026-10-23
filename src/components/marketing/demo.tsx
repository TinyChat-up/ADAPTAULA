"use client";

import { useState } from "react";
import { BRAND_SYMBOL_SRC } from "@/components/ui/logo";
import { cn } from "@/lib/utils/cn";

const ROWS = [["Conejo", "Plantas", "Pradera"], ["León", "Carne", "Sabana"], ["Gorrión", "Semillas", "Bosque"]] as const;
const OPTIONS = ["A) Carne", "B) Plantas", "C) Semillas"] as const;
const QUESTION = "Según la tabla, ¿qué alimentación corresponde a «Conejo»? Elige una opción.";
type View = "original" | "adaptada" | "comparar" | "editor";
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "original", label: "Original" }, { id: "adaptada", label: "Adaptación" },
  { id: "comparar", label: "Comparar" }, { id: "editor", label: "Revisión" },
];

function SamplePaper({ adapted, selected = false }: { adapted: boolean; selected?: boolean }) {
  return (
    <article aria-label={adapted ? "Ficha adaptada de demostración" : "Ficha original de demostración"} className={cn("sample-paper", adapted ? "sample-paper--adapted" : "sample-paper--original", selected && "outline outline-2 outline-offset-2 outline-primary")}>
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <p className="text-[0.625rem] uppercase tracking-wider">Ciencias · 4.º de Primaria</p>
        {/* Only the adapted sheet carries the mark, as the real ones do: the original is the teacher's own. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static vector brand mark */}
        {adapted ? <img src={BRAND_SYMBOL_SRC} alt="" width={830} height={713} className="h-4 w-auto" /> : null}
      </div>
      <h3>Animales y alimentación</h3>
      <p className="text-[0.6875rem]">Nombre: __________________</p>
      <table aria-label={`Animales: ${adapted ? "adaptación" : "original"}`}>
        <thead><tr>{["Animal", "Alimentación", "Hábitat"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{ROWS.map((r) => <tr key={r[0]}>{r.map((v, i) => i === 0 ? <th key={v} scope="row">{v}</th> : <td key={v}>{v}</td>)}</tr>)}</tbody>
      </table>
      {adapted && <div className="my-3 border-l-2 border-brand-navy bg-primary-soft px-3 py-2 text-[0.6875rem]">Apoyo para leer la tabla · Sigue la fila del animal desde la primera columna.</div>}
      <p className={adapted ? "font-semibold" : ""}>{QUESTION}</p>
      {adapted ? <ul className="sample-options">{OPTIONS.map((o) => <li key={o}><span aria-hidden className="sample-circle" />{o}</li>)}</ul> : <p className="mt-3">{OPTIONS.join(" · ")}</p>}
      {adapted && <p className="mt-5 border-b border-[#9aabb8] pb-1 text-[0.6875rem]">Mi respuesta: __________________</p>}
      <p className="mt-auto flex justify-between border-t border-border pt-2 text-[0.625rem] text-muted-foreground"><span>Lectura de tablas</span><span>1 / 1</span></p>
    </article>
  );
}

/** Public, local-only sample. It uses no user document, API or editor state. */
export function Demo() {
  const [view, setView] = useState<View>("adaptada");
  const [compareSide, setCompareSide] = useState<"original" | "adaptada">("original");
  const showBoth = view === "comparar";
  return (
    <figure id="demostracion" aria-label="Demostración de una ficha" className="w-full min-w-0 scroll-mt-28">
      <div className="rounded-[1.5rem] border border-border bg-surface-muted p-3 shadow-card sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div><p className="eyebrow text-primary">Vista de ejemplo</p><p className="text-sm text-muted-foreground">Ficha sintética · Ciencias · 4.º de Primaria</p></div>
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium">Demostración</span>
        </div>
        <div role="tablist" aria-label="Vista de la demostración" className="mb-5 flex max-w-full gap-1 overflow-x-auto rounded-control border border-border bg-surface p-1">
          {VIEWS.map(({ id, label }) => <button key={id} id={`demo-tab-${id}`} type="button" role="tab" aria-selected={view === id} aria-controls="demo-panel" onClick={() => setView(id)} className={cn("min-h-11 shrink-0 rounded-control px-3 text-sm font-medium transition-colors", view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-primary-soft hover:text-foreground")}>{label}</button>)}
        </div>
        <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${view}`} className="min-w-0">
          {showBoth && <div className="mb-4 flex gap-2 sm:hidden" aria-label="Lado de la comparación">
            {(["original", "adaptada"] as const).map((side) => <button key={side} type="button" aria-pressed={compareSide === side} onClick={() => setCompareSide(side)} className={cn("min-h-11 flex-1 rounded-control border px-3 text-sm font-medium", compareSide === side ? "border-primary bg-primary-soft" : "border-border bg-surface")}>{side === "original" ? "Original" : "Adaptación"}</button>)}
          </div>}
          <div className={cn("mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-5", showBoth && "sm:grid-cols-2", view === "editor" && "lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)]")}>
            {(view === "original" || (showBoth && compareSide === "original")) && <div className={cn("min-w-0", showBoth && "sm:hidden")}><p className="mb-2 text-sm font-semibold">Original</p><SamplePaper adapted={false} /></div>}
            {showBoth && <div className="hidden sm:block"><p className="mb-2 text-sm font-semibold">Original</p><SamplePaper adapted={false} /></div>}
            {(view === "adaptada" || view === "editor" || (showBoth && compareSide === "adaptada")) && <div className={cn("min-w-0", showBoth && "sm:hidden")}><p className="mb-2 text-sm font-semibold">{view === "editor" ? "Borrador de muestra" : "Adaptación de muestra"}</p><SamplePaper adapted selected={view === "editor"} /></div>}
            {showBoth && <div className="hidden sm:block"><p className="mb-2 text-sm font-semibold">Adaptación de muestra</p><SamplePaper adapted /> </div>}
            {view === "editor" && <aside aria-label="Ejemplo del inspector" className="self-start rounded-card border border-border bg-surface p-5 text-sm">
              <p className="eyebrow text-primary">Aspecto del editor de la ficha</p>
              <h3 className="mt-3 text-lg font-semibold">Actividad seleccionada</h3>
              <p className="mt-2 text-muted-foreground">En una adaptación real, aquí puedes revisar el enunciado permitido, la presentación y el espacio para responder. Los cambios requieren guardado antes de descargar el PDF.</p>
              <p className="mt-4 border-t border-border pt-4 text-muted-foreground">Figuras, tablas y opciones permanecen protegidas. El docente comprueba cualquier cambio de contenido.</p>
            </aside>}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 border-l-2 border-primary pl-3 text-sm leading-relaxed text-muted-foreground"><strong className="font-medium text-foreground">Demostración preparada por nosotros.</strong> La misma tabla, pregunta y opciones; cambia su presentación. Esta muestra es estática, no una adaptación generada durante tu visita ni una edición funcional.</figcaption>
    </figure>
  );
}
