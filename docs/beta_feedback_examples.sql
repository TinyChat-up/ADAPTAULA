create table if not exists public.adaptation_feedback (
  id uuid primary key default gen_random_uuid(),
  adaptation_id uuid not null references public.adaptations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('useful', 'partial', 'not_useful')),
  comment text default ''::text,
  created_at timestamptz not null default now()
);

create index if not exists idx_adaptation_feedback_user_adaptation
on public.adaptation_feedback(user_id, adaptation_id);

create table if not exists public.approved_adaptation_examples (
  id uuid primary key default gen_random_uuid(),
  adaptation_id uuid not null references public.adaptations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_text text not null,
  generated_output_html text not null,
  final_edited_html text not null,
  config_json jsonb not null default '{}'::jsonb,
  style_id uuid,
  template_id uuid,
  output_format text not null,
  student_profile text not null,
  visual_support_level text not null default 'medio'::text,
  feedback_rating text,
  feedback_comment text,
  was_approved boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_approved_examples_user_created
on public.approved_adaptation_examples(user_id, created_at desc);

alter table public.adaptation_feedback enable row level security;
alter table public.approved_adaptation_examples enable row level security;

drop policy if exists "adaptation_feedback_select_own" on public.adaptation_feedback;
create policy "adaptation_feedback_select_own"
on public.adaptation_feedback
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "adaptation_feedback_insert_own" on public.adaptation_feedback;
create policy "adaptation_feedback_insert_own"
on public.adaptation_feedback
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "approved_examples_select_own" on public.approved_adaptation_examples;
create policy "approved_examples_select_own"
on public.approved_adaptation_examples
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "approved_examples_insert_own" on public.approved_adaptation_examples;
create policy "approved_examples_insert_own"
on public.approved_adaptation_examples
for insert
to authenticated
with check (auth.uid() = user_id);
