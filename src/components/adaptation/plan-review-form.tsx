"use client";

import { Loader2 } from "lucide-react";
import { useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import type { AdaptationPlanDto, SubmitReviewDto } from "@/lib/adaptation/orchestration/service";
import type { PublicResult } from "@/lib/adaptation/orchestration/public";
import type { AdaptationContextView } from "@/lib/adaptation/presentation/context";
import { actionLabel, targetLabel } from "@/lib/adaptation/presentation/copy";
import { buildReview, formReducer, initialFormState, interpretSubmit, isRecommended, problemsOf } from "@/lib/adaptation/presentation/review-form";
import { DecisionCard } from "./decision-card";

export type SubmitReview = (review: ReturnType<typeof buildReview>) => Promise<PublicResult<SubmitReviewDto>>;

/**
 * «Así prepararemos esta ficha»: the human review of the real plan (the «Revisar antes de crear» path, and the way back after a
 * blocked sheet). It starts from the recommendation, so the teacher only changes what they want; «Crear ficha» saves the review
 * and the screen then creates the sheet. It never submits by itself, never hides a decision and never decides what is
 * executable: the server answers that when the review is saved.
 */
export function PlanReviewForm({
  plan,
  context,
  deferredIds,
  submit,
  onSaved,
  onRefresh,
  intro,
}: {
  plan: AdaptationPlanDto;
  context: AdaptationContextView;
  deferredIds: readonly string[];
  submit: SubmitReview;
  onSaved: (result: SubmitReviewDto) => void;
  onRefresh: () => void;
  /** Why the teacher is here when they did not choose it (e.g. after a blocked sheet). */
  intro?: string | undefined;
}) {
  const [state, dispatch] = useReducer(formReducer, plan, initialFormState);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [affected, setAffected] = useState<string[]>([]);
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const problems = problemsOf(plan, state);
  const missing = Object.values(problems).filter((p) => p === "missing_choice").length;
  const stale = failure?.code === "stale_review";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    setAttempted(true);
    if (Object.keys(problems).length > 0) {
      const firstId = plan.decisions.find((d) => problems[d.id])?.id;
      const index = plan.decisions.findIndex((d) => d.id === firstId);
      formRef.current?.querySelectorAll<HTMLElement>("fieldset")[index]?.querySelector<HTMLElement>("input,select,textarea")?.focus();
      return;
    }
    lock.current = true;
    setPending(true);
    setFailure(null);
    setAffected([]);
    try {
      const outcome = interpretSubmit(await submit(buildReview(plan, state)));
      if (outcome.kind === "saved") onSaved(outcome.result);
      else if (outcome.kind === "unsupported") {
        setAffected(outcome.affected);
        setFailure({ code: "unsupported_execution", message: outcome.message });
      } else setFailure({ code: outcome.kind === "stale" ? "stale_review" : outcome.code, message: outcome.message });
    } catch {
      setFailure({ code: "network", message: "No hemos podido guardar la revisión. Comprueba la conexión e inténtalo de nuevo." });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  const changed = !isRecommended(plan, state);
  const applied = plan.decisions.filter((d) => state[d.id]?.choice !== "reject").length;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6" aria-labelledby="plan-review-title">
      <div className="space-y-2">
        <h2 id="plan-review-title" className="text-xl font-semibold">
          Así prepararemos esta ficha
        </h2>
        <p className="text-muted-foreground">Revisa cómo se adaptará el material y cambia lo que necesites antes de crear la ficha.</p>
        {intro ? <Alert tone="info" title={intro} /> : null}
        <p className="text-sm text-muted-foreground">
          {applied} de {plan.decisions.length} {plan.decisions.length === 1 ? "cambio se aplicará" : "cambios se aplicarán"}
          {plan.counts.review > 0 ? ` · ${plan.counts.review} ${plan.counts.review === 1 ? "conviene revisarlo" : "conviene revisarlos"}` : ""}.
        </p>
      </div>

      {stale ? (
        <Alert tone="warning" title={failure?.message}>
          <Button variant="secondary" size="sm" onClick={onRefresh} className="mt-2">
            Actualizar propuesta
          </Button>
        </Alert>
      ) : failure ? (
        <Alert tone={failure.code === "unsupported_execution" ? "warning" : "danger"} title={failure.message}>
          {affected.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {affected.map((id) => {
                const d = plan.decisions.find((x) => x.id === id);
                return d ? <li key={id}>{`${targetLabel(d.target, context.targets)} · ${actionLabel(d.action)}`}</li> : null;
              })}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <ol className="space-y-4">
        {plan.decisions.map((decision, index) => (
          <DecisionCard
            key={decision.id}
            decision={decision}
            index={index}
            context={context}
            draft={state[decision.id]!}
            problem={attempted ? problems[decision.id] : undefined}
            deferred={deferredIds.includes(decision.id)}
            notice={affected.includes(decision.id) ? "Este cambio necesita ajustarse antes de crear el material." : undefined}
            disabled={pending}
            onChoose={(choice) => dispatch({ type: "choose", id: decision.id, choice })}
            onEdit={(patch) => dispatch({ type: "edit", id: decision.id, patch })}
          />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={pending || stale}>
          {pending ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          Crear ficha
        </Button>
        {changed ? (
          <Button variant="secondary" onClick={() => dispatch({ type: "reset", plan })} disabled={pending}>
            Restaurar recomendación
          </Button>
        ) : null}
        <p role="status" className="text-sm text-muted-foreground">
          {pending ? "Preparando la ficha…" : missing > 0 ? `Te quedan ${missing} ${missing === 1 ? "cambio" : "cambios"} por decidir.` : ""}
        </p>
      </div>
    </form>
  );
}
