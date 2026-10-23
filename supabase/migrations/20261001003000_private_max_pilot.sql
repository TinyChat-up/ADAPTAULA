-- Piloto privado autorizado: Stripe TEST, sin modificar el catálogo comercial.
create table if not exists public.billing_pilot_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  session_id text unique,
  stripe_subscription_id text unique,
  state text not null default 'pending' check (state in ('pending', 'active', 'canceled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.billing_pilot_requests enable row level security;
revoke all on public.billing_pilot_requests from public, anon, authenticated;
grant select on public.billing_pilot_requests to authenticated;
grant all on public.billing_pilot_requests to service_role;
drop policy if exists "pilot: lectura propia" on public.billing_pilot_requests;
create policy "pilot: lectura propia" on public.billing_pilot_requests for select to authenticated
  using (user_id = auth.uid() and public.has_workspace_role(workspace_id, array['owner']));

alter table public.subscriptions add column if not exists pilot_request_id uuid
  references public.billing_pilot_requests(id) on delete no action;

create or replace function public.start_billing_pilot(p_workspace uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.plans where slug = 'max' and features->>'commercial_policy' = '2026-10-v2') then
    raise exception 'commercial_migration_required';
  end if;
  perform 1 from public.workspaces where id = p_workspace and owner_id = p_user
    and type = 'personal' for update;
  if not found or (select count(*) from public.workspace_members where workspace_id = p_workspace) <> 1
    or not exists (select 1 from public.workspace_members where workspace_id = p_workspace
      and user_id = p_user and role = 'owner') then
    raise exception 'pilot_not_eligible';
  end if;
  select id into v_id from public.billing_pilot_requests where workspace_id = p_workspace and user_id = p_user;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.subscriptions where workspace_id = p_workspace) then
    raise exception 'existing_subscription';
  end if;
  insert into public.billing_pilot_requests(workspace_id, user_id)
    values(p_workspace, p_user) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.sync_billing_pilot(
  p_request uuid, p_session text, p_subscription text, p_price text,
  p_status text, p_start timestamptz, p_end timestamptz, p_event text
) returns void language plpgsql security definer set search_path = '' as $$
declare g public.billing_pilot_requests; v_plan uuid;
begin
  select * into strict g from public.billing_pilot_requests where id = p_request for update;
  if not exists (select 1 from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
    where w.id = g.workspace_id and w.type = 'personal' and w.owner_id = g.user_id and m.user_id = g.user_id and m.role = 'owner')
    or (select count(*) from public.workspace_members where workspace_id = g.workspace_id) <> 1 then raise exception 'pilot_not_eligible'; end if;
  if g.session_id is distinct from p_session or p_subscription !~ '^sub_[A-Za-z0-9]+$'
    or p_price !~ '^price_[A-Za-z0-9]+$' or p_status not in ('active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired')
    or p_end <= p_start or p_event !~ '^evt_[A-Za-z0-9]+$' then raise exception 'pilot_binding_invalid'; end if;
  if g.stripe_subscription_id is not null and g.stripe_subscription_id <> p_subscription then raise exception 'pilot_binding_invalid'; end if;
  -- Ended pilots cannot be reopened by a delayed event; expiry does not depend on Cron/webhooks.
  if g.state = 'canceled' or g.expires_at <= now() then p_status := 'canceled'; end if;
  if exists (select 1 from public.stripe_events where stripe_event_id = 'pilot-test:' || p_event) then return; end if;
  select id into strict v_plan from public.plans where slug = 'max';
  if exists (select 1 from public.subscriptions where workspace_id = g.workspace_id
    and (pilot_request_id is distinct from g.id or stripe_subscription_id <> p_subscription)) then
    raise exception 'existing_subscription';
  end if;
  insert into public.subscriptions(workspace_id, plan_id, stripe_subscription_id, stripe_price_id,
    billing_interval, status, period_start, period_end, pilot_request_id)
  values(g.workspace_id, v_plan, p_subscription, p_price, 'month', p_status, p_start, p_end, g.id)
  on conflict(workspace_id) do update set status = excluded.status,
    period_start = excluded.period_start, period_end = excluded.period_end
    where public.subscriptions.pilot_request_id = g.id
      and public.subscriptions.stripe_subscription_id = p_subscription;
  if not found then raise exception 'existing_subscription'; end if;
  update public.billing_pilot_requests set stripe_subscription_id = p_subscription,
    state = case when p_status = 'canceled' then 'canceled' else 'active' end where id = g.id;
  insert into public.stripe_events(stripe_event_id, type, payload_summary)
    values('pilot-test:' || p_event, 'private_max_pilot', jsonb_build_object('request_id', g.id));
end;
$$;

-- The returned plan is workspace-scoped: Max in plans stays at 0 images / disabled.
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
  if p.slug = 'max' and s.pilot_request_id is not null and s.plan_id is not null then
    p.monthly_images := 5;
    p.features := p.features || '{"image_generation":true,"illustrations_per_adaptation":3,"illustration_budget_usd":0.5}'::jsonb;
  end if;
  return p;
end;
$$;
create or replace function public.current_period(ws uuid, at_time timestamptz default now())
returns table(period_start timestamptz, period_end timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_start timestamptz; v_end timestamptz; v_months int; v_local timestamp;
begin
  select s.period_start, s.period_end into v_start, v_end from public.subscriptions s
  where s.workspace_id = ws and s.status in ('active','trialing','past_due')
    and s.period_start is not null and s.period_end is not null
    and (s.pilot_request_id is null or exists (
      select 1 from public.billing_pilot_requests r where r.id = s.pilot_request_id
        and r.workspace_id = ws and r.stripe_subscription_id = s.stripe_subscription_id
        and r.state = 'active' and r.expires_at > at_time
        and exists (select 1 from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
          where w.id = ws and w.type = 'personal' and w.owner_id = r.user_id and m.user_id = r.user_id and m.role = 'owner')
        and (select count(*) from public.workspace_members where workspace_id = ws) = 1
    ));
  if found then
    v_months := greatest(0,(extract(year from age(at_time,v_start))*12 + extract(month from age(at_time,v_start)))::int);
    period_start := v_start + make_interval(months => v_months);
    period_end := v_start + make_interval(months => v_months+1);
    if period_start < v_end and period_end > v_end then period_end := v_end; end if;
    return next; return;
  end if;
  v_local := at_time at time zone 'Europe/Madrid';
  period_start := date_trunc('month',v_local) at time zone 'Europe/Madrid';
  period_end := (date_trunc('month',v_local)+interval '1 month') at time zone 'Europe/Madrid';
  return next;
end;
$$;
revoke all on function public.start_billing_pilot(uuid,uuid) from public, anon, authenticated;
revoke all on function public.sync_billing_pilot(uuid,text,text,text,text,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.start_billing_pilot(uuid,uuid) to service_role;
grant execute on function public.sync_billing_pilot(uuid,text,text,text,text,timestamptz,timestamptz,text) to service_role;
revoke all on function public.workspace_plan(uuid) from public, anon, authenticated;
grant execute on function public.workspace_plan(uuid) to service_role;
