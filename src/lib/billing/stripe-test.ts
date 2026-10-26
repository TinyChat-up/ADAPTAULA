import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const StripeId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
export const CheckoutSchema = z.object({
  id: StripeId('cs_test'), livemode: z.literal(false), mode: z.literal('subscription'),
  subscription: StripeId('sub').nullable(),
  status: z.enum(['open', 'complete', 'expired']),
  url: z.url().nullable(), metadata: z.record(z.string(), z.string()),
});
export const SubscriptionSchema = z.object({
  id: StripeId('sub'), livemode: z.literal(false),
  status: z.enum(['active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired']),
  current_period_start: z.number().int().positive(), current_period_end: z.number().int().positive(),
  cancel_at_period_end: z.boolean().default(false),
  metadata: z.record(z.string(), z.string()),
  items: z.object({ data: z.array(z.object({ price: z.object({ id: StripeId('price') }) })).length(1) }),
});
export const EventSchema = z.object({
  id: StripeId('evt'), livemode: z.literal(false), type: z.string(),
  data: z.object({ object: z.object({ id: z.string(), metadata: z.record(z.string(), z.string()).optional() }) }),
});

/** Raw bytes, timestamp tolerance and all v1 signatures (secret rotation); never trust a parsed unsigned event. */
export function validStripeSignature(raw: string, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!signature || !secret.startsWith('whsec_') || signature.length > 4096) return false;
  const parts = signature.split(',').map(x => x.trim().split('='));
  const times = parts.filter(([k]) => k === 't');
  if (times.length !== 1 || !/^\d+$/.test(times[0]?.[1] ?? '')) return false;
  const t = times[0]![1]!;
  if (Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return parts.some(([k,v]) => k === 'v1' && /^[a-f0-9]{64}$/.test(v ?? '') && timingSafeEqual(expected, Buffer.from(v!, 'hex')));
}

/** Pinned REST contract, no automatic retries of mutations; no live key can reach this transport. */
export class StripeTest {
  constructor(private readonly secret: string, private readonly send: typeof fetch = fetch) {
    if (!secret.startsWith('sk_test_')) throw new Error('stripe_test_only');
  }
  async request(path: string, fields?: URLSearchParams, key?: string): Promise<unknown> {
    if (!/^\/(prices\/price_[A-Za-z0-9]+|checkout\/sessions(?:\/cs_test_[A-Za-z0-9]+)?|subscriptions\/sub_[A-Za-z0-9]+)$/.test(path)) throw new Error('stripe_path_invalid');
    const response = await this.send(`https://api.stripe.com/v1${path}`, {
      method: fields ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${this.secret}`, 'Stripe-Version': '2025-02-24.acacia',
        ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}) }, body: fields?.toString(),
    });
    if (!response.ok) throw new Error(`stripe_unavailable:${response.status}`);
    return response.json();
  }
  async checkPrice(id: string, amount: number) {
    const parsed = z.object({ id: StripeId('price'), livemode: z.literal(false), active: z.literal(true),
      type: z.literal('recurring'), currency: z.literal('eur'), unit_amount: z.number().int(),
      // Without automatic tax (never enabled here) an unspecified price charges exactly its amount, as «IVA incluido» promises;
      // only an exclusive price, which would add tax on top, is refused.
      tax_behavior: z.enum(['inclusive', 'unspecified']), recurring: z.object({ interval: z.literal('month'), interval_count: z.literal(1) }),
    }).safeParse(await this.request(`/prices/${id}`));
    // Names the price fields that do not match (never their values), so the person who set up Stripe knows what to fix.
    if (!parsed.success) throw new Error(`stripe_price_invalid:${[...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(',')}`);
    const price = parsed.data;
    if (price.id !== id || price.unit_amount !== amount) throw new Error('stripe_price_mismatch');
  }
  async checkout(input: { workspaceId: string; userId: string; priceId: string; site: string; expires: number; key: string }) {
    const site = new URL(input.site);
    if ((site.protocol !== 'https:' && site.hostname !== 'localhost' && site.hostname !== '127.0.0.1') || site.username || site.password) throw new Error('stripe_return_url_invalid');
    const fields = new URLSearchParams({ mode: 'subscription', 'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': '1', success_url: `${site.origin}/app/uso?max=pendiente`,
      cancel_url: `${site.origin}/precios`, expires_at: String(input.expires), client_reference_id: input.workspaceId,
      'metadata[workspace_id]': input.workspaceId, 'metadata[user_id]': input.userId,
      'subscription_data[metadata][workspace_id]': input.workspaceId,
    });
    return CheckoutSchema.parse(await this.request('/checkout/sessions', fields, input.key));
  }
  async session(id: string) { return CheckoutSchema.parse(await this.request(`/checkout/sessions/${id}`)); }
  async subscription(id: string) { return SubscriptionSchema.parse(await this.request(`/subscriptions/${id}`)); }
}

export function checkoutUrl(value: string | null): string {
  const url = new URL(value ?? '');
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) throw new Error('stripe_url_invalid');
  return url.href;
}

export async function boundedWebhookBody(request: Request): Promise<string> {
  if (!request.body) throw new Error('empty_body');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) { await reader.cancel(); throw new Error('large_body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Only our own fixed codes reach the log: never a Stripe message, an id, a URL or a secret. */
export function checkoutFailureReason(error: unknown): string {
  if (error instanceof z.ZodError) return `stripe_response_invalid:${[...new Set(error.issues.map((i) => i.path.join('.')))].join(',')}`;
  return error instanceof Error && /^[a-z_]+(:[a-z0-9_.,]+)?$/.test(error.message) ? error.message : 'unknown';
}
