"use client";

import { FileText, ImageIcon, Info, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { ACCEPT_ATTRIBUTE, FILE_TYPES, FORMATS_LABEL, SOURCE_BUCKET, type MaterialLimits } from "@/lib/materials/config";
import { describeValidationError, validateDeclaredFile } from "@/lib/materials/file-validation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const MIB = 1024 * 1024;

function formatSize(bytes: number): string {
  return bytes >= MIB ? `${(bytes / MIB).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Phase = "idle" | "preparing" | "uploading" | "checking";
const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  preparing: "Preparando la subida…",
  uploading: "Subiendo el archivo…",
  checking: "Comprobando el archivo…",
};

export function MaterialUploader({ limits }: { limits: MaterialLimits }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<keyof typeof FILE_TYPES | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const previewUrl = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  const busy = phase !== "idle";

  function accept(files: FileList | null) {
    setNotice(null);
    const first = files?.[0];
    if (!first) return;
    if (files.length > 1) setNotice("Solo puedes analizar un archivo cada vez. Hemos cogido el primero.");
    const result = validateDeclaredFile({ name: first.name, size: first.size, mime: first.type }, limits);
    if (!result.ok) {
      setFile(null);
      setFormat(null);
      setError(describeValidationError(result.code, limits));
      return;
    }
    setError(null);
    setFile(first);
    setFormat(result.format);
  }

  function clear() {
    setFile(null);
    setFormat(null);
    setError(null);
    setNotice(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function analyze() {
    if (!file || !format) return;
    setError(null);
    setPhase("preparing");
    try {
      const init = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, mime: file.type }),
      });
      const initBody = (await init.json().catch(() => null)) as { materialId: string; path: string; token: string; error?: { message: string } } | null;
      if (!init.ok || !initBody?.materialId) {
        setError(initBody?.error?.message ?? "No hemos podido preparar la subida. Inténtalo de nuevo.");
        return setPhase("idle");
      }

      setPhase("uploading");
      const { error: uploadError } = await createClient()
        .storage.from(SOURCE_BUCKET)
        .uploadToSignedUrl(initBody.path, initBody.token, file, { contentType: FILE_TYPES[format].mime });
      if (uploadError) {
        setError("No hemos podido subir el archivo. Comprueba tu conexión e inténtalo de nuevo.");
        return setPhase("idle");
      }

      setPhase("checking");
      const done = await fetch(`/api/uploads/${initBody.materialId}/complete`, { method: "POST" });
      if (!done.ok) {
        const body = (await done.json().catch(() => null)) as { error?: { message: string } } | null;
        setError(body?.error?.message ?? "No hemos podido comprobar el archivo. Inténtalo de nuevo.");
        return setPhase("idle");
      }
      router.push(`/app/materiales/${initBody.materialId}`);
    } catch {
      setError("No hemos podido completar la subida. Comprueba tu conexión e inténtalo de nuevo.");
      setPhase("idle");
    }
  }

  const Icon = file && FILE_TYPES[format ?? "pdf"].kind === "image" ? ImageIcon : FileText;

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {file ? (
        <div className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-card">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, nothing to optimize
            <img src={previewUrl} alt="Vista previa del archivo seleccionado" className="size-16 shrink-0 rounded-control border border-border object-cover" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
              <Icon aria-hidden className="size-7" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground">
              {FILE_TYPES[format ?? "pdf"].label} · {formatSize(file.size)}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            Cambiar
          </Button>
          <Button variant="ghost" size="sm" onClick={clear} disabled={busy} aria-label="Quitar el archivo">
            <X aria-hidden className="size-4" />
            Quitar
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border bg-surface",
          )}
        >
          <UploadCloud aria-hidden className="size-10 text-primary" />
          <p className="text-xl font-semibold">{dragging ? "Suelta tu ficha aquí" : "Arrastra tu ficha aquí"}</p>
          <p className="text-muted-foreground">
            o{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="font-medium text-primary underline underline-offset-2">
              selecciona un archivo
            </button>
          </p>
          <p className="text-sm text-muted-foreground">
            Formatos admitidos: {FORMATS_LABEL}. PDF de hasta {Math.floor(limits.maxPdfBytes / MIB)} MB y {limits.maxPages} páginas; imágenes de hasta{" "}
            {Math.floor(limits.maxImageBytes / MIB)} MB.
          </p>
        </div>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only" aria-label="Seleccionar un archivo" tabIndex={-1} onChange={(e) => accept(e.target.files)} />

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        Evita incluir información personal innecesaria del alumnado en los archivos que subas.
      </p>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Button size="lg" onClick={analyze} disabled={!file || busy}>
          {busy ? "Un momento…" : "Analizar material"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {phase === "idle" ? "" : PHASE_TEXT[phase]}
        </p>
      </div>
    </div>
  );
}
