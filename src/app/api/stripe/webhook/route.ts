import 'server-only';
import { z } from 'zod';
import { maxCheckoutConfig } from '@/lib/billing/max';
import { StripeTest, EventSchema, validStripeSignature, boundedWebhookBody, checkoutFailureReason } from '@/lib/billing/stripe-test';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api/context';

export const runtime = 'nodejs';
const EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'];

export async function POST(request: Request) {
  const config = maxCheckoutConfig();
  if (!config) return apiError(503, 'not_available', 'Servicio no disponible.');
  let event;
  try {
    const raw = await boundedWebhookBody(request);
    if (!validStripeSignature(raw, request.headers.get('stripe-signature'), config.webhook)) throw new Error('signature');
    event = EventSchema.parse(JSON.parse(raw));
  } catch { return apiError(400, 'invalid_event', 'Evento no válido.'); }
  if (!EVENTS.includes(event.type)) return Response.json({ received: true });
  try {
    const stripe = new StripeTest(config.secret);
    let subscriptionId = event.data.object.id; let sessionWorkspace: string | undefined;
    if (event.type === 'checkout.session.completed') {
      const session = await stripe.session(event.data.object.id);
      if (session.status !== 'complete' || !session.subscription) throw new Error('checkout_incomplete');
      subscriptionId = session.subscription; sessionWorkspace = session.metadata.workspace_id;
    }
    // Retrieve the current state; the browser return and the signed payload alone grant nothing.
    const subscription = await stripe.subscription(subscriptionId);
    const workspaceId = subscription.metadata.workspace_id;
    // Subscriptions Adaptaula did not create (or of another price) are acknowledged and never alter a plan.
    if (!workspaceId || subscription.items.data[0]?.price.id !== config.priceId) return Response.json({ received: true });
    if (!z.uuid().safeParse(workspaceId).success || (sessionWorkspace !== undefined && sessionWorkspace !== workspaceId)) throw new Error('max_binding_invalid');
    const result = await createAdminClient().rpc('sync_max_subscription', { p_workspace: workspaceId, p_subscription: subscription.id,
      p_price: config.priceId, p_status: subscription.status,
      p_start: new Date(subscription.current_period_start * 1000).toISOString(),
      p_end: new Date(subscription.current_period_end * 1000).toISOString(),
      p_cancel_at_period_end: subscription.cancel_at_period_end, p_event: event.id });
    if (result.error) throw new Error('max_sync_failed');
    return Response.json({ received: true });
  } catch (error) {
    logger.warn('max_webhook_failed', { eventId: event.id, reason: checkoutFailureReason(error) });
    return apiError(503, 'sync_failed', 'No se ha podido confirmar el evento.');
  }
}
