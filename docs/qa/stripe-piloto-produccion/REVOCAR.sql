-- Preparado, NO ejecutado. Solo revoca el piloto vinculado del workspace indicado.
begin;
do $$
declare ws uuid := '00000000-0000-0000-0000-000000000000'; r public.billing_pilot_requests;
begin
  if ws='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'Indica el workspace autorizado'; end if;
  select * into strict r from public.billing_pilot_requests where workspace_id=ws for update;
  update public.billing_pilot_requests set state='canceled' where id=r.id and workspace_id=ws;
  update public.subscriptions set status='canceled'
  where workspace_id=ws and pilot_request_id=r.id
    and stripe_subscription_id=r.stripe_subscription_id;
end;
$$;
commit;
