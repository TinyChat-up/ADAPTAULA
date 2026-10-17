"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export function PrivacyControls({ deletionStatus, deletionAvailable }: { deletionStatus: string | null; deletionAvailable: boolean }) {
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [requestStatus, setRequestStatus] = useState(deletionStatus);

  async function download() {
    setExportBusy(true); setExportMessage("");
    try {
      const response = await fetch("/api/account/export", { method: "POST", credentials: "same-origin" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? "No hemos podido preparar la copia.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `adaptaula-datos-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportMessage("Copia preparada y descargada. Guárdala en un lugar privado.");
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Error al descargar la copia."); }
    finally { setExportBusy(false); }
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setDeleteBusy(true); setDeleteMessage("");
    try {
      const response = await fetch("/api/account/deletion-request", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ password: values.get("password"), confirmation: values.get("confirmation") }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? "No hemos podido registrar la solicitud.");
      }
      const result = await response.json();
      form.reset();
      setRequestStatus(result.status);
      setDeleteMessage("Solicitud registrada. Tu cuenta y tus documentos siguen disponibles mientras se tramita.");
    } catch (error) { setDeleteMessage(error instanceof Error ? error.message : "Error al registrar la solicitud."); }
    finally { setDeleteBusy(false); }
  }

  return <div className="space-y-8">
    <div className="space-y-3">
      <h3 className="font-semibold">Descargar una copia de mis datos</h3>
      <p className="text-sm text-muted-foreground">Descarga un JSON con tus datos de cuenta, perfiles funcionales, materiales y adaptaciones de tus espacios personales donde eres la única persona. Incluye originales de hasta 2 MB en total; los mayores puedes descargarlos por separado desde su ficha en Materiales. El contenido de espacios compartidos queda fuera.</p>
      <Button type="button" variant="secondary" onClick={download} disabled={exportBusy}>{exportBusy ? "Preparando copia…" : "Descargar mis datos"}</Button>
      <p role="status" className="text-sm text-muted-foreground">{exportMessage}</p>
    </div>
    <div className="space-y-3 border-t border-border pt-6">
      <h3 className="font-semibold">Solicitar eliminación de cuenta</h3>
      <p className="text-sm text-muted-foreground">La solicitud queda registrada para revisión manual de tus espacios, documentos y obligaciones de conservación. No borra inmediatamente tu cuenta ni los documentos de otras personas. Puedes seguir accediendo mientras esté pendiente y consultar aquí su estado.</p>
      {!deletionAvailable ? <p role="status" className="text-sm font-medium">La solicitud de eliminación todavía no está disponible en este entorno.</p> :
        requestStatus ? <p role="status" className="text-sm font-medium">{
          requestStatus === "completed" ? "Solicitud marcada como completada." :
            requestStatus === "blocked" ? "Solicitud bloqueada; requiere revisión manual." :
              requestStatus === "reviewing" ? "Solicitud en revisión." : "Solicitud de eliminación pendiente."
        }</p> :
        <form onSubmit={requestDeletion} className="max-w-sm space-y-3">
          <label className="block text-sm font-medium" htmlFor="delete-confirmation">Escribe ELIMINAR MI CUENTA</label>
          <input id="delete-confirmation" name="confirmation" required autoComplete="off" className="w-full rounded-lg border border-border bg-background p-3 text-foreground" />
          <label className="block text-sm font-medium" htmlFor="delete-password">Contraseña actual</label>
          <input id="delete-password" name="password" type="password" required autoComplete="current-password" className="w-full rounded-lg border border-border bg-background p-3 text-foreground" />
          <Button type="submit" variant="secondary" disabled={deleteBusy}>{deleteBusy ? "Registrando…" : "Solicitar eliminación"}</Button>
        </form>}
      <p role="status" className="text-sm text-muted-foreground">{deleteMessage}</p>
    </div>
  </div>;
}
