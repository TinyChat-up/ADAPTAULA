"use client";

import { useId } from "react";
import { SelectField } from "@/components/ui/fields";
import type { PlanDecisionDto } from "@/lib/adaptation/orchestration/service";
import { ACTION_LABELS, INTENSITY_LABELS, RESPONSE_TARGET_LABELS, SUPPORT_LABELS, strategyLabel } from "@/lib/adaptation/presentation/copy";
import type { EditDraft } from "@/lib/adaptation/presentation/review-form";
import { ADAPTATION_ACTIONS, INTENSITIES, RESPONSE_TARGETS, STRATEGY_KEYS, SUPPORT_KINDS, type StrategyKey, type SupportKind } from "@/lib/schemas/adaptation-plan";


const MAX_STRATEGIES = 3;
const MAX_SUPPORTS = 4;

function CheckGroup<T extends string>({
  legend,
  hint,
  options,
  selected,
  max,
  onChange,
}: {
  legend: string;
  hint: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: readonly T[];
  max: number;
  onChange: (next: T[]) => void;
}) {
  const hintId = useId();
  return (
    <fieldset className="space-y-2" aria-describedby={hintId}>
      <legend className="text-sm font-medium">{legend}</legend>
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {options.map((o) => {
          const checked = selected.includes(o.value);
          const blocked = !checked && selected.length >= max;
          return (
            <label key={o.value} className="flex min-h-11 items-center gap-2 rounded-control px-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                disabled={blocked}
                onChange={() => onChange(checked ? selected.filter((x) => x !== o.value) : [...selected, o.value])}
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Structured controls for exactly the fields the review contract lets a teacher change. Values are shown translated;
 * nothing is typed as JSON and no raw key is visible. The server re-validates whatever is sent.
 */
export function DecisionEditor({ decision, draft, onChange }: { decision: PlanDecisionDto; draft: EditDraft; onChange: (patch: EditDraft) => void }) {
  const noteId = useId();
  const strategies = (draft.strategies ?? decision.strategies) as StrategyKey[];
  const supports = (draft.supports ?? decision.supports) as SupportKind[];
  return (
    <div className="space-y-4 rounded-card border border-border bg-background p-4">
      <p className="text-sm font-semibold">Ajustar este cambio</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Qué se hace" value={draft.action ?? decision.action} onChange={(e) => onChange({ action: e.target.value as EditDraft["action"] })}>
          {ADAPTATION_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Intensidad" value={draft.intensity ?? decision.intensity} onChange={(e) => onChange({ intensity: e.target.value as EditDraft["intensity"] })}>
          {INTENSITIES.map((i) => (
            <option key={i} value={i}>
              {INTENSITY_LABELS[i]}
            </option>
          ))}
        </SelectField>
      </div>
      <CheckGroup
        legend="Cómo se hace"
        hint={`Hasta ${MAX_STRATEGIES} formas.`}
        options={STRATEGY_KEYS.map((s) => ({ value: s, label: strategyLabel(s) }))}
        selected={strategies}
        max={MAX_STRATEGIES}
        onChange={(next) => onChange({ strategies: next })}
      />
      <CheckGroup
        legend="Ayudas"
        hint={`Hasta ${MAX_SUPPORTS} ayudas. Las ayudas nuevas se revisarán con especial cuidado para que no den pistas de la respuesta.`}
        options={SUPPORT_KINDS.map((s) => ({ value: s, label: SUPPORT_LABELS[s] }))}
        selected={supports}
        max={MAX_SUPPORTS}
        onChange={(next) => onChange({ supports: next })}
      />
      <SelectField label="Forma de responder" hint="Deja «Sin cambios» para mantener la propuesta." value={draft.responseTarget ?? ""} onChange={(e) => onChange({ responseTarget: e.target.value as EditDraft["responseTarget"] })}>
        <option value="">Sin cambios</option>
        {RESPONSE_TARGETS.map((r) => (
          <option key={r} value={r}>
            {RESPONSE_TARGET_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <label htmlFor={noteId} className="block text-sm font-medium">
          Nota para este cambio <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id={noteId}
          rows={2}
          maxLength={160}
          value={draft.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
          className="block w-full rounded-control border border-border bg-surface px-3 py-2 text-base"
        />
      </div>
    </div>
  );
}
