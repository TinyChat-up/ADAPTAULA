import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getUserPlan } from "@/lib/subscriptionService";

// Lazy init — STRIPE_SECRET_KEY is only required at request time, not build time
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key);
}

export async function POST(req: Request) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
    }

    // ── Validate plan ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const plan = typeof body.plan === "string" ? body.plan : "pro";

    if (plan !== "pro") {
      return NextResponse.json({ error: "Plan no válido para checkout" }, { status: 400 });
    }

    // ── Guard: already subscribed ───────────────────────────────────────────
    const currentPlan = await getUserPlan(user.id);
    if (currentPlan === "pro") {
      return NextResponse.json(
        { error: "Ya tienes una suscripción Pro activa", alreadySubscribed: true },
        { status: 409 },
      );
    }

    // ── Create Stripe Checkout Session ──────────────────────────────────────
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID!,
          quantity: 1,
        },
      ],
      // Pre-fill customer email
      customer_email: user.email,
      // Pass userId so the webhook can identify the user
      metadata: {
        userId: user.id,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
        },
      },
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=canceled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error al crear sesión de pago";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
