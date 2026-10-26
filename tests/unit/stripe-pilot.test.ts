import { expect,it,vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { StripeTest,checkoutFailureReason,validStripeSignature,checkoutUrl,EventSchema,SubscriptionSchema,boundedWebhookBody } from '@/lib/billing/stripe-test';
import { imagePilotAllows } from '@/lib/materials/visuals/illustrate/pilot';
const secret='whsec_fixture';
it('solo permite producción con modo explícito, backend y workspace exactos',()=>{
  const config={AI_IMAGES_PILOT_MODE:'production-pilot' as const,AI_IMAGES_PILOT_WORKSPACE_ID:'one',AI_IMAGES_PILOT_SUPABASE_URL:'https://project.supabase.co'};
  expect(imagePilotAllows(config,'one',config.AI_IMAGES_PILOT_SUPABASE_URL,'production')).toBe(true);
  expect(imagePilotAllows(config,'other',config.AI_IMAGES_PILOT_SUPABASE_URL,'production')).toBe(false);
  expect(imagePilotAllows(config,'one','https://other.supabase.co','production')).toBe(false);
  expect(imagePilotAllows(config,'one',config.AI_IMAGES_PILOT_SUPABASE_URL,'preview')).toBe(false);
});
it('firma sobre bytes, tolerancia temporal, rotación y manipulación',()=>{
  const raw='{"test":true}';const t='1700000000';const digest=createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex');
  const header=`t=${t},v1=${'0'.repeat(64)},v1=${digest}`;
  expect(validStripeSignature(raw,header,secret,1700000000000)).toBe(true);
  expect(validStripeSignature(raw+' ',header,secret,1700000000000)).toBe(false);
  expect(validStripeSignature(raw,header,secret,1700000500000)).toBe(false);
  expect(validStripeSignature(raw,`t=${t},t=${t},v1=${digest}`,secret,1700000000000)).toBe(false);
  expect(validStripeSignature(raw,'t=NaN,v1=oops',secret)).toBe(false);
});
it('no acepta claves, eventos ni suscripciones live o URLs de terceros',()=>{
  expect(()=>new StripeTest('sk_live_fixture')).toThrow('stripe_test_only');
  expect(()=>EventSchema.parse({id:'evt_X',livemode:true,type:'checkout.session.completed',data:{object:{id:'cs_X'}}})).toThrow();
  expect(()=>SubscriptionSchema.parse({livemode:true})).toThrow();
  expect(()=>checkoutUrl('https://checkout.stripe.com.attacker.test')).toThrow();
  expect(checkoutUrl('https://checkout.stripe.com/c/pay/test')).toBe('https://checkout.stripe.com/c/pay/test');
});
it('contrato de precio: mensual, EUR, IVA incluido y precio del catálogo',async()=>{
  const price={id:'price_Test',livemode:false,active:true,type:'recurring',currency:'eur',unit_amount:4990,tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1}};
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify(price)));
  const stripe=new StripeTest('sk_test_fixture',send);
  await stripe.checkPrice('price_Test',4990);
  expect(send.mock.calls[0]?.[1]?.headers).toMatchObject({'Stripe-Version':'2025-02-24.acacia'});
  await expect(stripe.checkPrice('price_Test',2490)).rejects.toThrow('stripe_price_mismatch');
  await expect(stripe.request('/customers/anything')).rejects.toThrow('stripe_path_invalid');
});
it('el registro nombra qué falla del precio o de Stripe, nunca sus valores',async()=>{
  const price={id:'price_Test',livemode:false,active:true,type:'recurring',currency:'eur',unit_amount:4990,tax_behavior:'unspecified',recurring:{interval:'year',interval_count:1}};
  const stripe=new StripeTest('sk_test_fixture',vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify(price))));
  const failure=await stripe.checkPrice('price_Test',4990).catch((e:unknown)=>e);
  expect(checkoutFailureReason(failure)).toBe('stripe_price_invalid:tax_behavior,recurring.interval');
  const down=await new StripeTest('sk_test_fixture',vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:404}))).checkPrice('price_Test',4990).catch((e:unknown)=>e);
  expect(checkoutFailureReason(down)).toBe('stripe_unavailable:404');
  expect(checkoutFailureReason(new Error('Invalid API Key provided: sk_test_123'))).toBe('unknown');
});
it('Checkout fija metadata, precio e idempotencia; no acepta return URL del navegador',async()=>{
  const send=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:'cs_test_One',livemode:false,mode:'subscription',subscription:null,status:'open',url:'https://checkout.stripe.com/c/pay/test',metadata:{}})));
  await new StripeTest('sk_test_fixture',send).checkout({requestId:'request',workspaceId:'workspace',priceId:'price_Test',site:'https://adaptaula.example',expires:1700003600});
  const call=send.mock.calls[0]![1]!;expect(call.headers).toMatchObject({'Idempotency-Key':'max-pilot:request'});
  const fields=new URLSearchParams(String(call.body));expect(fields.get('success_url')).toBe('https://adaptaula.example/app/uso?piloto=pendiente');
  expect(fields.get('subscription_data[metadata][workspace_id]')).toBe('workspace');
});
it('cuerpo del webhook acotado antes de analizar JSON',async()=>{
  await expect(boundedWebhookBody(new Request('https://example.test',{method:'POST',body:'x'.repeat(128*1024+1)}))).rejects.toThrow('large_body');
});
