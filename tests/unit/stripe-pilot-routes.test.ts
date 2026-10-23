import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { createHmac } from 'node:crypto';
const state=vi.hoisted(()=>({role:'owner',workspace:'ws',enabled:true,rate:true,syncError:false,sessionStatus:'open',subWorkspace:'ws',synced:0,adminCalls:0,record:{id:'request',workspace_id:'ws',session_id:'cs_test_One',state:'pending',expires_at:'2099-01-01',created_at:new Date().toISOString()}}));
vi.mock('@/lib/api/context',()=>({
  apiError:(status:number,code:string,message:string)=>Response.json({error:{code,message}},{status}),
  getApiContext:async(request:Request)=>request.headers.get('origin')!=='https://app.example'
    ?{response:Response.json({}, {status:403})}
    :{ctx:{role:state.role,workspace:{id:state.workspace,type:'personal'},user:{id:'user'}}},
}));
vi.mock('@/lib/billing/pilot',()=>({billingPilotConfig:(ws?:string)=>state.enabled&&(!ws||ws==='ws')?{workspaceId:'ws',priceId:'price_Test',secret:'sk_test_fixture',webhook:'whsec_fixture',site:'https://app.example'}:null}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>{
  state.adminCalls++;
  return {
    rpc:async(name:string)=>name==='rate_limit_allowed'?{data:state.rate}:name==='start_billing_pilot'?{data:'request'}:(state.synced++,{error:state.syncError?{message:'do not expose'}:null}),
    from:(table:string)=>{
      const result=()=>({data:table==='plans'?{monthly_price_cents:4990}:state.record,error:null});
      const q={select:()=>q,eq:()=>q,is:()=>q,update:()=>q,single:async()=>result(),maybeSingle:async()=>result()};return q;
    },
  };
}}));
const {POST:checkout}=await import('@/app/api/stripe/checkout/route');
const {POST:webhook}=await import('@/app/api/stripe/webhook/route');
beforeEach(()=>{
  state.role='owner';state.workspace='ws';state.enabled=true;state.rate=true;state.syncError=false;state.sessionStatus='open';state.subWorkspace='ws';state.synced=0;state.adminCalls=0;state.record.state='pending';
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.includes('/checkout/sessions/')) return Response.json({id:'cs_test_One',livemode:false,mode:'subscription',status:state.sessionStatus,url:'https://checkout.stripe.com/test',subscription:state.sessionStatus==='complete'?'sub_One':null,metadata:{pilot_request:'request',workspace_id:'ws'}});
    if(url.includes('/subscriptions/'))return Response.json({id:'sub_One',livemode:false,status:'active',current_period_start:1700000000,current_period_end:1702600000,metadata:{pilot_request:'request',workspace_id:state.subWorkspace},items:{data:[{price:{id:'price_Test'}}]}});
    throw new Error('unexpected_network');
  }));
});
afterEach(()=>vi.unstubAllGlobals());
const post=()=>new Request('https://app.example/api/stripe/checkout',{method:'POST',headers:{origin:'https://app.example'}});
function event(live=false){const raw=JSON.stringify({id:'evt_One',livemode:live,type:'checkout.session.completed',data:{object:{id:'cs_test_One'}}});const t=String(Math.floor(Date.now()/1000));const hash=createHmac('sha256','whsec_fixture').update(`${t}.${raw}`).digest('hex');return new Request('https://app.example/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${hash}`},body:raw});}
it('owner accede a su sesión; no cambia de plan por regresar del Checkout',async()=>{
  const response=await checkout(post());expect(response.status).toBe(200);expect(await response.json()).toEqual({url:'https://checkout.stripe.com/test'});expect(state.synced).toBe(0);
});
it('lector, otro workspace, origen externo y flag apagado no llegan a Stripe',async()=>{
  state.role='viewer';expect((await checkout(post())).status).toBe(404);
  state.role='owner';state.workspace='other';expect((await checkout(post())).status).toBe(404);
  state.workspace='ws';state.enabled=false;expect((await checkout(post())).status).toBe(404);
  expect((await checkout(new Request('https://app.example/api/stripe/checkout',{method:'POST'}))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();expect(state.adminCalls).toBe(0);
});
it('frecuencia agotada no crea Checkout',async()=>{state.rate=false;expect((await checkout(post())).status).toBe(429);expect(fetch).not.toHaveBeenCalled();});
it('evento firmado recupera el estado actual y sincroniza mediante RPC atómica',async()=>{state.sessionStatus='complete';expect((await webhook(event())).status).toBe(200);expect(state.synced).toBe(1);expect(fetch).toHaveBeenCalledTimes(3);});
it('eventos live y sin firma se rechazan antes de acceder a BD o proveedor',async()=>{
  expect((await webhook(event(true))).status).toBe(400);
  expect((await webhook(new Request('https://app.example/api/stripe/webhook',{method:'POST',body:'{}'}))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();expect(state.adminCalls).toBe(0);
});
it('una asociación ajena no concede Max; fallos devuelven error para reintento sin detalles',async()=>{
  state.sessionStatus='complete';state.subWorkspace='other';expect((await webhook(event())).status).toBe(503);expect(state.synced).toBe(0);
  state.subWorkspace='ws';state.syncError=true;const result=await webhook(event());expect(result.status).toBe(503);expect(await result.text()).not.toContain('do not expose');
});
