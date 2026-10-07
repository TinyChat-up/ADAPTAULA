"use client";

import { Check, Circle, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { PdfDownload } from "@/components/material/pdf-download";
import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { DEFERRED_NOTE, STATUS_COPY } from "@/lib/adaptation/presentation/copy";
import { failureView, readyTitle, stageStates, warningLines, workingCopy } from "@/lib/adaptation/presentation/view-model";
import { formatDateTime } from "@/lib/format/date";
import { cn } from "@/lib/utils/cn";

export function BackLinks({ materialId }: { materialId: string }) {
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <LinkButton href={`/app/materiales/${materialId}`} variant="secondary">
        Volver al material
      </LinkButton>
      <Link href="/app" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">
        Ir al inicio
      </Link>
    </div>
  );
}

export function CancelControl({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <ConfirmDialog
      triggerLabel="Cancelar adaptación"
      title="¿Cancelar esta adaptación?"
      description="Se detendrá esta adaptación. Si aún no se había entregado, no contará como una adaptación utilizada."
      confirmLabel="Sí, cancelar"
      pending={busy}
      onConfirm={onCancel}
    />
  );
}

function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold">{children}</h2>;
}

export function StartPanel({ busy, onStart, cancel, canCancel }: { busy: boolean; onStart: () => void; cancel: ReactNode; canCancel: boolean }) {
  return (
    <Card className="space-y-4">
      <PanelTitle>{STATUS_COPY.needsPlanning.title}</PanelTitle>
      <p className="text-muted-foreground">{STATUS_COPY.needsPlanning.body}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onStart} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          Preparar propuesta de adaptación
        </Button>
        {canCancel ? cancel : null}
      </div>
    </Card>
  );
}

export function WorkingPanel({ dto, offline, cancel }: { dto: AdaptationStatusDto; offline: boolean; cancel: ReactNode }) {
  const copy = workingCopy(dto.progress);
  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <PanelTitle>{copy.title}</PanelTitle>
        <p className="text-muted-foreground">{copy.body}</p>
        <p className="text-sm text-muted-foreground">Puedes seguir usando Adaptaula: la adaptación se guarda y podrás volver a esta página.</p>
      </div>
      <ol className="space-y-3" aria-label="Fases de la adaptación">
        {stageStates(dto.progress).map((stage) => (
          <li key={stage.key} aria-current={stage.state === "active" ? "step" : undefined} className="flex items-center gap-3">
            {stage.state === "done" ? (
              <Check aria-hidden className="size-5 shrink-0 text-success" />
            ) : stage.state === "active" ? (
              <Loader2 aria-hidden className="size-5 shrink-0 text-primary motion-safe:animate-spin" />
            ) : (
              <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn(stage.state === "pending" && "text-muted-foreground", stage.state === "active" && "font-medium")}>
              {stage.label}
              <span className="sr-only">{stage.state === "done" ? " (hecho)" : stage.state === "active" ? " (en curso)" : " (pendiente)"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {offline ? "Parece que has perdido la conexión. Seguimos intentándolo…" : copy.title}
      </p>
      {dto.canCancel ? cancel : null}
    </Card>
  );
}

export function GeneratePanel({ busy, onGenerate, cancel, canCancel, deferredCount }: { busy: boolean; onGenerate: () => void; cancel: ReactNode; canCancel: boolean; deferredCount: number }) {
  return (
    <Card className="space-y-4">
      <PanelTitle>{STATUS_COPY.needsGeneration.title}</PanelTitle>
      <p className="text-muted-foreground">{STATUS_COPY.needsGeneration.body}</p>
      {deferredCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {deferredCount === 1 ? "Hay un cambio aprobado que no se ve todavía en el material." : `Hay ${deferredCount} cambios aprobados que no se ven todavía en el material.`} {DEFERRED_NOTE}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onGenerate} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          Crear material adaptado
        </Button>
        {canCancel ? cancel : null}
      </div>
    </Card>
  );
}

export function WarningsList({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function ReadyPanel({ dto, materialId, info }: { dto: AdaptationStatusDto; materialId: string; info: { version: number; createdAt: string } | null }) {
  const copy = readyTitle(dto);
  const lines = warningLines(dto);
  const version = info?.version ?? dto.currentVersion;
  return (
    <Card className="space-y-4">
      <Alert tone={lines.length > 0 ? "warning" : "success"} title={copy.title}>
        <p>{copy.body}</p>
      </Alert>
      <p className="text-sm text-muted-foreground">
        {version ? `Versión ${version}` : null}
        {info ? ` · ${formatDateTime(info.createdAt)}` : null}
      </p>
      {lines.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold">Observaciones</h3>
          <WarningsList lines={lines} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-3 pt-1">
        <LinkButton href={`/app/adaptaciones/${dto.id}/vista`}>Ver la ficha</LinkButton>
        <PdfDownload adaptationId={dto.id} />
      </div>
      <BackLinks materialId={materialId} />
    </Card>
  );
}

export function BlockedPanel({ dto, materialId, busy, canWrite, onReopen }: { dto: AdaptationStatusDto; materialId: string; busy: boolean; canWrite: boolean; onReopen: () => void }) {
  const lines = warningLines({ review: dto.review, execution: null });
  return (
    <Card className="space-y-4 border-danger/40">
      <Alert tone="danger" title={STATUS_COPY.blocked.title}>
        <p>{STATUS_COPY.blocked.body}</p>
      </Alert>
      {lines.length > 0 ? <WarningsList lines={lines} /> : null}
      {canWrite && dto.nextAction === "review_plan" ? (
        <Button onClick={onReopen} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          Revisar la propuesta
        </Button>
      ) : null}
      <BackLinks materialId={materialId} />
    </Card>
  );
}

export function FailedPanel({ dto, materialId, busy, onRetry, cancel }: { dto: AdaptationStatusDto; materialId: string; busy: boolean; onRetry: (acknowledge: boolean) => void; cancel: ReactNode }) {
  const view = failureView(dto);
  return (
    <Card className="space-y-4 border-danger/40">
      <Alert tone={view.ambiguous ? "warning" : "danger"} title={view.ambiguous ? "No se pudo confirmar el resultado del último intento." : STATUS_COPY.failed.title}>
        <p>{view.ambiguous ? "Si lo intentas de nuevo, el proceso se repetirá desde ese paso." : view.message}</p>
      </Alert>
      <div className="flex flex-wrap items-center gap-3">
        {view.canRetry && view.ambiguous ? (
          <ConfirmDialog
            triggerLabel="Reintentar"
            title="¿Repetir el último paso?"
            description="Se repetirá el procesamiento de este paso. Úsalo solo si no ves el resultado esperado."
            confirmLabel="Sí, repetir"
            confirmVariant="primary"
            pending={busy}
            onConfirm={() => onRetry(true)}
          />
        ) : view.canRetry ? (
          <Button onClick={() => onRetry(false)} disabled={busy}>
            {busy ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
            Reintentar
          </Button>
        ) : null}
        {view.canCancel ? cancel : null}
      </div>
      <BackLinks materialId={materialId} />
    </Card>
  );
}

const READ_ONLY_COPY: Record<"start" | "generate" | "review", string> = {
  start: "Esta adaptación está creada pero todavía no se ha empezado.",
  review: "La propuesta de cambios está esperando la revisión de una persona con permiso de edición.",
  generate: "La propuesta está revisada; falta que una persona con permiso de edición cree la ficha.",
};

/** What a read-only member sees where a decision is needed: the state, no commands. */
export function ReadOnlyPanel({ screen, materialId }: { screen: "start" | "generate" | "review"; materialId: string }) {
  return (
    <Card className="space-y-3">
      <PanelTitle>{screen === "review" ? STATUS_COPY.awaitingReview.title : screen === "generate" ? STATUS_COPY.needsGeneration.title : "Pendiente de empezar"}</PanelTitle>
      <p className="text-muted-foreground">{READ_ONLY_COPY[screen]}</p>
      <p className="text-sm text-muted-foreground">Tienes acceso de solo lectura en este espacio de trabajo.</p>
      <BackLinks materialId={materialId} />
    </Card>
  );
}

export function CancelledPanel({ materialId }: { materialId: string }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <XCircle aria-hidden className="size-5 text-muted-foreground" />
        <PanelTitle>{STATUS_COPY.cancelled.title}</PanelTitle>
      </div>
      <p className="text-muted-foreground">{STATUS_COPY.cancelled.body}</p>
      <BackLinks materialId={materialId} />
    </Card>
  );
}
