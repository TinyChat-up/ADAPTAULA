import { BookOpen, Captions, Check, Compass, Eye, Images, Leaf, ListChecks, MessageCircle, PenLine, Route, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { STARTING_POINTS, type StartingPointId } from "@/lib/profiles/starting-points";
import { cn } from "@/lib/utils/cn";

const ICONS = { book: BookOpen, captions: Captions, compass: Compass, eye: Eye, images: Images, leaf: Leaf, list: ListChecks, message: MessageCircle, pen: PenLine, route: Route, math: Sigma };

export function StartingPointCards({ selected, onSelect, onAdd, onReplace }: { selected: readonly StartingPointId[]; onSelect: (id: StartingPointId) => void; onAdd: () => void; onReplace: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Elige una o varias tarjetas y pulsa «Añadir estos apoyos». Podrás personalizarlos después.</p>
      <p className="text-xs text-muted-foreground">Desmarcar no elimina ajustes guardados. Para reemplazarlos, confirma «Sustituir configuración».</p>
      <fieldset className="min-w-0"><legend className="sr-only">Áreas de apoyo para combinar</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {STARTING_POINTS.map((point) => {
            const Icon = ICONS[point.icon], checked = selected.includes(point.id);
            return <label key={point.id} className={cn("relative flex cursor-pointer gap-3 rounded-card border bg-surface p-4 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary motion-reduce:transition-none", checked ? "border-primary bg-primary-soft" : "border-border hover:border-control-border")}>
              <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => onSelect(point.id)} aria-label={point.title} />
              <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
              <span className="min-w-0 space-y-1.5 [overflow-wrap:anywhere]"><span className="block pr-5 text-sm font-semibold">{point.title}</span><span className="block text-sm text-muted-foreground">{point.description}</span><span className="block text-xs text-muted-foreground">En clase: {point.example}</span></span>
              {checked ? <Check aria-hidden className="absolute right-3 top-4 size-4 text-primary" /> : null}
            </label>;
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onAdd} disabled={!selected.length}>Añadir estos apoyos</Button>
        <ConfirmDialog triggerLabel="Sustituir configuración" title="¿Sustituir los apoyos actuales?" description="Se sustituirán los apoyos, límites y permisos por los puntos de partida seleccionados. Las fortalezas y barreras se conservan. Puedes deshacer este cambio antes de guardar." confirmLabel="Sí, sustituir apoyos" confirmVariant="primary" pending={!selected.length} onConfirm={onReplace} />
        <span role="status" className="text-xs text-muted-foreground">{selected.length ? `${selected.length} áreas seleccionadas` : "Ninguna área seleccionada"}</span>
      </div>
    </div>
  );
}
