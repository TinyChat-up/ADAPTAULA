"use client";

import { useId, useRef, type ReactNode } from "react";
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
}: {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "primary";
  pending: boolean;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
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
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-border bg-surface p-6 shadow-card backdrop:bg-foreground/40"
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${id}-desc`} className="mt-2 text-muted-foreground">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Cancelar
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => {
              ref.current?.close();
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
