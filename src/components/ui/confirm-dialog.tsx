"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

/** Native <dialog>: focus is trapped, Escape closes it and focus returns to the trigger. */
export function ConfirmDialog({
  triggerLabel,
  triggerIcon,
  title,
  description,
  confirmLabel,
  confirmVariant = "danger",
  pending,
  onConfirm,
  details,
  acknowledge,
}: {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "primary";
  pending: boolean;
  onConfirm: () => void;
  /** What the action affects, shown under the description (lists, counts). */
  details?: ReactNode;
  /** An irreversible action: the confirm button stays disabled until the person ticks this explicit statement. */
  acknowledge?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => ref.current?.showModal()} disabled={pending}>
        {triggerIcon}
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="sheet m-auto w-[calc(100%-2rem)] max-h-[85dvh] max-w-md overflow-y-auto rounded-panel border border-border bg-surface p-6 text-foreground shadow-dialog backdrop:bg-foreground/40"
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${id}-desc`} className="mt-2 text-muted-foreground">
          {description}
        </p>
        {details ? <div className="mt-4 text-sm">{details}</div> : null}
        {acknowledge ? (
          <label className="mt-4 flex min-h-11 items-start gap-3 text-sm font-medium">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-danger" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>{acknowledge}</span>
          </label>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Cancelar
          </Button>
          <Button
            variant={confirmVariant}
            disabled={Boolean(acknowledge) && !acknowledged}
            onClick={() => {
              ref.current?.close();
              setAcknowledged(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
