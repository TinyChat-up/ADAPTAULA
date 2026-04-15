"use client";

import { useEffect } from "react";
import Link from "next/link";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: Props) {
  useEffect(() => {
    console.error("ROOT_ERROR:", error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-16"
      style={{ background: "var(--aa-cream)", color: "var(--aa-text)" }}
    >
      <div className="w-full max-w-[440px] text-center">
        {/* Icon */}
        <div
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "rgba(232,131,74,0.12)", border: "1.5px solid rgba(232,131,74,0.3)" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-8 w-8"
            style={{ color: "var(--aa-orange)" }}
          >
            <path
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-extrabold" style={{ color: "var(--aa-green-dark)" }}>
          Algo salió mal
        </h1>
        <p className="mb-8 text-sm leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
          Se ha producido un error inesperado. Puedes intentarlo de nuevo o volver al inicio.
          {error.digest && (
            <span className="mt-2 block text-xs opacity-60">
              Código: {error.digest}
            </span>
          )}
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-full px-6 py-2.5 text-sm font-bold text-white transition-all"
            style={{
              background: "linear-gradient(135deg, var(--aa-orange) 0%, #f0a060 100%)",
              boxShadow: "0 4px 14px rgba(232,131,74,0.28)",
            }}
          >
            Intentar de nuevo
          </button>
          <Link
            href="/"
            className="rounded-full border px-6 py-2.5 text-sm font-semibold transition hover:bg-black/5"
            style={{ borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }}
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
