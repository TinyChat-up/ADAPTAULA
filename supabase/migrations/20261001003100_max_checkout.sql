-- Max se contrata desde su tarjeta (Stripe en modo prueba por ahora) para cualquier propietario, sin el piloto
-- de siete días. Stripe y el webhook son la fuente de verdad: esta función solo la llama el servidor tras
-- recuperar la suscripción de la API de Stripe. El catálogo no cambia (Max sigue con monthly_images = 0 en
-- `plans`): las imágenes se conceden a la suscripción Max vigente, igual que hacía el piloto.
create or replace function public.sync_max_subscription(
  p_workspace uuid, p_subscription text, p_price text, p_status text,
  p_start timestamptz, p_end timestamptz, p_cancel_at_period_end boolean, p_event text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_plan uuid; s public.subscriptions;
begin
  if p_subscription !~ '^sub_[A-Za-z0-9]+$' or p_price !~ '^price_[A-Za-z0-9]+$' or p_event !~ '^evt_[A-Za-z0-9]+$'
    or p_status not in ('active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired')
    or p_end <= p_start then raise exception 'max_binding_invalid'; end if;
  perform 1 from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'max_binding_invalid'; end if;
  if exists (select 1 from public.stripe_events where stripe_event_id = 'max:' || p_event) then return; end if;
  if exists (select 1 from public.subscriptions where stripe_subscription_id = p_subscription and workspace_id <> p_workspace) then
    raise exception 'max_binding_invalid';
  end if;
  select * into s from public.subscriptions where workspace_id = p_workspace;
  -- A different subscription still in force is never replaced; a finished one, or the old seven-day pilot's, can be.
  if found and s.stripe_subscription_id <> p_subscription and s.status in ('active','trialing','past_due')
    and s.pilot_request_id is null then
    raise exception 'existing_subscription';
  end if;
  select id into strict v_plan from public.plans where slug = 'max';
  insert into public.subscriptions(workspace_id, plan_id, stripe_subscription_id, stripe_price_id,
    billing_interval, status, period_start, period_end, cancel_at_period_end, pilot_request_id)
  values(p_workspace, v_plan, p_subscription, p_price, 'month', p_status, p_start, p_end, p_cancel_at_period_end, null)
  on conflict(workspace_id) do update set plan_id = excluded.plan_id,
    stripe_subscription_id = excluded.stripe_subscription_id, stripe_price_id = excluded.stripe_price_id,
    billing_interval = excluded.billing_interval, status = excluded.status, period_start = excluded.period_start,
    period_end = excluded.period_end, cancel_at_period_end = excluded.cancel_at_period_end, pilot_request_id = null;
  insert into public.stripe_events(stripe_event_id, type, payload_summary)
    values('max:' || p_event, 'max_subscription', jsonb_build_object('workspace_id', p_workspace, 'status', p_status));
end;
$$;
revoke all on function public.sync_max_subscription(uuid,text,text,text,timestamptz,timestamptz,boolean,text) from public, anon, authenticated;
grant execute on function public.sync_max_subscription(uuid,text,text,text,timestamptz,timestamptz,boolean,text) to service_role;

-- Same resolver as 030, but the image allowance follows any Max subscription in force, not only the pilot's.
create or replace function public.workspace_plan(ws uuid)
returns public.plans language plpgsql stable security definer set search_path = '' as $$
declare s public.subscriptions; p public.plans; g public.billing_pilot_requests;
begin
  select * into s from public.subscriptions where workspace_id = ws and status in ('active','trialing','past_due');
  if found and s.pilot_request_id is not null then
    select r.* into g from public.billing_pilot_requests r where r.id = s.pilot_request_id
      and r.workspace_id = ws and r.stripe_subscription_id = s.stripe_subscription_id
      and r.state = 'active' and r.expires_at > now()
      and exists (select 1 from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
        where w.id = ws and w.type = 'personal' and w.owner_id = r.user_id and m.user_id = r.user_id and m.role = 'owner')
      and (select count(*) from public.workspace_members where workspace_id = ws) = 1;
    if not found then s.plan_id := null; end if;
  end if;
  select * into p from public.plans where id = coalesce(s.plan_id, (select id from public.plans where slug = 'free'));
  if p.slug = 'max' and s.plan_id is not null then
    p.monthly_images := 5;
    p.features := p.features || '{"image_generation":true,"illustrations_per_adaptation":3,"illustration_budget_usd":0.5}'::jsonb;
  end if;
  return p;
end;
$$;
revoke all on function public.workspace_plan(uuid) from public, anon, authenticated;
grant execute on function public.workspace_plan(uuid) to service_role;
