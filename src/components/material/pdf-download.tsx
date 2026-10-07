"use client";

import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { fetchAdaptationPdf } from "@/lib/render/print/download";

type State = { kind: "idle" } | { kind: "generating" } | { kind: "started"; filename: string } | { kind: "error"; message: string };

/** "Descargar PDF": the sheet as the student sees it, generated now. One request at a time (a second click while it runs does nothing). */
export function PdfDownload({ adaptationId }: { adaptationId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const running = useRef(false);

  async function download() {
    if (running.current) return;
    running.current = true;
    setState({ kind: "generating" });
    try {
      const result = await fetchAdaptationPdf(adaptationId);
      if (!result.ok) {
        setState({ kind: "error", message: result.message });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      // Chromium reads the link's `download` name after the click returns: the link and its object URL are released later.
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
      setState({ kind: "started", filename: result.filename });
    } finally {
      running.current = false;
    }
  }

  const generating = state.kind === "generating";
  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={download} disabled={generating} aria-disabled={generating}>
        {generating ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Download aria-hidden className="size-4" />}
        {generating ? "Preparando el PDF…" : "Descargar PDF"}
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {generating ? "Estamos preparando el PDF de la ficha. Puede tardar unos segundos." : state.kind === "started" ? `Descarga iniciada: ${state.filename}` : ""}
      </p>
      {state.kind === "error" ? (
        <Alert tone="danger" title="No se ha podido descargar el PDF.">
          {state.message} Puedes volver a intentarlo.
        </Alert>
      ) : null}
    </div>
  );
}
