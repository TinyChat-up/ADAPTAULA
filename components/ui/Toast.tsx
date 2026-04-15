"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ToastContext, useToastState, type Toast, type ToastVariant } from "@/hooks/useToast";

// ─── Variant config ───────────────────────────────────────────────────────────

const VARIANT: Record<
  ToastVariant,
  { bg: string; border: string; text: string; icon: ReactNode }
> = {
  error: {
    bg: "#fff1f2",
    border: "#fecdd3",
    text: "#be123c",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    ),
  },
  success: {
    bg: "rgba(123,175,127,0.12)",
    border: "rgba(123,175,127,0.4)",
    text: "#2d6b31",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
    ),
  },
  warning: {
    bg: "rgba(232,131,74,0.10)",
    border: "rgba(232,131,74,0.35)",
    text: "#8f4a12",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    ),
  },
  info: {
    bg: "rgba(11,79,179,0.08)",
    border: "rgba(11,79,179,0.22)",
    text: "#0b4fb3",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
      </svg>
    ),
  },
};

// ─── Single toast item ────────────────────────────────────────────────────────

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { bg, border, text, icon } = VARIANT[toast.variant];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="aa-toast flex w-full max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg"
      style={{ background: bg, borderColor: border, color: text }}
    >
      {icon}
      <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar notificación"
        className="shrink-0 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
        style={{ color: text }}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Container ────────────────────────────────────────────────────────────────

function ToastContainer() {
  const ctx = useContext(ToastContext);
  if (!ctx || ctx.toasts.length === 0) return null;

  return (
    <div
      aria-label="Notificaciones"
      className="fixed right-4 top-4 z-[9999] flex flex-col gap-2"
      style={{ maxWidth: "calc(100vw - 2rem)" }}
    >
      {ctx.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={ctx.dismiss} />
      ))}
    </div>
  );
}

// ─── Provider (wraps children + renders container) ────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const value = useToastState();

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}
