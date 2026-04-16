"use client";

// ProGateModal — modal de conversión Pro para dos contextos:
//   "trial-exhausted" → usuario agotó su adaptación gratuita
//   "export-locked"   → usuario intenta exportar PDF/DOCX sin plan Pro

interface Props {
  variant: "trial-exhausted" | "export-locked";
  onUpgrade: () => void;
  onClose: () => void;
}

function FeatureItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm" style={{ color: "var(--aa-text)" }}>
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" fill="rgba(123,175,127,0.2)" stroke="var(--aa-green)" strokeWidth="1.2" />
        <path d="M5.5 8l2 2 3-3.5" stroke="var(--aa-green-dark)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{text}</span>
    </li>
  );
}

export default function ProGateModal({ variant, onUpgrade, onClose }: Props) {
  const isTrialExhausted = variant === "trial-exhausted";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(20,30,22,0.55)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card */}
      <div
        className="relative w-full max-w-[440px] rounded-2xl bg-white px-8 py-10"
        style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}
      >
        {/* Icon area */}
        <div className="mb-5 flex flex-col items-center gap-3">
          {isTrialExhausted ? (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: "rgba(123,175,127,0.15)" }}
            >
              <svg
                className="h-7 w-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--aa-green-dark)"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
          ) : (
            <>
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "rgba(232,131,74,0.12)" }}
              >
                <svg
                  className="h-7 w-7"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--aa-orange)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <span
                className="rounded-full px-3 py-0.5 text-xs font-semibold text-white"
                style={{ background: "var(--aa-orange)" }}
              >
                Función Pro
              </span>
            </>
          )}
        </div>

        {/* Headline */}
        <h2
          className="mb-3 text-center text-xl font-bold leading-snug"
          style={{ color: "var(--aa-text)" }}
        >
          {isTrialExhausted
            ? "Ya has probado AdaptAula"
            : "La exportación es una función Pro"}
        </h2>

        {/* Body */}
        <p
          className="mb-6 text-center text-sm leading-relaxed"
          style={{ color: "var(--aa-text-muted)" }}
        >
          {isTrialExhausted
            ? "Has utilizado tu adaptación de prueba gratuita. Para seguir generando fichas adaptadas, activa el plan Pro."
            : "Las descargas en PDF y DOCX están disponibles en el plan Pro. Activa Pro y descarga fichas listas para imprimir al instante."}
        </p>

        {/* Feature list */}
        <ul
          className="mb-6 space-y-2.5 rounded-xl px-4 py-4"
          style={{
            background: "rgba(123,175,127,0.07)",
            border: "1px solid rgba(123,175,127,0.18)",
          }}
        >
          {isTrialExhausted ? (
            <>
              <FeatureItem text="Adaptaciones ilimitadas" />
              <FeatureItem text="Exportación PDF y DOCX" />
              <FeatureItem text="IA de mayor precisión (GPT-4.1)" />
            </>
          ) : (
            <>
              <FeatureItem text="PDF listo para imprimir — formato A4" />
              <FeatureItem text="DOCX editable — para Word o Google Docs" />
              <FeatureItem text="Adaptaciones ilimitadas sin restricción" />
            </>
          )}
        </ul>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={onUpgrade}
          className="mb-4 w-full rounded-xl py-3.5 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.99]"
          style={{
            background: "var(--aa-green-dark)",
            boxShadow: "0 4px 16px rgba(74,124,89,0.28)",
          }}
        >
          Ver plan Pro · 9,99 €/mes
        </button>

        {/* Secondary */}
        <div className="text-center">
          <button
            type="button"
            onClick={onClose}
            className="text-sm transition hover:opacity-75"
            style={{ color: "var(--aa-text-muted)" }}
          >
            {isTrialExhausted ? "Volver al inicio" : "Cerrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
