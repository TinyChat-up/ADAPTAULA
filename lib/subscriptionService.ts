import { supabase } from "@/lib/supabaseClient";
import { createClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Plan = "free" | "pro";

export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "incomplete"
  | "trialing"
  | "paused";

export type SubscriptionRow = {
  id: string;
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
};

// Statuses that represent an active paid period
const PAID_STATUSES: SubscriptionStatus[] = ["active", "trialing"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeRow(row: Record<string, unknown>): SubscriptionRow {
  const plan = row.plan === "pro" ? "pro" : "free";
  const statusRaw = asStr(row.status);
  const status = (
    ["active", "canceled", "past_due", "incomplete", "trialing", "paused"].includes(statusRaw)
      ? statusRaw
      : "active"
  ) as SubscriptionStatus;

  return {
    id: asStr(row.id),
    userId: asStr(row.user_id),
    plan,
    status,
    stripeCustomerId: row.stripe_customer_id ? asStr(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? asStr(row.stripe_subscription_id) : null,
    stripePriceId: row.stripe_price_id ? asStr(row.stripe_price_id) : null,
    currentPeriodEnd: row.current_period_end ? asStr(row.current_period_end) : null,
    createdAt: asStr(row.created_at),
    updatedAt: asStr(row.updated_at),
  };
}

// ─── Read helpers (browser client, respects RLS) ──────────────────────────────

/**
 * Returns the active plan for a user.
 * Defaults to 'free' if no active/trialing subscription found or if it's expired.
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  const sub = await getActiveSubscription(userId);
  return sub?.plan ?? "free";
}

/**
 * Returns the most recent active subscription for a user, or null if none.
 * A subscription is considered active when its status is 'active' or 'trialing'
 * AND its current_period_end is in the future.
 */
export async function getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", PAID_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = normalizeRow(data as Record<string, unknown>);

  // Verify period hasn't expired even if status is still 'active' in DB
  if (row.currentPeriodEnd && new Date(row.currentPeriodEnd) < new Date()) {
    return null;
  }

  return row;
}

// ─── Write helpers (service-role client, bypasses RLS) ────────────────────────

/**
 * Creates a Supabase client using the service-role key.
 * ONLY call this from trusted server code (API routes, webhook handlers).
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the client.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Upserts a subscription record from Stripe event data.
 * Uses service-role to bypass RLS — only call from webhook/server handlers.
 */
export async function upsertSubscription(input: {
  userId: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const db = createServiceClient();

  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: input.userId,
      plan: input.plan,
      status: input.status,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      stripe_price_id: input.stripePriceId,
      current_period_end: input.currentPeriodEnd?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );

  if (error) throw new Error(`upsertSubscription failed: ${error.message}`);
}

/**
 * Looks up the userId stored in our DB for a given Stripe customer ID.
 * Used in subscription events that may not carry metadata.userId.
 */
export async function getUserIdByCustomer(stripeCustomerId: string): Promise<string | null> {
  const db = createServiceClient();

  const { data, error } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return asStr((data as Record<string, unknown>).user_id) || null;
}
