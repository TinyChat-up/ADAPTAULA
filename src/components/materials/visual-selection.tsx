"use client";

import { useRef, useState, type PointerEvent } from "react";
import { boundsFromCorners, toNormalized, type NormalizedBounds } from "@/lib/materials/visuals/geometry";

const pct = (n: number) => `${(n * 100).toFixed(4)}%`;

/**
 * The page image with a draggable rectangle. Coordinates are read relative to the image's own box at the moment of the event,
 * so they are page coordinates whatever the zoom, scroll or screen size. Pointer events cover mouse, pen and touch.
 */
export function SelectionSurface({
  src,
  alt,
  zoom,
  bounds,
  onChange,
  onLoad,
}: {
  src: string;
  alt: string;
  zoom: number;
  bounds: NormalizedBounds | null;
  onChange: (b: NormalizedBounds) => void;
  onLoad: (size: { width: number; height: number }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const point = (e: PointerEvent<HTMLDivElement>) => toNormalized(e.clientX, e.clientY, box.current!.getBoundingClientRect());
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) onChange(boundsFromCorners(start.current, point(e)));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) onChange(boundsFromCorners(start.current, point(e)));
    start.current = null;
  };

  if (failed) return <p className="rounded-control border border-border p-4 text-sm">No hemos podido mostrar esta página. Prueba con otra página o vuelve más tarde.</p>;
  return (
    <div className="max-h-[75vh] overflow-auto rounded-control border border-border bg-background" data-testid="selection-scroll" role="region" aria-label="Página del original (se puede desplazar)" tabIndex={0}>
      <div ref={box} className="relative select-none" style={{ width: `${zoom * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authorised, server-rendered page; next/image cannot proxy it */}
        <img src={src} alt={alt} draggable={false} className="block h-auto w-full" onLoad={(e) => onLoad({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
        <div className="absolute inset-0 cursor-crosshair" style={{ touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} data-testid="selection-overlay" aria-hidden />
        {bounds ? (
          <div className="pointer-events-none absolute border-2 border-primary bg-primary/10 outline outline-1 outline-white" style={{ left: pct(bounds.x), top: pct(bounds.y), width: pct(bounds.w), height: pct(bounds.h) }} data-testid="selection-box" />
        ) : null}
      </div>
    </div>
  );
}

/** What the crop will look like, drawn from the same page image (a preview only: the real crop is produced on the server). */
export function CropPreview({ src, bounds, pageSize }: { src: string; bounds: NormalizedBounds; pageSize: { width: number; height: number } }) {
  const ratio = (bounds.w * pageSize.width) / (bounds.h * pageSize.height);
  const posX = bounds.w < 1 ? (bounds.x / (1 - bounds.w)) * 100 : 0;
  const posY = bounds.h < 1 ? (bounds.y / (1 - bounds.h)) * 100 : 0;
  return (
    <div
      role="img"
      aria-label="Vista previa del recorte"
      className="w-full max-w-sm border border-border bg-white bg-no-repeat"
      style={{ aspectRatio: String(ratio), backgroundImage: `url("${src}")`, backgroundSize: `${100 / bounds.w}% ${100 / bounds.h}%`, backgroundPosition: `${posX}% ${posY}%` }}
    />
  );
}
