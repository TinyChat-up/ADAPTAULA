import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
}

const controlClasses =
  "block w-full rounded-control border border-border bg-surface px-3 min-h-11 text-base text-foreground placeholder:text-muted-foreground/70 aria-[invalid=true]:border-danger";

function Shell({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FieldShellProps & { id: string; children: (describedBy: string | undefined) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children(describedBy)}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  optional,
  className,
  ...props
}: FieldShellProps & Omit<ComponentProps<"input">, "id"> & { id?: string }) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      {(describedBy) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(controlClasses, className)}
          {...props}
        />
      )}
    </Shell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  className,
  children,
  ...props
}: FieldShellProps & Omit<ComponentProps<"select">, "id"> & { id?: string }) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      {(describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(controlClasses, className)}
          {...props}
        >
          {children}
        </select>
      )}
    </Shell>
  );
}
