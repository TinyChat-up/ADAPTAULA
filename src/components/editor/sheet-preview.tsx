"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialSheet } from "@/components/material/sheet";
import { Button } from "@/components/ui/button";
import type { RenderModel } from "@/lib/render/model";

/** Only scales the screen's shared sheet. Physical dimensions and PDF pagination remain CLARO's. */
export function SheetPreview({ model }: { model: RenderModel }) {
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, Math.max(.2, (entry.contentRect.width) / (210 * 96 / 25.4))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="space-y-2">
    <Button className="ms-chrome" variant="ghost" size="sm" onClick={() => setFit(!fit)}>{fit ? "Ver tamaño real" : "Ajustar a pantalla"}</Button>
    <div ref={stage} className="ms-stage" role="region" aria-label="Hoja A4, desplazable" tabIndex={0}>
      <div style={{ zoom: fit ? scale : 1 }}><MaterialSheet model={model} /></div>
    </div>
  </div>;
}
