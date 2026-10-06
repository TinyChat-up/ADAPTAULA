import { TextField } from "@/components/ui/fields";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";

type Limits = FunctionalProfile["limits"];
type Allowances = FunctionalProfile["allowances"];

function numberOrUndefined(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function AdvancedLimits({
  profile,
  onChange,
}: {
  profile: FunctionalProfile;
  onChange: (next: { limits: Limits; allowances: Allowances }) => void;
}) {
  const { limits, allowances } = profile;
  const setLimit = (key: keyof Limits, value: string) => onChange({ limits: { ...limits, [key]: numberOrUndefined(value) }, allowances });
  const setAllowance = (key: keyof Pick<Allowances, "calculator" | "keyboard">, value: boolean) =>
    onChange({ limits, allowances: { ...allowances, [key]: value } });

  return (
    <details className="rounded-card border border-border bg-surface p-5">
      <summary className="cursor-pointer font-semibold">Ajustes avanzados (opcional)</summary>
      <div className="mt-5 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Palabras por instrucción"
            type="number"
            inputMode="numeric"
            min={4}
            max={40}
            hint="Máximo, de 4 a 40."
            value={limits.max_instruction_words ?? ""}
            onChange={(e) => setLimit("max_instruction_words", e.target.value)}
          />
          <TextField
            label="Tareas visibles a la vez"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            hint="Máximo, de 1 a 10."
            value={limits.max_visible_tasks ?? ""}
            onChange={(e) => setLimit("max_visible_tasks", e.target.value)}
          />
          <TextField
            label="Minutos por tarea"
            type="number"
            inputMode="numeric"
            min={2}
            max={60}
            hint="Máximo, de 2 a 60."
            value={limits.max_task_minutes ?? ""}
            onChange={(e) => setLimit("max_task_minutes", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={allowances.calculator === true} onChange={(e) => setAllowance("calculator", e.target.checked)} />
            Se permite el uso de calculadora
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={allowances.keyboard === true} onChange={(e) => setAllowance("keyboard", e.target.checked)} />
            Se permite responder con teclado
          </label>
        </div>
      </div>
    </details>
  );
}
