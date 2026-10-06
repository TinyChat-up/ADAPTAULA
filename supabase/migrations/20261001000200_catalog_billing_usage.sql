-- Adaptaula · 002 · Catálogo educativo, planes, suscripciones y cuotas
-- Ver docs/DATABASE.md y docs/BILLING.md.

-- ---------------------------------------------------------------------------
-- Catálogo educativo (datos, no código)
-- ---------------------------------------------------------------------------

create table public.stages (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.grades (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  stage_slug text not null references public.stages (slug),
  name text not null,
  sort_order int not null default 0,
  typical_age_min int,
  typical_age_max int,
  active boolean not null default true
);

create index grades_stage_idx on public.grades (stage_slug);

create table public.subjects (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  stage_slugs text[] not null default '{}',
  sort_order int not null default 0,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Planes (los límites viven aquí; se cambian sin desplegar)
-- ---------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  monthly_price_cents int not null default 0 check (monthly_price_cents >= 0),
  annual_price_cents int not null default 0 check (annual_price_cents >= 0),
  stripe_price_monthly_id text unique,
  stripe_price_annual_id text unique,
  monthly_adaptations int not null check (monthly_adaptations >= 0),
  monthly_images int not null default 0 check (monthly_images >= 0),
  max_profiles int not null check (max_profiles >= 0),
  max_classes int not null check (max_classes >= 0),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Facturación (escritura solo desde el servidor / webhooks)
-- ---------------------------------------------------------------------------

create table public.billing_customers (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  plan_id uuid not null references public.plans (id),
  billing_interval text check (billing_interval in ('month', 'year')),
  status text not null check (status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
  )),
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_plan_idx on public.subscriptions (plan_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Uso: libro de movimientos (consumo positivo, devolución negativa)
-- ---------------------------------------------------------------------------

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('adaptation', 'image', 'block_revision')),
  units int not null check (units <> 0),
  job_id uuid,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index usage_events_period_idx on public.usage_events (workspace_id, kind, created_at);

-- ---------------------------------------------------------------------------
-- Plan efectivo y periodo de cuota
-- ---------------------------------------------------------------------------

-- Sin suscripción vigente = plan free. past_due mantiene el plan durante los reintentos de cobro.
create or replace function public.workspace_plan(ws uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.plans p
  where p.id = coalesce(
    (select s.plan_id from public.subscriptions s
      where s.workspace_id = ws and s.status in ('active', 'trialing', 'past_due')),
    (select f.id from public.plans f where f.slug = 'free')
  );
$$;

-- Free: mes natural en Europe/Madrid. Pago: tramos mensuales anclados al inicio del ciclo de Stripe
-- (el plan anual reinicia la cuota cada mes).
create or replace function public.current_period(ws uuid, at_time timestamptz default now())
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_months int;
  v_local timestamp;
begin
  select s.period_start, s.period_end
    into v_start, v_end
  from public.subscriptions s
  where s.workspace_id = ws
    and s.status in ('active', 'trialing', 'past_due')
    and s.period_start is not null
    and s.period_end is not null;

  if found then
    v_months := greatest(0, (extract(year from age(at_time, v_start)) * 12 + extract(month from age(at_time, v_start)))::int);
    -- Ambos extremos se anclan a v_start: (31 ene + 1 mes) + 1 mes ≠ 31 ene + 2 meses.
    period_start := v_start + make_interval(months => v_months);
    period_end := v_start + make_interval(months => v_months + 1);
    if period_start < v_end and period_end > v_end then
      period_end := v_end;
    end if;
    return next;
    return;
  end if;

  v_local := at_time at time zone 'Europe/Madrid';
  period_start := date_trunc('month', v_local) at time zone 'Europe/Madrid';
  period_end := (date_trunc('month', v_local) + interval '1 month') at time zone 'Europe/Madrid';
  return next;
end;
$$;

-- Reserva atómica de cuota. Devuelve { allowed, used, limit, period_end[, duplicate] }.
-- El lock por workspace+tipo impide que dos peticiones concurrentes superen el límite.
create or replace function public.consume_quota(
  p_workspace uuid,
  p_kind text,
  p_units int,
  p_user uuid,
  p_job uuid,
  p_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_limit int;
  v_used int;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_units is null or p_units <= 0 then
    raise exception 'units must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_kind, 0));

  select * into v_plan from public.workspace_plan(p_workspace);
  if v_plan.id is null then
    raise exception 'no plan resolved for workspace' using errcode = 'P0002';
  end if;

  v_limit := case p_kind
    when 'adaptation' then v_plan.monthly_adaptations
    when 'image' then v_plan.monthly_images
    when 'block_revision' then coalesce((v_plan.features ->> 'monthly_block_revisions')::int, 0)
  end;
  if v_limit is null then
    raise exception 'unknown quota kind: %', p_kind using errcode = '22023';
  end if;

  select cp.period_start, cp.period_end into v_start, v_end from public.current_period(p_workspace) cp;

  select coalesce(sum(e.units), 0)::int into v_used
  from public.usage_events e
  where e.workspace_id = p_workspace and e.kind = p_kind and e.created_at >= v_start and e.created_at < v_end;

  if exists (select 1 from public.usage_events e where e.idempotency_key = p_key) then
    return jsonb_build_object('allowed', true, 'duplicate', true, 'used', v_used, 'limit', v_limit, 'period_end', v_end);
  end if;

  if v_used + p_units > v_limit then
    return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit, 'period_end', v_end);
  end if;

  insert into public.usage_events (workspace_id, user_id, kind, units, job_id, idempotency_key)
  values (p_workspace, p_user, p_kind, p_units, p_job, p_key);

  return jsonb_build_object('allowed', true, 'used', v_used + p_units, 'limit', v_limit, 'period_end', v_end);
end;
$$;

-- Devolución idempotente de una reserva. Se fecha igual que la reserva para compensar en el mismo periodo.
create or replace function public.refund_quota(p_reserve_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.usage_events;
begin
  select * into r from public.usage_events e where e.idempotency_key = p_reserve_key and e.units > 0;
  if not found then
    return false;
  end if;

  insert into public.usage_events (workspace_id, user_id, kind, units, job_id, idempotency_key, metadata, created_at)
  values (r.workspace_id, r.user_id, r.kind, -r.units, r.job_id, 'refund:' || p_reserve_key,
          jsonb_build_object('refund_of', r.id), r.created_at)
  on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

-- Resumen de plan y uso para la UI (dashboard, /app/uso). Solo para miembros del workspace.
create or replace function public.workspace_usage(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_start timestamptz;
  v_end timestamptz;
  v_used jsonb;
begin
  if not public.is_workspace_member(ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.workspace_plan(ws);
  select cp.period_start, cp.period_end into v_start, v_end from public.current_period(ws) cp;

  select coalesce(jsonb_object_agg(t.kind, t.used), '{}'::jsonb) into v_used
  from (
    select e.kind, sum(e.units)::int as used
    from public.usage_events e
    where e.workspace_id = ws and e.created_at >= v_start and e.created_at < v_end
    group by e.kind
  ) t;

  return jsonb_build_object(
    'plan', jsonb_build_object('slug', v_plan.slug, 'name', v_plan.name),
    'period_start', v_start,
    'period_end', v_end,
    'adaptations', jsonb_build_object('used', coalesce((v_used ->> 'adaptation')::int, 0), 'limit', v_plan.monthly_adaptations),
    'images', jsonb_build_object('used', coalesce((v_used ->> 'image')::int, 0), 'limit', v_plan.monthly_images),
    'block_revisions', jsonb_build_object(
      'used', coalesce((v_used ->> 'block_revision')::int, 0),
      'limit', coalesce((v_plan.features ->> 'monthly_block_revisions')::int, 0)
    ),
    'max_profiles', v_plan.max_profiles,
    'max_classes', v_plan.max_classes,
    'features', v_plan.features
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------

revoke execute on function public.workspace_plan(uuid) from public, anon, authenticated;
revoke execute on function public.current_period(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.consume_quota(uuid, text, int, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.refund_quota(text) from public, anon, authenticated;
revoke execute on function public.workspace_usage(uuid) from public, anon;
grant execute on function public.workspace_plan(uuid) to service_role;
grant execute on function public.current_period(uuid, timestamptz) to service_role;
grant execute on function public.consume_quota(uuid, text, int, uuid, uuid, text) to service_role;
grant execute on function public.refund_quota(text) to service_role;
grant execute on function public.workspace_usage(uuid) to authenticated, service_role;

alter table public.stages enable row level security;
alter table public.grades enable row level security;
alter table public.subjects enable row level security;
alter table public.plans enable row level security;
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;

-- Catálogo y planes: lectura pública (página de precios, formularios). Escritura: service role.
create policy "stages: lectura pública" on public.stages for select to anon, authenticated using (true);
create policy "grades: lectura pública" on public.grades for select to anon, authenticated using (true);
create policy "subjects: lectura pública" on public.subjects for select to anon, authenticated using (true);
create policy "plans: lectura pública" on public.plans for select to anon, authenticated using (true);

revoke insert, update, delete on public.stages, public.grades, public.subjects, public.plans from anon, authenticated;
revoke insert, update, delete on public.billing_customers, public.subscriptions, public.usage_events from anon, authenticated;

create policy "billing_customers: leer si soy owner o admin" on public.billing_customers
  for select to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "subscriptions: leer si soy miembro" on public.subscriptions
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "usage_events: leer si soy miembro" on public.usage_events
  for select to authenticated using (public.is_workspace_member(workspace_id));
