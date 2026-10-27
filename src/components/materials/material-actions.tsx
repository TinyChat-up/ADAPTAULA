"use client";

import { Archive, ArchiveRestore, RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";

type Result = { ok: true } | { ok: false; message: string } | undefined;

export interface DeletionImpact {
  adaptations: number;
  delivered: number;
  versions: number;
  images: number;
}

/**
 * The actions on a material, the everyday ones apart from the destructive one. Re-analysing an analysed material and deleting it
 * for good always ask first; withdrawing it from the library does not (it is reversible).
 */
export function MaterialActions({
  retry,
  retryLabel,
  retryConfirm,
  archive,
  restore,
  remove,
  purge,
}: {
  retry?: () => Promise<Result>;
  retryLabel?: string;
  /** When set, re-analysing asks first with this explanation (quota, adaptations kept). */
  retryConfirm?: string;
  archive?: () => Promise<Result>;
  restore?: () => Promise<Result>;
  /** Deleting a material without adaptations. */
  remove?: () => Promise<Result>;
  /** Deleting a material and everything made from it, after showing what goes with it. */
  purge?: { action: () => Promise<Result>; impact: DeletionImpact };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<Result>) => () => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok) setError(result.message);
    });
  };
  const everyday = Boolean(retry || archive || restore);

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {everyday ? (
        <div className="flex flex-wrap gap-2">
          {retry && retryConfirm ? (
            <ConfirmDialog
              triggerLabel={retryLabel ?? "Volver a analizar"}
              triggerIcon={<RefreshCw aria-hidden className="size-4" />}
              title="¿Volver a analizar este material?"
              description={retryConfirm}
              confirmLabel="Volver a analizar"
              confirmVariant="primary"
              pending={pending}
              onConfirm={run(retry)}
            />
          ) : retry ? (
            <Button variant="secondary" onClick={run(retry)} disabled={pending}>
              <RefreshCw aria-hidden className="size-4" />
              {retryLabel ?? "Reintentar"}
            </Button>
          ) : null}
          {archive ? (
            <Button variant="secondary" onClick={run(archive)} disabled={pending}>
              <Archive aria-hidden className="size-4" />
              Retirar de la biblioteca
            </Button>
          ) : null}
          {restore ? (
            <Button variant="secondary" onClick={run(restore)} disabled={pending}>
              <ArchiveRestore aria-hidden className="size-4" />
              Restaurar en la biblioteca
            </Button>
          ) : null}
        </div>
      ) : null}
      {purge && purge.impact.adaptations > 0 ? (
        <div className={everyday ? "border-t border-border pt-3" : undefined}>
          <ConfirmDialog
            triggerLabel="Eliminar definitivamente"
            triggerIcon={<Trash2 aria-hidden className="size-4" />}
            title="¿Eliminar definitivamente el material y sus adaptaciones?"
            description="Esta acción no se puede deshacer. Si solo quieres que deje de aparecer, retíralo de la biblioteca: así se conserva todo."
            details={<ImpactList impact={purge.impact} />}
            acknowledge={`Entiendo que se eliminarán también ${purge.impact.adaptations === 1 ? "su adaptación" : `sus ${purge.impact.adaptations} adaptaciones`} y que no se podrá recuperar.`}
            confirmLabel="Eliminar definitivamente"
            pending={pending}
            onConfirm={run(purge.action)}
          />
        </div>
      ) : purge || remove ? (
        <div className={everyday ? "border-t border-border pt-3" : undefined}>
          <ConfirmDialog
            triggerLabel={everyday ? "Eliminar definitivamente" : "Eliminar"}
            triggerIcon={<Trash2 aria-hidden className="size-4" />}
            title="¿Eliminar este material?"
            description="Se borrarán el archivo y su análisis de forma definitiva."
            confirmLabel="Eliminar material"
            pending={pending}
            onConfirm={run((purge?.action ?? remove)!)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ImpactList({ impact }: { impact: DeletionImpact }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>El archivo original y su análisis.</li>
      <li>
        {plural(impact.adaptations, "adaptación", "adaptaciones")}
        {impact.delivered > 0 ? ` (${plural(impact.delivered, "entregada", "entregadas")})` : ""}, con {plural(impact.versions, "versión", "versiones")} y su historial de revisión.
      </li>
      {impact.images > 0 ? <li>{plural(impact.images, "imagen generada", "imágenes generadas")} para esas fichas.</li> : null}
      <li>Los PDF de esas fichas dejarán de poder descargarse.</li>
      <li>Las adaptaciones y análisis ya consumidos siguen contando en tu plan: borrar no los devuelve.</li>
    </ul>
  );
}
