"use client";

import { FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FILE_TYPES, FORMATS_LABEL, type MaterialLimits } from "@/lib/materials/config";
import { cn } from "@/lib/utils/cn";

export function UploadSurface({ file, format, previewUrl, busy, limits, select, clear, accept }: {
  file: File | null;
  format: keyof typeof FILE_TYPES | null;
  previewUrl: string | null;
  busy: boolean;
  limits: MaterialLimits;
  select: () => void;
  clear: () => void;
  accept: (files: FileList) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return (
    <div
      data-testid="upload-surface"
      onDragEnter={(e) => { e.preventDefault(); depth.current++; if (!busy) setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
      onDragLeave={(e) => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setDragging(false); if (!busy) accept(e.dataTransfer.files); }}
      className={cn("rounded-panel border border-dashed p-5 transition-colors sm:p-8", dragging ? "border-primary bg-primary-soft" : "border-control-border bg-surface")}
    >
      {file ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL, revoked when selection changes
              <img src={previewUrl} alt="Vista previa del archivo seleccionado" className="size-16 shrink-0 rounded-control border border-border object-contain" />
            ) : <FileText aria-hidden strokeWidth={1.25} className="size-12 shrink-0 text-primary" />}
            <div className="min-w-0">
              <p className="break-words font-semibold [overflow-wrap:anywhere]">{file.name}</p>
              <p className="text-sm text-muted-foreground">{FILE_TYPES[format ?? "pdf"].label} · {file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <p role="status" className="text-sm text-muted-foreground">{dragging ? "Suelta para cambiar el archivo" : busy ? "Estamos recibiendo tu documento" : "Archivo seleccionado. Listo para subir."}</p>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" onClick={select} disabled={busy}>Cambiar</Button>
              <Button variant="ghost" size="sm" onClick={clear} disabled={busy}><X aria-hidden className="size-4" />Quitar</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="relative flex h-24 w-18 items-center justify-center rounded-control border border-border bg-background shadow-sm"><Upload aria-hidden className="size-7 text-primary" strokeWidth={1.5} /></div>
          <div>
            <h2 className="text-xl font-semibold">{dragging ? "Suelta tu ficha aquí" : "Arrastra tu ficha aquí"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">El punto de partida es el material que ya utilizas.</p>
          </div>
          <Button variant="secondary" onClick={select}>Seleccionar un archivo</Button>
          <p className="max-w-md text-xs text-muted-foreground">{FORMATS_LABEL}. PDF de hasta {Math.floor(limits.maxPdfBytes / (1024 * 1024))} MB y {limits.maxPages} páginas; imágenes de hasta {Math.floor(limits.maxImageBytes / (1024 * 1024))} MB.</p>
        </div>
      )}
    </div>
  );
}
