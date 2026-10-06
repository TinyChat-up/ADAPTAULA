-- Adaptaula · 005 · Operación interna: IA, prompts, ajustes, Stripe, auditoría, analítica, rate limit
-- Todas estas tablas tienen RLS sin políticas: solo accesibles con service role (servidor y /admin).

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  job_id uuid references public.adaptation_jobs (id) on delete set null,
  adaptation_id uuid references public.adaptations (id) on delete set null,
  purpose text not null check (purpose in (
    'analyze', 'plan', 'generate', 'review', 'revise_block', 'image_brief', 'image'
  )),
  model_alias text not null check (model_alias in ('ECONOMY', 'STANDARD', 'PREMIUM', 'IMAGE_FAST', 'IMAGE_QUALITY')),
  provider text not null,
  model text not null,
  prompt_key text,
  prompt_version int,
  effort text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  estimated_cost_usd numeric(10, 6) not null default 0,
  latency_ms int,
  status text not null check (status in ('success', 'error', 'refused', 'invalid_output')),
  error_code text,
  review_score numeric(4, 3),
  created_at timestamptz not null default now()
);

create index ai_runs_created_idx on public.ai_runs (created_at desc);
create index ai_runs_workspace_idx on public.ai_runs (workspace_id, created_at desc);
create index ai_runs_job_idx on public.ai_runs (job_id);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z_]+$'),
  version int not null check (version > 0),
  content text not null,
  content_hash text not null,
  schema_version int not null,
  active boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (key, version)
);

create unique index prompt_versions_one_active_idx on public.prompt_versions (key) where active;

create table public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

create table public.stripe_events (
  stripe_event_id text primary key,
  type text not null,
  processed_at timestamptz not null default now(),
  payload_summary jsonb not null default '{}'::jsonb
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (name ~ '^[a-z_]+$'),
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index product_events_name_idx on public.product_events (name, created_at desc);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

-- Ventana fija. Registra el intento y devuelve true si la acción está PERMITIDA (hits <= max).
-- Nota: el nombre deja claro que true = permitido. Úsalo así: if not rate_limit_allowed(...) then reject.
create or replace function public.rate_limit_allowed(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

revoke execute on function public.rate_limit_allowed(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_allowed(text, int, int) to service_role;

alter table public.ai_runs enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.app_settings enable row level security;
alter table public.stripe_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.product_events enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.ai_runs, public.prompt_versions, public.app_settings, public.stripe_events,
  public.audit_logs, public.product_events, public.rate_limits from anon, authenticated;
