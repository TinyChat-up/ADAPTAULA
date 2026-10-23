import 'server-only';
import { publicEnv } from '@/lib/config/env.public';
import { serverEnv } from '@/lib/config/env.server';
import { imagePilotAllows } from '@/lib/materials/visuals/illustrate/pilot';
import { getSupabase } from '@/lib/auth/session';

/** This is a private TEST checkout, independent of public plan availability. */
export function billingPilotConfig(workspaceId?: string) {
  const env = serverEnv();
  const target = env.AI_IMAGES_PILOT_WORKSPACE_ID;
  if (!env.STRIPE_PILOT_ENABLED || !target || (workspaceId && workspaceId !== target)
    || !env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')
    || !env.STRIPE_PILOT_PRICE_ID
    || !imagePilotAllows(env, target, publicEnv().NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV)) return null;
  return { workspaceId: target, priceId: env.STRIPE_PILOT_PRICE_ID,
    secret: env.STRIPE_SECRET_KEY, webhook: env.STRIPE_WEBHOOK_SECRET, site: publicEnv().NEXT_PUBLIC_SITE_URL };
}

export async function loadBillingPilot(workspaceId: string) {
  const result = await (await getSupabase()).from('billing_pilot_requests').select('state,expires_at').eq('workspace_id',workspaceId).maybeSingle();
  if (result.error) return null; // An unapplied migration must not publish an operational button.
  return { state: result.data && Date.parse(result.data.expires_at) <= Date.now() ? 'canceled' : result.data?.state ?? null,
    expires: result.data?.expires_at ?? null };
}
