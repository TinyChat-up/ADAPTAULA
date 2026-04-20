"use client";

// PlanStatusBanner — muestra el plan actual del usuario (Free/Pro) en la
// pantalla inicial. Puramente visual: no decide ni cambia el plan real.
// El plan viene de page.tsx, que lo lee de Supabase en el mount.

interface Props {
  /** null = cargando todavía */
  currentPlan: "free" | "pro" | null;
  onUpgrade: () => void;
}

const FREE_FEATURES = [
  "Adaptaciones con IA estándar",
  "PDF y DOCX básicos",
  "Disponibilidad limitada",
];

const PRO_FEATURES = [
  "IA de mayor calidad y precisión",
  "Mejor estructura visual del documento",
  "PDF y DOCX sin límites",
  "Prioridad frente al plan gratuito",
];

export default function PlanStatusBanner({ currentPlan, onUpgrade }: Props) {
  // Mientras carga, mostrar esqueleto neutro
  if (currentPlan === null) {
    return (
      <div className="mb-6 grid grid-cols-2 gap-3 w-full max-w-[580px]">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="aa-skeleton h-[148px] rounded-2xl"
            style={{ opacity: 0.5 }}
          />
        ))}
      </div>
    );
  }

  const isFree = currentPlan === "free";
  const isPro  = currentPlan === "pro";

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 w-full max-w-[580px]">

      {/* ── Card Gratis ── */}
      <div
        className="relative flex flex-col rounded-2xl border px-4 py-4 transition-all"
        style={{
          borderColor: isFree ? "var(--aa-green)" : "#ddd8d0",
          background: isFree ? "rgba(123,175,127,0.06)" : "#FAFAF8",
          boxShadow: isFree ? "0 0 0 1.5px var(--aa-green)" : "none",
        }}
      >
        {/* Badge plan actual */}
        {isFree && (
          <span
            className="absolute -top-2.5 left-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white"
            style={{ background: "var(--aa-green-dark)" }}
          >
            Plan actual
          </span>
        )}

        <div className="mb-2.5">
          <p className="text-[13px] font-bold" style={{ color: "var(--aa-text)" }}>
            Gratis
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--aa-text-muted)" }}>
            Sin coste
          </p>
        </div>

        <ul className="space-y-1.5 flex-1">
          {FREE_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--aa-text-muted)" }}>
              <span className="mt-0.5 shrink-0 text-[10px]" style={{ color: "#9aaa9b" }}>✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Card Pro ── */}
      <div
        className="relative flex flex-col rounded-2xl border px-4 py-4 transition-all"
        style={{
          borderColor: isPro ? "var(--aa-green-dark)" : "#ddd8d0",
          background: isPro
            ? "rgba(74,124,89,0.07)"
            : "linear-gradient(135deg, #FFFDF9 0%, #FFF8F2 100%)",
          boxShadow: isPro
            ? "0 0 0 1.5px var(--aa-green-dark)"
            : "0 1px 4px rgba(0,0,0,0.05)",
        }}
      >
        {/* Badge plan actual o badge Pro */}
        <span
          className="absolute -top-2.5 right-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white"
          style={{
            background: isPro ? "var(--aa-green-dark)" : "var(--aa-orange)",
          }}
        >
          {isPro ? "Plan actual" : "Pro"}
        </span>

        <div className="mb-2.5">
          <p className="text-[13px] font-bold flex items-center gap-1" style={{ color: "var(--aa-text)" }}>
            Pro
            <span style={{ color: "var(--aa-orange)", fontSize: "11px" }}>★</span>
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--aa-text-muted)" }}>
            9,99 €/mes
          </p>
        </div>

        <ul className="space-y-1.5 flex-1">
          {PRO_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-[11px]" style={{ color: isPro ? "var(--aa-text)" : "var(--aa-text-muted)" }}>
              <span
                className="mt-0.5 shrink-0 text-[10px]"
                style={{ color: isPro ? "var(--aa-green-dark)" : "var(--aa-orange)" }}
              >
                ✓
              </span>
              {f}
            </li>
          ))}
        </ul>

        {/* CTA solo si el usuario es Free */}
        {isFree && (
          <button
            type="button"
            onClick={onUpgrade}
            className="mt-3 w-full rounded-xl py-2 text-[11px] font-bold text-white transition hover:opacity-90 active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, var(--aa-orange) 0%, #f0a060 100%)",
              boxShadow: "0 3px 10px rgba(232,131,74,0.28)",
            }}
          >
            Activar Pro →
          </button>
        )}
      </div>

    </div>
  );
}
