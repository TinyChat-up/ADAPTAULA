"use client";

import { AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/feedback";
import type { PlanDecisionDto } from "@/lib/adaptation/orchestration/service";
import { DEFERRED_NOTE, actionLabel, actionSentence, flagCopy, intensityLabel, limitLines, needLabels, preservedLines, strategyLabel, supportLabel, targetLabel } from "@/lib/adaptation/presentation/copy";
import type { AdaptationContextView } from "@/lib/adaptation/presentation/context";
import { PROBLEM_COPY, type Choice, type DecisionDraft, type DecisionProblem } from "@/lib/adaptation/presentation/review-form";
import { cn } from "@/lib/utils/cn";
import { DecisionEditor } from "./decision-editor";

const MAX_NEEDS = 3;

const STATUS_BADGE = {
  valid: { label: "Recomendado", icon: CheckCircle2, tone: "text-success" },
  review: { label: "Requiere tu atención", icon: AlertTriangle, tone: "text-warning" },
  blocked: { label: "No aplicable tal cual", icon: Ban, tone: "text-danger" },
} as const;

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
  const status = STATUS_BADGE[decision.status] ?? STATUS_BADGE.review;
  const StatusIcon = status.icon;
  const needs = needLabels(decision.needs);
  const hint = context.hints[decision.target];
  const specific = preservedLines(decision.preserves);
  const preserved = specific.length > 0 ? specific : (context.preserved[decision.target] ?? []);
  const limits = limitLines(decision);
  const attention = decision.issues.filter((i) => i.severity !== "info");
  const errorId = problem ? `${uid}-error` : undefined;
  const options: Array<{ value: Choice; label: string }> = [
    { value: "approve", label: "Aprobar" },
    { value: "reject", label: "Descartar" },
    { value: "edit", label: "Ajustar" },
  ];

  return (
    <li>
      <fieldset
        disabled={disabled}
        aria-describedby={errorId}
        className={cn("space-y-4 rounded-card border bg-surface p-5 shadow-card", decision.status === "blocked" ? "border-danger/40" : decision.status === "review" ? "border-warning/50" : "border-border")}
      >
        <legend className="sr-only">{`Cambio ${index + 1}: ${targetLabel(decision.target, context.targets)}, ${actionLabel(decision.action)}`}</legend>

        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-base font-semibold">
              {targetLabel(decision.target, context.targets)} · {actionLabel(decision.action)}
            </h3>
            {hint ? <p className="text-sm text-muted-foreground">«{hint}»</p> : null}
          </div>
          <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", status.tone)}>
            <StatusIcon aria-hidden className="size-4" />
            {status.label}
          </span>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="font-medium">Qué se propone</dt>
            <dd className="space-y-1.5 text-foreground/90">
              <p>{actionSentence(decision.action)}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{intensityLabel(decision.intensity)}</Badge>
                {decision.strategies.map((s) => (
                  <Badge key={s}>{strategyLabel(s)}</Badge>
                ))}
              </div>
              {decision.supports.length > 0 ? <p>Ayudas: {decision.supports.map(supportLabel).join(", ")}.</p> : null}
            </dd>
          </div>
          {needs.length > 0 ? (
            <div className="space-y-1">
              <dt className="font-medium">Por qué</dt>
              <dd className="text-foreground/90">
                Responde a: {needs.slice(0, MAX_NEEDS).join(" · ")}
                {needs.length > MAX_NEEDS ? ` y ${needs.length - MAX_NEEDS} más` : ""}.
              </dd>
            </div>
          ) : null}
          {preserved.length > 0 ? (
            <div className="space-y-1 sm:col-span-2">
              <dt className="font-medium">Se mantendrá</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-5 text-foreground/90">
                  {preserved.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {limits.length > 0 ? (
            <div className="space-y-1 sm:col-span-2">
              <dt className="font-medium">{decision.supports.length > 0 ? "Límites de esta ayuda" : "Límites de este cambio"}</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-5 text-foreground/90">
                  {limits.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>

        {decision.status === "blocked" ? (
          <p className="rounded-control bg-danger/5 p-3 text-sm">Este cambio no se puede aplicar tal cual: se puede descartar o ajustar, pero no aprobar.</p>
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

        <div role="radiogroup" aria-label={`Qué hacer con el cambio ${index + 1}`} aria-describedby={errorId} className="flex flex-wrap gap-2">
          {options.map((o) => {
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

        {problem ? (
          <p id={errorId} className="text-sm font-medium text-danger">
            {PROBLEM_COPY[problem]}
          </p>
        ) : null}
      </fieldset>
    </li>
  );
}
