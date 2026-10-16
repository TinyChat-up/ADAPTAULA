"use client";

import { PanelRightClose, PanelRightOpen, ArrowRight } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Slots keep authorized data on the server. Hiding the inspector never unmounts forms or stops polling. */
export function DocumentWorkspace({ document, children, nextLabel = "Ver preparación" }: {
  document: ReactNode;
  children: ReactNode;
  nextLabel?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(true);
  function continueHere() {
    setOpen(true);
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-workspace-next]") ?? panel.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
    });
  }
  return (
    <section className="document-workspace" aria-label="Espacio de trabajo de la ficha">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="text-sm text-muted-foreground">Tu documento, siempre a mano</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
            {open ? <PanelRightClose aria-hidden className="size-4" /> : <PanelRightOpen aria-hidden className="size-4" />}
            {open ? "Ocultar panel" : "Mostrar panel"}
          </Button>
          <Button variant="secondary" size="sm" onClick={continueHere}>
            {nextLabel}<ArrowRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <div className="document-workspace-grid" data-panel-open={open}>
        <div className="document-workspace-paper">{document}</div>
        <aside id={id} ref={panel} hidden={!open} tabIndex={-1} aria-label="Preparación de la ficha" className="document-workspace-inspector">
          {children}
        </aside>
      </div>
    </section>
  );
}
