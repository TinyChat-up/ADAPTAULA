-- SOLO LECTURA. Cambiar el UUID; no es una migración ni concede acceso.
select to_regclass('public.billing_pilot_requests') as solicitudes_030,
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='subscriptions' and column_name='pilot_request_id') as vinculo_030,
  to_regprocedure('public.start_billing_pilot(uuid,uuid)') as inicio_rpc,
  to_regprocedure('public.sync_billing_pilot(uuid,text,text,text,text,timestamptz,timestamptz,text)') as sincronizacion_rpc;

select p.proname, pg_get_function_identity_arguments(p.oid) as firma,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('start_billing_pilot','sync_billing_pilot','workspace_plan');

select c.relrowsecurity as rls, c.relname
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='billing_pilot_requests';

-- Ejecutar lo siguiente SOLO si 030 ya existe; utilizar el workspace autorizado.
select w.id as workspace_id, p.slug, p.monthly_images,
  p.features->>'image_generation' as imagenes_efectivas
from public.workspaces w
cross join lateral public.workspace_plan(w.id) p
where w.id='00000000-0000-0000-0000-000000000000'::uuid;

select slug,monthly_price_cents,features->>'commercial_policy' as politica_comercial,monthly_images,features->>'image_generation' as imagenes_catalogo
from public.plans where slug in ('free','pro','max');

select workspace_id,id,state,created_at,expires_at,
  expires_at > now() as vigente,session_id is not null as sesion_vinculada,
  stripe_subscription_id is not null as suscripcion_vinculada
from public.billing_pilot_requests
where workspace_id='00000000-0000-0000-0000-000000000000'::uuid;
