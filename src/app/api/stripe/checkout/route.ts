import 'server-only';
import { getApiContext, apiError } from '@/lib/api/context';
import { billingPilotConfig } from '@/lib/billing/pilot';
import { StripeTest, checkoutFailureReason, checkoutUrl } from '@/lib/billing/stripe-test';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const auth = await getApiContext(request, { mutating: true });
  if ('response' in auth) return auth.response;
  const { ctx } = auth;
  const config = billingPilotConfig(ctx.workspace.id);
  if (!config || ctx.role !== 'owner' || ctx.workspace.type !== 'personal') return apiError(404, 'not_available', 'La prueba privada no está disponible para esta cuenta.');
  try {
    const admin = createAdminClient();
    const limit = await admin.rpc('rate_limit_allowed', { p_key: `stripe-pilot:${ctx.user.id}`, p_window_seconds: 3600, p_max: 5 });
    if (limit.error || !limit.data) return apiError(429, 'rate_limited', 'Espera antes de volver a intentarlo.');
    // The database rechecks owner, single member and absence of any previous subscription.
    const start = await admin.rpc('start_billing_pilot', { p_workspace: ctx.workspace.id, p_user: ctx.user.id });
    if (start.error || typeof start.data !== 'string') return apiError(409, 'not_eligible', 'No se puede iniciar el piloto: revisa si ya existe una suscripción o solicitud.');
    const record = await admin.from('billing_pilot_requests').select('id,session_id,state,expires_at,created_at').eq('id', start.data).single();
    if (record.error || !record.data || record.data.state !== 'pending' || Date.parse(record.data.expires_at) <= Date.now()) return apiError(409, 'pilot_closed', 'El piloto ya está iniciado o ha finalizado.');
    const stripe = new StripeTest(config.secret);
    let session;
    if (record.data.session_id) session = await stripe.session(record.data.session_id);
    else {
      // Never recreate an unbound session outside Stripe's idempotency retention window.
      if (Date.now() - Date.parse(record.data.created_at) > 30 * 60000) return apiError(409, 'pilot_expired', 'La preparación ha caducado. Requiere revisión antes de repetirla.');
      const plan = await admin.from('plans').select('monthly_price_cents').eq('slug', 'max').single();
      if (plan.error || !plan.data) throw new Error('catalog_unavailable');
      await stripe.checkPrice(config.priceId, plan.data.monthly_price_cents);
      session = await stripe.checkout({ requestId: start.data, workspaceId: ctx.workspace.id, priceId: config.priceId,
        site: config.site, expires: Math.floor(Date.parse(record.data.created_at) / 1000) + 3600 });
      const bound = await admin.from('billing_pilot_requests').update({ session_id: session.id }).eq('id', start.data).is('session_id', null).select('id');
      if (bound.error) throw new Error('pilot_bind_failed');
      if (!bound.data?.length) {
        const current = await admin.from('billing_pilot_requests').select('session_id').eq('id', start.data).single();
        if (current.error || current.data?.session_id !== session.id) throw new Error('pilot_bind_failed');
      }
    }
    if (session.status !== 'open' || session.metadata.pilot_request !== start.data || session.metadata.workspace_id !== ctx.workspace.id) throw new Error('pilot_session_invalid');
    return Response.json({ url: checkoutUrl(session.url) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logger.warn('stripe_pilot_checkout_failed', { workspaceId: ctx.workspace.id, reason: checkoutFailureReason(error) });
    return apiError(503, 'checkout_failed', 'No se ha podido preparar Stripe de prueba. No se ha confirmado ningún cambio de plan.');
  }
}
