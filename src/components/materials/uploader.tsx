"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { ACCEPT_ATTRIBUTE, FILE_TYPES, SOURCE_BUCKET, type MaterialLimits } from "@/lib/materials/config";
import { describeValidationError, validateDeclaredFile } from "@/lib/materials/file-validation";
import { createClient } from "@/lib/supabase/client";
import { UploadSurface } from "./upload-surface";

type Phase = "idle" | "preparing" | "uploading" | "checking";
const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  preparing: "Preparando la subida…",
  uploading: "Subiendo el archivo…",
  checking: "Comprobando el archivo…",
};

export function MaterialUploader({ limits }: { limits: MaterialLimits }) {
  const router = useRouter();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<keyof typeof FILE_TYPES | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  const previewUrl = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  const busy = phase !== "idle";

  function accept(files: FileList | null) {
    if (busy) return;
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
    requestAnimationFrame(() => submitRef.current?.focus());
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

  return (
    <section aria-label="Subir una ficha" className="space-y-5">
      <div id={errorId}>{error ? <Alert tone="danger">{error}</Alert> : null}</div>
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      <UploadSurface file={file} format={format} previewUrl={previewUrl} busy={busy} limits={limits}
        select={() => inputRef.current?.click()} clear={clear} accept={accept} />
      <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} disabled={busy} className="sr-only" aria-label="Seleccionar un archivo" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} tabIndex={-1} onChange={(e) => accept(e.target.files)} />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        Evita incluir información personal innecesaria del alumnado en los archivos que subas.
      </p>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button ref={submitRef} size="lg" onClick={analyze} disabled={!file || busy}>
          {busy ? "Un momento…" : "Analizar material"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">{phase === "idle" ? "Después, elegirás los apoyos." : PHASE_TEXT[phase]}</p>
      </div>
    </section>
  );
}
