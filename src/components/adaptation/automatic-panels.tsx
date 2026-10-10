"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { AUTOMATIC_STOP_COPY, needLabels } from "@/lib/adaptation/presentation/copy";
import { warningLines } from "@/lib/adaptation/presentation/view-model";
import { BackLinks, WarningsList } from "./status-panels";

/**
 * «Hacer magia» could not finish the sheet by itself (phase `automatic_incomplete`). The teacher reads what happened in plain words;
 * editing is OFFERED («Revisar y editar»), never opened for them. Nothing here was delivered or charged. Read-only members see the
 * state without the action.
 */
export function AutomaticIncompletePanel({
  dto,
  materialId,
  busy,
  canWrite,
  onEdit,
  cancel,
}: {
  dto: AdaptationStatusDto;
  materialId: string;
  busy: boolean;
  canWrite: boolean;
  /** Only when the teacher clicks: opens the plan to edit (reopening a blocked sheet first). */
  onEdit: () => void;
  cancel: ReactNode;
}) {
  const reason = dto.automaticStop?.reason ?? "quality";
  const copy = AUTOMATIC_STOP_COPY[reason];
  const needs = needLabels(dto.automaticStop?.needs ?? []);
  const lines = reason === "quality" ? warningLines({ review: dto.review, execution: null }) : [];
  const canEdit = canWrite && dto.nextAction === "review_plan";
  return (
    <Card className="space-y-4 border-warning/40">
      <Alert tone="warning" title={AUTOMATIC_STOP_COPY.title}>
        <p>{copy.body}</p>
      </Alert>
      {needs.length > 0 ? <p className="text-sm">Necesidad sin atender automáticamente: {needs.join(" · ")}.</p> : null}
      {lines.length > 0 ? <WarningsList lines={lines} /> : null}
      {reason === "quality" && !dto.regenerationAvailable ? (
        <p className="text-sm">Ya se han preparado tres versiones de esta ficha y ninguna ha superado la comprobación de calidad. Si quieres intentarlo de nuevo, crea una adaptación nueva desde el material.</p>
      ) : null}
      <p className="text-sm text-muted-foreground">{copy.hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button variant="secondary" onClick={onEdit} disabled={busy}>
            {busy ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
            {AUTOMATIC_STOP_COPY.edit}
          </Button>
        ) : null}
        {canWrite && dto.canCancel ? cancel : null}
      </div>
      {!canWrite ? <p className="text-sm text-muted-foreground">Tienes acceso de solo lectura en este espacio de trabajo.</p> : null}
      <BackLinks materialId={materialId} />
    </Card>
  );
}

