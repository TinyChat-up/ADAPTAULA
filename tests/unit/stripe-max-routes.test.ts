import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
const WS='11111111-1111-4111-8111-111111111111';
const state=vi.hoisted(()=>({role:'owner',enabled:true,rate:true,plan:'free',syncError:false,sessionStatus:'open',subWorkspace:'',subPrice:'price_Test',synced:[] as unknown[],adminCalls:0}));
vi.mock('@/lib/api/context',()=>({
  apiError:(status:number,code:string,message:string)=>Response.json({error:{code,message}},{status}),
  getApiContext:async(request:Request)=>request.headers.get('origin')!=='https://app.example'
    ?{response:Response.json({}, {status:403})}
    :{ctx:{role:state.role,workspace:{id:'11111111-1111-4111-8111-111111111111',type:'personal'},user:{id:'user'}}},
}));
vi.mock('@/lib/billing/max',()=>({
  maxCheckoutConfig:()=>state.enabled?{priceId:'price_Test',secret:'sk_test_fixture',webhook:'whsec_fixture',site:'https://app.example'}:null,
  canBuyPlan:(ctx:{role:string})=>ctx.role==='owner'||ctx.role==='admin',
}));
vi.mock('@/lib/plans/usage',()=>({getWorkspaceUsage:async()=>({plan:{slug:state.plan}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>{
  state.adminCalls++;
  return {
    rpc:async(name:string,args:unknown)=>name==='rate_limit_allowed'?{data:state.rate}:(state.synced.push(args),{error:state.syncError?{message:'do not expose'}:null}),
    from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{monthly_price_cents:4990},error:null})};return q;},
  };
}}));
const {POST:checkout}=await import('@/app/api/stripe/checkout/route');
const {POST:webhook}=await import('@/app/api/stripe/webhook/route');
const price={id:'price_Test',livemode:false,active:true,type:'recurring',currency:'eur',unit_amount:4990,tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1}};
beforeEach(()=>{
  Object.assign(state,{role:'owner',enabled:true,rate:true,plan:'free',syncError:false,sessionStatus:'open',subWorkspace:WS,subPrice:'price_Test',synced:[],adminCalls:0});
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.includes('/prices/')) return Response.json(price);
    if(url.includes('/checkout/sessions')) return Response.json({id:'cs_test_One',livemode:false,mode:'subscription',status:state.sessionStatus,url:'https://checkout.stripe.com/test',subscription:state.sessionStatus==='complete'?'sub_One':null,metadata:{workspace_id:WS}});
    if(url.includes('/subscriptions/'))return Response.json({id:'sub_One',livemode:false,status:'active',current_period_start:1700000000,current_period_end:1702600000,cancel_at_period_end:false,metadata:state.subWorkspace?{workspace_id:state.subWorkspace}:{},items:{data:[{price:{id:state.subPrice}}]}});
    throw new Error('unexpected_network');
  }));
});
afterEach(()=>vi.unstubAllGlobals());
const post=()=>new Request('https://app.example/api/stripe/checkout',{method:'POST',headers:{origin:'https://app.example'}});
function event(type='checkout.session.completed',live=false,id='cs_test_One'){const raw=JSON.stringify({id:'evt_One',livemode:live,type,data:{object:{id}}});const t=String(Math.floor(Date.now()/1000));const hash=createHmac('sha256','whsec_fixture').update(`${t}.${raw}`).digest('hex');return new Request('https://app.example/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${hash}`},body:raw});}

it('un propietario en Free abre el pago de Max; volver del Checkout no cambia el plan',async()=>{
  const response=await checkout(post());expect(response.status).toBe(200);expect(await response.json()).toEqual({url:'https://checkout.stripe.com/test'});
  expect(state.synced).toHaveLength(0);
});
it('lector, Max ya contratado, origen externo, contratación apagada y frecuencia agotada no crean pago',async()=>{
  state.role='viewer';expect((await checkout(post())).status).toBe(404);
  state.role='owner';state.enabled=false;expect((await checkout(post())).status).toBe(404);
  state.enabled=true;expect((await checkout(new Request('https://app.example/api/stripe/checkout',{method:'POST'}))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  state.rate=false;expect((await checkout(post())).status).toBe(429);
  state.rate=true;state.plan='max';expect((await checkout(post())).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
it('un precio de Stripe que no es el de Max no abre el pago y no expone detalles',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...price,unit_amount:2490})));
  const response=await checkout(post());expect(response.status).toBe(503);expect(await response.text()).not.toMatch(/price_|2490/);
});
it('el pago completado recupera la suscripción de Stripe y la sincroniza con el espacio',async()=>{
  state.sessionStatus='complete';expect((await webhook(event())).status).toBe(200);
  expect(state.synced).toEqual([expect.objectContaining({p_workspace:WS,p_subscription:'sub_One',p_status:'active',p_event:'evt_One'})]);
});
it('las bajas y cambios de la suscripción también se sincronizan; las ajenas se ignoran',async()=>{
  expect((await webhook(event('customer.subscription.deleted',false,'sub_One'))).status).toBe(200);expect(state.synced).toHaveLength(1);
  state.subPrice='price_Other';expect((await webhook(event('customer.subscription.updated',false,'sub_One'))).status).toBe(200);
  state.subPrice='price_Test';state.subWorkspace='';expect((await webhook(event('customer.subscription.updated',false,'sub_One'))).status).toBe(200);
  expect(state.synced).toHaveLength(1);
});
it('eventos live o sin firma se rechazan antes de tocar BD o Stripe',async()=>{
  expect((await webhook(event('checkout.session.completed',true))).status).toBe(400);
  expect((await webhook(new Request('https://app.example/api/stripe/webhook',{method:'POST',body:'{}'}))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();expect(state.adminCalls).toBe(0);
});
it('una asociación ajena no concede Max; un fallo pide reintento sin detalles',async()=>{
  state.sessionStatus='complete';state.subWorkspace='22222222-2222-4222-8222-222222222222';
  expect((await webhook(event())).status).toBe(503);expect(state.synced).toHaveLength(0);
  state.subWorkspace=WS;state.syncError=true;const result=await webhook(event());expect(result.status).toBe(503);expect(await result.text()).not.toContain('do not expose');
});
