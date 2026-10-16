"use client";

import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export interface OriginalFile {
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  original_name: string | null;
}

function PageImage({ src, name, page, onRetry }: { src: string; name: string; page: number; onRetry: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // The private raster may finish before React hydrates; its load event then predates our handler.
    const frame = requestAnimationFrame(() => {
      if (img.current?.complete) setState(img.current.naturalWidth > 0 ? "ready" : "error");
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <>
      <p role="status" className="p-3 text-sm text-muted-foreground">{state === "loading" ? `Cargando página ${page}…` : state === "ready" ? `Página ${page} visible` : ""}</p>
      {state === "error" ? (
        <Alert tone="warning" title="No hemos podido mostrar esta página.">
          <p>Puedes reintentar o abrir el original en otra pestaña.</p>
          <Button variant="secondary" className="mt-3" onClick={onRetry}><RotateCcw aria-hidden className="size-4" />Reintentar página</Button>
        </Alert>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin authorized raster; no public URL or image proxy
        <img ref={img} src={src} alt={`Vista previa de ${name}, página ${page}`} className="original-page" onLoad={() => setState("ready")} onError={() => setState("error")} />
      )}
    </>
  );
}

/** One original page at a time, using the existing private raster route. Zoom never changes paper geometry or PDF bytes. */
export function OriginalDocument({ materialId, file }: { materialId: string; file: OriginalFile }) {
  const uid = useId();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const count = file.mime_type.startsWith("image/") ? 1 : file.page_count;
  const name = file.original_name ?? "tu material";
  const fileUrl = `/api/materials/${materialId}/file`;
  function goTo(next: number) {
    setPage(next);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }
  return (
    <section aria-label="Documento original" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Original</h2>
          <p className="break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">{name} · {Math.max(1, Math.round(file.size_bytes / 1024)).toLocaleString("es-ES")} KB</p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">Sin modificar</span>
      </div>
      <ActionBar label="Herramientas del original" className="original-tools">
        {count && count > 1 ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Página anterior" disabled={page <= 1} onClick={() => goTo(page - 1)}><ChevronLeft aria-hidden className="size-4" /></Button>
            <label htmlFor={`${uid}-page`} className="sr-only">Página del original</label>
            <select id={`${uid}-page`} value={page} onChange={(e) => goTo(Number(e.target.value))} className="min-h-11 rounded-control border border-control-border bg-surface px-2 text-sm">
              {Array.from({ length: count }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} de {count}</option>)}
            </select>
            <Button size="sm" variant="ghost" aria-label="Página siguiente" disabled={page >= count} onClick={() => goTo(page + 1)}><ChevronRight aria-hidden className="size-4" /></Button>
          </div>
        ) : <span className="px-2 text-sm">Página 1{count === 1 ? " de 1" : " · total sin confirmar"}</span>}
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Reducir original" disabled={zoom <= 50} onClick={() => setZoom(zoom - 25)}><Minus aria-hidden className="size-4" /></Button>
          <output aria-label="Zoom del original" className="min-w-12 text-center text-sm tabular-nums">{zoom} %</output>
          <Button size="sm" variant="ghost" aria-label="Ampliar original" disabled={zoom >= 200} onClick={() => setZoom(zoom + 25)}><Plus aria-hidden className="size-4" /></Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setZoom(100); viewport.current?.scrollTo({ left: 0 }); }}>Ajustar al ancho</Button>
      </ActionBar>
      <div ref={viewport} role="region" tabIndex={0} aria-label="Página del original, desplazable" className="original-viewport">
        <div className="original-scale" style={{ width: `${zoom}%` }}>
          <PageImage key={`${materialId}:${page}:${attempt}`} src={`/api/materials/${materialId}/pages/${page}${attempt ? `?intento=${attempt}` : ""}`} name={name} page={page} onRetry={() => setAttempt(attempt + 1)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">Abrir original en otra pestaña</a>
        <a href={`${fileUrl}?download=1`} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">Descargar original</a>
      </div>
      <p className="text-xs text-muted-foreground">Vista de la página original. Para seleccionar texto o leer con más detalle, abre el archivo.</p>
    </section>
  );
}
