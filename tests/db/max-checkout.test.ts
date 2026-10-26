import { beforeAll, afterAll, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, createUser, as } from './harness';
let db: PGlite; let seq = 0;
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
const account = async()=>createUser(db,`max${++seq}@example.test`);
async function sync(ws:string, sub:string, status='active', event='evt_'+String(++seq)) {
  await db.query(`select public.sync_max_subscription($1,$2,'price_Test',$3,now()-interval '1 day',now()+interval '29 days',false,$4)`,[ws,sub,status,event]);
}
const plan = async(ws:string)=>(await db.query<{slug:string;monthly_images:number;features:Record<string,unknown>}>('select (public.workspace_plan($1)).*',[ws])).rows[0]!;

it('cualquier propietario pasa a Max con cinco imágenes; el catálogo y los demás espacios no cambian',async()=>{
  const a=await account(), b=await account();
  await sync(a.workspaceId,'sub_A1','active','evt_Same');await sync(a.workspaceId,'sub_A1','canceled','evt_Same');
  expect(await plan(a.workspaceId)).toMatchObject({slug:'max',monthly_images:5,features:{image_generation:true}});
  expect(await plan(b.workspaceId)).toMatchObject({slug:'free',monthly_images:0});
  expect((await db.query("select monthly_images from public.plans where slug='max'")).rows[0]).toEqual({monthly_images:0});
  await expect(as(db,'authenticated',a.id,()=>sync(a.workspaceId,'sub_A2'))).rejects.toThrow(/permission denied/);
});

it('la cancelación devuelve a Free y permite volver a contratar',async()=>{
  const a=await account();await sync(a.workspaceId,'sub_B1');await sync(a.workspaceId,'sub_B1','canceled');
  expect((await plan(a.workspaceId)).slug).toBe('free');
  await sync(a.workspaceId,'sub_B2');expect((await plan(a.workspaceId)).slug).toBe('max');
});

it('no sustituye otra suscripción vigente ni acepta una suscripción de otro espacio',async()=>{
  const a=await account(), b=await account();
  await db.query("insert into public.subscriptions(workspace_id,plan_id,stripe_subscription_id,stripe_price_id,status) select $1,id,'sub_Pro1','price_Pro','active' from public.plans where slug='pro'",[a.workspaceId]);
  await expect(sync(a.workspaceId,'sub_C1')).rejects.toThrow(/existing_subscription/);
  expect((await plan(a.workspaceId)).slug).toBe('pro');
  await sync(b.workspaceId,'sub_C2');
  await expect(sync(a.workspaceId,'sub_C2')).rejects.toThrow(/max_binding_invalid/);
  await expect(sync(b.workspaceId,'not-a-sub')).rejects.toThrow(/max_binding_invalid/);
});
