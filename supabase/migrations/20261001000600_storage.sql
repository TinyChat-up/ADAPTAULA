-- Adaptaula · 006 · Storage: buckets privados y políticas
-- Ruta de los objetos: <workspace_id>/<material_o_adaptacion_id>/<fichero>
-- Lectura: miembros del workspace. Escritura: solo con URL firmada emitida por el servidor o service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('source-materials', 'source-materials', false, 26214400,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('generated-assets', 'generated-assets', false, 10485760,
    array['image/png', 'image/webp', 'image/jpeg']),
  ('exports', 'exports', false, 52428800,
    array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "adaptaula: miembros leen los archivos de su workspace" on storage.objects;

create policy "adaptaula: miembros leen los archivos de su workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('source-materials', 'generated-assets', 'exports')
    and public.is_workspace_member(public.try_uuid((storage.foldername(name))[1]))
  );
