-- Adaptaula · 034 · Reglas pedagógicas privadas del planificador (ADR-045)
-- Bucket privado `agent-rules`: solo el servidor lo lee, con service role. Ningún rol de usuario tiene política sobre él,
-- así que la RLS de storage.objects niega listar, leer, subir o borrar a cualquier cliente. Los archivos se suben fuera de la
-- aplicación (scripts/agent-rules/upload.mjs) y se verifican contra el manifiesto de huellas del repositorio.
-- ai_runs.rules_sha256: huella del paquete de reglas usado por una llamada (nunca su contenido). Nula para las demás llamadas.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-rules', 'agent-rules', false, 1048576, array['text/markdown', 'application/json'])
on conflict (id) do update set public = false;

alter table public.ai_runs
  add column if not exists rules_sha256 text
  check (rules_sha256 is null or rules_sha256 ~ '^[a-f0-9]{64}$');
