"use client";

import { useEffect, useId, useRef } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Button, LinkButton, buttonStyles } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export type PdfPreviewState =
  | { kind: "preparing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; url: string; filename: string; pageCount: number; nativeViewer: boolean };

/** Presentation of a prepared binary only. The browser owns zoom/page controls; CLARO never repaginates here. */
export function PdfPreviewDialog({ state, versionLabel, editHref, inEditor, onClose, onRetry, onDownload }: {
  state: PdfPreviewState; versionLabel: string; editHref?: string | undefined; inEditor: boolean;
  onClose: () => void; onRetry: () => void; onDownload: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-description`}
    className="fixed inset-0 m-auto h-[100dvh] max-h-[100dvh] w-full max-w-none overflow-auto border border-border bg-background p-0 text-foreground shadow-dialog backdrop:bg-foreground/40 sm:h-[94dvh] sm:max-w-[96vw] sm:rounded-panel">
    <div className="flex min-h-full flex-col">
      <header className="surface-glass sticky top-0 z-10 space-y-3 border-b border-border p-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${uid}-title`} className="text-lg font-semibold">Vista previa de impresión</h2>
            <p className="text-sm text-muted-foreground">{versionLabel}</p>
          </div>
          <Button variant="ghost" aria-label="Cerrar vista previa de impresión" onClick={onClose} autoFocus><X aria-hidden className="size-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {state.kind === "ready" ? <>
            <p role="status" className="mr-auto text-sm font-medium">{state.pageCount} {state.pageCount === 1 ? "hoja A4" : "hojas A4"} · PDF definitivo</p>
            <a className={buttonStyles({})} href={state.url} download={state.filename} onClick={onDownload}><Download aria-hidden className="size-4" />Descargar PDF</a>
          </> : null}
          {editHref ? <LinkButton variant="secondary" href={editHref}>Volver a editar</LinkButton> : <Button variant="secondary" onClick={onClose}>{inEditor ? "Volver a editar" : "Volver a la ficha"}</Button>}
        </div>
        <p id={`${uid}-description`} className="text-sm text-muted-foreground">PDF real para el alumnado. La descarga conserva este mismo archivo. Revisa todas las hojas antes de imprimir.</p>
      </header>
      {state.kind === "preparing" ? <div role="status" aria-live="polite" className="m-auto flex max-w-md items-center gap-3 p-8">
        <Loader2 aria-hidden className="size-5 shrink-0 motion-safe:animate-spin" /><p>Preparando el PDF definitivo… Comprobamos sus recursos y sus hojas reales.</p>
      </div> : state.kind === "error" ? <div className="m-auto max-w-xl space-y-4 p-6"><Alert tone="danger" title="No se ha podido preparar la vista previa.">{state.message}</Alert><Button onClick={onRetry}>Volver a intentarlo</Button></div> : <main className="flex flex-1 flex-col gap-3 p-3 sm:p-5" aria-label="PDF definitivo">
        {state.nativeViewer ? <>
          <p className="text-sm text-muted-foreground">Usa los controles de tu visor para recorrer las {state.pageCount} hojas y ampliar. Si solo muestra una hoja o no carga, descarga el PDF para revisarlo en tu lector.</p>
          <iframe title={`PDF definitivo · ${versionLabel}`} src={`${state.url}#view=FitH`} className="min-h-[65dvh] w-full flex-1 rounded-control border border-border bg-white" />
        </> : <Alert title="Tu navegador no ofrece un visor PDF integrado.">Descarga el archivo con el botón «Descargar PDF» y ábrelo en tu lector para revisar sus {state.pageCount} hojas. No necesitas volver a prepararlo.</Alert>}
        <p className="text-xs text-muted-foreground">El zoom y la navegación dependen del visor del navegador. Esta comprobación de formato no valida la corrección pedagógica.</p>
      </main>}
    </div>
  </dialog>;
}
