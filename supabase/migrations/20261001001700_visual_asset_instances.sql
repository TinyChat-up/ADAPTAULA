-- Adaptaula · 017 · Instancias físicas de los recortes visuales
--
-- `identity` es el recorte LÓGICO (localizador + receta). Cada PNG producido es una INSTANCIA física inmutable con su propio
-- sha256: el mismo recorte lógico puede tener varias, porque un render válido no tiene por qué ser byte a byte idéntico en
-- otro runtime (otra versión de Node, glibc o Skia). Antes se exigía una sola fila por identidad, y una regeneración válida
-- con otros bytes acababa marcada como `asset_corrupt` para siempre.
--
-- No mueve ni modifica filas ni objetos: cada asset existente pasa a ser la instancia única de su identidad y conserva su
-- `storage_path`. Siguen igual la inmutabilidad, la unicidad de `storage_path`, la RLS y los permisos.

alter table public.material_visual_assets drop constraint material_visual_assets_identity_key;

-- Un mismo par (recorte lógico, bytes) es una sola instancia: dos productores que generan los mismos bytes a la vez dejan una fila.
alter table public.material_visual_assets
  add constraint material_visual_assets_identity_sha256_key unique (identity, sha256);

-- Resolución de instancias de un recorte lógico: de la más reciente a la más antigua (created_at desc, id desc).
create index material_visual_assets_identity_idx on public.material_visual_assets (identity, created_at desc, id desc);
