"use client";

import { useEffect } from "react";
import Link from "next/link";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function HistoryError({ error, reset }: Props) {
  useEffect(() => {
    console.error("HISTORY_ERROR:", error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-16"
      style={{ background: "var(--aa-cream)", color: "var(--aa-text)" }}
    >
      <div className="w-full max-w-[440px] text-center">
        {/* Icon */}
        <div
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "rgba(190,18,60,0.08)", border: "1.5px solid rgba(190,18,60,0.2)" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-7 w-7"
            style={{ color: "#be123c" }}
          >
            <path
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-xl font-extrabold" style={{ color: "var(--aa-green-dark)" }}>
          No se pudo cargar el historial
        </h1>
        <p className="mb-7 text-sm leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
          Hubo un problema al obtener tus adaptaciones guardadas. Comprueba tu conexión e inténtalo de nuevo.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-full px-6 py-2.5 text-sm font-bold text-white transition-all"
            style={{ background: "var(--aa-green)", boxShadow: "0 4px 12px rgba(123,175,127,0.30)" }}
          >
            Reintentar
          </button>
          <Link
            href="/"
            className="rounded-full border px-6 py-2.5 text-sm font-semibold transition hover:bg-black/5"
            style={{ borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }}
          >
            Crear adaptación
          </Link>
        </div>
      </div>
    </div>
  );
}
