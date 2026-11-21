import { BookOpen, Captions, Check, Compass, Eye, Images, Leaf, ListChecks, MessageCircle, PenLine, Route, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { STARTING_POINTS, type StartingPointId } from "@/lib/profiles/starting-points";
import { cn } from "@/lib/utils/cn";

const ICONS = { book: BookOpen, captions: Captions, compass: Compass, eye: Eye, images: Images, leaf: Leaf, list: ListChecks, message: MessageCircle, pen: PenLine, route: Route, math: Sigma };

const FEATURED: ReadonlySet<StartingPointId> = new Set(["visual-understanding", "reading", "language", "attention", "response"]);

type StartingPointCardsProps = { selected: readonly StartingPointId[] } & (
  | { onQuickAdd: (id: StartingPointId) => void }
  | { onSelect: (id: StartingPointId) => void; onAdd: () => void; onReplace: () => void }
);

export function StartingPointCards(props: StartingPointCardsProps) {
  const { selected } = props;
  const quick = "onQuickAdd" in props;
  const cards = (points: typeof STARTING_POINTS[number][]) => points.map((point) => {
    const Icon = ICONS[point.icon];
    const checked = selected.includes(point.id);
    if (quick) {
      return (
        <button
          key={point.id}
          type="button"
          aria-disabled={checked}
          aria-label={checked ? `Apoyo añadido de ${point.title}` : `Añadir apoyo de ${point.title}`}
          className={cn("flex min-h-11 min-w-0 items-start gap-3 rounded-card border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", checked ? "border-primary bg-primary-soft" : "cursor-pointer border-border bg-surface hover:border-control-border")}
          onClick={() => { if (!checked) props.onQuickAdd(point.id); }}
        >
          <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-semibold">{point.title}</span>
            <span className="block text-sm text-muted-foreground">{point.example}</span>
            {checked ? <span className="inline-flex items-center gap-1 text-sm font-medium text-primary"><Check aria-hidden className="size-4" />Añadido</span> : null}
          </span>
        </button>
      );
    }
    return (
      <label key={point.id} className={cn("relative flex cursor-pointer gap-3 rounded-card border bg-surface p-4 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary motion-reduce:transition-none", checked ? "border-primary bg-primary-soft" : "border-border hover:border-control-border")}>
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => props.onSelect(point.id)} aria-label={point.title} />
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <span className="min-w-0 space-y-1.5 [overflow-wrap:anywhere]">
          <span className="block pr-5 text-sm font-semibold">{point.title}</span>
          <span className="block text-sm text-muted-foreground">{point.description}</span>
          <span className="block text-xs text-muted-foreground">En clase: {point.example}</span>
        </span>
        {checked ? <Check aria-hidden className="absolute right-3 top-4 size-4 text-primary" /> : null}
      </label>
    );
  });

  return (
    <div className="space-y-4">
      {quick ? <p className="text-sm text-muted-foreground">Pulsa un apoyo para añadirlo al perfil.</p> : (
        <>
          <p className="text-sm text-muted-foreground">Elige una o varias tarjetas y pulsa «Añadir estos apoyos». Podrás personalizarlos después.</p>
          <p className="text-xs text-muted-foreground">Desmarcar conserva los ajustes guardados. Para reemplazarlos, confirma «Sustituir configuración».</p>
        </>
      )}
      <fieldset className="min-w-0"><legend className="sr-only">Áreas de apoyo para combinar</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards(STARTING_POINTS.filter((point) => FEATURED.has(point.id)))}
        </div>
      </fieldset>
      <details className="rounded-card border border-border p-4">
        <summary className="min-h-9 cursor-pointer font-medium">Ver más propuestas de apoyo</summary>
        <fieldset className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
          <legend className="sr-only">Otras áreas de apoyo</legend>
          {cards(STARTING_POINTS.filter((point) => !FEATURED.has(point.id)))}
        </fieldset>
      </details>
      {quick ? null : <div className="flex flex-wrap items-center gap-3">
        <Button onClick={props.onAdd} disabled={!selected.length}>Añadir estos apoyos</Button>
        <ConfirmDialog triggerLabel="Sustituir configuración" title="¿Sustituir los apoyos actuales?" description="Se sustituirán los apoyos, límites y permisos por los puntos de partida seleccionados. Las fortalezas y barreras se conservan. Puedes deshacer este cambio antes de guardar." confirmLabel="Sí, sustituir apoyos" confirmVariant="primary" pending={!selected.length} onConfirm={props.onReplace} />
        <span role="status" className="text-xs text-muted-foreground">{selected.length ? `${selected.length} áreas seleccionadas` : "Ninguna área seleccionada"}</span>
      </div>}
    </div>
  );
}
