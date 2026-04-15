create table if not exists public.document_library_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  materia text not null check (materia in ('lengua', 'mates')),
  modo text not null check (modo in ('simplificacion', 'reduccion', 'pictogramas', 'esquema', 'escritura')),
  perfil_funcional text not null check (perfil_funcional in ('apoyo_visual_alto', 'lectoescritura_inicial', 'escritura_guiada', 'simplificacion_lectora')),
  source_text text not null,
  adapted_html text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_library_examples_user_id
on public.document_library_examples(user_id);

create index if not exists idx_document_library_examples_lookup
on public.document_library_examples(user_id, materia, modo, perfil_funcional, created_at desc);

alter table public.document_library_examples enable row level security;

drop policy if exists "document_library_examples_select_own" on public.document_library_examples;
create policy "document_library_examples_select_own"
on public.document_library_examples
for select
using (auth.uid() = user_id);

drop policy if exists "document_library_examples_insert_own" on public.document_library_examples;
create policy "document_library_examples_insert_own"
on public.document_library_examples
for insert
with check (auth.uid() = user_id);

drop policy if exists "document_library_examples_update_own" on public.document_library_examples;
create policy "document_library_examples_update_own"
on public.document_library_examples
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "document_library_examples_delete_own" on public.document_library_examples;
create policy "document_library_examples_delete_own"
on public.document_library_examples
for delete
using (auth.uid() = user_id);
