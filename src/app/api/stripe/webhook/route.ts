import 'server-only';
import { billingPilotConfig } from '@/lib/billing/pilot';
import { StripeTest, EventSchema, validStripeSignature, boundedWebhookBody } from '@/lib/billing/stripe-test';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api/context';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const config = billingPilotConfig();
  if (!config) return apiError(503, 'not_available', 'Servicio no disponible.');
  let event;
  try {
    const raw = await boundedWebhookBody(request);
    if (!validStripeSignature(raw, request.headers.get('stripe-signature'), config.webhook)) throw new Error('signature');
    event = EventSchema.parse(JSON.parse(raw));
  } catch { return apiError(400, 'invalid_event', 'Evento no válido.'); }
  if (!['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) return Response.json({ received: true });
  try {
    const admin = createAdminClient(); const stripe = new StripeTest(config.secret);
    let requestId: string | undefined; let sessionId: string | undefined;
    if (event.type === 'checkout.session.completed') {
      const session = await stripe.session(event.data.object.id);
      if (session.status !== 'complete' || !session.subscription) throw new Error('checkout_incomplete');
      requestId = session.metadata.pilot_request; sessionId = session.id;
    } else {
      const record = await admin.from('billing_pilot_requests').select('id,session_id').eq('stripe_subscription_id', event.data.object.id).maybeSingle();
      if (record.error) throw new Error('lookup_failed');
      if (!record.data) return Response.json({ received: true }); // Unrelated events never alter subscriptions.
      requestId = record.data.id; sessionId = record.data.session_id;
    }
    const record = await admin.from('billing_pilot_requests').select('id,workspace_id,session_id').eq('id', requestId ?? '').single();
    if (record.error || !record.data || record.data.workspace_id !== config.workspaceId || record.data.session_id !== sessionId) throw new Error('pilot_binding_invalid');
    const session = await stripe.session(record.data.session_id);
    if (!session.subscription || session.metadata.pilot_request !== record.data.id || session.metadata.workspace_id !== config.workspaceId) throw new Error('pilot_binding_invalid');
    // Retrieve the current state; the browser return and the signed payload alone grant nothing.
    const subscription = await stripe.subscription(session.subscription);
    if (subscription.metadata.pilot_request !== record.data.id || subscription.metadata.workspace_id !== config.workspaceId
      || subscription.items.data[0]?.price.id !== config.priceId) throw new Error('pilot_binding_invalid');
    const result = await admin.rpc('sync_billing_pilot', { p_request: record.data.id, p_session: session.id,
      p_subscription: subscription.id, p_price: config.priceId, p_status: subscription.status,
      p_start: new Date(subscription.current_period_start * 1000).toISOString(),
      p_end: new Date(subscription.current_period_end * 1000).toISOString(), p_event: event.id });
    if (result.error) throw new Error('pilot_sync_failed');
    return Response.json({ received: true });
  } catch {
    logger.warn('stripe_pilot_webhook_failed', { eventId: event.id });
    return apiError(503, 'sync_failed', 'No se ha podido confirmar el evento.');
  }
}
