"use client";

interface Props {
  onBack: () => void;
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill={color} fillOpacity={0.15} stroke={color} strokeWidth="1.5" />
      <path d="M5 8l2 2 4-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlanBenefit({ text, color }: { text: string; color: string }) {
  return (
    <li className="flex items-start gap-2 text-sm" style={{ color: "#4B5B4C" }}>
      <CheckIcon color={color} />
      {text}
    </li>
  );
}

export default function SubscriptionScreen({ onBack }: Props) {
  return (
    <div className="aa-screen px-4 py-12">
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-2xl font-bold" style={{ color: "var(--aa-green-dark)" }}>
          Elige el plan que mejor
          <br className="hidden sm:block" /> se adapta a ti
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--aa-text-muted)" }}>
          Más de 2.000 docentes ya usan AdaptAula
        </p>
      </div>

      {/* Plan cards */}
      <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-5 sm:grid-cols-3">

        {/* ── GRATUITO ── */}
        <div className="flex flex-col rounded-3xl border bg-white p-6" style={{ borderColor: "#dde8dd" }}>
          <span
            className="mb-4 self-start rounded-full border px-3 py-0.5 text-xs font-semibold"
            style={{ borderColor: "#c8dcc8", color: "var(--aa-text-muted)" }}
          >
            Gratis para siempre
          </span>
          <div className="mb-5">
            <span className="text-3xl font-bold" style={{ color: "var(--aa-text)" }}>0 €</span>
            <span className="text-sm" style={{ color: "var(--aa-text-muted)" }}>/mes</span>
          </div>
          <ul className="mb-6 flex-1 space-y-3">
            <PlanBenefit text="3 adaptaciones al mes" color="#9aaa9b" />
            <PlanBenefit text="Formatos básicos (PDF)" color="#9aaa9b" />
            <PlanBenefit text="Sin pictogramas ARASAAC" color="#9aaa9b" />
          </ul>
          <button
            type="button"
            className="w-full rounded-full border py-2.5 text-sm font-semibold transition hover:bg-gray-50"
            style={{ borderColor: "var(--aa-green)", color: "var(--aa-green)" }}
          >
            Empezar gratis
          </button>
        </div>

        {/* ── PRO ── */}
        <div
          className="relative flex flex-col rounded-3xl border-2 bg-white p-6"
          style={{ borderColor: "var(--aa-orange)", boxShadow: "0 8px 30px rgba(232,131,74,0.15)" }}
        >
          {/* Badge */}
          <span
            className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-1 text-xs font-bold text-white"
            style={{ background: "var(--aa-orange)" }}
          >
            Más popular
          </span>

          <span
            className="mb-4 self-start rounded-full border px-3 py-0.5 text-xs font-semibold"
            style={{ borderColor: "#f5c5a0", color: "var(--aa-orange)" }}
          >
            Pro
          </span>
          <div className="mb-5">
            <span className="text-3xl font-bold" style={{ color: "var(--aa-orange)" }}>9,99 €</span>
            <span className="text-sm" style={{ color: "var(--aa-text-muted)" }}>/mes</span>
          </div>
          <ul className="mb-6 flex-1 space-y-3">
            <PlanBenefit text="Adaptaciones ilimitadas" color="var(--aa-orange)" />
            <PlanBenefit text="Pictogramas ARASAAC incluidos" color="var(--aa-orange)" />
            <PlanBenefit text="Todos los tipos de adaptación" color="var(--aa-orange)" />
            <PlanBenefit text="Exportar PDF y Word" color="var(--aa-orange)" />
            <PlanBenefit text="Historial de adaptaciones" color="var(--aa-orange)" />
          </ul>
          <button
            type="button"
            className="w-full rounded-full py-2.5 text-sm font-bold text-white transition"
            style={{
              background: "linear-gradient(135deg, var(--aa-orange) 0%, #f0a060 100%)",
              boxShadow: "0 4px 14px rgba(232,131,74,0.35)",
            }}
          >
            Suscribirse ahora
          </button>
        </div>

        {/* ── CENTRO EDUCATIVO ── */}
        <div className="flex flex-col rounded-3xl border-2 bg-white p-6" style={{ borderColor: "var(--aa-green)" }}>
          <span
            className="mb-4 self-start rounded-full border px-3 py-0.5 text-xs font-semibold"
            style={{ borderColor: "#c8dcc8", color: "var(--aa-green-dark)" }}
          >
            Para equipos
          </span>
          <div className="mb-5">
            <span className="text-2xl font-bold" style={{ color: "var(--aa-text)" }}>Precio a medida</span>
          </div>
          <ul className="mb-6 flex-1 space-y-3">
            <PlanBenefit text="Todo lo incluido en Pro" color="var(--aa-green)" />
            <PlanBenefit text="Múltiples docentes" color="var(--aa-green)" />
            <PlanBenefit text="Panel de administración" color="var(--aa-green)" />
            <PlanBenefit text="Soporte prioritario 24/7" color="var(--aa-green)" />
            <PlanBenefit text="Formación incluida" color="var(--aa-green)" />
          </ul>
          <button
            type="button"
            className="w-full rounded-full py-2.5 text-sm font-bold text-white transition"
            style={{ background: "var(--aa-green)" }}
          >
            Contactar
          </button>
        </div>
      </div>

      {/* Trust badges */}
      <div className="mx-auto mt-10 flex max-w-[500px] justify-center gap-8">
        {[
          {
            label: "Pago seguro",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 7.5v5m-2.5-2.5h5" />
              </svg>
            ),
          },
          {
            label: "Cumplimiento LOPD",
            icon: (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            ),
          },
          {
            label: "Valoración 4.8/5",
            icon: (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ),
          },
        ].map(({ label, icon }) => (
          <div key={label} className="flex flex-col items-center gap-1.5 text-center">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "rgba(123,175,127,0.12)", color: "var(--aa-green-dark)" }}
            >
              {icon}
            </div>
            <span className="text-xs" style={{ color: "var(--aa-text-muted)" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-xs" style={{ color: "var(--aa-text-muted)" }}>
        Cancela cuando quieras. Sin permanencia.
      </p>

      {/* Back to adaptation */}
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm transition"
          style={{ color: "var(--aa-text-muted)" }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Volver a mi adaptación
        </button>
      </div>
    </div>
  );
}
