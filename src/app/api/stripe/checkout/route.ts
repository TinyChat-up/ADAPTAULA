import 'server-only';
import { getApiContext, apiError } from '@/lib/api/context';
import { canBuyPlan, maxCheckoutConfig } from '@/lib/billing/max';
import { StripeTest, checkoutFailureReason, checkoutUrl } from '@/lib/billing/stripe-test';
import { getWorkspaceUsage } from '@/lib/plans/usage';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
const WINDOW_SECONDS = 600;

export async function POST(request: Request) {
  const auth = await getApiContext(request, { mutating: true });
  if ('response' in auth) return auth.response;
  const { ctx } = auth;
  const config = maxCheckoutConfig();
  if (!config || !canBuyPlan(ctx)) return apiError(404, 'not_available', 'La contratación de Max no está disponible para esta cuenta.');
  try {
    const admin = createAdminClient();
    const limit = await admin.rpc('rate_limit_allowed', { p_key: `max-checkout:${ctx.user.id}`, p_window_seconds: 3600, p_max: 10 });
    if (limit.error || !limit.data) return apiError(429, 'rate_limited', 'Espera unos minutos antes de volver a intentarlo.');
    if ((await getWorkspaceUsage(ctx.workspace.id)).plan.slug === 'max') return apiError(409, 'already_max', 'Tu espacio ya tiene el plan Max.');
    const plan = await admin.from('plans').select('monthly_price_cents').eq('slug', 'max').single();
    if (plan.error || !plan.data) throw new Error('catalog_unavailable');
    const stripe = new StripeTest(config.secret);
    await stripe.checkPrice(config.priceId, plan.data.monthly_price_cents);
    // Repeated clicks within the same ten minutes reuse one Checkout session (same idempotency key and parameters).
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
    const session = await stripe.checkout({ workspaceId: ctx.workspace.id, userId: ctx.user.id, priceId: config.priceId,
      site: config.site, expires: window + 3600, key: `max-checkout:${ctx.workspace.id}:${window}` });
    if (session.status !== 'open' || session.metadata.workspace_id !== ctx.workspace.id) throw new Error('checkout_session_invalid');
    return Response.json({ url: checkoutUrl(session.url) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logger.warn('max_checkout_failed', { workspaceId: ctx.workspace.id, reason: checkoutFailureReason(error) });
    return apiError(503, 'checkout_failed', 'No hemos podido abrir el pago. No se ha hecho ningún cargo; inténtalo de nuevo en unos minutos.');
  }
}
