-- Adaptaula · 012 · ai_runs: tokens escritos en la caché de prompts
-- El proveedor factura la escritura en caché (1,25× el precio de entrada) aparte de la entrada normal y de las lecturas
-- de caché. Sin esta columna el coste estimado no se podía reconstruir a partir de los tokens registrados.
-- input_tokens = solo la entrada no cacheada; la entrada total es input + cached_input + cache_creation_input.

alter table public.ai_runs
  add column cache_creation_input_tokens int not null default 0 check (cache_creation_input_tokens >= 0);
