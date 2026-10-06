import { cn } from "@/lib/utils/cn";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/** Native radio group dressed as cards: keyboard and screen-reader behavior come for free. */
export function ChoiceCards<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  columns = 1,
}: {
  name: string;
  legend: string;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 1 | 2;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-xl font-semibold">{legend}</legend>
      <div className={cn("grid gap-3", columns === 2 && "sm:grid-cols-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-14 cursor-pointer items-start gap-3 rounded-card border bg-surface p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              value === o.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-background",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{o.label}</span>
              {o.description ? <span className="block text-sm text-muted-foreground">{o.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
