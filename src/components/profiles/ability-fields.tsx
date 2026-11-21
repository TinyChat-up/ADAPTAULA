import { useId } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { ABILITY_AUTONOMY, LEARNING_STATEMENT_LIMIT, LEARNINGS_PER_AREA, type ObservedAbility } from "@/lib/schemas/pedagogical-profile";

export const AUTONOMY_LABELS: Record<ObservedAbility["autonomy"], string> = {
  independent: "Lo hace solo",
  with_help: "Lo consigue con ayuda",
  not_yet: "Todavía no lo consigue",
  unassessed: "Sin valorar",
};

export function AbilityFields({ value, onChange }: { value: ObservedAbility[]; onChange: (value: ObservedAbility[]) => void }) {
  const id = useId();
  const update = (index: number, patch: Partial<ObservedAbility>) => onChange(value.map((entry, i) => i === index ? { ...entry, ...patch } : entry));

  function add() {
    onChange([...value, { statement: "", autonomy: "unassessed" }]);
    requestAnimationFrame(() => document.getElementById(`${id}-ability-${value.length}`)?.focus());
  }

  return (
    <div className="space-y-3">
      {value.map((entry, index) => (
        <fieldset key={index} className="min-w-0 space-y-2 rounded-control border border-border px-3 pb-3">
          <legend className="px-1 text-sm font-medium">Aprendizaje {index + 1}</legend>
          <TextField id={`${id}-ability-${index}`} label="Qué hace" placeholder="Por ejemplo, lee un gráfico de barras" maxLength={LEARNING_STATEMENT_LIMIT} value={entry.statement} onChange={(event) => update(index, { statement: event.target.value })} />
          <SelectField label="Cómo lo hace" value={entry.autonomy} onChange={(event) => {
            const autonomy = ABILITY_AUTONOMY.find((option) => option === event.target.value);
            if (autonomy) update(index, { autonomy });
          }}>
            {ABILITY_AUTONOMY.map((option) => <option key={option} value={option}>{AUTONOMY_LABELS[option]}</option>)}
          </SelectField>
          <Button variant="ghost" aria-label={`Quitar aprendizaje ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>Quitar</Button>
        </fieldset>
      ))}
      {value.length < LEARNINGS_PER_AREA ? <Button variant="secondary" onClick={add}>Añadir aprendizaje</Button> : null}
    </div>
  );
}
