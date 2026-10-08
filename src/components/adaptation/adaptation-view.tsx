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
import { createRunDispatcher, type RunDispatcher } from "@/lib/jobs/run-dispatcher";
import { screenFor } from "@/lib/adaptation/presentation/view-model";
import { BlockedPanel, CancelControl, CancelledPanel, FailedPanel, GeneratePanel, ReadOnlyPanel, ReadyPanel, StartPanel, WorkingPanel } from "./status-panels";
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
  canWrite,
}: {
  initial: AdaptationStatusDto;
  plan: AdaptationPlanDto | null;
  context: AdaptationContextView;
  readyInfo: { version: number; createdAt: string } | null;
  actions: AdaptationActions;
  /** False for read-only members: every state is visible, no command is offered and nothing is asked to run. */
  canWrite: boolean;
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
  const runnerRef = useRef<RunDispatcher | null>(null);
  const lock = useRef(false);
  const id = initial.id;

  /** Takes a newer status. True when the pipeline moved on to another stage it is still working on (run that one now). */
  function adopt(next: AdaptationStatusDto): boolean {
    const previous = statusRef.current;
    statusRef.current = next;
    setStatus(next);
    // «Hacer magia» ends on the sheet itself, the moment it is delivered.
    if (next.creationMode === "automatic" && next.phase === "ready" && previous.phase !== "ready") {
      router.push(`/app/adaptaciones/${id}/vista`);
      return false;
    }
    if (next.phase !== previous.phase || next.nextAction !== previous.nextAction || next.status !== previous.status) router.refresh();
    return next.status !== previous.status && shouldPoll(next);
  }

  useEffect(() => {
    // The pending stage runs now, in its own awaited request (a Route Handler: it must not queue behind other Server Actions).
    // Polling only observes it, and re-asks gently if the job is left waiting (a retry backoff ended, a function died).
    const runner = createRunDispatcher<AdaptationStatusDto>({
      run: async () => {
        const response = await fetch(`/api/adaptations/${id}/run`, { method: "POST", cache: "no-store" });
        return response.ok ? ((await response.json()) as AdaptationStatusDto) : null;
      },
      onResult: (next) => adopt(next) && canWrite,
    });
    runnerRef.current = runner;
    if (canWrite && shouldPoll(statusRef.current)) runner.kick(true);
    const poller = createPoller({
      fetchStatus: async (signal) => {
        const response = await fetch(`/api/adaptations/${id}/status`, { cache: "no-store", signal });
        return response.ok ? ((await response.json()) as AdaptationStatusDto) : null;
      },
      onStatus: (next) => {
        const moved = adopt(next);
        if (canWrite && shouldPoll(next)) runner.kick(moved);
      },
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
      runner.stop();
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

  /** A command just persisted a stage job: run it now (no wait for any scheduler). */
  const runNow = () => runnerRef.current?.kick(true);

  const cancel = <CancelControl busy={busy} onCancel={() => void run(actions.cancel)} />;
  const screen = screenFor(status);
  // A read-only member sees the same states without commands (the server would refuse them anyway).
  const shown = canWrite ? status : { ...status, canCancel: false, canRetry: false };
  const deferredIds = saved?.deferredDecisions ?? status.execution?.deferredDecisions ?? [];
  const reviewIntro =
    status.creationMode === "automatic"
      ? status.generationsUsed > 0
        ? "Corrige lo que necesites y vuelve a crear la ficha."
        : "No hemos podido preparar la ficha automáticamente. Revisa cómo se adaptará el material y créala desde aquí."
      : status.generationsUsed > 0
        ? "Corrige lo que necesites y vuelve a crear la ficha."
        : undefined;
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

      {!canWrite && (screen === "start" || screen === "generate" || screen === "review") ? <ReadOnlyPanel screen={screen} materialId={context.materialId} /> : null}

      {canWrite && screen === "start" ? <StartPanel busy={busy} onStart={() => void run(actions.start, runNow)} cancel={cancel} canCancel={status.canCancel} /> : null}
      {screen === "working" ? <WorkingPanel dto={shown} offline={offline} cancel={cancel} /> : null}
      {canWrite && screen === "generate" ? <GeneratePanel busy={busy} onGenerate={() => void run(actions.generate, () => { setSaved(null); runNow(); })} cancel={cancel} canCancel={status.canCancel} deferredCount={deferredIds.length} /> : null}
      {canWrite && screen === "review" ? (
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
                // «Crear ficha»: the review is saved; the sheet is created right away with it.
                setSaved(result);
                void run(actions.generate, () => {
                  setSaved(null);
                  runNow();
                });
              }}
              intro={reviewIntro}
              onRefresh={() => router.refresh()}
            />
            {status.canCancel ? cancel : null}
          </div>
        )
      ) : null}
      {screen === "ready" ? <ReadyPanel dto={status} materialId={context.materialId} info={readyInfo} /> : null}
      {screen === "blocked" ? <BlockedPanel dto={status} materialId={context.materialId} busy={busy} canWrite={canWrite} onReopen={() => void run(actions.reopen, () => setSaved(null))} /> : null}
      {screen === "failed" ? <FailedPanel dto={shown} materialId={context.materialId} busy={busy} onRetry={(acknowledge) => void run(() => actions.retry({ acknowledgeAmbiguous: acknowledge }), runNow)} cancel={cancel} /> : null}
      {screen === "cancelled" ? <CancelledPanel materialId={context.materialId} /> : null}
    </div>
  );
}
