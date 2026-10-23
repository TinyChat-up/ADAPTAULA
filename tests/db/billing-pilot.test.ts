import { beforeAll, afterAll, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, createUser, as, applyMigration, MIGRATIONS_DIR } from './harness';
import path from 'node:path';
let db: PGlite; let seq = 0;
beforeAll(async()=>{db=await createTestDb();},120000);
afterAll(async()=>{await db.close();});
async function account(){return createUser(db,`pilot${++seq}@example.test`);}
async function start(user:Awaited<ReturnType<typeof account>>) {
  return (await db.query<{id:string}>('select public.start_billing_pilot($1,$2) id',[user.workspaceId,user.id])).rows[0]!.id;
}
async function bind(id:string){const suffix=id.replaceAll('-','');await db.query('update public.billing_pilot_requests set session_id=$2 where id=$1',[id,`cs_test_${suffix}`]);return suffix;}
async function sync(id:string, suffix:string, event='evt_'+String(++seq), status='active') {
  await db.query(`select public.sync_billing_pilot($1,$2,$3,'price_Test',$4,now()-interval '1 day',now()+interval '29 days',$5)`,[id,`cs_test_${suffix}`,`sub_${suffix}`,status,event]);
}
const plan = async(ws:string)=>(await db.query<{slug:string;monthly_images:number;features:Record<string,unknown>}>('select (public.workspace_plan($1)).*',[ws])).rows[0]!;
it('Max privado, cinco imágenes solo para el workspace concedido, RPC vedada y catálogo intacto',async()=>{
  const a=await account(), b=await account(); const id=await start(a);expect(await start(a)).toBe(id);
  const suffix=await bind(id);await sync(id,suffix,'evt_First');await sync(id,suffix,'evt_First');
  expect(await plan(a.workspaceId)).toMatchObject({slug:'max',monthly_images:5,features:{image_generation:true}});
  expect(await plan(b.workspaceId)).toMatchObject({slug:'free',monthly_images:0});
  expect((await db.query('select monthly_images,features from public.plans where slug=\'max\'')).rows[0]).toMatchObject({monthly_images:0,features:{image_generation:false}});
  expect((await db.query('select count(*)::int n from public.subscriptions where workspace_id=$1',[a.workspaceId])).rows[0]).toEqual({n:1});
  await expect(as(db,'authenticated',a.id,()=>start(a))).rejects.toThrow(/permission denied/);
  await expect(as(db,'authenticated',a.id,()=>sync(id,suffix))).rejects.toThrow(/permission denied/);
  expect((await as(db,'authenticated',b.id,()=>db.query('select * from public.billing_pilot_requests where id=$1',[id]))).rows).toHaveLength(0);
  await expect(as(db,'authenticated',b.id,()=>db.query("insert into public.billing_pilot_requests(workspace_id,user_id) values($1,$2)",[b.workspaceId,b.id]))).rejects.toThrow(/permission denied/);
});
it('caduca sin Cron ni webhook, no se prolonga por duplicados y conserva la trazabilidad',async()=>{
  const a=await account();const id=await start(a);const suffix=await bind(id);await sync(id,suffix);
  const original=(await db.query('select expires_at from public.billing_pilot_requests where id=$1',[id])).rows[0];
  await sync(id,suffix);expect((await db.query('select expires_at from public.billing_pilot_requests where id=$1',[id])).rows[0]).toEqual(original);
  await db.query("update public.billing_pilot_requests set expires_at=now()-interval '1 second' where id=$1",[id]);
  expect(await plan(a.workspaceId)).toMatchObject({slug:'free',monthly_images:0});
  expect((await db.query("select count(*)::int n from public.subscriptions where workspace_id=$1 and status='active'",[a.workspaceId])).rows[0]).toEqual({n:1});
  const period=(await db.query<{period_start:Date}>('select * from public.current_period($1)',[a.workspaceId])).rows[0]!;
  const free=(await db.query<{period_start:Date}>('select * from public.current_period($1)',[(await account()).workspaceId])).rows[0]!;
  expect(period.period_start).toEqual(free.period_start);
  await sync(id,suffix);expect((await db.query('select state from public.billing_pilot_requests where id=$1',[id])).rows[0]).toEqual({state:'canceled'});
});
it('no toca suscripciones anteriores, rechaza asociaciones erróneas y no reabre una cancelación',async()=>{
  const a=await account();await db.query("insert into public.subscriptions(workspace_id,plan_id,stripe_subscription_id,stripe_price_id,status) select $1,id,$2,'price_Previous','active' from public.plans where slug='pro'",[a.workspaceId,`sub_Other${++seq}`]);
  await expect(start(a)).rejects.toThrow(/existing_subscription/);expect((await plan(a.workspaceId)).slug).toBe('pro');
  const b=await account(),id=await start(b),suffix=await bind(id);
  await expect(sync(id,'Wrong')).rejects.toThrow(/pilot_binding_invalid/);
  await sync(id,suffix,'evt_Cancel','canceled');await sync(id,suffix);
  expect((await plan(b.workspaceId)).slug).toBe('free');
  const c=await account(),request=await start(c),bound=await bind(request);
  await db.query("insert into public.subscriptions(workspace_id,plan_id,stripe_subscription_id,stripe_price_id,status) select $1,id,$2,'price_Previous','active' from public.plans where slug='pro'",[c.workspaceId,`sub_Concurrent${++seq}`]);
  await expect(sync(request,bound)).rejects.toThrow(/existing_subscription/);
  expect((await plan(c.workspaceId)).slug).toBe('pro');
});
it('no concede si el workspace deja de ser exclusivamente personal',async()=>{
  const a=await account(),b=await account(),id=await start(a),suffix=await bind(id);await sync(id,suffix);
  await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",[a.workspaceId,b.id]);
  expect((await plan(a.workspaceId)).slug).toBe('free');await expect(sync(id,suffix)).rejects.toThrow(/pilot_not_eligible/);
});
it('cinco reservas permitidas y sexta bloqueada; devolución e idempotencia',async()=>{
  const a=await account(),id=await start(a),suffix=await bind(id);await sync(id,suffix);
  for(let i=0;i<5;i++){
    const p=[a.workspaceId,`pilot-${id}-${i}`];
    expect((await db.query<{q:{allowed:boolean}}>("select public.consume_quota($1,'image',1,null,null,$2) q",p)).rows[0]!.q.allowed).toBe(true);
  }
  expect((await db.query<{q:{allowed:boolean}}>("select public.consume_quota($1,'image',1,null,null,$2) q",[a.workspaceId,`pilot-${id}-six`])).rows[0]!.q.allowed).toBe(false);
  await db.query('select public.refund_quota($1)',[`pilot-${id}-0`]);
  expect((await db.query<{q:{allowed:boolean}}>("select public.consume_quota($1,'image',1,null,null,$2) q",[a.workspaceId,`pilot-${id}-new`])).rows[0]!.q.allowed).toBe(true);
});
it('migración repetible sin modificar concesiones ni catálogo',async()=>{
  const before=(await db.query('select id,expires_at from public.billing_pilot_requests order by id')).rows;
  await applyMigration(db,path.join(MIGRATIONS_DIR,'20261001003000_private_max_pilot.sql'));
  expect((await db.query('select id,expires_at from public.billing_pilot_requests order by id')).rows).toEqual(before);
});
