"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import type { PublicResult } from "@/lib/adaptation/orchestration/public";
import type { AdaptationPlanDto, EnqueuedDto, SubmitReviewDto } from "@/lib/adaptation/orchestration/service";
import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import type { AdaptationContextView } from "@/lib/adaptation/presentation/context";
import { actionErrorCopy, needLabels } from "@/lib/adaptation/presentation/copy";
import { createPoller, shouldPoll, type Poller } from "@/lib/adaptation/presentation/poller";
import { screenFor } from "@/lib/adaptation/presentation/view-model";
import { BlockedPanel, CancelControl, CancelledPanel, FailedPanel, GeneratePanel, ReadyPanel, StartPanel, WorkingPanel } from "./status-panels";
import { PlanReviewForm, type SubmitReview } from "./plan-review-form";

export interface AdaptationActions {
  start: () => Promise<PublicResult<EnqueuedDto>>;
  submit: SubmitReview;
  generate: () => Promise<PublicResult<EnqueuedDto>>;
  reopen: () => Promise<PublicResult<{ status: string }>>;
  retry: (options?: { acknowledgeAmbiguous?: boolean }) => Promise<PublicResult<EnqueuedDto>>;
  cancel: () => Promise<PublicResult<{ cancelled: boolean; status: string }>>;
}

interface Notice {
  tone: "danger" | "warning" | "info";
  text: string;
}

const MAX_NEEDS_SHOWN = 6;

/**
 * The whole adaptation lifecycle on one URL. The server renders the first state; this component keeps it fresh by polling the
 * status endpoint only while the pipeline works by itself, and shows what the DTO says (`nextAction`, `canRetry`, `canCancel`):
 * it never decides which transitions are allowed. Reloading rebuilds everything from the server.
 */
export function AdaptationView({
  initial,
  plan,
  context,
  readyInfo,
  actions,
}: {
  initial: AdaptationStatusDto;
  plan: AdaptationPlanDto | null;
  context: AdaptationContextView;
  readyInfo: { version: number; createdAt: string } | null;
  actions: AdaptationActions;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setStatus(initial);
  }
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SubmitReviewDto | null>(null);

  const statusRef = useRef(status);
  const pollerRef = useRef<Poller | null>(null);
  const lock = useRef(false);
  const id = initial.id;

  function adopt(next: AdaptationStatusDto) {
    const previous = statusRef.current;
    statusRef.current = next;
    setStatus(next);
    if (next.phase !== previous.phase || next.nextAction !== previous.nextAction || next.status !== previous.status) router.refresh();
  }

  useEffect(() => {
    const poller = createPoller({
      fetchStatus: async (signal) => {
        const response = await fetch(`/api/adaptations/${id}/status`, { cache: "no-store", signal });
        return response.ok ? ((await response.json()) as AdaptationStatusDto) : null;
      },
      onStatus: (next) => adopt(next),
      onConnection: (online) => setOffline(!online),
      isVisible: () => !document.hidden,
    });
    pollerRef.current = poller;
    if (shouldPoll(statusRef.current)) poller.start();
    const onVisible = () => {
      if (!document.hidden) poller.wake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      poller.stop();
    };
    // `adopt` only touches refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    statusRef.current = status;
    if (shouldPoll(status)) pollerRef.current?.start();
  }, [status]);

  async function refreshStatus() {
    try {
      const response = await fetch(`/api/adaptations/${id}/status`, { cache: "no-store" });
      if (response.ok) adopt((await response.json()) as AdaptationStatusDto);
    } catch {
      setOffline(true);
    }
    pollerRef.current?.start(true);
  }

  async function run<T>(command: () => Promise<PublicResult<T>>, after?: (data: T) => void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await command();
      if (!result.ok) {
        setNotice({ tone: result.code === "entitlement_unavailable" ? "info" : "warning", text: actionErrorCopy(result.code, result.message) });
        await refreshStatus();
      } else {
        after?.(result.data);
        await refreshStatus();
      }
    } catch {
      setNotice({ tone: "danger", text: "No hemos podido completar la acción. Comprueba la conexión e inténtalo de nuevo." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const cancel = <CancelControl busy={busy} onCancel={() => void run(actions.cancel)} />;
  const screen = screenFor(status);
  const deferredIds = saved?.deferredDecisions ?? status.execution?.deferredDecisions ?? [];
  const needs = plan ? needLabels(plan.decisions.flatMap((d) => d.needs)).slice(0, MAX_NEEDS_SHOWN) : [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {context.subject ? <Badge>{context.subject}</Badge> : null}
          {context.stage ? <Badge>{context.stage}</Badge> : null}
          {context.grade ? <Badge>{context.grade}</Badge> : null}
          {context.activityCount > 0 ? <Badge>{`${context.activityCount} ${context.activityCount === 1 ? "actividad" : "actividades"}`}</Badge> : null}
        </div>
        {screen === "review" && needs.length > 0 ? <p className="text-sm text-muted-foreground">Necesidades que se tienen en cuenta: {needs.join(" · ")}.</p> : null}
      </div>

      <div aria-live="polite">{notice ? <Alert tone={notice.tone} title={notice.text} /> : null}</div>

      {screen === "start" ? <StartPanel busy={busy} onStart={() => void run(actions.start)} cancel={cancel} canCancel={status.canCancel} /> : null}
      {screen === "working" ? <WorkingPanel dto={status} offline={offline} cancel={cancel} /> : null}
      {screen === "generate" ? <GeneratePanel busy={busy} onGenerate={() => void run(actions.generate, () => setSaved(null))} cancel={cancel} canCancel={status.canCancel} deferredCount={deferredIds.length} /> : null}
      {screen === "review" ? (
        plan === null ? (
          <Alert tone="warning" title="No hemos podido cargar la propuesta.">
            <Button variant="secondary" size="sm" onClick={() => router.refresh()} className="mt-2">
              Actualizar propuesta
            </Button>
          </Alert>
        ) : (
          <div className="space-y-4">
            <PlanReviewForm
              key={plan.planFingerprint}
              plan={plan}
              context={context}
              deferredIds={deferredIds}
              submit={actions.submit}
              onSaved={(result) => {
                setSaved(result);
                void refreshStatus();
              }}
              onRefresh={() => router.refresh()}
            />
            {status.canCancel ? cancel : null}
          </div>
        )
      ) : null}
      {screen === "ready" ? <ReadyPanel dto={status} materialId={context.materialId} info={readyInfo} /> : null}
      {screen === "blocked" ? <BlockedPanel dto={status} materialId={context.materialId} busy={busy} onReopen={() => void run(actions.reopen, () => setSaved(null))} /> : null}
      {screen === "failed" ? <FailedPanel dto={status} materialId={context.materialId} busy={busy} onRetry={(acknowledge) => void run(() => actions.retry({ acknowledgeAmbiguous: acknowledge }))} cancel={cancel} /> : null}
      {screen === "cancelled" ? <CancelledPanel materialId={context.materialId} /> : null}
    </div>
  );
}
