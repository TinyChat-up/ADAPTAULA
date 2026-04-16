"use client";

// PlanBadge — indicador de plan actual para navbar/header.
// free: pill crema + "Activar Pro →" link
// pro:  pill verde oscuro con estrella

interface Props {
  plan: "free" | "pro";
  onUpgrade?: () => void;
}

export default function PlanBadge({ plan, onUpgrade }: Props) {
  if (plan === "pro") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
        style={{ background: "var(--aa-green-dark)" }}
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M6 .5 7.3 3.2l3-.4-2.1 2 .5 3-2.7-1.4-2.7 1.4.5-3-2.1-2 3 .4z" />
        </svg>
        Pro activo
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
        style={{ background: "#F0EDE8", color: "var(--aa-text-muted)" }}
      >
        Prueba gratuita
      </span>
      {onUpgrade && (
        <button
          type="button"
          onClick={onUpgrade}
          className="text-xs font-medium transition hover:opacity-75"
          style={{ color: "var(--aa-green-dark)" }}
        >
          Activar Pro →
        </button>
      )}
    </div>
  );
}
