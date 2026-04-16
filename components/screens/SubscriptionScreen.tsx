"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Props {
  onBack: () => void;
}

async function startProCheckout(): Promise<{ url: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";

  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ plan: "pro" }),
  });

  const json = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const msg = typeof json.error === "string" ? json.error : "Error al iniciar el pago";
    throw new Error(msg);
  }

  if (typeof json.url !== "string") throw new Error("Respuesta inesperada del servidor");
  return { url: json.url };
}

// ─── Feature card data ────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: "Adaptaciones ilimitadas",
    description: "Sin restricciones por mes. Adapta todos los materiales que necesites.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    ),
  },
  {
    title: "Exportación PDF y DOCX",
    description: "Descarga fichas listas para imprimir en los formatos del aula.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    ),
  },
  {
    title: "IA de mayor precisión",
    description: "GPT-4.1 con instrucciones pedagógicas premium. Resultados más fieles, consignas más claras.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
      />
    ),
  },
  {
    title: "Estilo docente propio",
    description: "Aprende de tus materiales y adapta con tu estructura y tono habitual.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
      />
    ),
  },
] as const;

const TRUST_ITEMS = ["✓ Pago seguro vía Stripe", "✓ Cancela cuando quieras", "✓ Factura disponible"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionScreen({ onBack }: Props) {
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleProCheckout() {
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const { url } = await startProCheckout();
      window.location.href = url;
    } catch (err: unknown) {
      setCheckoutError(err instanceof Error ? err.message : "Error inesperado");
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="aa-screen px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-[640px]">

        {/* ── Top badge ── */}
        <div className="mb-6 flex justify-center">
          <span
            className="inline-flex items-center rounded-full px-4 py-1.5 text-xs font-semibold text-white"
            style={{ background: "var(--aa-green-dark)" }}
          >
            Plan Pro · 9,99 €/mes
          </span>
        </div>

        {/* ── Headline ── */}
        <h1
          className="mb-4 text-center text-3xl font-bold leading-tight sm:text-4xl"
          style={{ color: "var(--aa-text)" }}
        >
          Adaptaciones sin límites,
          <br className="hidden sm:block" /> calidad profesional
        </h1>

        {/* ── Subheadline ── */}
        <p
          className="mx-auto mb-10 max-w-[480px] text-center text-base leading-relaxed sm:text-lg"
          style={{ color: "var(--aa-text-muted)" }}
        >
          Genera fichas adaptadas ilimitadas, exporta en PDF y DOCX, y benefíciate de inteligencia artificial de mayor precisión.
        </p>

        {/* ── Feature grid 2×2 ── */}
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl bg-white p-5"
              style={{ border: "1px solid #E8E5E0", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <div
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: "rgba(123,175,127,0.12)" }}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="var(--aa-green-dark)"
                  strokeWidth={1.6}
                >
                  {f.icon}
                </svg>
              </div>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--aa-text)" }}>
                {f.title}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
                {f.description}
              </p>
            </div>
          ))}
        </div>

        {/* ── Price block ── */}
        <div className="mb-6 text-center">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-5xl font-bold" style={{ color: "var(--aa-text)" }}>9,99 €</span>
            <span className="text-base" style={{ color: "var(--aa-text-muted)" }}>/mes</span>
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--aa-text-muted)" }}>
            Cancela cuando quieras. Sin permanencia.
          </p>
        </div>

        {/* ── Error ── */}
        {checkoutError && (
          <div
            className="mb-4 rounded-xl px-4 py-3 text-center text-sm"
            style={{ background: "rgba(190,18,60,0.08)", color: "#be123c" }}
          >
            {checkoutError}
          </div>
        )}

        {/* ── Primary CTA ── */}
        <button
          type="button"
          onClick={() => void handleProCheckout()}
          disabled={checkoutBusy}
          className="w-full rounded-2xl py-4 text-base font-bold text-white transition hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
          style={{
            background: "var(--aa-green-dark)",
            boxShadow: "0 4px 20px rgba(74,124,89,0.30)",
          }}
        >
          {checkoutBusy ? "Redirigiendo a Stripe…" : "Activar AdaptAula Pro"}
        </button>

        {/* ── Secondary link ── */}
        <p className="mt-4 text-center text-sm" style={{ color: "var(--aa-text-muted)" }}>
          ¿Ya eres Pro?{" "}
          <a
            href="/login"
            className="font-medium transition hover:opacity-75"
            style={{ color: "var(--aa-green-dark)" }}
          >
            Accede a tu cuenta →
          </a>
        </p>

        {/* ── Trust signals ── */}
        <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
          {TRUST_ITEMS.map((t) => (
            <span key={t} className="text-xs" style={{ color: "var(--aa-text-muted)" }}>
              {t}
            </span>
          ))}
        </div>

        {/* ── Back ── */}
        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm transition hover:opacity-75"
            style={{ color: "var(--aa-text-muted)" }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
