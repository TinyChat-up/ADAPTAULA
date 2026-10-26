import { BARRIERS, STRENGTHS, suggestedSupports } from "@/lib/profiles/learning-catalog";
import { DIMENSION_COPY } from "@/lib/profiles/copy";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import { Button } from "@/components/ui/button";
import type { LearningObservations } from "@/lib/schemas/learning-observations";

export function LearningObservationsPicker({ value, onChange, onAddSuggestions }: { value: LearningObservations; onChange: (next: LearningObservations) => void; onAddSuggestions: (keys: DimensionKey[]) => void }) {
  const suggestions = suggestedSupports(value.barriers);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Opcional. Marca solo lo que hayas observado. Dejarlo en blanco significa «no indicado», no que no tenga fortalezas o barreras.</p>
      <details className="rounded-card border border-border bg-surface p-5">
        <summary className="min-h-8 cursor-pointer font-semibold">Fortalezas · ¿Qué se le da bien?{value.strengths.length ? ` (${value.strengths.length})` : ""}</summary>
        <fieldset className="mt-4 grid gap-2"><legend className="sr-only">Fortalezas observadas</legend>
          {Object.entries(STRENGTHS).map(([key, label]) => {
            const id = key as keyof typeof STRENGTHS;
            return <label key={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control p-2 text-sm hover:bg-background"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={value.strengths.includes(id)} onChange={(e) => onChange({ ...value, strengths: e.target.checked ? [...value.strengths, id] : value.strengths.filter((x) => x !== id) })} /><span>{label}</span></label>;
          })}
        </fieldset>
      </details>
      <details className="rounded-card border border-border bg-surface p-5">
        <summary className="min-h-8 cursor-pointer font-semibold">Barreras · ¿Qué dificulta la tarea?{value.barriers.length ? ` (${value.barriers.length})` : ""}</summary>
        <p className="mt-3 text-sm text-muted-foreground">Son situaciones, no rasgos permanentes. No activan ajustes sin tu elección.</p>
        <fieldset className="mt-2 grid gap-2"><legend className="sr-only">Barreras observadas</legend>
          {Object.entries(BARRIERS).map(([key, item]) => {
            const id = key as keyof typeof BARRIERS;
            return <label key={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control p-2 text-sm hover:bg-background"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={value.barriers.includes(id)} onChange={(e) => onChange({ ...value, barriers: e.target.checked ? [...value.barriers, id] : value.barriers.filter((x) => x !== id) })} /><span>{item.label}</span></label>;
          })}
        </fieldset>
      </details>
      {suggestions.length > 0 ? <div className="space-y-3 rounded-card border border-border bg-surface p-5">
        <p className="text-sm font-medium">Sugerencias para estas situaciones · no se activan automáticamente</p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">{suggestions.map((key) => <li key={key}>{DIMENSION_COPY[key].control}</li>)}</ul>
        <Button variant="secondary" onClick={() => onAddSuggestions(suggestions)}>Añadir estas sugerencias</Button>
        <p className="text-xs text-muted-foreground">Punto de partida de frecuencia media. Conserva tus ajustes. Revisa la intensidad en «Personalizar más». No cambia el nivel curricular.</p>
      </div> : null}
    </div>
  );
}
