import { AlertTriangle } from "lucide-react";
import { targetLabel } from "@/lib/adaptation/presentation/copy";
import type { MethodNote } from "@/lib/adaptation/v22/notes";

/** Advisory notes of the V2.2 checks on the generated sheet (ADR-047). Not a verdict: the teacher's own review stays the last word. */
export function MethodNotes({ notes, targets }: { notes: MethodNote[]; targets: Record<string, string> }) {
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="method-notes-title" className="space-y-2 rounded-card border border-warning/40 bg-warning/5 p-4 text-sm">
      <h2 id="method-notes-title" className="flex items-center gap-2 text-base font-semibold">
        <AlertTriangle aria-hidden className="size-4 text-warning" />
        Conviene que compruebes estos puntos
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        {notes.map((n, i) => (
          <li key={`${n.check}-${i}`}>
            <span className="font-medium">{n.label}</span>
            {n.targets.length > 0 ? ` (${n.targets.map((t) => targetLabel(t, targets)).join(", ")})` : ""}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">Son avisos orientativos: no bloquean la ficha ni sustituyen tu revisión de las pistas, de lo que se evalúa y de la autonomía del alumnado.</p>
    </section>
  );
}
