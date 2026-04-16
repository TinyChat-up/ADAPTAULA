"use client";

interface Props {
  message?: string;
  onBack: () => void;
  onRetry?: () => void;
}

export default function ResultError({ onBack, onRetry }: Props) {
  return (
    <div
      style={{ minHeight: "100svh", background: "#F0EDE8", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="mx-auto max-w-[480px] px-6 py-12 text-center">

        {/* Icon */}
        <div
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "rgba(232,131,74,0.10)" }}
        >
          <svg
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="var(--aa-orange)"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="mb-2 text-xl font-bold" style={{ color: "var(--aa-text)" }}>
          No hemos podido generar la adaptación
        </h1>

        {/* Subtitle */}
        <p className="mb-8 text-sm leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
          Prueba con otro nivel educativo o revisa el contenido.
        </p>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="w-full rounded-2xl py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98]"
              style={{ background: "var(--aa-green-dark)", boxShadow: "0 4px 16px rgba(74,124,89,0.22)" }}
            >
              Intentar de nuevo
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm transition hover:opacity-75"
            style={{ color: "var(--aa-text-muted)" }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Volver a configurar
          </button>
        </div>

      </div>
    </div>
  );
}
