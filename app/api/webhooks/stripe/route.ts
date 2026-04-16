import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  upsertSubscription,
  getUserIdByCustomer,
  type Plan,
  type SubscriptionStatus,
} from "@/lib/subscriptionService";

// Lazy init — STRIPE_SECRET_KEY is only required at request time, not build time
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key);
}

// Events we care about for subscription lifecycle
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function derivePlan(priceId: string | null | undefined): Plan {
  if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  // Unknown price defaults to pro when subscription exists (safe direction).
  // Adjust if you add more plans in the future.
  return "pro";
}

function deriveStatus(stripeStatus: string): SubscriptionStatus {
  const allowed: SubscriptionStatus[] = [
    "active", "canceled", "past_due", "incomplete", "trialing", "paused",
  ];
  return allowed.includes(stripeStatus as SubscriptionStatus)
    ? (stripeStatus as SubscriptionStatus)
    : "active";
}

/**
 * Resolves userId from subscription metadata, falling back to a DB lookup
 * by stripe_customer_id if metadata is missing.
 */
async function resolveUserId(
  subscriptionMetaUserId: string | null | undefined,
  stripeCustomerId: string | null | undefined,
): Promise<string | null> {
  if (subscriptionMetaUserId) return subscriptionMetaUserId;
  if (stripeCustomerId) return getUserIdByCustomer(stripeCustomerId);
  return null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Read raw body for signature verification — must use .text(), not .json()
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    console.error("Webhook signature error:", message);
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 400 });
  }

  // Ignore events we don't handle
  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  try {
    switch (event.type) {
      // ── Checkout completed ─────────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode !== "subscription") break;

        const userId = session.metadata?.userId ?? null;
        if (!userId) {
          console.error("checkout.session.completed: missing metadata.userId", session.id);
          break;
        }

        const stripeSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        const stripeCustomerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;

        if (!stripeSubscriptionId || !stripeCustomerId) {
          console.error("checkout.session.completed: missing subscription or customer", session.id);
          break;
        }

        // Fetch full subscription to get price and period
        // Note: in Stripe 17.x current_period_end moved to SubscriptionItem
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const firstItem = subscription.items.data[0];
        const priceId = firstItem?.price?.id ?? null;
        const periodEnd = firstItem?.current_period_end
          ? new Date(firstItem.current_period_end * 1000)
          : null;

        await upsertSubscription({
          userId,
          plan: derivePlan(priceId),
          status: deriveStatus(subscription.status),
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId: priceId,
          currentPeriodEnd: periodEnd,
        });
        break;
      }

      // ── Subscription created ───────────────────────────────────────────────
      case "customer.subscription.created":
      // ── Subscription updated (renewal, plan change, status change) ─────────
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;

        const stripeCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id ?? null;

        const userId = await resolveUserId(
          subscription.metadata?.userId,
          stripeCustomerId ?? undefined,
        );

        if (!userId) {
          console.error(`${event.type}: could not resolve userId`, subscription.id);
          break;
        }

        // In Stripe 17.x current_period_end is on SubscriptionItem, not Subscription
        const firstItem = subscription.items.data[0];
        const priceId = firstItem?.price?.id ?? null;
        const periodEnd = firstItem?.current_period_end
          ? new Date(firstItem.current_period_end * 1000)
          : null;

        await upsertSubscription({
          userId,
          plan: derivePlan(priceId),
          status: deriveStatus(subscription.status),
          stripeCustomerId: stripeCustomerId ?? "",
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          currentPeriodEnd: periodEnd,
        });
        break;
      }

      // ── Subscription deleted (canceled / expired) ──────────────────────────
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        const stripeCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id ?? null;

        const userId = await resolveUserId(
          subscription.metadata?.userId,
          stripeCustomerId ?? undefined,
        );

        if (!userId) {
          console.error("customer.subscription.deleted: could not resolve userId", subscription.id);
          break;
        }

        await upsertSubscription({
          userId,
          plan: "free",
          status: "canceled",
          stripeCustomerId: stripeCustomerId ?? "",
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.items.data[0]?.price?.id ?? null,
          currentPeriodEnd: null,
        });
        break;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Webhook handler error (${event.type}):`, message);
    // Return 200 anyway — Stripe retries on non-2xx, and most errors here are
    // data issues we can't recover from by retrying the same event.
    return NextResponse.json({ received: true, warning: message });
  }

  return NextResponse.json({ received: true });
}
