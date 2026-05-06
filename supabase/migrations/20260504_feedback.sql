create table if not exists public.adaptation_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  adaptation_id uuid references public.adaptations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  rating smallint not null check (rating in (1, -1)),
  tags text[] default '{}',
  comment text,
  subject text,
  support_degree text,
  learning_profile text
);

alter table public.adaptation_feedback enable row level security;

create policy "Users can insert own feedback"
  on public.adaptation_feedback for insert
  with check (auth.uid() = user_id or user_id is null);

create policy "Admins can read all feedback"
  on public.adaptation_feedback for select
  using (auth.uid() in (
    select id from public.profiles where role = 'admin'
  ));
