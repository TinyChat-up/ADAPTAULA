"use client";

import { AlertTriangle, Ban, CheckCircle2, MinusCircle, PencilLine } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import type { PlanDecisionDto } from "@/lib/adaptation/orchestration/service";
import { DEFERRED_NOTE, actionLabel, actionSentence, flagCopy, intensityLabel, limitLines, needLabels, preservedLines, strategyLabel, supportLabel, targetLabel } from "@/lib/adaptation/presentation/copy";
import type { AdaptationContextView } from "@/lib/adaptation/presentation/context";
import { PROBLEM_COPY, type Choice, type DecisionDraft, type DecisionProblem } from "@/lib/adaptation/presentation/review-form";
import { cn } from "@/lib/utils/cn";
import { DecisionEditor } from "./decision-editor";

const MAX_NEEDS = 3;

/** What will happen with the decision, as chosen now (the recommendation until the teacher changes it). */
const OUTCOME = {
  approve: { label: "Se aplicará", icon: CheckCircle2, tone: "text-success" },
  reject: { label: "No se aplicará", icon: MinusCircle, tone: "text-muted-foreground" },
  edit: { label: "Se aplicará con tus ajustes", icon: PencilLine, tone: "text-primary" },
} as const;

const OPTIONS: Array<{ value: Choice; label: string }> = [
  { value: "approve", label: "Aplicar" },
  { value: "reject", label: "No aplicar" },
  { value: "edit", label: "Ajustar" },
];

/**
 * One decision of the real plan, in the teacher's words: what changes, why (the profile's needs) and what is kept. The choice is
 * hidden behind «Cambiar» because the recommendation is already set; what the teacher cannot change (what is kept, the limits of a
 * help, a decision that cannot be applied as it is) is shown as information only.
 */
export function DecisionCard({
  decision,
  index,
  context,
  draft,
  problem,
  deferred,
  notice,
  disabled,
  onChoose,
  onEdit,
}: {
  decision: PlanDecisionDto;
  index: number;
  context: AdaptationContextView;
  draft: DecisionDraft;
  problem: DecisionProblem | undefined;
  deferred: boolean;
  /** A server-side finding about this decision after saving (e.g. it needs an adjustment before generating). */
  notice?: string | undefined;
  disabled: boolean;
  onChoose: (choice: Choice) => void;
  onEdit: (patch: DecisionDraft["edit"]) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const expanded = open || draft.choice === "edit" || problem !== undefined || notice !== undefined;
  const outcome = OUTCOME[draft.choice ?? "approve"];
  const OutcomeIcon = outcome.icon;
  const needs = needLabels(decision.needs);
  const hint = context.hints[decision.target];
  const specific = preservedLines(decision.preserves);
  const preserved = specific.length > 0 ? specific : (context.preserved[decision.target] ?? []);
  const limits = limitLines(decision);
  const attention = decision.issues.filter((i) => i.severity !== "info");
  const errorId = problem ? `${uid}-error` : undefined;
  const title = `${targetLabel(decision.target, context.targets)} · ${actionLabel(decision.action)}`;

  return (
    <li>
      <fieldset
        disabled={disabled}
        aria-describedby={errorId}
        className={cn("space-y-3 rounded-card border bg-surface p-4 shadow-card sm:p-5", decision.status === "blocked" ? "border-danger/40" : attention.length > 0 ? "border-warning/50" : "border-border")}
      >
        <legend className="sr-only">{`Cambio ${index + 1}: ${title}`}</legend>

        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-base font-semibold">{title}</h3>
            {hint ? <p className="text-sm text-muted-foreground">«{hint}»</p> : null}
          </div>
          <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", outcome.tone)}>
            <OutcomeIcon aria-hidden className="size-4" />
            {outcome.label}
          </span>
        </div>

        <div className="space-y-1.5 text-sm text-foreground/90">
          <p>{actionSentence(decision.action)}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge>{intensityLabel(decision.intensity)}</Badge>
            {decision.strategies.map((s) => (
              <Badge key={s}>{strategyLabel(s)}</Badge>
            ))}
          </div>
          {decision.supports.length > 0 ? <p>Ayudas: {decision.supports.map(supportLabel).join(", ")}.</p> : null}
          {needs.length > 0 ? (
            <p>
              <span className="font-medium">Por qué: </span>
              {needs.slice(0, MAX_NEEDS).join(" · ")}
              {needs.length > MAX_NEEDS ? ` y ${needs.length - MAX_NEEDS} más` : ""}.
            </p>
          ) : null}
        </div>

        {preserved.length > 0 ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">Se mantendrá</p>
            <ul className="list-disc space-y-0.5 pl-5 text-foreground/90">
              {preserved.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {limits.length > 0 ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{decision.supports.length > 0 ? "Límites de esta ayuda" : "Límites de este cambio"}</p>
            <ul className="list-disc space-y-0.5 pl-5 text-foreground/90">
              {limits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision.status === "blocked" ? (
          <p className="flex gap-2 rounded-control bg-danger/5 p-3 text-sm">
            <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            Este cambio no se puede aplicar tal cual. Puedes dejarlo fuera o ajustarlo.
          </p>
        ) : null}
        {attention.length > 0 ? (
          <ul className="space-y-1 rounded-control bg-warning/5 p-3 text-sm">
            {[...new Set(attention.map((i) => flagCopy(i.flag)))].map((line) => (
              <li key={line} className="flex gap-2">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-control bg-danger/5 p-3 text-sm font-medium">
            {notice}
          </p>
        ) : null}
        {deferred ? <p className="text-sm text-muted-foreground">{DEFERRED_NOTE}</p> : null}

        {expanded ? (
          <div className="space-y-3">
            <div role="radiogroup" aria-label={`Qué hacer con el cambio ${index + 1}`} aria-describedby={errorId} className="flex flex-wrap gap-2">
              {OPTIONS.map((o) => {
                const unavailable = o.value === "approve" && decision.status === "blocked";
                const selected = draft.choice === o.value;
                return (
                  <label
                    key={o.value}
                    className={cn(
                      "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                      selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-surface hover:bg-background",
                      unavailable && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input type="radio" name={`${uid}-choice`} value={o.value} checked={selected} disabled={unavailable} onChange={() => onChoose(o.value)} className="size-4 accent-primary" />
                    {o.label}
                    {selected ? <span className="sr-only"> (elegido)</span> : null}
                  </label>
                );
              })}
            </div>
            {draft.choice === "edit" ? <DecisionEditor decision={decision} draft={draft.edit} onChange={onEdit} /> : null}
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`Cambiar: ${title}`}>
            Cambiar
          </Button>
        )}

        {problem ? (
          <p id={errorId} className="text-sm font-medium text-danger">
            {PROBLEM_COPY[problem]}
          </p>
        ) : null}
      </fieldset>
    </li>
  );
}
