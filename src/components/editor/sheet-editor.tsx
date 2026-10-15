"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Undo2, Redo2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { PdfDownload } from "@/components/material/pdf-download";
import { applyEditorChanges, emptyChanges, type EditorChanges, type SavedDraft } from "@/lib/editor/changes";
import { historyOf, changeHistory, undoHistory, redoHistory } from "@/lib/editor/history";
import { sheetModel, type SheetInput } from "@/lib/render/sheet-model";
import { ActivityControls } from "./activity-controls";
import { AppearanceControls } from "./appearance-controls";
import { SheetPreview } from "./sheet-preview";

export function SheetEditor({ adaptationId, baseVersion, input, saved }: {
  adaptationId: string; baseVersion: number; input: SheetInput; saved: SavedDraft | null;
}) {
  const [history, setHistory] = useState(() => historyOf(saved?.changes ?? emptyChanges()));
  const [lastSaved, setLastSaved] = useState(saved);
  const [acknowledged, setAcknowledged] = useState(saved?.contentAcknowledged ?? false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activities = input.document.pages.flatMap((p) => p.blocks).filter((b) => b.type === "activity");
  const [selected, setSelected] = useState(activities[0]?.id ?? "");
  const changes = history.present;
  const dirty = JSON.stringify(changes) !== JSON.stringify(lastSaved?.changes ?? emptyChanges());
  const preview = useMemo(() => {
    try {
      const applied = applyEditorChanges(input.document, changes);
      return { ...sheetModel({ ...input, document: applied.document }, "student"), contentBlocks: applied.contentBlocks, valid: true, presentation: applied.document.presentation };
    } catch {
      return { ...sheetModel(input, "student"), contentBlocks: [], valid: false, presentation: { ...input.document.presentation, ...changes.presentation } };
    }
  }, [input, changes]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(value: EditorChanges) {
    setHistory((h) => changeHistory(h, value));
    setAcknowledged(false);
    setMessage(""); setError("");
  }

  async function save() {
    if (saving || !preview.valid) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/adaptations/${adaptationId}/draft`, { method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseVersion, revision: lastSaved?.revision ?? 0, changes, acknowledged }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error?.message ?? "No se ha podido guardar. Tus cambios siguen aquí."); return; }
      setLastSaved({ revision: body.revision, changes, contentAcknowledged: acknowledged });
      setMessage("Borrador guardado. La ficha generada sigue intacta.");
    } catch { setError("No hemos podido conectar. Tus cambios siguen aquí; vuelve a intentarlo."); }
    finally { setSaving(false); }
  }

  return <div className="min-w-0 space-y-6">
    <div className="ms-chrome space-y-3">
      <Link className="text-sm font-medium text-primary underline" href={`/app/adaptaciones/${adaptationId}/vista`}
        onClick={(e) => { if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardarlos?")) e.preventDefault(); }}>Ver ficha generada</Link>
      <PageHeader title="Editar ficha" description="Ajusta tu copia y comprueba cómo la verá el alumnado. El original se conserva." />
      <div className="flex flex-wrap items-center gap-2" aria-label="Acciones de edición">
        <Button variant="secondary" disabled={saving || !history.past.length} onClick={() => { setHistory(undoHistory); setAcknowledged(false); setMessage(""); }}> <Undo2 aria-hidden className="size-4" />Deshacer</Button>
        <Button variant="secondary" disabled={saving || !history.future.length} onClick={() => { setHistory(redoHistory); setAcknowledged(false); setMessage(""); }}> <Redo2 aria-hidden className="size-4" />Rehacer</Button>
        <Button disabled={saving || !dirty || !preview.valid || (preview.contentBlocks.length > 0 && !acknowledged)} onClick={save}><Save aria-hidden className="size-4" />{saving ? "Guardando…" : "Guardar borrador"}</Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{saving ? "Guardando tus cambios…" : message || (dirty ? "Tienes cambios sin guardar." : lastSaved ? `Borrador guardado · revisión ${lastSaved.revision}` : "Estás viendo la ficha generada. Aún no hay borrador.")}</p>
      {error ? <Alert tone="danger" title="No se ha guardado el borrador.">{error} <Link href={`/app/adaptaciones/${adaptationId}/editar`} className="underline" onClick={(e) => { if (!window.confirm("Recargar descartará los cambios sin guardar. ¿Continuar?")) e.preventDefault(); }}>Recargar borrador guardado</Link></Alert> : null}
      {!preview.valid ? <Alert tone="warning" title="Revisa el enunciado.">No puede quedar vacío. Mientras lo corriges, la vista muestra la ficha generada.</Alert> : null}
      {preview.contentBlocks.length ? <Alert tone="warning" title="Has cambiado contenido de la actividad.">
        <p>Comprueba números, unidades, relaciones y referencias a figuras. No añadas respuestas. Este borrador no tiene validación pedagógica automática.</p>
        <label className="mt-3 flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 size-5 shrink-0" disabled={saving} checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />Entiendo que debo comprobar estos cambios antes de usar la ficha.</label>
      </Alert> : null}
    </div>

    <div className="grid min-w-0 gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="ms-chrome min-w-0 space-y-6" aria-label="Ajustes de la ficha">
        <fieldset disabled={saving} className="space-y-6 rounded-card border border-border bg-surface p-5">
          <AppearanceControls presentation={preview.presentation} changes={changes} onChange={change} />
          <hr className="border-border" />
          <ActivityControls activities={activities} selected={selected} onSelect={setSelected} changes={changes} onChange={change} />
        </fieldset>
        <div className="space-y-3">
          <Button variant="ghost" disabled={saving || !lastSaved || !dirty} onClick={() => { change(lastSaved!.changes); setAcknowledged(lastSaved!.contentAcknowledged); }}>Recuperar último guardado</Button>
          <p className="text-sm text-muted-foreground">Se conserva cada revisión guardada. Recuperar no cambia la ficha generada.</p>
          {lastSaved ? <PdfDownload key={lastSaved.revision} adaptationId={adaptationId} draftRevision={lastSaved.revision} disabled={dirty || saving || !preview.valid || preview.validation.status === "not_renderable"} /> : null}
          <p className="text-sm text-muted-foreground">Guarda los cambios para descargar el PDF actualizado. Solo se imprime la ficha del alumnado.</p>
        </div>
      </aside>
      <section className="min-w-0 space-y-3" aria-label="Vista previa A4">
        <h2 className="ms-chrome font-semibold">Tu ficha · vista A4</h2>
        <p className="ms-chrome text-sm text-muted-foreground">La separación final en hojas se ajusta al descargar el PDF. Puedes ampliar la vista para leerla con detalle.</p>
        {preview.validation.status === "not_renderable" ? <Alert tone="warning" title="Falta completar la ficha.">Revisa sus recursos en la vista docente. El borrador no permite omitir una figura imprescindible.</Alert> :
          <SheetPreview model={preview.model} />}
      </section>
    </div>
  </div>;
}
