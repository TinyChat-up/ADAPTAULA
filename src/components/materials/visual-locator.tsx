"use client";

import { Loader2, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { NormalizedBoundsSchema, type NormalizedBounds } from "@/lib/materials/visuals/geometry";
import type { VisualActionResult } from "@/lib/materials/visuals/public";
import { CropPreview, SelectionSurface } from "./visual-selection";

const ZOOMS = [1, 1.5, 2] as const;

async function send(materialId: string, visualId: string, body: Record<string, unknown>): Promise<VisualActionResult> {
  const response = await fetch(`/api/materials/${materialId}/visuals/${visualId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as VisualActionResult | null;
  return data ?? { ok: false, message: "No hemos podido guardar la selección. Inténtalo de nuevo." };
}
const FIELDS = [
  ["x", "Desde la izquierda"],
  ["y", "Desde arriba"],
  ["w", "Ancho"],
  ["h", "Alto"],
] as const;

/**
 * "Señala dónde está el visual en el original": the person selects a rectangle on a page; the server produces the crop. Nothing
 * here uploads an image or decides what the crop contains.
 */
export function VisualLocator({
  materialId,
  visualId,
  pageCount,
  initialPage,
  suggestedPage,
  returnTo,
  canRetry,
}: {
  materialId: string;
  visualId: string;
  pageCount: number;
  initialPage: number;
  suggestedPage: number;
  returnTo: string;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [bounds, setBounds] = useState<NormalizedBounds | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VisualActionResult | null>(null);
  const lock = useRef(false);

  const src = `/api/materials/${materialId}/pages/${page}`;
  const valid = bounds ? NormalizedBoundsSchema.safeParse(bounds) : null;
  const goTo = (next: number) => {
    setPage(next);
    setBounds(null);
    setPageSize(null);
    setResult(null);
  };

  async function run(command: () => Promise<VisualActionResult>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setResult(null);
    try {
      const outcome = await command();
      setResult(outcome);
      if (outcome.ok && outcome.status === "ready") {
        router.push(returnTo);
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "No hemos podido guardar la selección. Comprueba la conexión e inténtalo de nuevo." });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  const setField = (key: keyof NormalizedBounds, value: string) => {
    const n = Number(value) / 100;
    if (!Number.isFinite(n)) return;
    setBounds({ ...(bounds ?? { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }), [key]: Math.round(n * 1e6) / 1e6 });
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground sm:hidden" role="note">
        Para seleccionar con precisión, abre esta herramienta en una pantalla más grande.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Páginas del original" className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1 || pending} onClick={() => goTo(page - 1)}>
            Anterior
          </Button>
          <span className="text-sm" aria-live="polite">
            Página {page} de {pageCount}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pageCount || pending} onClick={() => goTo(page + 1)}>
            Siguiente
          </Button>
        </nav>
        <div className="flex items-center gap-2" role="group" aria-label="Zoom">
          <Button variant="secondary" size="sm" aria-label="Alejar" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}>
            <Minus aria-hidden className="size-4" />
          </Button>
          <span className="w-12 text-center text-sm">{Math.round(zoom * 100)} %</span>
          <Button variant="secondary" size="sm" aria-label="Acercar" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)}>
            <Plus aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      {page !== suggestedPage ? <p className="text-sm text-muted-foreground">El análisis situaba este recurso en la página {suggestedPage}. Puedes elegir otra si no está ahí.</p> : null}

      <SelectionSurface key={page} src={src} alt={`Página ${page} del original`} zoom={zoom} bounds={bounds} onChange={setBounds} onLoad={setPageSize} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ajuste fino de la selección (en % de la página)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FIELDS.map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="block">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                inputMode="decimal"
                value={bounds ? Math.round(bounds[key] * 1000) / 10 : ""}
                onChange={(e) => setField(key, e.target.value)}
                className="block min-h-11 w-full rounded-control border border-border bg-surface px-3"
              />
            </label>
          ))}
        </div>
      </fieldset>

      {bounds && valid?.success && pageSize ? (
        <section className="space-y-2" aria-label="Vista previa">
          <h2 className="text-sm font-semibold">Así se recortará</h2>
          <CropPreview src={src} bounds={bounds} pageSize={pageSize} />
        </section>
      ) : null}
      <p role="status" className="text-sm text-muted-foreground">
        {!bounds ? "Arrastra sobre la página para rodear la imagen." : valid && !valid.success ? "La selección es demasiado pequeña o se sale de la página." : "Selección lista."}
      </p>

      {result && !(result.ok && result.status === "ready") ? (
        <Alert tone="warning" title={result.ok ? result.message : result.message}>
          {result.ok || canRetry ? (
            <Button variant="secondary" size="sm" className="mt-2" disabled={pending} onClick={() => run(() => send(materialId, visualId, { action: "retry" }))}>
              Reintentar el recorte
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={!valid?.success || pending} onClick={() => run(() => send(materialId, visualId, { action: "locate", page, bounds }))}>
          {pending ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          Confirmar selección
        </Button>
      </div>
    </div>
  );
}
