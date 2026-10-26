import 'server-only';
import { getUser } from '@/lib/auth/session';
import { getWorkspaceContext, type WorkspaceContext } from '@/lib/auth/workspace';
import { publicEnv } from '@/lib/config/env.public';
import { serverEnv } from '@/lib/config/env.server';
import { getWorkspaceUsage } from '@/lib/plans/usage';

/** Max is sold with Stripe in TEST mode only: a live key never enables it (the transport refuses it too). */
export function maxCheckoutConfig() {
  const env = serverEnv();
  if (!env.FLAG_MAX_PLAN_ENABLED || !env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')
    || !env.STRIPE_PILOT_PRICE_ID) return null;
  return { priceId: env.STRIPE_PILOT_PRICE_ID, secret: env.STRIPE_SECRET_KEY, webhook: env.STRIPE_WEBHOOK_SECRET, site: publicEnv().NEXT_PUBLIC_SITE_URL };
}

export const canBuyPlan = (ctx: WorkspaceContext) => ctx.role === 'owner' || ctx.role === 'admin';

/** What the Max card offers this visitor; resolved on the server, never from anything the browser sends. */
export type MaxOffer = 'unavailable' | 'sign_in' | 'buy' | 'current' | 'not_allowed';

export async function maxOffer(): Promise<MaxOffer> {
  try {
    if (!maxCheckoutConfig()) return 'unavailable';
    if (!(await getUser())) return 'sign_in';
    const ctx = await getWorkspaceContext();
    if ((await getWorkspaceUsage(ctx.workspace.id)).plan.slug === 'max') return 'current';
    return canBuyPlan(ctx) ? 'buy' : 'not_allowed';
  } catch { return 'unavailable'; }
}
