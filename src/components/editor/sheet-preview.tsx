"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { MaterialSheet } from "@/components/material/sheet";
import type { ActivitySelection } from "@/components/material/nodes";
import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import type { RenderModel } from "@/lib/render/model";

/** Screen scale/navigation only. The complete model still determines headers, order and PDF pagination. */
export function SheetPreview({ model, selection, page: controlledPage, onPageChange }: {
  model: RenderModel; selection?: ActivitySelection | undefined;
  page?: number; onPageChange?: (page: number) => void;
}) {
  const uid = useId();
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [localPage, setLocalPage] = useState(1);
  const page = Math.min(controlledPage ?? localPage, Math.max(1, model.pages.length));
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // Hidden mobile tabs have zero width: preserve their last useful scale.
      if (entry && entry.contentRect.width > 0) setScale(Math.max(.1, entry.contentRect.width / (210 * 96 / 25.4)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function goTo(value: number) {
    setLocalPage(value); onPageChange?.(value);
    stage.current?.scrollTo({ top: 0, left: 0 });
  }
  return <div className="sheet-preview min-w-0 space-y-3">
    <ActionBar label="Herramientas de la adaptación" className="original-tools">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" aria-label="Página anterior de la adaptación" disabled={page <= 1} onClick={() => goTo(page - 1)}><ChevronLeft aria-hidden className="size-4" /></Button>
        <label htmlFor={uid} className="sr-only">Página de la adaptación</label>
        <select id={uid} value={page} onChange={(e) => goTo(Number(e.target.value))} className="min-h-11 rounded-control border border-control-border bg-surface px-2 text-sm">
          {model.pages.map((p) => <option key={p.number} value={p.number}>{p.number} de {model.pages.length}</option>)}
        </select>
        <Button variant="ghost" size="sm" aria-label="Página siguiente de la adaptación" disabled={page >= model.pages.length} onClick={() => goTo(page + 1)}><ChevronRight aria-hidden className="size-4" /></Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" aria-label="Reducir adaptación" disabled={zoom <= 50} onClick={() => setZoom(zoom - 25)}><Minus aria-hidden className="size-4" /></Button>
        <output aria-label="Zoom de la adaptación" className="min-w-12 text-center text-sm tabular-nums">{zoom} %</output>
        <Button variant="ghost" size="sm" aria-label="Ampliar adaptación" disabled={zoom >= 200} onClick={() => setZoom(zoom + 25)}><Plus aria-hidden className="size-4" /></Button>
      </div>
      <Button variant="ghost" size="sm" onClick={() => { setZoom(100); stage.current?.scrollTo({ left: 0 }); }}>Ajustar al ancho</Button>
    </ActionBar>
    <div ref={stage} className="sheet-viewport" role="region" aria-label="Hoja A4, desplazable" tabIndex={0}>
      <p role="status" className="p-3 text-sm text-muted-foreground">Página {page} de la vista CLARO</p>
      <div style={{ zoom: scale * zoom / 100 }}><MaterialSheet model={model} visiblePage={page} selection={selection} /></div>
    </div>
    <p className="text-xs text-muted-foreground">Páginas de la vista CLARO. Usa «Vista previa de impresión» para comprobar las hojas definitivas de la revisión guardada.</p>
  </div>;
}
