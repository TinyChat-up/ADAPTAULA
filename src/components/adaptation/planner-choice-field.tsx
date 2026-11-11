"use client";

import { useId } from "react";

export type PlannerChoiceValue = "current" | "v22";

/**
 * The planner choice of the V3 pilot (ADR-046). Rendered only for the authorised pilot workspace of an isolated backend; the server
 * checks the same gate again, so this is a request, never a permission. No model, token or cost is named here.
 */
export function PlannerChoiceField({ value, onChange, disabled }: { value: PlannerChoiceValue; onChange: (value: PlannerChoiceValue) => void; disabled: boolean }) {
  const uid = useId();
  const options: Array<{ value: PlannerChoiceValue; label: string; hint: string }> = [
    { value: "current", label: "Planificador actual", hint: "El mismo que usa hoy la plataforma." },
    { value: "v22", label: "Planificador experimental V2.2", hint: "Decide con la metodología V2.2. Las decisiones condicionadas esperan tu revisión." },
  ];
  return (
    <fieldset className="space-y-2 rounded-md border border-dashed border-border p-3 text-sm" aria-describedby={`${uid}-note`}>
      <legend className="px-1 font-medium">Planificador (solo en este espacio de pruebas)</legend>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-11 items-start gap-3 py-1">
          <input type="radio" name={`${uid}-planner`} value={o.value} className="mt-1 size-5 accent-primary" checked={value === o.value} onChange={() => onChange(o.value)} disabled={disabled} aria-describedby={`${uid}-${o.value}`} />
          <span>
            <span className="font-medium">{o.label}</span>
            <span id={`${uid}-${o.value}`} className="block text-muted-foreground">
              {o.hint}
            </span>
          </span>
        </label>
      ))}
      <p id={`${uid}-note`} className="text-muted-foreground">
        Para comparar, adapta el mismo material con el mismo perfil una vez con cada planificador.
      </p>
    </fieldset>
  );
}
