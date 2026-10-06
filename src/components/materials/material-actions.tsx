"use client";

import { RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";

type Result = { ok: true } | { ok: false; message: string } | undefined;

export function MaterialActions({
  retry,
  remove,
  retryLabel,
}: {
  retry?: () => Promise<Result>;
  remove: () => Promise<Result>;
  retryLabel?: string;
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

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {retry ? (
          <Button variant="secondary" onClick={run(retry)} disabled={pending}>
            <RefreshCw aria-hidden className="size-4" />
            {retryLabel ?? "Reintentar"}
          </Button>
        ) : null}
        <ConfirmDialog
          triggerLabel="Eliminar"
          triggerIcon={<Trash2 aria-hidden className="size-4" />}
          title="¿Eliminar este material?"
          description="Se borrarán el archivo y su análisis de forma definitiva."
          confirmLabel="Eliminar material"
          pending={pending}
          onConfirm={run(remove)}
        />
      </div>
    </div>
  );
}
