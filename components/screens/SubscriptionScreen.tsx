"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BrandLogo from "@/components/BrandLogo";

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

const FEATURES = [
  {
    title: "Adaptaciones ilimitadas",
    desc: "Sin restricciones por mes",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
      </svg>
    ),
  },
  {
    title: "PDF y DOCX",
    desc: "Listos para imprimir",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M12 18v-6m0 0l-3 3m3-3l3 3" />
      </svg>
    ),
  },
  {
    title: "IA avanzada",
    desc: "Resultados más precisos",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
  },
  {
    title: "Estilo propio",
    desc: "Aprende tu forma de enseñar",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21a9 9 0 110-18 9 9 0 010 18z" />
        <path d="M3.6 9h16.8M3.6 15h16.8" />
        <path d="M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
      </svg>
    ),
  },
] as const;

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
    <div className="flex min-h-screen flex-col" style={{ background: "#FEFCF9" }}>
      {/* ── Nav ── */}
      <nav
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "0.5px solid #EDE8E0" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1"
          style={{ fontSize: 12, color: "#8A8070", transition: "all 0.15s" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver
        </button>
        <BrandLogo compact />
        <div style={{ width: 52 }} />
      </nav>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-[520px]">
          {/* Badge */}
          <div className="mb-6 flex justify-center">
            <span
              className="inline-flex items-center gap-1.5"
              style={{
                background: "#F7F3EE",
                border: "0.5px solid #E8C4A0",
                borderRadius: 20,
                padding: "5px 14px",
                fontSize: 11,
                fontWeight: 500,
                color: "#B85A20",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#E8834A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6l4 6 5-4-2 10H5L3 8l5 4 4-6z" />
              </svg>
              Plan Pro
            </span>
          </div>

          {/* Headline */}
          <h1
            className="mb-2 text-center"
            style={{ fontSize: 24, fontWeight: 500, color: "#1A1A1A", lineHeight: 1.3 }}
          >
            Adaptaciones sin límites,
            <br />
            calidad profesional
          </h1>
          <p
            className="mx-auto mb-6 text-center"
            style={{ fontSize: 13, color: "#8A8070", maxWidth: 380 }}
          >
            Genera fichas adaptadas ilimitadas, exporta en PDF y DOCX, y benefíciate de IA de mayor precisión.
          </p>

          {/* Feature grid */}
          <div className="mb-6 grid grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{ background: "#fff", border: "0.5px solid #EDE8E0", borderRadius: 11, padding: 14 }}
              >
                <div
                  className="mb-2.5 flex items-center justify-center"
                  style={{ width: 32, height: 32, borderRadius: 8, background: "#F2EEE8" }}
                >
                  {f.icon}
                </div>
                <p style={{ fontSize: 12, fontWeight: 500, color: "#1A1A1A" }}>{f.title}</p>
                <p className="mt-0.5" style={{ fontSize: 11, color: "#8A8070" }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Price */}
          <div className="mb-6 text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span style={{ fontSize: 38, fontWeight: 500, color: "#1A1A1A" }}>9,99 €</span>
              <span style={{ fontSize: 14, color: "#8A8070" }}>/mes</span>
            </div>
            <p className="mt-1" style={{ fontSize: 12, color: "#A09888" }}>
              Sin permanencia · cancela cuando quieras
            </p>
          </div>

          {/* Error */}
          {checkoutError && (
            <div
              className="mb-4 text-center text-sm"
              style={{ borderRadius: 10, padding: "10px 16px", background: "#fef2f2", border: "0.5px solid #f5c6c6", color: "#c53030" }}
            >
              {checkoutError}
            </div>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={() => void handleProCheckout()}
            disabled={checkoutBusy}
            className="flex w-full items-center justify-center gap-2 text-white disabled:opacity-60"
            style={{ borderRadius: 10, padding: 13, fontSize: 13, fontWeight: 500, background: "#4A7C59", transition: "all 0.15s" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            {checkoutBusy ? "Redirigiendo a Stripe…" : "Activar AdaptAula Pro"}
          </button>

          {/* Secondary link */}
          <p className="mt-4 text-center" style={{ fontSize: 12, color: "#8A8070" }}>
            ¿Ya eres Pro?{" "}
            <a href="/login" style={{ color: "#4A7C59", fontWeight: 500, transition: "all 0.15s" }}>
              Accede a tu cuenta →
            </a>
          </p>

          {/* Trust signals */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {[
              {
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>,
                text: "Pago seguro",
              },
              {
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
                text: "Factura disponible",
              },
              {
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
                text: "Sin permanencia",
              },
            ].map((t) => (
              <span key={t.text} className="inline-flex items-center gap-1.5" style={{ fontSize: 11, color: "#A09888" }}>
                {t.icon} {t.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
