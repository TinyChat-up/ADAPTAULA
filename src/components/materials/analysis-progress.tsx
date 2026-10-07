"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/layout";
import { createRunDispatcher } from "@/lib/jobs/run-dispatcher";
import { cn } from "@/lib/utils/cn";

interface StatusPayload {
  status: string;
  step: string | null;
}

/** Steps map to what the server really does; there are no timers and no invented estimates. */
const STEPS = [
  { key: "received", label: "Archivo recibido" },
  { key: "analyzing", label: "Leyendo el contenido e identificando las actividades" },
  { key: "validating", label: "Revisando la estructura" },
  { key: "saving", label: "Preparando el material" },
] as const;

type StepState = "done" | "active" | "pending";

export function stepStates(status: string, step: string | null): StepState[] {
  if (status === "analyzed") return ["done", "done", "done", "done"];
  const order = { analyzing: 1, validating: 2, saving: 3 } as const;
  const current = status === "analyzing" ? (order[step as keyof typeof order] ?? 1) : 0;
  return STEPS.map((_, index) => {
    if (index === 0) return "done";
    if (status === "queued" || status === "uploaded") return "pending";
    return index < current ? "done" : index === current ? "active" : "pending";
  });
}

export function AnalysisProgress({ materialId, initialStatus }: { materialId: string; initialStatus: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<StatusPayload>({ status: initialStatus, step: null });
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = (status: string) => status === "analyzed" || status === "failed";

    // The analysis runs now, in its own awaited request; polling only observes it (and re-asks if the job is left waiting).
    const runner = createRunDispatcher<StatusPayload>({
      run: async () => {
        const response = await fetch(`/api/materials/${materialId}/analysis/run`, { method: "POST", cache: "no-store" });
        return response.ok ? ((await response.json()) as StatusPayload) : null;
      },
      onResult: (next) => {
        setPayload(next);
        if (settled(next.status)) router.refresh();
      },
    });
    runner.kick(true);

    async function poll() {
      try {
        const response = await fetch(`/api/materials/${materialId}/status`, { cache: "no-store" });
        if (!response.ok) throw new Error("status");
        const next = (await response.json()) as StatusPayload;
        if (cancelled) return;
        setOffline(false);
        setPayload(next);
        if (settled(next.status)) {
          router.refresh();
          return;
        }
        if (next.status === "queued" || next.status === "analyzing") runner.kick();
      } catch {
        if (!cancelled) setOffline(true);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }

    timer = setTimeout(poll, 800);
    return () => {
      cancelled = true;
      runner.stop();
      clearTimeout(timer);
    };
  }, [materialId, router]);

  const states = stepStates(payload.status, payload.step);
  const waiting = payload.status === "queued" || payload.status === "uploaded";

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Estamos preparando tu material</h2>
        <p className="text-muted-foreground">
          Puedes seguir usando Adaptaula mientras terminamos.{" "}
          <Link href="/app/materiales" className="font-medium text-primary underline underline-offset-2">
            Ir a Materiales
          </Link>
        </p>
      </div>
      <ol className="space-y-3" aria-label="Pasos del análisis">
        {STEPS.map((step, index) => {
          const state = states[index]!;
          return (
            <li key={step.key} aria-current={state === "active" ? "step" : undefined} className="flex items-center gap-3">
              {state === "done" ? (
                <Check aria-hidden className="size-5 shrink-0 text-success" />
              ) : state === "active" ? (
                <Loader2 aria-hidden className="size-5 shrink-0 text-primary motion-safe:animate-spin" />
              ) : (
                <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground/50" />
              )}
              <span className={cn(state === "pending" && "text-muted-foreground", state === "active" && "font-medium")}>
                {step.label}
                <span className="sr-only">{state === "done" ? " (hecho)" : state === "active" ? " (en curso)" : " (pendiente)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" className="text-sm text-muted-foreground">
        {offline ? "Parece que has perdido la conexión. Seguimos intentándolo…" : waiting ? "Estamos empezando el análisis de tu material…" : ""}
      </p>
    </Card>
  );
}
