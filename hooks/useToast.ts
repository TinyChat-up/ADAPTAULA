"use client";

import { createContext, useCallback, useContext, useReducer } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "error" | "success" | "warning" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
}

type Action =
  | { type: "ADD"; toast: Toast }
  | { type: "REMOVE"; id: string };

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.type) {
    case "ADD":
      return [...state, action.toast];
    case "REMOVE":
      return state.filter((t) => t.id !== action.id);
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Provider state factory ───────────────────────────────────────────────────

export function useToastState(): ToastContextValue {
  const [toasts, dispatch] = useReducer(reducer, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id });
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      dispatch({ type: "ADD", toast: { id, variant, message } });
      // Auto-dismiss after 4s
      setTimeout(() => dispatch({ type: "REMOVE", id }), 4000);
    },
    [],
  );

  return { toasts, toast, dismiss };
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useToast(): Pick<ToastContextValue, "toast" | "dismiss"> {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return { toast: ctx.toast, dismiss: ctx.dismiss };
}
