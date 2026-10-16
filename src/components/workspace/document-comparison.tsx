"use client";

import { useState, type ReactNode } from "react";
import { SheetPreview } from "@/components/editor/sheet-preview";
import { PdfDownload } from "@/components/material/pdf-download";
import { Button, LinkButton } from "@/components/ui/button";
import { SelectField } from "@/components/ui/fields";
import { Alert } from "@/components/ui/feedback";
import type { RenderModel } from "@/lib/render/model";

export interface ComparisonVersion { model: RenderModel; printable: boolean }
export function DocumentComparison({ adaptationId, original, generated, draft, draftError, canWrite, baseVersion }: {
  adaptationId: string; original: ReactNode; generated: ComparisonVersion;
  draft: (ComparisonVersion & { revision: number; contentChanged: boolean }) | null;
  draftError: boolean; canWrite: boolean; baseVersion: number;
}) {
  const [side, setSide] = useState<"original" | "adaptation">("adaptation");
  const [version, setVersion] = useState("generated");
  const saved = version === "draft" ? draft : null;
  const active = saved ?? generated;
  return <div className="comparison-workspace space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-full"><SelectField label="Versión de la adaptación" value={version} onChange={(e) => setVersion(e.target.value)}>
        <option value="generated">Generada · versión {baseVersion}</option>
        {draft ? <option value="draft">Borrador guardado · revisión {draft.revision}</option> : null}
      </SelectField></div>
      {canWrite ? <LinkButton variant="secondary" href={`/app/adaptaciones/${adaptationId}/editar`}>{draft ? "Continuar editando el borrador" : "Editar ficha"}</LinkButton> : null}
    </div>
    {draftError ? <Alert tone="warning" title="No se puede mostrar el borrador guardado.">La comparación muestra la ficha generada. Vuelve a cargar para intentarlo de nuevo.</Alert> : null}
    {saved?.contentChanged ? <Alert tone="warning">Este borrador incluye cambios de contenido del docente. Necesita comprobación pedagógica; no está validado automáticamente.</Alert> : null}
    <p className="text-sm text-muted-foreground">Cada documento tiene sus propias páginas. No se presupone una correspondencia entre ellas.</p>
    <div className="comparison-switch gap-2" role="group" aria-label="Documento que quieres ver">
      <Button variant={side === "original" ? "primary" : "secondary"} aria-pressed={side === "original"} onClick={() => setSide("original")}>Original</Button>
      <Button variant={side === "adaptation" ? "primary" : "secondary"} aria-pressed={side === "adaptation"} onClick={() => setSide("adaptation")}>Adaptación</Button>
    </div>
    <div className="comparison-grid">
      <div className="comparison-side min-w-0" data-active={side === "original"}>{original}</div>
      <section aria-label="Documento adaptado" className="comparison-side min-w-0 space-y-3" data-active={side === "adaptation"}>
        <div><h2 className="text-lg font-semibold">Adaptación</h2><p className="text-xs text-muted-foreground">{saved ? `Borrador guardado · revisión ${saved.revision}` : `Generada · versión ${baseVersion}`}</p></div>
        {active.printable ? <SheetPreview model={active.model} /> : <Alert tone="warning" title="Esta ficha todavía no se puede mostrar completa.">Revisa sus recursos en la vista docente.</Alert>}
        {active.printable ? <div className="space-y-2"><p className="text-sm font-medium">PDF: {saved ? `borrador guardado · revisión ${saved.revision}` : `adaptación generada · versión ${baseVersion}`}</p><PdfDownload key={saved?.revision ?? "generated"} adaptationId={adaptationId} {...(saved ? { draftRevision: saved.revision } : {})} /></div> : null}
      </section>
    </div>
  </div>;
}
