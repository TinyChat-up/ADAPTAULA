"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * «Añadir recurso» and «Continuar sin esta imagen» for ONE visual a decision asked for. Both act on the same adaptation and its
 * delivered version: nothing is regenerated, no new adaptation, no quota. The server validates the image on its bytes; this form
 * only collects it. Errors stay next to the field (`aria-describedby`), never only in a toast.
 */
export function ResourceActions({ adaptationId, decisionId, canOmit, hasResource }: { adaptationId: string; decisionId: string; canOmit: boolean; hasResource: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"upload" | "omit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/adaptations/${adaptationId}/resources/${decisionId}`;

  async function send(body: BodyInit, json: boolean, kind: "upload" | "omit") {
    setPending(kind);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST", body, ...(json ? { headers: { "content-type": "application/json" } } : {}) });
      const answer = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !answer?.ok) {
        setError(answer?.message ?? "No hemos podido guardar el cambio. Inténtalo de nuevo.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("No hemos podido guardar el cambio. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      setPending(null);
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Elige una imagen.");
      return;
    }
    if (data.get("rights") !== "on") {
      setError("Confirma que puedes usar esta imagen en tu clase.");
      return;
    }
    void send(data, false, "upload");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={open ? "secondary" : "primary"} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${uid}-form`} disabled={pending !== null}>
          <ImagePlus aria-hidden className="size-4" />
          {hasResource ? "Cambiar recurso" : "Añadir recurso"}
        </Button>
        {canOmit ? (
          <ConfirmDialog
            triggerLabel="Continuar sin esta imagen"
            title="¿Continuar sin esta imagen?"
            description="La actividad original no la incluía, así que se puede resolver sin ella. La ficha se imprimirá sin la imagen y la decisión quedará registrada. Podrás añadirla más tarde."
            confirmLabel="Continuar sin ella"
            confirmVariant="primary"
            pending={pending === "omit"}
            onConfirm={() => void send(JSON.stringify({ action: "omit" }), true, "omit")}
          />
        ) : null}
      </div>
      {open ? (
        <form id={`${uid}-form`} onSubmit={upload} className="space-y-3 rounded-card border border-border p-3" aria-describedby={error ? `${uid}-error` : undefined}>
          <div className="space-y-1">
            <label htmlFor={`${uid}-file`} className="text-sm font-medium">
              Imagen (PNG, JPG o WebP, hasta 8 MB)
            </label>
            <input id={`${uid}-file`} name="file" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm" aria-describedby={`${uid}-hint${error ? ` ${uid}-error` : ""}`} />
            <p id={`${uid}-hint`} className="text-xs text-muted-foreground">
              Se guarda solo en esta ficha, sin los datos ocultos del archivo. No subas fotos ni datos del alumnado.
            </p>
          </div>
          <label className="flex min-h-6 items-start gap-2 text-sm">
            <input type="checkbox" name="rights" className="mt-1 size-4" />
            <span>Puedo usar esta imagen en mi clase (es mía o tiene una licencia que lo permite).</span>
          </label>
          <Button type="submit" size="sm" disabled={pending !== null}>
            {pending === "upload" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
            Guardar imagen
          </Button>
        </form>
      ) : null}
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
