-- Migration: subscriptions table
-- Sprint B.1 — AdaptAula
-- Apply via Supabase Dashboard > SQL Editor, or via supabase db push

-- ─── Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                    text        NOT NULL DEFAULT 'free'
                                        CHECK (plan IN ('free', 'pro')),
  status                  text        NOT NULL DEFAULT 'active'
                                        CHECK (status IN (
                                          'active', 'canceled', 'past_due',
                                          'incomplete', 'trialing', 'paused'
                                        )),
  stripe_customer_id      text,
  stripe_subscription_id  text        UNIQUE,
  stripe_price_id         text,
  current_period_end      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx
  ON public.subscriptions (user_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON public.subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON public.subscriptions (status);

-- ─── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users may read their own subscription
CREATE POLICY "Users can read own subscription"
  ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE are reserved for the service-role backend only.
-- No client-side policies — writes happen exclusively via the webhook handler
-- using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).

-- ─── Auto-update updated_at ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
