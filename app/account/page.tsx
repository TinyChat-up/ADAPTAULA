"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import BrandLogo from "@/components/BrandLogo";
import { supabase } from "@/lib/supabaseClient";
import { signOut } from "@/lib/authService";

type SubscriptionData = {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
};

export default function AccountPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState("");

  useEffect(() => {
    const bootstrap = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push("/login?next=/account");
        return;
      }

      setUser(currentUser);

      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end, stripe_customer_id")
        .eq("user_id", currentUser.id)
        .in("status", ["active", "trialing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setSubscription(data as SubscriptionData | null);
      setLoading(false);
    };

    void bootstrap();
  }, [router]);

  const isPro =
    subscription?.plan === "pro" &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end) > new Date());

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/");
    } catch {
      // silently ignore sign-out errors
    }
  };

  const handleManageSubscription = async () => {
    setBillingError("");
    setBillingBusy(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;
      if (!token) throw new Error("Sin sesión activa.");

      const res = await fetch("/api/billing-portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Error al abrir el portal.");
      }

      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Error inesperado.");
      setBillingBusy(false);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <div
        className="flex min-h-svh items-center justify-center text-sm"
        style={{ background: "var(--aa-cream, #FAF7F2)", color: "var(--aa-text-muted, #6B7A6C)" }}
      >
        Cargando cuenta...
      </div>
    );
  }

  return (
    <div
      className="flex min-h-svh flex-col items-center px-4 py-10"
      style={{ background: "var(--aa-cream, #FAF7F2)" }}
    >
      <div
        className="w-full max-w-[480px] rounded-2xl bg-white px-8 py-10"
        style={{ boxShadow: "0 4px 24px rgba(44,59,45,0.08)" }}
      >
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/"
            className="text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
          >
            ← Volver
          </Link>
        </div>

        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <BrandLogo />
        </div>

        {/* Account section */}
        <section className="mb-6">
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
          >
            Tu cuenta
          </h2>
          <div
            className="rounded-2xl px-5 py-4"
            style={{ background: "var(--aa-cream, #FAF7F2)" }}
          >
            <p
              className="mb-0.5 text-xs font-semibold"
              style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
            >
              Email
            </p>
            <p
              className="text-sm font-medium"
              style={{ color: "var(--aa-text, #2C3B2D)" }}
            >
              {user?.email ?? "—"}
            </p>
          </div>
        </section>

        {/* Plan section */}
        <section className="mb-8">
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
          >
            Plan
          </h2>
          <div
            className="rounded-2xl px-5 py-4"
            style={{ background: "var(--aa-cream, #FAF7F2)" }}
          >
            <div className="flex items-center gap-3">
              {isPro ? (
                <span
                  className="rounded-full px-3 py-1 text-xs font-bold text-white"
                  style={{ background: "var(--aa-green-dark, #4A7C59)" }}
                >
                  ★ Pro activo
                </span>
              ) : (
                <span
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    borderColor: "#c8dcc8",
                    color: "var(--aa-text-muted, #6B7A6C)",
                    background: "#FAF7F2",
                  }}
                >
                  Prueba gratuita
                </span>
              )}
            </div>

            {isPro && subscription?.current_period_end ? (
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
              >
                Activo hasta {formatDate(subscription.current_period_end)}
              </p>
            ) : null}
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {isPro ? (
            <button
              type="button"
              onClick={handleManageSubscription}
              disabled={billingBusy}
              className="w-full rounded-full border py-3 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: "var(--aa-green-dark, #4A7C59)",
                color: "var(--aa-green-dark, #4A7C59)",
              }}
            >
              {billingBusy ? "Redirigiendo..." : "Gestionar suscripción"}
            </button>
          ) : null}

          {billingError ? (
            <p className="text-center text-xs" style={{ color: "#E11D48" }}>
              {billingError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full py-2 text-sm transition-opacity hover:opacity-70"
            style={{ color: "var(--aa-text-muted, #6B7A6C)" }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
