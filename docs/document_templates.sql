create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text default ''::text,
  output_format text not null,
  visual_support_level text default 'medio'::text,
  template_html text not null,
  template_schema jsonb,
  source_adaptation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_templates_user_id
on public.document_templates(user_id);

create index if not exists idx_document_templates_user_format
on public.document_templates(user_id, output_format);

alter table public.document_templates enable row level security;

drop policy if exists "document_templates_select_own" on public.document_templates;
create policy "document_templates_select_own"
on public.document_templates
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "document_templates_insert_own" on public.document_templates;
create policy "document_templates_insert_own"
on public.document_templates
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "document_templates_update_own" on public.document_templates;
create policy "document_templates_update_own"
on public.document_templates
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "document_templates_delete_own" on public.document_templates;
create policy "document_templates_delete_own"
on public.document_templates
for delete
to authenticated
using (auth.uid() = user_id);
