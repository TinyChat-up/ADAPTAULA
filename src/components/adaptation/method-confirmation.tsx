"use client";

import { useId } from "react";
import type { Confirmation } from "@/lib/adaptation/presentation/review-form";
import type { DecisionMethodDto } from "@/lib/adaptation/v22/method-projection";

const OPTIONS: Array<{ value: Confirmation; label: string }> = [
  { value: "yes", label: "Sí" },
  { value: "no", label: "No" },
  { value: "unknown", label: "No lo sé" },
];

/**
 * The teacher's answer to what the V2.2 method left open for one decision (ADR-047). Only «Sí» lets the decision be applied; «No» and
 * «No lo sé» leave it out, which is always safe. Without a question (a possible hint, an unusual support) it asks for the explicit
 * confirmation that the teacher has considered it. Nothing here shows rules, models or costs.
 */
export function MethodConfirmation({ method, value, onChange, disabled, describedBy }: { method: DecisionMethodDto; value: Confirmation | undefined; onChange: (answer: Confirmation) => void; disabled: boolean; describedBy?: string | undefined }) {
  const uid = useId();
  const question = method.question ?? (method.reasons.length > 0 ? "¿Quieres aplicar este cambio sabiendo lo anterior?" : "¿Quieres aplicar este cambio?");
  return (
    <div role="radiogroup" aria-labelledby={`${uid}-q`} aria-describedby={describedBy} className="space-y-2 rounded-control border border-warning/40 bg-warning/5 p-3 text-sm">
      <p id={`${uid}-q`} className="font-medium">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <label key={o.value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-4 font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
            <input type="radio" name={`${uid}-answer`} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} className="size-4 accent-primary" />
            {o.label}
          </label>
        ))}
      </div>
      <p className="text-muted-foreground">Solo «Sí» aplica el cambio. Con «No» o «No lo sé» queda fuera.</p>
    </div>
  );
}
