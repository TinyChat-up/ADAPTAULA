"use client";

import { Copy, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";

type ActionResult = { ok: false; message: string } | undefined;

export function ProfileActions({
  duplicate,
  remove,
}: {
  duplicate: () => Promise<ActionResult>;
  remove: () => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) => () => {
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
        <Button variant="secondary" onClick={run(duplicate)} disabled={pending}>
          <Copy aria-hidden className="size-4" />
          Duplicar
        </Button>
        <ConfirmDialog
          triggerLabel="Eliminar"
          triggerIcon={<Trash2 aria-hidden className="size-4" />}
          title="¿Eliminar este perfil?"
          description="Se borrará de forma definitiva. Las adaptaciones que ya hayas creado con él no se eliminan."
          confirmLabel="Eliminar perfil"
          pending={pending}
          onConfirm={run(remove)}
        />
      </div>
    </div>
  );
}
