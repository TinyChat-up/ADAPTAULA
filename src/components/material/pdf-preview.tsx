"use client";

import { useEffect, useRef, useState } from "react";
import { FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAdaptationPdf, PDF_GENERIC_ERROR } from "@/lib/render/pdf-download";
import { pdfObjectUrl } from "@/lib/render/pdf-object-url";
import { PdfPreviewDialog, type PdfPreviewState } from "./pdf-preview-dialog";

type Props = {
  adaptationId: string; baseVersion: number; draftRevision?: number; disabled?: boolean; editHref?: string | undefined; inEditor?: boolean;
};

export function PdfPreview(props: Props) {
  return <PdfPreviewSession key={`${props.adaptationId}:${props.baseVersion}:${props.draftRevision ?? "generated"}`} {...props} />;
}

function PdfPreviewSession({ adaptationId, baseVersion, draftRevision, disabled = false, editHref, inEditor = false }: Props) {
  const [state, setState] = useState<PdfPreviewState | null>(null);
  const running = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const file = useRef<ReturnType<typeof pdfObjectUrl> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  function dispose() {
    sequence.current++;
    controller.current?.abort(); controller.current = null;
    file.current?.release(); file.current = null;
    running.current = false;
  }
  useEffect(() => () => { dispose(); }, [adaptationId, baseVersion, draftRevision]);

  function close() {
    dispose(); setState(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  async function prepare() {
    if (running.current || disabled) return;
    dispose(); running.current = true;
    const current = sequence.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 75_000);
    setState({ kind: "preparing" });
    try {
      const result = await fetchAdaptationPdf(adaptationId, fetch, draftRevision, { signal: abort.signal, baseVersion });
      if (current !== sequence.current) return;
      if (!result.ok) { setState({ kind: "error", message: result.message }); return; }
      file.current = pdfObjectUrl(result.blob);
      setState({ kind: "ready", url: file.current.url, filename: result.filename, pageCount: result.pageCount, nativeViewer: navigator.pdfViewerEnabled === true });
    } catch {
      if (current === sequence.current) setState({ kind: "error", message: PDF_GENERIC_ERROR });
    } finally {
      clearTimeout(timeout);
      if (current === sequence.current) running.current = false;
    }
  }

  return <>
    <Button ref={trigger} variant="secondary" disabled={disabled || state !== null} aria-haspopup="dialog" onClick={prepare}><FileSearch aria-hidden className="size-4" />Vista previa de impresión</Button>
    {state ? <PdfPreviewDialog state={state} versionLabel={draftRevision === undefined ? "Adaptación generada" : `Borrador guardado · revisión ${draftRevision}`} editHref={editHref} inEditor={inEditor} onClose={close} onRetry={prepare} onDownload={() => file.current?.markDownloaded()} /> : null}
  </>;
}
