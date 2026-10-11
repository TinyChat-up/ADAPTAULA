"use client";

import { Loader2, ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * «Buscar en el original»: asks the server to locate the sheet's figures automatically (same adaptation, no unit, never over a
 * figure the teacher located). What it could not find stays listed below, with «Localizar en el original» as before.
 */
export function AutoLocateButton({ adaptationId }: { adaptationId: string }) {
  const router = useRouter();
  const statusId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/adaptations/${adaptationId}/visuals/auto`, { method: "POST" });
      const answer = (await response.json().catch(() => null)) as { ok?: boolean; found?: number; missing?: number; message?: string } | null;
      if (!response.ok || !answer?.ok) {
        setMessage(answer?.message ?? "No hemos podido buscar las imágenes ahora. Puedes localizarlas tú en el original.");
        return;
      }
      setMessage(answer.missing ? "Algunas imágenes no se han podido localizar con seguridad: localízalas tú en el original." : "Imágenes localizadas en el original.");
      router.refresh();
    } catch {
      setMessage("No hemos podido buscar las imágenes. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="secondary" onClick={run} disabled={pending} aria-describedby={message ? statusId : undefined}>
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <ScanSearch aria-hidden className="size-4" />}
        Buscar en el original
      </Button>
      {message ? (
        <p id={statusId} role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
